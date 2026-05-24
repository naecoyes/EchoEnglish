const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { ensureDir, pathExists } = require("./utils");
const { initAudioManifest, updateAudioManifest } = require("./outputManifests");

const execFileAsync = promisify(execFile);

async function createAudio({ readingItems, outputDir, apiKey, baseUrl, model, voice, requestIntervalMs, logs = [] }) {
  if (!apiKey) throw new Error("Google API key is required for Gemini TTS.");
  await assertCommand("ffmpeg", ["-version"]);
  await assertCommand("ffprobe", ["-version"]);

  const workDir = path.join(outputDir, "audio-work");
  const cacheDir = path.join(path.dirname(outputDir), ".tts-cache");
  await ensureDir(workDir);
  await ensureDir(cacheDir);
  await initAudioManifest(outputDir, readingItems);

  const concatFiles = [];
  const timedItems = [];
  let cursor = 0;
  let lastRequestAt = 0;
  let apiRequestCount = 0;
  let cacheHitCount = 0;
  const total = readingItems.length;
  const minimumRequestIntervalMs = Number.isFinite(Number(requestIntervalMs)) ? Math.max(0, Number(requestIntervalMs)) : 1500;

  for (let index = 0; index < readingItems.length; index += 1) {
    const item = readingItems[index];
    const speechText = item.ttsText || item.text;
    const cacheKey = createCacheKey({ model, voice, text: speechText });
    const wavPath = path.join(cacheDir, `${cacheKey}.wav`);
    pushLog(logs, `Audio ${index + 1}/${total}: ${item.text.slice(0, 60)}${item.text.length > 60 ? "…" : ""}`);
    await updateAudioManifest(outputDir, item.id, { status: "running", cacheKey, path: wavPath, error: null });

    let spokenSeconds = null;
    try {
      spokenSeconds = await getCachedDuration(wavPath);
      if (spokenSeconds) {
        cacheHitCount += 1;
      } else {
        await waitForRequestSlot(lastRequestAt, minimumRequestIntervalMs);
        lastRequestAt = Date.now();
        apiRequestCount += 1;
        const pcmBytes = await synthesizeGoogle({ apiKey, baseUrl, model, voice, text: speechText });
        await fs.writeFile(wavPath, pcmToWav(pcmBytes, 24000, 1, 16));
        spokenSeconds = await getDurationSeconds(wavPath);
      }
    } catch (error) {
      await updateAudioManifest(outputDir, item.id, { status: "failed", cacheKey, path: wavPath, error: error.message });
      throw error;
    }

    if (!spokenSeconds) throw new Error(`Google returned audio but duration could not be read for ${item.id}.`);
    await updateAudioManifest(outputDir, item.id, { status: "completed", cacheKey, durationSeconds: spokenSeconds, path: wavPath, error: null });
    concatFiles.push(wavPath);

    const displayEnd = cursor + spokenSeconds + Math.min(item.pauseAfterSeconds, 1.2);
    timedItems.push({ ...item, startSeconds: cursor, endSeconds: displayEnd, spokenSeconds });
    cursor += spokenSeconds;
    if (item.pauseAfterSeconds > 0) {
      const silencePath = await getSilenceFile(workDir, item.pauseAfterSeconds);
      concatFiles.push(silencePath);
      cursor += item.pauseAfterSeconds;
    }
  }

  pushLog(logs, `TTS API requests: ${apiRequestCount}; cache hits: ${cacheHitCount}.`);
  const concatPath = path.join(workDir, "concat.txt");
  await fs.writeFile(concatPath, concatFiles.map((file) => `file '${escapeConcatPath(file)}'`).join("\n"));
  const audioPath = path.join(outputDir, "audio.wav");
  await execFileAsync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", concatPath, "-c", "copy", audioPath], {
    maxBuffer: 1024 * 1024 * 16
  });

  return { provider: "google", audioPath, voice, model, durationSeconds: cursor, fallbackCount: 0, items: timedItems };
}

async function synthesizeGoogle({ apiKey, baseUrl, model, voice, text }) {
  const selectedModel = model || "gemini-2.5-flash-preview-tts";
  const url = `${(baseUrl || "https://generativelanguage.googleapis.com/v1beta").replace(/\/$/, "")}/models/${encodeURIComponent(selectedModel)}:generateContent`;
  const payload = await fetchWithRetry(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey
    },
    body: JSON.stringify({
      model: selectedModel,
      contents: [{ parts: [{ text }] }],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: voice || "Kore" }
          }
        }
      }
    })
  });
  const part = payload?.candidates?.[0]?.content?.parts?.find((candidate) => candidate.inlineData?.data);
  if (!part?.inlineData?.data) throw new Error("Google TTS response did not include audio data.");
  return Buffer.from(part.inlineData.data, "base64");
}

async function fetchWithRetry(url, options) {
  let lastError = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const response = await fetch(url, options);
      const payload = await response.json().catch(() => null);
      if (response.status === 429 || response.status >= 500) throw new Error(`HTTP ${response.status}`);
      if (!response.ok) throw new Error(`Google TTS failed with HTTP ${response.status}. ${payload?.error?.message || ""}`.trim());
      return payload;
    } catch (error) {
      lastError = error;
      await delay(1400 * (attempt + 1));
    }
  }
  throw lastError;
}

function pcmToWav(pcmBytes, sampleRate, channels, bitsPerSample) {
  const dataSize = pcmBytes.length;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * bitsPerSample / 8, 28);
  header.writeUInt16LE(channels * bitsPerSample / 8, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, pcmBytes]);
}

async function getCachedDuration(file) {
  if (!(await pathExists(file))) return null;
  return getDurationSeconds(file).catch(() => null);
}

async function getDurationSeconds(file) {
  const { stdout } = await execFileAsync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", file], {
    maxBuffer: 1024 * 1024
  });
  const duration = Number(stdout.trim());
  return Number.isFinite(duration) ? duration : null;
}

async function getSilenceFile(workDir, seconds) {
  const normalized = Number(seconds || 0).toFixed(3).replace(/0+$/, "").replace(/\.$/, ".0");
  const file = path.join(workDir, `silence_${normalized.replace(".", "_")}.wav`);
  if (await pathExists(file)) return file;
  await execFileAsync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "anullsrc=r=24000:cl=mono", "-t", normalized, "-ar", "24000", "-ac", "1", file], {
    maxBuffer: 1024 * 1024 * 8
  });
  return file;
}

async function waitForRequestSlot(lastRequestAt, minimumRequestIntervalMs) {
  if (!lastRequestAt || minimumRequestIntervalMs <= 0) return;
  const waitMs = minimumRequestIntervalMs - (Date.now() - lastRequestAt);
  if (waitMs > 0) await delay(waitMs);
}

async function assertCommand(command, args) {
  try {
    await execFileAsync(command, args, { maxBuffer: 1024 * 1024 });
  } catch (error) {
    throw new Error(`Required command failed: ${command}. ${error.message}`);
  }
}

function createCacheKey(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function escapeConcatPath(file) {
  return file.replace(/'/g, "'\\''");
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pushLog(logs, message) {
  if (Array.isArray(logs)) logs.push(`[${new Date().toISOString()}] ${message}`);
}

module.exports = { createAudio };
