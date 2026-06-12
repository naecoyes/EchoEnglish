const fs = require("node:fs/promises");
const path = require("node:path");
const { ensureDir, pathExists } = require("./utils");
const { initImageManifest, updateImageManifest } = require("./outputManifests");
const { fetchJsonWithPolicy } = require("./apiLimiter");
const { validateImageOrThrow } = require("./imageQuality");

async function generateImages({ scenes, outputDir, apiKey, baseUrl, model, aspectRatio = "16:9", batchSize = 3, onProgress }) {
  if (!apiKey) throw new Error("Google API key is required for Imagen generation.");
  const imagesDir = path.join(outputDir, "images");
  await ensureDir(imagesDir);
  const manifest = await initImageManifest(outputDir, scenes);
  await removeStaleSceneImages(imagesDir, scenes.map((scene) => scene.id));

  const results = [];
  for (const [index, scene] of scenes.entries()) {
    const manifestItem = manifest.items?.find((item) => item.sceneId === scene.id);
    if (manifestItem?.promptChanged) {
      await deleteSceneImage(imagesDir, scene.id);
      await updateImageManifest(outputDir, scene.id, {
        status: "pending",
        imagePath: null,
        error: "Prompt changed; cached image will be regenerated."
      });
    }
    const cachedPath = !manifestItem?.promptChanged
      && manifestItem?.status === "completed"
      && manifestItem?.imagePath
      && await pathExists(manifestItem.imagePath)
      ? manifestItem.imagePath
      : null;
    if (cachedPath) {
      const quality = await validateCachedImage(cachedPath, imagesDir, scene.id);
      if (quality) {
        await updateImageManifest(outputDir, scene.id, { status: "completed", imagePath: cachedPath, quality, error: null });
        results.push({ sceneId: scene.id, imagePath: cachedPath, cached: true });
        await reportProgress(onProgress, { sceneId: scene.id, status: "completed", completed: results.length, total: scenes.length, index });
        continue;
      }
      await updateImageManifest(outputDir, scene.id, {
        status: "pending",
        imagePath: null,
        error: "Cached image failed quality checks and will be regenerated."
      });
    }

    await updateImageManifest(outputDir, scene.id, { status: "running", attempts: 0, error: null });
    await reportProgress(onProgress, { sceneId: scene.id, status: "running", completed: results.length, total: scenes.length, index });
    try {
      const outputPath = await generateValidatedImage({
        scene,
        imagesDir,
        outputDir,
        apiKey,
        baseUrl,
        model,
        aspectRatio,
        batchSize
      });
      await updateImageManifest(outputDir, scene.id, { status: "completed", imagePath: outputPath, error: null });
      results.push({ sceneId: scene.id, imagePath: outputPath });
      await reportProgress(onProgress, { sceneId: scene.id, status: "completed", completed: results.length, total: scenes.length, index });
    } catch (error) {
      await updateImageManifest(outputDir, scene.id, { status: "failed", imagePath: null, error: error.message });
      throw error;
    }
  }
  return results;
}

async function reportProgress(onProgress, progress) {
  if (typeof onProgress !== "function") return;
  await onProgress(progress);
}

async function generateValidatedImage({ scene, imagesDir, outputDir, apiKey, baseUrl, model, aspectRatio = "16:9", batchSize = 3 }) {
  if (scene.hasPeople && batchSize > 1) {
    return generateBatchValidatedImage({ scene, imagesDir, outputDir, apiKey, baseUrl, model, aspectRatio, batchSize: clampBatchSize(batchSize) });
  }
  return generateSingleValidatedImage({ scene, imagesDir, outputDir, apiKey, baseUrl, model, aspectRatio });
}

async function generateSingleValidatedImage({ scene, imagesDir, outputDir, apiKey, baseUrl, model, aspectRatio = "16:9" }) {
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await updateImageManifest(outputDir, scene.id, { status: "running", attempts: attempt, error: null });
    try {
      const buffers = await requestImagen({
        apiKey,
        baseUrl,
        model,
        prompt: scene.imagePrompt || buildPrompt(scene, aspectRatio),
        aspectRatio,
        sampleCount: 1
      });
      const bytes = buffers[0];
      const outputPath = path.join(imagesDir, `${scene.id}${detectImageExtension(bytes)}`);
      await fs.writeFile(outputPath, bytes);
      const quality = await validateImageOrThrow(outputPath);
      await updateImageManifest(outputDir, scene.id, { quality, error: null });
      return outputPath;
    } catch (error) {
      lastError = error;
      await updateImageManifest(outputDir, scene.id, {
        status: "running",
        error: error.message,
        quality: error.quality || null
      });
      await deleteSceneImage(imagesDir, scene.id);
      if (!error.quality) throw error;
    }
  }
  throw lastError;
}

async function generateBatchValidatedImage({ scene, imagesDir, outputDir, apiKey, baseUrl, model, aspectRatio, batchSize }) {
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await updateImageManifest(outputDir, scene.id, { status: "running", attempts: attempt, error: null, batchSize });
    try {
      const buffers = await requestImagen({
        apiKey,
        baseUrl,
        model,
        prompt: scene.imagePrompt || buildPrompt(scene, aspectRatio),
        aspectRatio,
        sampleCount: batchSize
      });

      const savedPaths = [];
      for (let i = 0; i < buffers.length; i += 1) {
        const ext = detectImageExtension(buffers[i]);
        const batchPath = path.join(imagesDir, `${scene.id}_batch_${String(i + 1).padStart(2, "0")}${ext}`);
        await fs.writeFile(batchPath, buffers[i]);
        try {
          await validateImageOrThrow(batchPath);
          savedPaths.push(batchPath);
        } catch {
          await fs.unlink(batchPath).catch(() => {});
        }
      }

      if (savedPaths.length === 0) {
        throw new Error(`All ${buffers.length} batch images failed quality checks for ${scene.id}.`);
      }

      await updateImageManifest(outputDir, scene.id, {
        quality: null,
        batchSize,
        batchCount: savedPaths.length,
        error: null
      });

      return savedPaths[0];
    } catch (error) {
      lastError = error;
      await updateImageManifest(outputDir, scene.id, {
        status: "running",
        error: error.message,
        quality: error.quality || null
      });
      await deleteSceneImage(imagesDir, scene.id);
      await deleteBatchTempFiles(imagesDir, scene.id);
      if (!error.quality) throw error;
    }
  }
  throw lastError;
}

async function requestImagen({ apiKey, baseUrl, model, prompt, aspectRatio = "16:9", sampleCount = 1 }) {
  const url = `${(baseUrl || "https://generativelanguage.googleapis.com/v1beta").replace(/\/$/, "")}/models/${encodeURIComponent(model || "imagen-4.0-generate-001")}:predict`;
  const safePrompt = normalizeImagenPrompt(prompt);
  const payload = await requestImagenPayload({ apiKey, url, prompt: safePrompt, aspectRatio, sampleCount });
  const buffers = extractImageBuffers(payload);
  if (buffers.length) return buffers;

  const fallbackPrompt = buildSafeImagenFallbackPrompt(safePrompt, aspectRatio);
  if (fallbackPrompt && fallbackPrompt !== safePrompt) {
    const fallbackPayload = await requestImagenPayload({ apiKey, url, prompt: fallbackPrompt, aspectRatio, sampleCount: 1 });
    const fallbackBuffers = extractImageBuffers(fallbackPayload);
    if (fallbackBuffers.length) return fallbackBuffers;
    throw new Error(`${formatImagenEmptyResponse(fallbackPayload)} Fallback prompt was also empty.`);
  }

  throw new Error(formatImagenEmptyResponse(payload));
}

async function requestImagenPayload({ apiKey, url, prompt, aspectRatio, sampleCount }) {
  return await fetchJsonWithPolicy("google:image", url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey
    },
    body: JSON.stringify({
      instances: [{ prompt }],
      parameters: {
        sampleCount: clampBatchSize(sampleCount),
        aspectRatio: aspectRatio || "16:9",
        personGeneration: "allow_adult"
      }
    })
  });
}

function normalizeImagenPrompt(prompt) {
  const text = String(prompt || "").replace(/\s+/g, " ").trim();
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= 430) return text;
  return words.slice(0, 430).join(" ");
}

function extractImageBuffers(payload) {
  const base64Values = [];
  collectImageBase64(payload, base64Values);
  return base64Values
    .map((value) => Buffer.from(value, "base64"))
    .filter((buffer) => buffer.length > 32);
}

function buildSafeImagenFallbackPrompt(prompt, aspectRatio = "16:9") {
  const scene = extractPromptField(prompt, "Scene setting:")
    || extractPromptField(prompt, "Scene:")
    || extractPromptField(prompt, "Base scene prompt:");
  const moment = extractPromptField(prompt, "Exact sentence moment to visualize:")
    || extractPromptField(prompt, "Moment:");
  const safeScene = sanitizeImagenPromptText(scene || prompt);
  const safeMoment = sanitizeImagenPromptText(moment);
  return normalizeImagenPrompt([
    `${aspectRatio} photorealistic documentary still image for an English learning video.`,
    safeScene ? `Scene: ${safeScene}.` : "Scene: a realistic historical technology setting with simple human activity.",
    safeMoment ? `Story moment: ${safeMoment}.` : "",
    "Use generic adult people only, photographed from behind or at a distance, with non-identifiable faces.",
    "Show objects, workspace, products, tools, buildings, or public-event atmosphere instead of recognizable public figures.",
    "No real logos, no readable brand marks, no text, no subtitles, no watermark, no celebrity likeness, no poster, no slide design, no black lower-third bar, no placeholder words like Your Text. Product interfaces (websites, apps, software screens) are allowed when the story topic requires them, but they must look like real screenshots in a natural environment.",
    "Cinematic natural light, 35mm documentary photo style, clear composition, natural uncluttered bottom area with real scene content."
  ].filter(Boolean).join(" "));
}

function extractPromptField(prompt, label) {
  const text = String(prompt || "");
  const start = text.indexOf(label);
  if (start < 0) return "";
  const rest = text.slice(start + label.length);
  const nextMatch = rest.search(/\b(?:Exact sentence moment to visualize|Factual documentary mode|Non-podcast mode|Camera direction|Composition|Image quality|Negative constraints|Distinctness|Beat prompt|Scene setting|Moment|Shot direction|Camera|Lighting):/);
  return (nextMatch >= 0 ? rest.slice(0, nextMatch) : rest).trim();
}

function sanitizeImagenPromptText(text) {
  return String(text || "")
    .replace(/\bSteve Jobs\b/gi, "a technology founder")
    .replace(/\bSteve Wozniak\b/gi, "an electronics engineer")
    .replace(/\bRonald Wayne\b/gi, "a third cofounder")
    .replace(/\bTim Cook\b/gi, "a technology executive")
    .replace(/\bApple(?: Inc\.?)?\b/gi, "a personal computer company")
    .replace(/\bMacintosh\b/gi, "an early personal computer")
    .replace(/\biPod\b/gi, "a compact music player")
    .replace(/\biPhone\b/gi, "a modern smartphone")
    .replace(/\biPad\b/gi, "a tablet computer")
    .replace(/\bSuper Bowl\b/gi, "a major televised event")
    .replace(/\biconic\b/gi, "simple")
    .replace(/\bfamous\b/gi, "well-known")
    .replace(/\blogo\b/gi, "plain background")
    .replace(/\s+/g, " ")
    .trim()
    .split(/\s+/)
    .slice(0, 110)
    .join(" ");
}

function collectImageBase64(value, output) {
  if (!value || output.length >= 4) return;
  if (Array.isArray(value)) {
    for (const item of value) collectImageBase64(item, output);
    return;
  }
  if (typeof value !== "object") return;

  for (const key of ["imageBytes", "bytesBase64Encoded", "imageBytesBase64Encoded", "data"]) {
    if (looksLikeBase64Image(value[key])) output.push(value[key]);
  }

  for (const child of Object.values(value)) {
    if (typeof child === "object") collectImageBase64(child, output);
  }
}

function looksLikeBase64Image(value) {
  if (typeof value !== "string" || value.length < 64) return false;
  return /^[A-Za-z0-9+/=\s]+$/.test(value);
}

function formatImagenEmptyResponse(payload) {
  if (!payload || (typeof payload === "object" && Object.keys(payload).length === 0)) {
    return "Google Imagen returned an empty response. Check that the API key has Imagen access, billing/quota is enabled, and the selected model is available for this key.";
  }
  const filtered = findFirstString(payload, ["raiFilteredReason", "filteredReason", "finishReason", "blockReason"]);
  if (filtered) return `Google Imagen did not return image bytes. Safety/filter reason: ${filtered}`;
  const message = payload?.error?.message || payload?.message || JSON.stringify(payload).slice(0, 500);
  return `Google Imagen response did not include image bytes: ${message}`;
}

function findFirstString(value, keys) {
  if (!value || typeof value !== "object") return "";
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findFirstString(item, keys);
      if (found) return found;
    }
    return "";
  }
  for (const key of keys) {
    if (typeof value[key] === "string" && value[key]) return value[key];
  }
  for (const child of Object.values(value)) {
    const found = findFirstString(child, keys);
    if (found) return found;
  }
  return "";
}

async function findExistingImage(imagesDir, sceneId) {
  for (const ext of [".png", ".jpg", ".jpeg", ".webp"]) {
    const candidate = path.join(imagesDir, `${sceneId}${ext}`);
    if (await pathExists(candidate)) return candidate;
  }
  const batch = await findExistingBatchImage(imagesDir, sceneId);
  if (batch) return batch;
  return null;
}

async function findExistingBatchImage(imagesDir, sceneId) {
  try {
    const entries = await fs.readdir(imagesDir);
    const batch = entries
      .filter((entry) => entry.startsWith(`${sceneId}_batch_`) && /\.(png|jpe?g|webp)$/i.test(entry))
      .sort()[0];
    return batch ? path.join(imagesDir, batch) : null;
  } catch {
    return null;
  }
}

async function removeStaleSceneImages(imagesDir, sceneIds) {
  const allowed = new Set(sceneIds);
  const currentGroup = imageSceneGroup(sceneIds[0] || "");
  try {
    const entries = await fs.readdir(imagesDir);
    for (const entry of entries) {
      if (!/\.(png|jpe?g|webp)$/i.test(entry)) continue;
      const sceneId = entry
        .replace(/\.(png|jpe?g|webp)$/i, "")
        .replace(/_batch_\d+$/i, "");
      if (!allowed.has(sceneId) && imageSceneGroup(sceneId) === currentGroup) {
        await fs.unlink(path.join(imagesDir, entry)).catch(() => {});
      }
    }
  } catch {}
}

function imageSceneGroup(sceneId) {
  const id = String(sceneId || "");
  if (id.startsWith("cover-youtube")) return "cover-youtube";
  if (id.startsWith("cover-vertical")) return "cover-vertical";
  if (id.startsWith("cover")) return "cover";
  if (id.startsWith("podcast-host")) return "podcast";
  return "scene";
}

async function validateCachedImage(cachedPath, imagesDir, sceneId) {
  try {
    return await validateImageOrThrow(cachedPath);
  } catch {
    await deleteSceneImage(imagesDir, sceneId);
    return null;
  }
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

function detectImageExtension(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return ".jpg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return ".png";
  if (bytes.slice(0, 4).toString("ascii") === "RIFF" && bytes.slice(8, 12).toString("ascii") === "WEBP") return ".webp";
  return ".png";
}

function buildPrompt(scene, aspectRatio = "16:9") {
  return [
    `Create a ${aspectRatio} photorealistic cinematic still image for an English shadowing video.`,
    scene.title ? `Video title: ${scene.title}.` : "",
    scene.templateTitle ? `Video type: ${scene.templateTitle}.` : "",
    scene.visualStyle ? `Visual style: ${scene.visualStyle}.` : "",
    `Scene: ${scene.visual || "clear documentary story moment"}.`,
    "Use realistic documentary photography, one clear focal subject, real location, motivated cinematic light, 35mm lens look, high detail, natural color grade.",
    "Keep the bottom area natural and uncluttered with real scene content. No text, no readable signs, no subtitles, no logos, no watermark, no black lower-third bar, no placeholder words like Your Text, no cartoon, no vector art, no PPT slide. Product interfaces (websites, apps, software screens) are allowed when the story topic requires them, but they must look like real screenshots in a natural environment."
  ].filter(Boolean).join(" ");
}

async function deleteSceneImage(imagesDir, sceneId) {
  for (const ext of [".png", ".jpg", ".jpeg", ".webp"]) {
    const candidate = path.join(imagesDir, `${sceneId}${ext}`);
    if (await pathExists(candidate)) await fs.unlink(candidate).catch(() => {});
  }
  await deleteBatchTempFiles(imagesDir, sceneId);
}

module.exports = { generateImages, generateValidatedImage };
