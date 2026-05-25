const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { ensureDir, pathExists } = require("./utils");
const { initAudioManifest, updateAudioManifest } = require("./outputManifests");
const { fetchJsonWithPolicy } = require("./apiLimiter");

const execFileAsync = promisify(execFile);
const API_URL = "https://api.minimaxi.com/v1/t2a_v2";

async function createAudio({ readingItems, outputDir, apiKey, model, englishVoice, chineseVoice, speed, requestIntervalMs, logs = [] }) {
  if (!apiKey) {
    throw new Error("MINIMAX_API_KEY is required for MiniMax TTS.");
  }

  await assertCommand("ffmpeg", ["-version"]);
  await assertCommand("ffprobe", ["-version"]);

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
    : Number(process.env.MINIMAX_TTS_MIN_INTERVAL_MS || 3500);

  const total = readingItems.length;
  await initAudioManifest(outputDir, readingItems);
  for (let index = 0; index < readingItems.length; index += 1) {
    const item = readingItems[index];
    pushLog(logs, `Audio ${index + 1}/${total}: ${item.text.slice(0, 60)}${item.text.length > 60 ? "…" : ""}`);
    const speechText = item.ttsText || item.text;

    const baseName = String(index + 1).padStart(4, "0");
    const voice = item.voice || (item.language === "zh" ? chineseVoice : englishVoice);
    const languageBoost = item.language === "zh" ? "Chinese" : "English";
    const cacheKey = createCacheKey({ model, voice, text: speechText, speed, languageBoost });
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
        let audioBytes;
        try {
          audioBytes = await synthesizeMiniMax({
            apiKey,
            model,
            voice,
            text: speechText,
            speed,
            languageBoost
          });
        } catch (error) {
          if (!item.voice || item.voice === englishVoice || item.language === "zh") throw error;
          pushLog(logs, `Voice ${item.voice} failed for ${item.speakerName || item.id}; falling back to ${englishVoice}.`);
          audioBytes = await synthesizeMiniMax({
            apiKey,
            model,
            voice: englishVoice,
            text: speechText,
            speed,
            languageBoost
          });
        }

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
      throw new Error(`MiniMax returned audio but duration could not be read for ${item.id}.`);
    }

    await updateAudioManifest(outputDir, item.id, {
      status: "completed",
      cacheKey,
      durationSeconds: spokenSeconds,
      path: wavPath,
      error: null
    });

    concatFiles.push(wavPath);

    const displayEnd = cursor + spokenSeconds + Math.min(item.pauseAfterSeconds, 1.2);
    timedItems.push({
      ...item,
      startSeconds: cursor,
      endSeconds: displayEnd,
      spokenSeconds
    });

    cursor += spokenSeconds;

    if (item.pauseAfterSeconds > 0) {
      const silencePath = await getSilenceFile(workDir, item.pauseAfterSeconds);
      concatFiles.push(silencePath);
      cursor += item.pauseAfterSeconds;
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
    provider: "minimax",
    audioPath,
    englishVoice,
    chineseVoice,
    model,
    durationSeconds: cursor,
    fallbackCount: 0,
    items: timedItems
  };
}

async function getCachedDuration(wavPath) {
  if (!(await pathExists(wavPath))) return null;
  return getDurationSeconds(wavPath).catch(() => null);
}

function createCacheKey({ model, voice, text, speed, languageBoost }) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify({ model, voice, text, speed, languageBoost }))
    .digest("hex");
}

async function waitForRequestSlot(lastRequestAt, minimumRequestIntervalMs) {
  if (!lastRequestAt || minimumRequestIntervalMs <= 0) return;
  const elapsed = Date.now() - lastRequestAt;
  const waitMs = minimumRequestIntervalMs - elapsed;
  if (waitMs > 0) await delay(waitMs);
}

async function synthesizeMiniMax({ apiKey, model, voice, text, speed, languageBoost }) {
  const body = {
    model,
    text,
    stream: false,
    output_format: "hex",
    language_boost: languageBoost,
    voice_setting: {
      voice_id: voice,
      speed,
      vol: 1,
      pitch: 0
    },
    audio_setting: {
      sample_rate: 32000,
      bitrate: 128000,
      format: "mp3",
      channel: 1
    },
    subtitle_enable: false,
    aigc_watermark: false
  };

  const payload = await fetchJsonWithPolicy("minimax:tts", API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  }, {
    minIntervalMs: Number(process.env.MINIMAX_TTS_MIN_INTERVAL_MS || 3500)
  });

  const statusCode = payload?.base_resp?.status_code;
  if (statusCode !== 0 && statusCode !== undefined) {
    const statusMsg = payload?.base_resp?.status_msg || "unknown error";
    throw new Error(`MiniMax TTS API failed: ${statusMsg}`);
  }

  const hexAudio = payload?.data?.audio;
  if (!hexAudio || typeof hexAudio !== "string") {
    throw new Error("MiniMax TTS response did not include hex audio data.");
  }

  return Buffer.from(hexAudio, "hex");
}

async function fetchWithRetry(url, options) {
  let lastError = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const response = await fetch(url, options);
      if (response.status === 429 || response.status >= 500) {
        throw new Error(`HTTP ${response.status}`);
      }

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(`MiniMax request failed with HTTP ${response.status}.`);
      }

      const statusCode = payload?.base_resp?.status_code;
      if (statusCode !== 0 && statusCode !== undefined) {
        const statusMsg = payload?.base_resp?.status_msg || "unknown error";
        if (statusMsg.toLowerCase().includes("rate limit") || statusCode === 1004 || statusCode === 104) {
          throw new Error(`Rate limit hit: ${statusMsg}`);
        }
        const err = new Error(`MiniMax API failed: ${statusMsg}`);
        err.isFinal = true;
        throw err;
      }

      return payload;
    } catch (error) {
      if (error.isFinal) throw error;
      lastError = error;
    }

    await delay(1500 * (attempt + 1));
  }

  throw lastError;
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
