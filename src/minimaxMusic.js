const fs = require("node:fs/promises");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { ensureDir, pathExists } = require("./utils");
const { completeMusicManifest, initMusicManifest, updateMusicManifest } = require("./outputManifests");

const API_URL = "https://api.minimaxi.com/v1/music_generation";
const execFileAsync = promisify(execFile);

async function generateMusic({ outputDir, apiKey, model, prompt, count = 3 }) {
  if (!apiKey) {
    throw new Error("MINIMAX_API_KEY is required for MiniMax music generation.");
  }

  const musicDir = path.join(outputDir, "music");
  await ensureDir(musicDir);
  const musicPath = path.join(musicDir, "background.mp3");
  const trackCount = Math.max(1, Math.min(4, Math.round(Number(count || 3))));
  await initMusicManifest(outputDir, trackCount);

  const existingTracks = await listExistingTracks(musicDir);
  if (await pathExists(musicPath) && existingTracks.length >= trackCount) {
    await completeMusicManifest(outputDir, musicPath);
    return {
      provider: "minimax",
      model,
      prompt,
      musicPath,
      tracks: existingTracks,
      reused: true,
      extraInfo: null
    };
  }

  const tracks = [];
  for (let index = 0; index < trackCount; index += 1) {
    const trackPath = path.join(musicDir, `background-${String(index + 1).padStart(2, "0")}.mp3`);
    if (!(await pathExists(trackPath))) {
      await updateMusicManifest(outputDir, index, {
        status: "running",
        path: trackPath,
        error: null
      });
      try {
        const bytes = await requestMusic({
          apiKey,
          model,
          prompt: buildTrackPrompt(prompt, index, trackCount)
        });
        await fs.writeFile(trackPath, bytes);
      } catch (error) {
        await updateMusicManifest(outputDir, index, {
          status: "failed",
          path: trackPath,
          error: error.message
        });
        throw error;
      }
    }
    await updateMusicManifest(outputDir, index, {
      status: "completed",
      path: trackPath,
      error: null
    });
    tracks.push(trackPath);
  }

  if (tracks.length === 1) {
    await fs.copyFile(tracks[0], musicPath);
  } else {
    await concatMp3Tracks(tracks, musicPath, musicDir);
  }
  await completeMusicManifest(outputDir, musicPath);

  return {
    provider: "minimax",
    model,
    prompt,
    musicPath,
    tracks,
    extraInfo: null
  };
}

async function requestMusic({ apiKey, model, prompt }) {
  const body = {
    model,
    prompt,
    stream: false,
    output_format: "hex",
    is_instrumental: true,
    aigc_watermark: false,
    audio_setting: {
      sample_rate: 44100,
      bitrate: 256000,
      format: "mp3"
    }
  };

  const response = await fetchWithRetry(API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`MiniMax music request failed with HTTP ${response.status}.`);
  }

  const statusCode = payload?.base_resp?.status_code;
  if (statusCode !== 0) {
    const statusMsg = payload?.base_resp?.status_msg || "unknown error";
    throw new Error(`MiniMax music generation failed: ${statusMsg}`);
  }

  const hexAudio = payload?.data?.audio;
  if (!hexAudio || typeof hexAudio !== "string") {
    throw new Error("MiniMax music response did not include hex audio data.");
  }

  return Buffer.from(hexAudio, "hex");
}

async function concatMp3Tracks(tracks, outputPath, musicDir) {
  const concatPath = path.join(musicDir, "concat.txt");
  await fs.writeFile(concatPath, tracks.map((file) => `file '${escapeConcatPath(file)}'`).join("\n"));
  await execFileAsync("ffmpeg", [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    concatPath,
    "-c",
    "copy",
    outputPath
  ], {
    maxBuffer: 1024 * 1024 * 8
  });
}

function buildTrackPrompt(prompt, index, count) {
  const moods = ["opening curiosity", "steady progress", "warm reflection", "hopeful ending"];
  return [
    prompt,
    `segment ${index + 1} of ${count}`,
    `mood: ${moods[index] || "calm documentary"}`,
    "instrumental only, no vocals, no lyrics"
  ].join(", ");
}

async function listExistingTracks(musicDir) {
  try {
    const entries = await fs.readdir(musicDir);
    return entries.filter((entry) => /^background-\d+\.mp3$/.test(entry)).sort().map((entry) => path.join(musicDir, entry));
  } catch {
    return [];
  }
}

function escapeConcatPath(file) {
  return file.replace(/'/g, "'\\''");
}

async function fetchWithRetry(url, options) {
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, options);
      if (response.status !== 429 && response.status < 500) {
        return response;
      }
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(1200 * (attempt + 1));
  }

  throw lastError;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  generateMusic
};
