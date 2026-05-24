const fs = require("node:fs/promises");
const path = require("node:path");
const { ensureDir, pathExists } = require("./utils");
const { initImageManifest, updateImageManifest } = require("./outputManifests");
const { fetchBufferWithPolicy, fetchJsonWithPolicy } = require("./apiLimiter");
const { validateImageOrThrow } = require("./imageQuality");

const API_URL = "https://api.minimaxi.com/v1/image_generation";

async function generateImages({ scenes, outputDir, apiKey, model, aspectRatio, promptOptimizer }) {
  if (!apiKey) {
    throw new Error("MINIMAX_API_KEY is required for MiniMax image generation.");
  }

  const imagesDir = path.join(outputDir, "images");
  await ensureDir(imagesDir);
  await initImageManifest(outputDir, scenes);

  const results = [];
  for (let index = 0; index < scenes.length; index += 1) {
    const scene = scenes[index];
    const cachedPath = await findExistingImage(imagesDir, scene.id);
    if (cachedPath) {
      const quality = await validateCachedImage(cachedPath, imagesDir, scene.id);
      if (!quality) {
        await updateImageManifest(outputDir, scene.id, {
          status: "pending",
          imagePath: null,
          error: "Cached image failed quality checks and will be regenerated."
        });
      } else {
      await updateImageManifest(outputDir, scene.id, {
        status: "completed",
        imagePath: cachedPath,
        quality,
        error: null
      });
      results.push({
        sceneId: scene.id,
        imageUrl: null,
        imagePath: cachedPath,
        cached: true
      });
      continue;
      }
    }

    await updateImageManifest(outputDir, scene.id, {
      status: "running",
      attempts: 0,
      error: null
    });

    let imageUrl = null;
    let outputPath = null;
    try {
      const generated = await generateValidatedImage({
        scene,
        imagesDir,
        outputDir,
        apiKey,
        model,
        aspectRatio,
        promptOptimizer
      });
      imageUrl = generated.imageUrl;
      outputPath = generated.outputPath;
    } catch (error) {
      await updateImageManifest(outputDir, scene.id, {
        status: "failed",
        imagePath: null,
        error: error.message
      });
      throw error;
    }
    await updateImageManifest(outputDir, scene.id, {
      status: "completed",
      imagePath: outputPath,
      error: null
    });
    results.push({
      sceneId: scene.id,
      imageUrl,
      imagePath: outputPath
    });
  }

  return results;
}

async function generateValidatedImage({ scene, imagesDir, outputDir, apiKey, model, aspectRatio, promptOptimizer }) {
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await updateImageManifest(outputDir, scene.id, {
      status: "running",
      attempts: attempt,
      error: null
    });
    try {
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
      const quality = await validateImageOrThrow(outputPath);
      await updateImageManifest(outputDir, scene.id, {
        quality,
        error: null
      });
      return { imageUrl, outputPath, quality };
    } catch (error) {
      lastError = error;
      await updateImageManifest(outputDir, scene.id, {
        status: "running",
        error: error.message,
        quality: error.quality || null
      });
      await deleteSceneImage(imagesDir, scene.id);
      if (!isImageQualityError(error)) throw error;
    }
  }
  throw lastError;
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

  const payload = await fetchJsonWithPolicy("minimax:image", API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  const statusCode = payload?.base_resp?.status_code;
  if (statusCode !== 0 && statusCode !== undefined) {
    const statusMsg = payload?.base_resp?.status_msg || "unknown error";
    throw new Error(`MiniMax image API failed: ${statusMsg}`);
  }

  const imageUrl = payload?.data?.image_urls?.[0];
  if (!imageUrl) {
    throw new Error("MiniMax image response did not include an image URL.");
  }

  return imageUrl;
}

async function validateCachedImage(cachedPath, imagesDir, sceneId) {
  try {
    return await validateImageOrThrow(cachedPath);
  } catch {
    await deleteSceneImage(imagesDir, sceneId);
    return null;
  }
}

async function downloadImageWithRetry(imageUrl, sceneId) {
  try {
    return await fetchBufferWithPolicy("download:image", imageUrl);
  } catch (error) {
    throw new Error(`Failed to download generated image for ${sceneId}: ${error.message}`);
  }
}

function buildPrompt(scene) {
  return [
    "16:9 documentary-style illustration, modern technology startup history video.",
    `Scene: ${scene.visual}.`,
    "Clean cinematic composition, orange Xiaomi-inspired accent, no logos, no readable text, suitable for business history narration."
  ].join(" ");
}

async function deleteSceneImage(imagesDir, sceneId) {
  for (const ext of [".png", ".jpg", ".jpeg", ".webp"]) {
    const candidate = path.join(imagesDir, `${sceneId}${ext}`);
    if (await pathExists(candidate)) {
      await fs.unlink(candidate).catch(() => {});
    }
  }
}

function isImageQualityError(error) {
  return Boolean(error?.quality);
}

module.exports = {
  generateImages
};
