const fs = require("node:fs/promises");
const path = require("node:path");
const { ensureDir, pathExists } = require("./utils");
const { initImageManifest, updateImageManifest } = require("./outputManifests");
const { fetchBufferWithPolicy, fetchJsonWithPolicy } = require("./apiLimiter");
const { validateImageOrThrow } = require("./imageQuality");

const API_URL = "https://api.minimaxi.com/v1/image_generation";
const MAX_PROMPT_CHARS = 1450;

async function generateImages({ scenes, outputDir, apiKey, model, aspectRatio, promptOptimizer, batchSize = 3, onProgress }) {
  if (!apiKey) {
    throw new Error("MINIMAX_API_KEY is required for MiniMax image generation.");
  }

  const imagesDir = path.join(outputDir, "images");
  await ensureDir(imagesDir);
  const manifest = await initImageManifest(outputDir, scenes);
  await removeStaleSceneImages(imagesDir, scenes.map((scene) => scene.id));

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
        promptOptimizer,
        batchSize
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

async function generateValidatedImage({ scene, imagesDir, outputDir, apiKey, model, aspectRatio, promptOptimizer, batchSize = 3 }) {
  if (scene.hasPeople && batchSize > 1) {
    return generateBatchValidatedImage({ scene, imagesDir, outputDir, apiKey, model, aspectRatio, promptOptimizer, batchSize: clampBatchSize(batchSize) });
  }
  return generateSingleValidatedImage({ scene, imagesDir, outputDir, apiKey, model, aspectRatio, promptOptimizer });
}

async function generateSingleValidatedImage({ scene, imagesDir, outputDir, apiKey, model, aspectRatio, promptOptimizer }) {
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await updateImageManifest(outputDir, scene.id, {
      status: "running",
      attempts: attempt,
      error: null
    });
    try {
      const imageUrls = await requestImage({
        apiKey,
        model,
        prompt: prepareMiniMaxPrompt(scene),
        aspectRatio,
        promptOptimizer,
        batchSize: 1
      });
      const bytes = await downloadImageWithRetry(imageUrls[0], scene.id);
      const outputPath = path.join(imagesDir, `${scene.id}${detectImageExtension(bytes)}`);
      await fs.writeFile(outputPath, bytes);
      const quality = await validateImageOrThrow(outputPath);
      await updateImageManifest(outputDir, scene.id, {
        quality,
        error: null
      });
      return { imageUrl: imageUrls[0], outputPath, quality };
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

async function generateBatchValidatedImage({ scene, imagesDir, outputDir, apiKey, model, aspectRatio, promptOptimizer, batchSize }) {
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await updateImageManifest(outputDir, scene.id, {
      status: "running",
      attempts: attempt,
      error: null,
      batchSize
    });
    try {
      const imageUrls = await requestImage({
        apiKey,
        model,
        prompt: prepareMiniMaxPrompt(scene),
        aspectRatio,
        promptOptimizer,
        batchSize
      });

      const candidates = [];
      for (let i = 0; i < imageUrls.length; i += 1) {
        try {
          const bytes = await downloadImageWithRetry(imageUrls[i], `${scene.id}-batch-${i}`);
          const ext = detectImageExtension(bytes);
          const batchPath = path.join(imagesDir, `${scene.id}_batch_${String(i + 1).padStart(2, "0")}${ext}`);
          await fs.writeFile(batchPath, bytes);
          candidates.push({ path: batchPath });
        } catch {
          continue;
        }
      }

      if (candidates.length === 0) {
        throw new Error(`All ${imageUrls.length} batch images failed to download for ${scene.id}.`);
      }

      const savedPaths = [];
      for (const candidate of candidates) {
        try {
          await validateImageOrThrow(candidate.path);
          savedPaths.push(candidate.path);
        } catch {
          await fs.unlink(candidate.path).catch(() => {});
        }
      }

      if (savedPaths.length === 0) {
        throw new Error(`All ${candidates.length} batch images failed quality checks for ${scene.id}.`);
      }

      await updateImageManifest(outputDir, scene.id, {
        quality: null,
        batchSize,
        batchCount: savedPaths.length,
        error: null
      });

      return { imageUrl: imageUrls[0], outputPath: savedPaths[0], quality: null };
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
  // First check for direct named files (legacy format)
  const directCandidates = [".png", ".jpg", ".jpeg", ".webp"].map((ext) => path.join(imagesDir, `${sceneId}${ext}`));
  for (const candidate of directCandidates) {
    if (await pathExists(candidate)) return candidate;
  }

  // Then check for batch files (new format: sceneId_batch_01.ext)
  const batchExtensions = [".jpg", ".png", ".jpeg", ".webp"];
  for (const ext of batchExtensions) {
    const batchPath = path.join(imagesDir, `${sceneId}_batch_01${ext}`);
    if (await pathExists(batchPath)) return batchPath;
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

async function requestImage({ apiKey, model, prompt, aspectRatio, promptOptimizer, batchSize = 1 }) {
  const safePrompt = limitPrompt(prompt, MAX_PROMPT_CHARS);
  const body = {
    model,
    prompt: safePrompt,
    aspect_ratio: aspectRatio,
    response_format: "url",
    n: clampBatchSize(batchSize),
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

  const imageUrls = payload?.data?.image_urls || [];
  if (imageUrls.length === 0) {
    throw new Error("MiniMax image response did not include any image URLs.");
  }

  return imageUrls;
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
    "Keep the bottom area natural and uncluttered with real scene content.",
    "No text, no readable signs, no subtitles, no logos, no watermark, no black lower-third bar, no placeholder words like Your Text, no cartoon, no vector art, no PPT slide. Product interfaces (websites, apps, software screens) are allowed when the story topic requires them, but they must look like real screenshots in a natural environment."
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

async function deleteSceneImage(imagesDir, sceneId) {
  for (const ext of [".png", ".jpg", ".jpeg", ".webp"]) {
    const candidate = path.join(imagesDir, `${sceneId}${ext}`);
    if (await pathExists(candidate)) {
      await fs.unlink(candidate).catch(() => {});
    }
  }
  await deleteBatchTempFiles(imagesDir, sceneId);
}

function isImageQualityError(error) {
  return Boolean(error?.quality);
}

function clampBatchSize(n) {
  const size = Number(n);
  if (!Number.isFinite(size) || size < 1) return 1;
  return Math.min(4, Math.max(1, Math.round(size)));
}

async function deleteBatchTempFiles(imagesDir, sceneId) {
  const prefix = `${sceneId}_batch_`;
  try {
    const entries = await fs.readdir(imagesDir);
    for (const entry of entries) {
      if (entry.startsWith(prefix)) {
        await fs.unlink(path.join(imagesDir, entry)).catch(() => {});
      }
    }
  } catch {}
}

async function removeStaleSceneImages(imagesDir, sceneIds) {
  const allowed = new Set(sceneIds);
  try {
    const entries = await fs.readdir(imagesDir);
    for (const entry of entries) {
      if (!/\.(png|jpe?g|webp)$/i.test(entry)) continue;
      const sceneId = entry
        .replace(/\.(png|jpe?g|webp)$/i, "")
        .replace(/_batch_\d+$/i, "");
      if (!allowed.has(sceneId)) {
        await fs.unlink(path.join(imagesDir, entry)).catch(() => {});
      }
    }
  } catch {}
}

module.exports = {
  generateImages
};
