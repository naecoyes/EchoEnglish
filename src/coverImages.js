const fs = require("node:fs/promises");
const path = require("node:path");
const { buildCoverPromptSet, renderCoverPrompts } = require("./coverPrompts");
const { renderCoverImage } = require("./coverRenderer");
const { generateImages: generateMiniMaxImages } = require("./minimaxImage");
const { generateImages: generateGoogleImages } = require("./googleImage");
const { MINIMAX_IMAGE_MODEL } = require("./minimaxDefaults");
const { ensureDir, pathExists } = require("./utils");

const PEOPLE_PATTERN = /\b(person|people|portrait|face|founder|host|man|woman|speaker|student|worker|engineer|leader|subject)\b/i;

async function generateCoverImageSet({
  story,
  outputDir,
  provider,
  settings,
  minimaxApiKey,
  minimaxImageModel,
  googleImageModel,
  logs = []
}) {
  const resolvedProvider = resolveCoverProvider(provider, settings?.media?.imageProvider);
  if (resolvedProvider !== "minimax" && resolvedProvider !== "google") {
    return { provider: resolvedProvider, completed: 0, total: 0, results: [] };
  }

  const prompts = story.coverPrompts || buildCoverPromptSet(story);
  story.coverPrompts = prompts;
  await ensureDir(outputDir);
  await fs.writeFile(path.join(outputDir, "cover-prompts.md"), renderCoverPrompts(story, prompts), "utf8");

  const imagesDir = path.join(outputDir, "images");
  await ensureDir(imagesDir);

  const coverItems = [prompts.youtube, prompts.vertical].filter(Boolean);
  const results = [];

  for (const item of coverItems) {
    const finalId = item.id;
    const backgroundId = `${finalId}-bg`;
    const variant = finalId === "cover-vertical" ? "vertical" : "youtube";
    const aspectRatio = item.aspectRatio || (variant === "vertical" ? "9:16" : "16:9");
    let sourcePath = await findTrustedCoverBackground(outputDir, backgroundId, item.prompt);

    if (!sourcePath) {
      await deleteCoverBackgroundImages(imagesDir, finalId, backgroundId);
      pushLog(logs, `Generating ${aspectRatio} cover background (${backgroundId}) with ${resolvedProvider}.`);
      const scene = {
        id: backgroundId,
        imagePrompt: item.prompt,
        title: story.title,
        visualStyle: story.storyboardDesign?.visualStyle,
        hasPeople: PEOPLE_PATTERN.test(item.prompt || "")
      };
      const generated = resolvedProvider === "google"
        ? await generateGoogleImages({
          scenes: [scene],
          outputDir,
          apiKey: settings?.google?.apiKey,
          baseUrl: settings?.google?.baseUrl,
          model: googleImageModel || settings?.google?.imageModel,
          aspectRatio,
          batchSize: 1,
          onProgress: () => {}
        })
        : await generateMiniMaxImages({
          scenes: [scene],
          outputDir,
          apiKey: minimaxApiKey || settings?.minimaxApiKey,
          model: minimaxImageModel || settings?.models?.image || MINIMAX_IMAGE_MODEL,
          aspectRatio,
          promptOptimizer: true,
          batchSize: 1,
          onProgress: () => {}
        });
      sourcePath = generated[0]?.imagePath || null;
    } else {
      pushLog(logs, `Rendering ${finalId} from existing cover background.`);
    }

    if (!sourcePath) {
      throw new Error(`Cover background generation failed for ${finalId}.`);
    }

    const outputPath = path.join(imagesDir, `${finalId}.png`);
    await renderCoverImage({ story, sourcePath, outputPath, variant });
    results.push({
      sceneId: finalId,
      imagePath: outputPath,
      sourceImagePath: sourcePath,
      provider: resolvedProvider
    });
  }

  return {
    provider: resolvedProvider,
    completed: results.length,
    total: coverItems.length,
    results,
    coverPromptsPath: path.join(outputDir, "cover-prompts.md")
  };
}

function resolveCoverProvider(coverProvider, imageProvider) {
  const provider = coverProvider || "inherit";
  if (provider === "inherit") return imageProvider || "minimax";
  return provider;
}

async function findExistingCoverBackground(imagesDir, finalId, backgroundId) {
  const directBackground = await findDirectImage(imagesDir, backgroundId, [".png", ".jpg", ".jpeg", ".webp"]);
  if (directBackground) return directBackground;

  const batchBackground = await findBatchImage(imagesDir, backgroundId);
  if (batchBackground) return batchBackground;

  // Legacy cover images were raw model backgrounds. Prefer those over spending
  // another image call, but skip final PNG overlays to avoid text-on-text.
  const legacyRaw = await findDirectImage(imagesDir, finalId, [".jpg", ".jpeg", ".webp"]);
  if (legacyRaw) return legacyRaw;

  return null;
}

async function findDirectImage(imagesDir, id, extensions) {
  for (const ext of extensions) {
    const candidate = path.join(imagesDir, `${id}${ext}`);
    if (await pathExists(candidate)) return candidate;
  }
  return null;
}

async function findBatchImage(imagesDir, id) {
  try {
    const prefix = `${id}_batch_`;
    const files = (await fs.readdir(imagesDir))
      .filter((file) => file.startsWith(prefix) && /\.(png|jpe?g|webp)$/i.test(file))
      .sort();
    return files.length ? path.join(imagesDir, files[0]) : null;
  } catch {
    return null;
  }
}

function pushLog(logs, message) {
  if (!Array.isArray(logs)) return;
  logs.push(`[${new Date().toISOString()}] ${message}`);
}

async function findTrustedCoverBackground(outputDir, backgroundId, prompt) {
  try {
    const manifest = JSON.parse(await fs.readFile(path.join(outputDir, "image-manifest.json"), "utf8"));
    const item = (manifest.items || []).find((entry) => entry.sceneId === backgroundId);
    if (
      item?.status === "completed"
      && item?.imagePath
      && item.prompt === prompt
      && item.cacheKey === `${item.sceneId}:${item.promptHash || ""}`
      && await pathExists(item.imagePath)
    ) {
      return item.imagePath;
    }
  } catch {}
  return null;
}

async function deleteCoverBackgroundImages(imagesDir, finalId, backgroundId) {
  for (const id of [backgroundId, finalId]) {
    for (const ext of [".png", ".jpg", ".jpeg", ".webp"]) {
      await fs.unlink(path.join(imagesDir, `${id}${ext}`)).catch(() => {});
    }
    let entries = [];
    try {
      entries = await fs.readdir(imagesDir);
    } catch {
      entries = [];
    }
    for (const entry of entries) {
      if (entry.startsWith(`${id}_batch_`) && /\.(png|jpe?g|webp)$/i.test(entry)) {
        await fs.unlink(path.join(imagesDir, entry)).catch(() => {});
      }
    }
  }
}

module.exports = {
  generateCoverImageSet,
  resolveCoverProvider
};
