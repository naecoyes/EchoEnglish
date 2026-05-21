const fs = require("node:fs/promises");
const path = require("node:path");
const { ensureDir, pathExists } = require("./utils");

const API_URL = "https://api.minimaxi.com/v1/music_generation";

async function generateMusic({ outputDir, apiKey, model, prompt }) {
  if (!apiKey) {
    throw new Error("MINIMAX_API_KEY is required for MiniMax music generation.");
  }

  const musicDir = path.join(outputDir, "music");
  await ensureDir(musicDir);
  const musicPath = path.join(musicDir, "background.mp3");

  if (await pathExists(musicPath)) {
    return {
      provider: "minimax",
      model,
      prompt,
      musicPath,
      reused: true,
      extraInfo: null
    };
  }

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

  await fs.writeFile(musicPath, Buffer.from(hexAudio, "hex"));

  return {
    provider: "minimax",
    model,
    prompt,
    musicPath,
    extraInfo: payload.extra_info || null
  };
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
