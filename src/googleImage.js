const fs = require("node:fs/promises");
const path = require("node:path");
const { ensureDir, pathExists } = require("./utils");
const { initImageManifest, updateImageManifest } = require("./outputManifests");

async function generateImages({ scenes, outputDir, apiKey, baseUrl, model }) {
  if (!apiKey) throw new Error("Google API key is required for Imagen generation.");
  const imagesDir = path.join(outputDir, "images");
  await ensureDir(imagesDir);
  await initImageManifest(outputDir, scenes);

  const results = [];
  for (const scene of scenes) {
    const cachedPath = await findExistingImage(imagesDir, scene.id);
    if (cachedPath) {
      await updateImageManifest(outputDir, scene.id, { status: "completed", imagePath: cachedPath, error: null });
      results.push({ sceneId: scene.id, imagePath: cachedPath, cached: true });
      continue;
    }

    await updateImageManifest(outputDir, scene.id, { status: "running", error: null });
    try {
      const bytes = await requestImagen({
        apiKey,
        baseUrl,
        model,
        prompt: scene.imagePrompt || scene.visual || "cinematic story background"
      });
      const outputPath = path.join(imagesDir, `${scene.id}${detectImageExtension(bytes)}`);
      await fs.writeFile(outputPath, bytes);
      await updateImageManifest(outputDir, scene.id, { status: "completed", imagePath: outputPath, error: null });
      results.push({ sceneId: scene.id, imagePath: outputPath });
    } catch (error) {
      await updateImageManifest(outputDir, scene.id, { status: "failed", imagePath: null, error: error.message });
      throw error;
    }
  }
  return results;
}

async function requestImagen({ apiKey, baseUrl, model, prompt }) {
  const url = `${(baseUrl || "https://generativelanguage.googleapis.com/v1beta").replace(/\/$/, "")}/models/${encodeURIComponent(model || "imagen-4.0-generate-001")}:predict?key=${encodeURIComponent(apiKey)}`;
  const payload = await fetchWithRetry(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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

async function fetchWithRetry(url, options) {
  let lastError = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const response = await fetch(url, options);
      const payload = await response.json().catch(() => null);
      if (response.status === 429 || response.status >= 500) throw new Error(`HTTP ${response.status}`);
      if (!response.ok) throw new Error(`Google Imagen failed with HTTP ${response.status}. ${payload?.error?.message || ""}`.trim());
      return payload;
    } catch (error) {
      lastError = error;
      await delay(1400 * (attempt + 1));
    }
  }
  throw lastError;
}

async function findExistingImage(imagesDir, sceneId) {
  for (const ext of [".png", ".jpg", ".jpeg", ".webp"]) {
    const candidate = path.join(imagesDir, `${sceneId}${ext}`);
    if (await pathExists(candidate)) return candidate;
  }
  return null;
}

function detectImageExtension(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return ".jpg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return ".png";
  if (bytes.slice(0, 4).toString("ascii") === "RIFF" && bytes.slice(8, 12).toString("ascii") === "WEBP") return ".webp";
  return ".png";
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { generateImages };
