const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { ensureDir, pathExists } = require("./utils");
const { initAudioManifest, updateAudioManifest } = require("./outputManifests");
const { fetchBufferWithPolicy } = require("./apiLimiter");

const execFileAsync = promisify(execFile);

async function createAudio({ readingItems, outputDir, apiKey, baseUrl, ttsBaseUrl, model, voice, speed, requestIntervalMs, logs = [] }) {
  if (!apiKey) {
    throw new Error("XIAOMI_API_KEY is required for Xiaomi TTS.");
  }

  await assertCommand("ffmpeg", ["-version"]);
  await assertCommand("ffprobe", ["-version"]);

  const apiModel = normalizeTtsModel(model);
  const apiBaseUrl = (ttsBaseUrl || baseUrl || "https://api.xiaomimimo.com/v1").replace(/\/$/, "");
  const apiUrl = `${apiBaseUrl}/${usesChatCompletions(apiModel) ? "chat/completions" : "audio/speech"}`;
  const workDir = path.join(outputDir, "audio-work");
  await ensureDir(workDir);
  const cacheDir = path.join(path.dirname(outputDir), ".tts-cache");
  await ensureDir(cacheDir);

  const concatFiles = [];
  const timedItems = [];
  let cursor = 0;
  let lastRequestAt = 0;
  let apiRequestCount = 0;
  let cacheHitCount = 0;
  const minimumRequestIntervalMs = Number.isFinite(Number(requestIntervalMs))
    ? Math.max(0, Number(requestIntervalMs))
    : 3500;

  const total = readingItems.length;
  await initAudioManifest(outputDir, readingItems);
  for (let index = 0; index < readingItems.length; index += 1) {
    const item = readingItems[index];
    pushLog(logs, `Audio ${index + 1}/${total}: ${item.text.slice(0, 60)}${item.text.length > 60 ? "…" : ""}`);
    const speechText = item.ttsText || item.text;

    const baseName = String(index + 1).padStart(4, "0");
    const selectedVoice = item.voice || voice;
    const cacheKey = createCacheKey({ model: apiModel, voice: selectedVoice, text: speechText, speed });
    const wavPath = path.join(cacheDir, `${cacheKey}.wav`);
    await updateAudioManifest(outputDir, item.id, {
      status: "running",
      cacheKey,
      path: wavPath,
      error: null
    });

    let spokenSeconds = null;
    try {
      spokenSeconds = await getCachedDuration(wavPath);
      if (spokenSeconds) {
        cacheHitCount += 1;
      } else {
        await waitForRequestSlot(lastRequestAt, minimumRequestIntervalMs);
        lastRequestAt = Date.now();
        apiRequestCount += 1;

        const mp3Path = path.join(workDir, `${baseName}-${cacheKey}.mp3`);
        const audioBytes = await synthesizeXiaomi({
          apiUrl,
          apiKey,
          model: apiModel,
          voice: selectedVoice,
          text: speechText,
          speed
        });

        await fs.writeFile(mp3Path, audioBytes);
        await execFileAsync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-i", mp3Path, "-ar", "44100", "-ac", "1", wavPath], {
          maxBuffer: 1024 * 1024 * 16
        });
        spokenSeconds = await getDurationSeconds(wavPath);
      }
    } catch (error) {
      await updateAudioManifest(outputDir, item.id, {
        status: "failed",
        cacheKey,
        path: wavPath,
        error: error.message
      });
      throw error;
    }

    if (!spokenSeconds) {
      await updateAudioManifest(outputDir, item.id, {
        status: "failed",
        cacheKey,
        path: wavPath,
        error: `Duration could not be read for ${item.id}.`
      });
      throw new Error(`Xiaomi returned audio but duration could not be read for ${item.id}.`);
    }
    await updateAudioManifest(outputDir, item.id, {
      status: "completed",
      cacheKey,
      durationSeconds: spokenSeconds,
      path: wavPath,
      error: null
    });

    concatFiles.push(wavPath);

    const pauseSeconds = Number(item.pauseAfterSeconds || 0);
    const displayEnd = cursor + spokenSeconds + pauseSeconds;
    timedItems.push({
      ...item,
      startSeconds: cursor,
      endSeconds: displayEnd,
      spokenSeconds
    });

    cursor += spokenSeconds;

    if (pauseSeconds > 0) {
      const silencePath = await getSilenceFile(workDir, pauseSeconds);
      concatFiles.push(silencePath);
      cursor += pauseSeconds;
    }
  }

  pushLog(logs, `TTS API requests: ${apiRequestCount}; cache hits: ${cacheHitCount}.`);
  pushLog(logs, `Merging ${concatFiles.length} audio clips into audio.wav…`);
  const concatPath = path.join(workDir, "concat.txt");
  await fs.writeFile(concatPath, concatFiles.map((file) => `file '${escapeConcatPath(file)}'`).join("\n"));

  const audioPath = path.join(outputDir, "audio.wav");
  await execFileAsync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", concatPath, "-c", "copy", audioPath], {
    maxBuffer: 1024 * 1024 * 16
  });

  return {
    provider: "xiaomi",
    audioPath,
    voice,
    model: apiModel,
    configuredModel: model,
    durationSeconds: cursor,
    fallbackCount: 0,
    items: timedItems
  };
}

async function getCachedDuration(wavPath) {
  if (!(await pathExists(wavPath))) return null;
  return getDurationSeconds(wavPath).catch(() => null);
}

function createCacheKey({ model, voice, text, speed }) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify({ model, voice, text, speed }))
    .digest("hex");
}

function normalizeTtsModel(model) {
  const value = String(model || "mimo-v2.5-tts").trim();
  const lower = value.toLowerCase();
  if (lower === "mimo-v2.5-tts") return "mimo-v2.5-tts";
  if (lower === "mimo-v2-tts") return "mimo-v2-tts";
  return lower;
}

function usesChatCompletions(model) {
  return String(model || "").toLowerCase() === "mimo-v2.5-tts";
}

async function waitForRequestSlot(lastRequestAt, minimumRequestIntervalMs) {
  if (!lastRequestAt || minimumRequestIntervalMs <= 0) return;
  const elapsed = Date.now() - lastRequestAt;
  const waitMs = minimumRequestIntervalMs - elapsed;
  if (waitMs > 0) await delay(waitMs);
}

async function synthesizeXiaomi({ apiUrl, apiKey, model, voice, text, speed }) {
  if (usesChatCompletions(model)) {
    return synthesizeXiaomiChat({ apiUrl, apiKey, model, voice, text });
  }

  const body = {
    model,
    input: text,
    voice: voice || "alloy",
    response_format: "mp3"
  };
  if (speed) body.speed = Number(speed);

  return await fetchWithRetry(apiUrl, {
    method: "POST",
    headers: {
      "api-key": apiKey,
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
}

async function synthesizeXiaomiChat({ apiUrl, apiKey, model, voice, text }) {
  const body = {
    model,
    messages: [
      {
        role: "assistant",
        content: text
      }
    ],
    modalities: ["text", "audio"],
    audio: {
      voice: voice || "Mia",
      format: "wav"
    }
  };

  const payload = await fetchJsonWithRetry(apiUrl, {
    method: "POST",
    headers: {
      "api-key": apiKey,
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  const audioData = payload?.choices?.[0]?.message?.audio?.data || payload?.audio?.data || payload?.data;
  if (!audioData) {
    throw new Error("Xiaomi TTS response did not include audio data.");
  }
  return Buffer.from(audioData, "base64");
}

async function fetchWithRetry(url, options) {
  let lastError = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const response = await fetch(url, options);
      if (response.status === 429 || response.status >= 500) {
        throw new Error(`HTTP ${response.status}`);
      }

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        throw new Error(formatXiaomiTtsError(response.status, errorText, url));
      }

      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } catch (error) {
      lastError = error;
    }

    await delay(1500 * (attempt + 1));
  }

  throw lastError;
}

async function fetchJsonWithRetry(url, options) {
  let lastError = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const response = await fetch(url, options);
      const text = await response.text().catch(() => "");
      const payload = text ? JSON.parse(text) : null;
      if (response.status === 429 || response.status >= 500) {
        throw new Error(`HTTP ${response.status}`);
      }
      if (!response.ok) {
        throw new Error(formatXiaomiTtsError(response.status, text, url));
      }
      return payload;
    } catch (error) {
      lastError = error;
    }
    await delay(1500 * (attempt + 1));
  }
  throw lastError;
}

function formatXiaomiTtsError(status, errorText, url) {
  const compact = String(errorText || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (status === 404) {
    return `Xiaomi TTS endpoint not found at ${url}. Check ttsBaseUrl in settings.`;
  }
  if (status === 401) {
    return `Xiaomi TTS authentication failed. Check xiaomi.apiKey in settings.`;
  }
  try {
    const parsed = JSON.parse(errorText);
    if (parsed?.error?.message) {
      return `Xiaomi TTS error: ${parsed.error.message}`;
    }
  } catch {}
  return `Xiaomi TTS request failed with HTTP ${status}${compact ? `: ${compact.slice(0, 160)}` : ""}`;
}

async function getSilenceFile(workDir, seconds) {
  const normalized = normalizeSilenceSeconds(seconds);
  const file = path.join(workDir, `silence_${normalized.replace(".", "_")}.wav`);
  if (await pathExists(file)) {
    return file;
  }

  await execFileAsync("ffmpeg", [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "anullsrc=r=44100:cl=mono",
    "-t",
    normalized,
    "-ar",
    "44100",
    "-ac",
    "1",
    file
  ], {
    maxBuffer: 1024 * 1024 * 8
  });

  return file;
}

function normalizeSilenceSeconds(seconds) {
  const value = Number(seconds);
  const safeValue = Number.isFinite(value) ? Math.max(0, value) : 0;
  return safeValue.toFixed(3).replace(/0+$/, "").replace(/\.$/, ".0");
}

async function getDurationSeconds(file) {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    file
  ], {
    maxBuffer: 1024 * 1024
  });

  const duration = Number(stdout.trim());
  return Number.isFinite(duration) ? duration : null;
}

async function assertCommand(command, args) {
  try {
    await execFileAsync(command, args, { maxBuffer: 1024 * 1024 });
  } catch (error) {
    throw new Error(`Required command failed: ${command}. ${error.message}`);
  }
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

module.exports = {
  createAudio
};
