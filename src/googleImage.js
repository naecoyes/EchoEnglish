const fs = require("node:fs/promises");
const path = require("node:path");
const { ensureDir, pathExists } = require("./utils");
const { initImageManifest, updateImageManifest } = require("./outputManifests");
const { fetchJsonWithPolicy } = require("./apiLimiter");
const { validateImageOrThrow } = require("./imageQuality");

async function generateImages({ scenes, outputDir, apiKey, baseUrl, model, onProgress }) {
  if (!apiKey) throw new Error("Google API key is required for Imagen generation.");
  const imagesDir = path.join(outputDir, "images");
  await ensureDir(imagesDir);
  await initImageManifest(outputDir, scenes);

  const results = [];
  for (const [index, scene] of scenes.entries()) {
    const cachedPath = await findExistingImage(imagesDir, scene.id);
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
        model
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

async function generateValidatedImage({ scene, imagesDir, outputDir, apiKey, baseUrl, model }) {
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await updateImageManifest(outputDir, scene.id, { status: "running", attempts: attempt, error: null });
    try {
      const bytes = await requestImagen({
        apiKey,
        baseUrl,
        model,
        prompt: scene.imagePrompt || buildPrompt(scene)
      });
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

async function requestImagen({ apiKey, baseUrl, model, prompt }) {
  const url = `${(baseUrl || "https://generativelanguage.googleapis.com/v1beta").replace(/\/$/, "")}/models/${encodeURIComponent(model || "imagen-4.0-generate-001")}:predict`;
  const payload = await fetchJsonWithPolicy("google:image", url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey
    },
    body: JSON.stringify({
      instances: [{ prompt }],
      parameters: { sampleCount: 1, aspectRatio: "16:9" }
    })
  });

  const base64 = payload?.predictions?.[0]?.bytesBase64Encoded
    || payload?.predictions?.[0]?.image?.bytesBase64Encoded
    || payload?.generatedImages?.[0]?.image?.imageBytes
    || payload?.generatedImages?.[0]?.image?.bytesBase64Encoded;
  if (!base64) {
    throw new Error("Google Imagen response did not include image bytes.");
  }
  return Buffer.from(base64, "base64");
}

async function findExistingImage(imagesDir, sceneId) {
  for (const ext of [".png", ".jpg", ".jpeg", ".webp"]) {
    const candidate = path.join(imagesDir, `${sceneId}${ext}`);
    if (await pathExists(candidate)) return candidate;
  }
  return null;
}

async function validateCachedImage(cachedPath, imagesDir, sceneId) {
  try {
    return await validateImageOrThrow(cachedPath);
  } catch {
    await deleteSceneImage(imagesDir, sceneId);
    return null;
  }
}

function detectImageExtension(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return ".jpg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return ".png";
  if (bytes.slice(0, 4).toString("ascii") === "RIFF" && bytes.slice(8, 12).toString("ascii") === "WEBP") return ".webp";
  return ".png";
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
  ].filter(Boolean).join(" ");
}

async function deleteSceneImage(imagesDir, sceneId) {
  for (const ext of [".png", ".jpg", ".jpeg", ".webp"]) {
    const candidate = path.join(imagesDir, `${sceneId}${ext}`);
    if (await pathExists(candidate)) await fs.unlink(candidate).catch(() => {});
  }
}

module.exports = { generateImages };
