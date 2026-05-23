const fs = require("node:fs/promises");
const path = require("node:path");
const { ensureDir, pathExists } = require("./utils");

async function readJson(file, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJson(file, value) {
  await ensureDir(path.dirname(file));
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function audioManifestPath(outputDir) {
  return path.join(outputDir, "audio-manifest.json");
}

function imageManifestPath(outputDir) {
  return path.join(outputDir, "image-manifest.json");
}

function musicManifestPath(outputDir) {
  return path.join(outputDir, "music-manifest.json");
}

async function initAudioManifest(outputDir, items) {
  const file = audioManifestPath(outputDir);
  const existing = await readJson(file, {});
  const previous = new Map((existing.items || []).map((item) => [item.id, item]));
  const manifest = {
    updatedAt: new Date().toISOString(),
    total: items.length,
    completed: 0,
    items: items.map((item, index) => ({
      id: item.id,
      index,
      text: item.text,
      language: item.language,
      status: previous.get(item.id)?.status || "pending",
      cacheKey: previous.get(item.id)?.cacheKey || null,
      durationSeconds: previous.get(item.id)?.durationSeconds || null,
      path: previous.get(item.id)?.path || null,
      error: previous.get(item.id)?.error || null
    }))
  };
  manifest.completed = manifest.items.filter((item) => item.status === "completed").length;
  await writeJson(file, manifest);
  return manifest;
}

async function updateAudioManifest(outputDir, id, patch) {
  const file = audioManifestPath(outputDir);
  const manifest = await readJson(file, { total: 0, completed: 0, items: [] });
  const item = manifest.items.find((candidate) => candidate.id === id);
  if (item) Object.assign(item, patch);
  manifest.updatedAt = new Date().toISOString();
  manifest.completed = manifest.items.filter((entry) => entry.status === "completed").length;
  manifest.total = manifest.items.length;
  await writeJson(file, manifest);
  return manifest;
}

async function initImageManifest(outputDir, scenes) {
  const file = imageManifestPath(outputDir);
  const existing = await readJson(file, {});
  const previous = new Map((existing.items || []).map((item) => [item.sceneId, item]));
  const items = [];
  for (const [index, scene] of scenes.entries()) {
    const prior = previous.get(scene.id) || {};
    const imagePath = prior.imagePath || await findExistingImage(path.join(outputDir, "images"), scene.id);
    items.push({
      sceneId: scene.id,
      index,
      prompt: scene.imagePrompt || scene.visual || "",
      status: imagePath ? "completed" : prior.status || "pending",
      imagePath: imagePath || null,
      error: imagePath ? null : prior.error || null
    });
  }
  const manifest = {
    updatedAt: new Date().toISOString(),
    total: items.length,
    completed: items.filter((item) => item.status === "completed").length,
    items
  };
  await writeJson(file, manifest);
  return manifest;
}

async function updateImageManifest(outputDir, sceneId, patch) {
  const file = imageManifestPath(outputDir);
  const manifest = await readJson(file, { total: 0, completed: 0, items: [] });
  const item = manifest.items.find((candidate) => candidate.sceneId === sceneId);
  if (item) Object.assign(item, patch);
  manifest.updatedAt = new Date().toISOString();
  manifest.completed = manifest.items.filter((entry) => entry.status === "completed").length;
  manifest.total = manifest.items.length;
  await writeJson(file, manifest);
  return manifest;
}

async function initMusicManifest(outputDir, count) {
  const file = musicManifestPath(outputDir);
  const existing = await readJson(file, {});
  const previous = new Map((existing.tracks || []).map((track) => [track.index, track]));
  const tracks = [];
  for (let index = 0; index < count; index += 1) {
    const trackPath = path.join(outputDir, "music", `background-${String(index + 1).padStart(2, "0")}.mp3`);
    const exists = await pathExists(trackPath);
    tracks.push({
      index,
      path: exists ? trackPath : previous.get(index)?.path || null,
      status: exists ? "completed" : previous.get(index)?.status || "pending",
      error: exists ? null : previous.get(index)?.error || null
    });
  }
  const backgroundPath = path.join(outputDir, "music", "background.mp3");
  const manifest = {
    updatedAt: new Date().toISOString(),
    total: tracks.length,
    completed: tracks.filter((track) => track.status === "completed").length,
    backgroundPath: await pathExists(backgroundPath) ? backgroundPath : existing.backgroundPath || null,
    tracks
  };
  await writeJson(file, manifest);
  return manifest;
}

async function updateMusicManifest(outputDir, index, patch) {
  const file = musicManifestPath(outputDir);
  const manifest = await readJson(file, { total: 0, completed: 0, tracks: [] });
  const track = manifest.tracks.find((candidate) => candidate.index === index);
  if (track) Object.assign(track, patch);
  manifest.updatedAt = new Date().toISOString();
  manifest.completed = manifest.tracks.filter((entry) => entry.status === "completed").length;
  manifest.total = manifest.tracks.length;
  await writeJson(file, manifest);
  return manifest;
}

async function completeMusicManifest(outputDir, backgroundPath) {
  const file = musicManifestPath(outputDir);
  const manifest = await readJson(file, { total: 0, completed: 0, tracks: [] });
  manifest.backgroundPath = backgroundPath;
  manifest.updatedAt = new Date().toISOString();
  manifest.completed = manifest.tracks.filter((entry) => entry.status === "completed").length;
  await writeJson(file, manifest);
  return manifest;
}

async function findExistingImage(imagesDir, sceneId) {
  const candidates = [".png", ".jpg", ".jpeg", ".webp"].map((ext) => path.join(imagesDir, `${sceneId}${ext}`));
  for (const candidate of candidates) {
    if (await pathExists(candidate)) return candidate;
  }
  return null;
}

module.exports = {
  audioManifestPath,
  completeMusicManifest,
  imageManifestPath,
  initAudioManifest,
  initImageManifest,
  initMusicManifest,
  musicManifestPath,
  readJson,
  updateAudioManifest,
  updateImageManifest,
  updateMusicManifest,
  writeJson
};
