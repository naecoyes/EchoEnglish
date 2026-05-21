const fs = require("node:fs/promises");
const path = require("node:path");
const { ensureDir, pathExists } = require("./utils");

const API_URL = "https://api.minimaxi.com/v1/image_generation";

async function generateImages({ scenes, outputDir, apiKey, model, aspectRatio, promptOptimizer }) {
  if (!apiKey) {
    throw new Error("MINIMAX_API_KEY is required for MiniMax image generation.");
  }

  const imagesDir = path.join(outputDir, "images");
  await ensureDir(imagesDir);

  const results = [];
  for (let index = 0; index < scenes.length; index += 1) {
    const scene = scenes[index];
    const cachedPath = await findExistingImage(imagesDir, scene.id);
    if (cachedPath) {
      results.push({
        sceneId: scene.id,
        imageUrl: null,
        imagePath: cachedPath,
        cached: true
      });
      continue;
    }

    const imageUrl = await requestImage({
      apiKey,
      model,
      prompt: scene.imagePrompt || buildPrompt(scene),
      aspectRatio,
      promptOptimizer
    });

    const bytes = await downloadImageWithRetry(imageUrl, scene.id);
    const outputPath = path.join(imagesDir, `${scene.id}${detectImageExtension(bytes)}`);
    await fs.writeFile(outputPath, bytes);
    results.push({
      sceneId: scene.id,
      imageUrl,
      imagePath: outputPath
    });
  }

  return results;
}

async function findExistingImage(imagesDir, sceneId) {
  const candidates = [".png", ".jpg", ".jpeg", ".webp"].map((ext) => path.join(imagesDir, `${sceneId}${ext}`));
  for (const candidate of candidates) {
    if (await pathExists(candidate)) return candidate;
  }
  return null;
}

function detectImageExtension(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return ".jpg";
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return ".png";
  }
  if (
    bytes.slice(0, 4).toString("ascii") === "RIFF" &&
    bytes.slice(8, 12).toString("ascii") === "WEBP"
  ) {
    return ".webp";
  }
  return ".png";
}

async function requestImage({ apiKey, model, prompt, aspectRatio, promptOptimizer }) {
  const body = {
    model,
    prompt,
    aspect_ratio: aspectRatio,
    response_format: "url",
    n: 1,
    prompt_optimizer: promptOptimizer,
    aigc_watermark: false
  };

  const payload = await fetchWithRetry(API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  const imageUrl = payload?.data?.image_urls?.[0];
  if (!imageUrl) {
    throw new Error("MiniMax image response did not include an image URL.");
  }

  return imageUrl;
}

async function downloadImageWithRetry(imageUrl, sceneId) {
  let lastError = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const response = await fetch(imageUrl);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      lastError = error;
      await delay(1500 * (attempt + 1));
    }
  }
  throw new Error(`Failed to download generated image for ${sceneId}: ${lastError.message}`);
}

function buildPrompt(scene) {
  return [
    "16:9 documentary-style illustration, modern technology startup history video.",
    `Scene: ${scene.visual}.`,
    "Clean cinematic composition, orange Xiaomi-inspired accent, no logos, no readable text, suitable for business history narration."
  ].join(" ");
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

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  generateImages
};
