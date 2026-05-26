const fs = require("node:fs/promises");
const path = require("node:path");
const { ensureDir, pathExists } = require("./utils");
const { initImageManifest, updateImageManifest } = require("./outputManifests");
const { fetchBufferWithPolicy, fetchJsonWithPolicy } = require("./apiLimiter");
const { validateImageOrThrow } = require("./imageQuality");

const API_URL = "https://api.minimaxi.com/v1/image_generation";
const MAX_PROMPT_CHARS = 1450;

async function generateImages({ scenes, outputDir, apiKey, model, aspectRatio, promptOptimizer, onProgress }) {
  if (!apiKey) {
    throw new Error("MINIMAX_API_KEY is required for MiniMax image generation.");
  }

  const imagesDir = path.join(outputDir, "images");
  await ensureDir(imagesDir);
  const manifest = await initImageManifest(outputDir, scenes);

  const results = [];
  for (let index = 0; index < scenes.length; index += 1) {
    const scene = scenes[index];
    const manifestItem = manifest.items?.find((item) => item.sceneId === scene.id);
    if (manifestItem?.promptChanged) {
      await deleteSceneImage(imagesDir, scene.id);
      await updateImageManifest(outputDir, scene.id, {
        status: "pending",
        imagePath: null,
        error: "Prompt changed; cached image will be regenerated."
      });
    }
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
    await reportProgress(onProgress, {
      sceneId: scene.id,
      status: "running",
      completed: results.length,
      total: scenes.length,
      index
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
    await reportProgress(onProgress, {
      sceneId: scene.id,
      status: "completed",
      completed: results.length,
      total: scenes.length,
      index
    });
  }

  return results;
}

async function reportProgress(onProgress, progress) {
  if (typeof onProgress !== "function") return;
  await onProgress(progress);
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
        prompt: prepareMiniMaxPrompt(scene),
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
  const safePrompt = limitPrompt(prompt, MAX_PROMPT_CHARS);
  const body = {
    model,
    prompt: safePrompt,
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

function prepareMiniMaxPrompt(scene) {
  const direct = normalizePrompt(scene.imagePrompt || "");
  if (direct && direct.length <= MAX_PROMPT_CHARS) return direct;

  const compact = [
    "16:9 photorealistic cinematic still image for an English shadowing video.",
    scene.title ? `Title: ${scene.title}.` : "",
    scene.templateTitle ? `Video type: ${scene.templateTitle}.` : "",
    scene.visualStyle ? `Style: ${scene.visualStyle}.` : "",
    scene.visual ? `Scene: ${limitPrompt(scene.visual, 360)}.` : "",
    scene.moment ? `Moment: ${limitPrompt(scene.moment, 280)}.` : "",
    "Real documentary photography, one clear focal subject, believable real-world location, natural human scale, 35mm lens look, cinematic depth of field, professional lighting, realistic texture.",
    "Keep lower third clean for bilingual subtitles.",
    "No text, no readable signs, no subtitles, no logos, no watermark, no UI, no cartoon, no vector art, no PPT slide."
  ].filter(Boolean).join(" ");

  if (compact.length <= MAX_PROMPT_CHARS) return compact;
  return limitPrompt(compact, MAX_PROMPT_CHARS);
}

function normalizePrompt(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function limitPrompt(value, maxChars) {
  const text = normalizePrompt(value);
  if (text.length <= maxChars) return text;
  const hardLimit = Math.max(80, maxChars - 1);
  const slice = text.slice(0, hardLimit);
  const sentenceEnd = Math.max(slice.lastIndexOf(". "), slice.lastIndexOf("; "), slice.lastIndexOf(", "));
  const cut = sentenceEnd > Math.floor(maxChars * 0.72) ? slice.slice(0, sentenceEnd + 1) : slice;
  return cut.trim();
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
    "Create a 16:9 photorealistic cinematic still image for an English shadowing video.",
    scene.title ? `Video title: ${scene.title}.` : "",
    scene.templateTitle ? `Video type: ${scene.templateTitle}.` : "",
    scene.visualStyle ? `Visual style: ${scene.visualStyle}.` : "",
    `Scene: ${scene.visual || "clear documentary story moment"}.`,
    "Use realistic documentary photography, one clear focal subject, real location, motivated cinematic light, 35mm lens look, high detail, natural color grade.",
    "Leave the lower third visually clean for subtitles. No text, no readable signs, no subtitles, no logos, no watermark, no UI, no cartoon, no vector art, no PPT slide."
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
