const fs = require("node:fs/promises");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { createRequire } = require("node:module");
const { ensureDir, pathExists } = require("./utils");
const { inspectImage } = require("./imageQuality");

const execFileAsync = promisify(execFile);
const { runFfmpeg } = require("./ffmpegGateway");
let cachedFfmpegEncoders = null;

function getLayout(orientation) {
  const isPortrait = orientation === "portrait";
  const W = isPortrait ? 1080 : 1920;
  const H = isPortrait ? 1920 : 1080;
  const CAPTION_Y = Math.round(H * (isPortrait ? 0.73 : 0.70));
  const CAPTION_H = isPortrait ? 320 : 250;
  const CAPTION_W = Math.round(W * (isPortrait ? 0.88 : 0.84));
  const CAPTION_X = Math.round((W - CAPTION_W) / 2);
  return { isPortrait, W, H, CAPTION_Y, CAPTION_H, CAPTION_W, CAPTION_X };
}

async function composeStoryVideo({ story, readingItems, outputDir, audioPath, musicPath = null, musicVolume = 0.12, logs = [], videoEncoder = "auto", orientation = "landscape", onProgress = null }) {
  await assertCommand("ffmpeg", ["-version"]);
  const layout = getLayout(orientation);
  const slidesDir = path.join(outputDir, orientation === "portrait" ? "slides-portrait" : "slides");
  await ensureDir(slidesDir);

  const frames = buildLearningFrames(story, readingItems);
  if (!frames.length) {
    throw new Error("Compose blocked: no timeline frames were generated.");
  }
  const audioDuration = await probeMediaDuration(audioPath);
  alignFramesToAudioDuration(frames, audioDuration);
  const sharp = loadSharp();

  const totalFrames = frames.length;
  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index];
    if (index % 5 === 0 || index === totalFrames - 1) {
      pushLog(logs, `[${orientation}] Rendering frame ${index + 1}/${totalFrames}: ${frame.title || frame.kind}`);
    }
    if (onProgress) {
      await onProgress({ orientation, completed: index + 1, total: totalFrames, phase: "frames" });
    }

    const sceneImageId = resolveFrameSceneImageId(story, frame);
    const existingImage = await findExistingSceneImage(outputDir, story, frame);
    frame.sceneImageId = sceneImageId;
    frame.imagePath = existingImage || null;
    const imageDataUri = existingImage ? await imageToDataUri(existingImage) : null;
    const svg = renderLearningFrame({ story, frame, frameIndex: index, imageDataUri, layout });
    await sharp(Buffer.from(svg)).png().toFile(path.join(slidesDir, `${frame.id}.png`));
  }

  const encoder = await resolveVideoEncoder(videoEncoder, logs);
  pushLog(logs, `Encoding final MP4 (${frames.length} frames) with ${encoder.label}…`);
  const concatPath = path.join(slidesDir, "concat.txt");
  const lines = [];
  frames.forEach((frame) => {
    const slidePath = path.join(slidesDir, `${frame.id}.png`);
    lines.push(`file '${escapeConcatPath(slidePath)}'`);
    lines.push(`duration ${frame.durationSeconds.toFixed(3)}`);
  });
  const lastFrame = frames[frames.length - 1];
  lines.push(`file '${escapeConcatPath(path.join(slidesDir, `${lastFrame.id}.png`))}'`);
  await fs.writeFile(concatPath, lines.join("\n"));

  const videoFilename = orientation === "portrait" ? "final-portrait.mp4" : "final.mp4";
  const videoPath = path.join(outputDir, videoFilename);
  const ffmpegArgs = [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    concatPath,
    "-i",
    audioPath
  ];

  if (musicPath) {
    ffmpegArgs.push("-stream_loop", "-1", "-i", musicPath);
  }

  ffmpegArgs.push(
    "-vf",
    "fps=30,format=yuv420p"
  );

  if (musicPath) {
    const safeMusicVolume = Number.isFinite(musicVolume) ? Math.max(0, Math.min(1, musicVolume)) : 0.12;
    ffmpegArgs.push(
      "-filter_complex",
      `[1:a]volume=1.0[narration];[2:a]volume=${safeMusicVolume}[music];[narration][music]amix=inputs=2:duration=first:dropout_transition=2[aout]`,
      "-map",
      "0:v",
      "-map",
      "[aout]"
    );
  }

  ffmpegArgs.push(...encoder.args, "-c:a", "aac", "-shortest", videoPath);

  try {
    await runFfmpeg(ffmpegArgs, { maxBuffer: 1024 * 1024 * 16 });
  } catch (error) {
    if (encoder.id === "cpu-libx264") throw error;
    pushLog(logs, `${encoder.label} failed during encode. Falling back to CPU libx264.`);
    const fallbackArgs = [...ffmpegArgs];
    const videoPathIndex = fallbackArgs.lastIndexOf(videoPath);
    fallbackArgs.splice(videoPathIndex - encoder.args.length - 3, encoder.args.length, ...encoderArgs("cpu-libx264").args);
    await runFfmpeg(fallbackArgs, { maxBuffer: 1024 * 1024 * 16 });
  }

  await writeTimelineManifest({ outputDir, frames, audioDuration, orientation, videoPath });

  return {
    videoPath,
    musicPath,
    audioDurationSeconds: audioDuration,
    timelineManifest: orientation === "portrait"
      ? path.join(outputDir, "timeline-manifest-portrait.json")
      : path.join(outputDir, "timeline-manifest.json"),
    scenes: frames.map((frame) => ({
      id: frame.id,
      kind: frame.kind,
      title: frame.title,
      startSeconds: frame.startSeconds,
      endSeconds: frame.endSeconds,
      durationSeconds: frame.durationSeconds,
      sceneImageId: frame.sceneImageId || null,
      imagePath: frame.imagePath || null
    }))
  };
}

async function probeMediaDuration(file) {
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      file
    ], { maxBuffer: 1024 * 1024 });
    const duration = Number(stdout.trim());
    return Number.isFinite(duration) ? duration : 0;
  } catch {
    return 0;
  }
}

function alignFramesToAudioDuration(frames, audioDuration) {
  if (!frames.length || !Number.isFinite(audioDuration) || audioDuration <= 0) return;
  const last = frames[frames.length - 1];
  const minimumEnd = Number(last.startSeconds || 0) + 0.5;
  const nextEnd = Math.max(minimumEnd, audioDuration);
  last.endSeconds = nextEnd;
  last.durationSeconds = Math.max(0.5, nextEnd - Number(last.startSeconds || 0));
}

async function writeTimelineManifest({ outputDir, frames, audioDuration, orientation, videoPath }) {
  const file = path.join(outputDir, orientation === "portrait" ? "timeline-manifest-portrait.json" : "timeline-manifest.json");
  const lastEnd = frames.length ? Number(frames[frames.length - 1].endSeconds || 0) : 0;
  const manifest = {
    generatedAt: new Date().toISOString(),
    orientation,
    videoPath,
    audioDurationSeconds: roundSeconds(audioDuration),
    timelineEndSeconds: roundSeconds(lastEnd),
    durationDeltaSeconds: roundSeconds((audioDuration || 0) - lastEnd),
    frameCount: frames.length,
    frames: frames.map((frame, index) => ({
      index,
      id: frame.id,
      kind: frame.kind,
      title: frame.title || null,
      sectionIndex: Number.isInteger(frame.sectionIndex) ? frame.sectionIndex : null,
      sentenceIndex: Number.isInteger(frame.sentenceIndex) ? frame.sentenceIndex : null,
      startSeconds: roundSeconds(frame.startSeconds),
      endSeconds: roundSeconds(frame.endSeconds),
      durationSeconds: roundSeconds(frame.durationSeconds),
      sceneImageId: frame.sceneImageId || null,
      imagePath: frame.imagePath || null,
      isVocabularyReview: frame.kind === "vocab-review"
    }))
  };
  await fs.writeFile(file, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

function roundSeconds(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? Number(number.toFixed(3)) : 0;
}

async function resolveVideoEncoder(preference = "auto", logs = []) {
  const wanted = normalizeVideoEncoderPreference(preference);
  const encoders = await getFfmpegEncoders();
  const candidates = wanted === "auto"
    ? ["apple-videotoolbox", "nvidia-nvenc", "intel-qsv", "cpu-libx264"]
    : [wanted, "cpu-libx264"];

  for (const candidate of candidates) {
    const encoder = encoderArgs(candidate);
    if (!encoder.requires || encoders.includes(encoder.requires)) return encoder;
    pushLog(logs, `${encoder.label} is not available in this ffmpeg build.`);
  }
  return encoderArgs("cpu-libx264");
}

function normalizeVideoEncoderPreference(value) {
  const text = String(value || "auto").trim().toLowerCase();
  return ["auto", "cpu-libx264", "apple-videotoolbox", "nvidia-nvenc", "intel-qsv"].includes(text) ? text : "auto";
}

function encoderArgs(id) {
  if (id === "apple-videotoolbox") {
    return {
      id,
      label: "Apple VideoToolbox (h264_videotoolbox)",
      requires: "h264_videotoolbox",
      args: ["-c:v", "h264_videotoolbox", "-b:v", "6000k"]
    };
  }
  if (id === "nvidia-nvenc") {
    return {
      id,
      label: "NVIDIA NVENC (h264_nvenc)",
      requires: "h264_nvenc",
      args: ["-c:v", "h264_nvenc", "-preset", "p4", "-b:v", "6000k"]
    };
  }
  if (id === "intel-qsv") {
    return {
      id,
      label: "Intel Quick Sync (h264_qsv)",
      requires: "h264_qsv",
      args: ["-c:v", "h264_qsv", "-b:v", "6000k"]
    };
  }
  return {
    id: "cpu-libx264",
    label: "CPU libx264",
    requires: "libx264",
    args: ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20"]
  };
}

async function getFfmpegEncoders() {
  if (cachedFfmpegEncoders) return cachedFfmpegEncoders;
  const { stdout } = await execFileAsync("ffmpeg", ["-hide_banner", "-encoders"], {
    maxBuffer: 1024 * 1024 * 4
  });
  cachedFfmpegEncoders = stdout;
  return cachedFfmpegEncoders;
}

function buildLearningFrames(story, readingItems) {
  const frames = [];
  let currentSectionIndex = 0;

  readingItems.forEach((item, index) => {
    const timedItem = {
      ...item,
      frameEndSeconds: getFrameEndSeconds(readingItems, index)
    };

    if (item.kind === "title-card") {
      frames.push(createCoverFrame(story, timedItem, currentSectionIndex, index));
      return;
    }

    if (item.kind === "section-title") {
      const found = Number.isInteger(item.sectionIndex)
        ? item.sectionIndex
        : story.sections.findIndex((section) => section.title === item.text);
      if (found >= 0) currentSectionIndex = found;
      frames.push(createTitleFrame(story, timedItem, currentSectionIndex, index));
      return;
    }

    if (item.kind === "story-sentence") {
      if (Number.isInteger(item.sectionIndex)) currentSectionIndex = item.sectionIndex;
      frames.push(createSentenceFrame(story, timedItem, currentSectionIndex, index));
      return;
    }

    if (item.kind === "vocabulary-review") {
      frames.push(createVocabularyReviewFrame(story, timedItem, currentSectionIndex, index));
      return;
    }

    if (item.kind === "vocabulary") {
      if (Number.isInteger(item.sectionIndex)) currentSectionIndex = item.sectionIndex;
      frames.push(createVocabularyFrame(story, timedItem, currentSectionIndex, index));
      return;
    }

    if (item.kind === "opening" || item.kind === "closing" || item.kind === "transition") {
      frames.push(createTitleFrame(story, timedItem, currentSectionIndex, index));
    }
  });

  return frames.filter((frame) => frame.durationSeconds > 0.2);
}

function getFrameEndSeconds(readingItems, index) {
  const item = readingItems[index];
  const startSeconds = item.startSeconds || 0;
  const next = readingItems[index + 1];
  if (next && Number.isFinite(next.startSeconds) && next.startSeconds > startSeconds) {
    return next.startSeconds;
  }
  return item.endSeconds || startSeconds + 3;
}

function createCoverFrame(story, item, sectionIndex, index) {
  const section = story.sections[sectionIndex] || story.sections[0];
  return baseFrame(item, sectionIndex, index, {
    kind: "cover",
    title: story.title,
    english: item.text,
    chinese: "今天的故事",
    visual: section?.visual || story.summary
  });
}

function createTitleFrame(story, item, sectionIndex, index) {
  const section = story.sections[sectionIndex] || story.sections[0];
  return baseFrame(item, sectionIndex, index, {
    kind: "title",
    title: item.kind === "opening" ? story.title : cleanTitle(item.text),
    english: item.text,
    chinese: item.kind === "closing" ? "做得很好，请再自己读一遍。" : "听故事，跟读句子，学习重点词汇。",
    visual: section?.visual || story.summary
  });
}

function createSentenceFrame(story, item, sectionIndex, index) {
  const section = story.sections[sectionIndex] || story.sections[0];
  const matchedVocabulary = selectVocabularyForSentence(story, section, item.text);
  const [vocabWord, vocabTranslation, vocabPhonetic] = matchedVocabulary || [];
  const podcast = isPodcastStory(story);
  return baseFrame(item, sectionIndex, index, {
    kind: "sentence",
    title: cleanTitle(section.title),
    english: item.text,
    chinese: translateSentence(section, item.text),
    vocabWord,
    vocabTranslation,
    vocabPhonetic,
    highlightedTerm: vocabWord,
    speaker: podcast ? item.speaker : null,
    speakerName: podcast ? item.speakerName : null,
    sentenceIndex: item.sentenceIndex,
    isPodcast: podcast,
    visual: section.visual
  });
}

function createVocabularyFrame(story, item, sectionIndex, index) {
  const section = story.sections[sectionIndex] || story.sections[0];
  const [word, translation, phonetic] = item.word
    ? [item.word, item.translation, item.phonetic]
    : section.vocabulary[item.vocabularyIndex || 0] || ["word", "词汇"];
  return baseFrame(item, sectionIndex, index, {
    kind: "vocabulary",
    title: cleanTitle(section.title),
    english: section.sentences[item.sentenceIndex || 0] || section.sentences[0],
    chinese: translateSentence(section, section.sentences[item.sentenceIndex || 0] || section.sentences[0]),
    vocabWord: word,
    vocabTranslation: translation,
    vocabPhonetic: phonetic,
    vocabulary: section.vocabulary,
    visual: section.visual
  });
}

function createVocabularyReviewFrame(story, item, sectionIndex, index) {
  const section = story.sections[sectionIndex] || story.sections[story.sections.length - 1] || story.sections[0];
  return baseFrame(item, sectionIndex, index, {
    kind: "vocab-review",
    title: "Vocabulary Review",
    english: item.text,
    chinese: "难点词汇总复习",
    visual: section?.visual || story.summary,
    vocabulary: collectReviewVocabulary(story)
  });
}

function baseFrame(item, sectionIndex, index, extra) {
  const startSeconds = item.startSeconds || 0;
  const endSeconds = item.frameEndSeconds || item.endSeconds || startSeconds + 3;
  return {
    id: `frame-${String(index + 1).padStart(4, "0")}`,
    sectionIndex,
    startSeconds,
    endSeconds,
    durationSeconds: Math.max(1.5, endSeconds - startSeconds),
    ...extra
  };
}

async function findExistingSceneImage(outputDir, story, frameOrIndex, sentenceIndex = 0) {
  if (isPodcastStory(story)) {
    const speaker = typeof frameOrIndex === "object" ? frameOrIndex.speaker : null;
    const podcastSceneId = speaker === "host-b" ? "podcast-host-b" : "podcast-host-a";
    const podcastImage = await findImageBySceneId(outputDir, podcastSceneId);
    if (podcastImage) return podcastImage;
  }

  const index = typeof frameOrIndex === "object" ? frameOrIndex.sectionIndex : frameOrIndex;
  const frameSentenceIndex = typeof frameOrIndex === "object" ? frameOrIndex.sentenceIndex : sentenceIndex;
  const section = story.sections[index] || {};
  const baseIndex = Number.isInteger(section.baseSectionIndex) ? section.baseSectionIndex : index;
  const variantIndex = Number.isInteger(section.imageVariantIndex) ? section.imageVariantIndex : 0;
  const variantSuffix = ["a", "b", "c"][variantIndex] || String(variantIndex + 1);
  const sceneBase = `scene-${String(baseIndex + 1).padStart(3, "0")}-${variantSuffix}`;
  const imagesDir = path.join(outputDir, "images");

  const beatIndex = getImageBeatIndexForSentence(section, frameSentenceIndex, story);
  const beatSceneId = `${sceneBase}-${String(beatIndex + 1).padStart(2, "0")}`;
  const beatBatchImages = await findBatchImages(imagesDir, beatSceneId);
  if (beatBatchImages.length > 0) {
    return beatBatchImages[0];
  }

  const sceneBatchImages = await findBatchImages(imagesDir, sceneBase);
  if (sceneBatchImages.length > 0) {
    const sentences = section.sentences || [];
    const sentenceCount = Math.max(1, sentences.length);
    const batchIndex = Math.floor((frameSentenceIndex / sentenceCount) * sceneBatchImages.length);
    return sceneBatchImages[Math.min(batchIndex, sceneBatchImages.length - 1)];
  }

  const beatBase = path.join(imagesDir, beatSceneId);
  const variantBase = path.join(imagesDir, sceneBase);
  const legacyBase = path.join(imagesDir, `scene-${String(baseIndex + 1).padStart(3, "0")}`);
  const candidates = [
    `${beatBase}.png`, `${beatBase}.jpg`, `${beatBase}.jpeg`, `${beatBase}.webp`,
    `${variantBase}.png`, `${variantBase}.jpg`, `${variantBase}.jpeg`, `${variantBase}.webp`,
    `${legacyBase}.png`, `${legacyBase}.jpg`, `${legacyBase}.jpeg`, `${legacyBase}.webp`
  ];
  for (const candidate of candidates) {
    if (await pathExists(candidate)) return candidate;
  }
  return null;
}

function resolveFrameSceneImageId(story, frameOrIndex, sentenceIndex = 0) {
  if (isPodcastStory(story)) {
    const speaker = typeof frameOrIndex === "object" ? frameOrIndex.speaker : null;
    return speaker === "host-b" ? "podcast-host-b" : "podcast-host-a";
  }

  const index = typeof frameOrIndex === "object" ? frameOrIndex.sectionIndex : frameOrIndex;
  const frameSentenceIndex = typeof frameOrIndex === "object" ? frameOrIndex.sentenceIndex : sentenceIndex;
  const section = story.sections[index] || {};
  const baseIndex = Number.isInteger(section.baseSectionIndex) ? section.baseSectionIndex : index;
  const variantIndex = Number.isInteger(section.imageVariantIndex) ? section.imageVariantIndex : 0;
  const variantSuffix = ["a", "b", "c"][variantIndex] || String(variantIndex + 1);
  const sceneBase = `scene-${String(baseIndex + 1).padStart(3, "0")}-${variantSuffix}`;
  const beatIndex = getImageBeatIndexForSentence(section, frameSentenceIndex, story);
  return `${sceneBase}-${String(beatIndex + 1).padStart(2, "0")}`;
}

async function findBatchImages(imagesDir, sceneBase) {
  const prefix = `${sceneBase}_batch_`;
  try {
    const entries = await fs.readdir(imagesDir);
    const batchFiles = entries
      .filter((e) => e.startsWith(prefix))
      .sort();
    const cleanResults = [];
    for (const file of batchFiles) {
      const fullPath = path.join(imagesDir, file);
      if (!await pathExists(fullPath)) continue;
      const quality = await inspectImage(fullPath).catch(() => null);
      if (quality?.ok) cleanResults.push(fullPath);
    }
    return cleanResults.length ? cleanResults : [];
  } catch {
    return [];
  }
}

function getImageBeatIndexForSentence(section, sentenceIndex = 0, story = null) {
  const beats = getSectionImageBeats(section);
  if (beats.length) {
    const index = Math.max(0, Number(sentenceIndex || 0));
    const match = beats.findIndex((beat) => index >= beat.sentenceStart && index <= beat.sentenceEnd);
    if (match >= 0) return match;
  }
  const beatSize = Number.isInteger(section.imageBeatSize) ? section.imageBeatSize : story?.mode === "pure-story" ? 4 : 2;
  return Math.max(0, Math.floor(Number(sentenceIndex || 0) / beatSize));
}

function getSectionImageBeats(section) {
  const sentences = section.sentences || [];
  const sentenceCount = Math.max(1, sentences.length);
  if (Array.isArray(section.imageBeats) && section.imageBeats.length) {
    return section.imageBeats
      .map((beat) => {
        const start = clampInteger(beat.sentenceStart, 0, sentenceCount - 1);
        const end = clampInteger(beat.sentenceEnd, start, sentenceCount - 1);
        return {
          ...beat,
          sentenceStart: start,
          sentenceEnd: Math.max(start, end)
        };
      })
      .sort((a, b) => a.sentenceStart - b.sentenceStart)
      .slice(0, 2);
  }
  return [{
    sentenceStart: 0,
    sentenceEnd: sentenceCount - 1
  }];
}

function clampInteger(value, min, max) {
  const number = Number(value);
  const integer = Number.isFinite(number) ? Math.trunc(number) : min;
  return Math.min(max, Math.max(min, integer));
}

async function findImageBySceneId(outputDir, sceneId) {
  const base = path.join(outputDir, "images", sceneId);
  for (const ext of [".png", ".jpg", ".jpeg", ".webp"]) {
    const candidate = `${base}${ext}`;
    if (await pathExists(candidate)) return candidate;
  }
  return null;
}

function renderLearningFrame({ story, frame, frameIndex, imageDataUri, layout }) {
  const { W, H, CAPTION_Y, CAPTION_H, CAPTION_W, CAPTION_X } = layout;
  const palette = getPalette(frameIndex);
  const pad = Math.round(W * 0.04);
  const imageLayer = imageDataUri
    ? `<image href="${imageDataUri}" x="${-pad}" y="${-pad}" width="${W + pad * 2}" height="${H + pad * 2}" preserveAspectRatio="xMidYMid slice"/>`
    : renderFallbackImage(frame, palette, layout);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="captionPanel" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#082f3f"/>
      <stop offset="55%" stop-color="#123b67"/>
      <stop offset="100%" stop-color="#242b63"/>
    </linearGradient>
    <linearGradient id="vocabPanel" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.86"/>
      <stop offset="50%" stop-color="#eaf5ff" stop-opacity="0.56"/>
      <stop offset="100%" stop-color="#9dccff" stop-opacity="0.36"/>
    </linearGradient>
    <linearGradient id="vocabEdge" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.95"/>
      <stop offset="50%" stop-color="#93c5fd" stop-opacity="0.45"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0.22"/>
    </linearGradient>
    <radialGradient id="vocabGlow" cx="28%" cy="20%" r="72%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.78"/>
      <stop offset="48%" stop-color="#bfdbfe" stop-opacity="0.18"/>
      <stop offset="100%" stop-color="#0b84ff" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="coverPanel" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#eef7ff" stop-opacity="0.92"/>
      <stop offset="100%" stop-color="#dbeafe" stop-opacity="0.72"/>
    </linearGradient>
    <linearGradient id="bottomCleanGradient" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#020817" stop-opacity="0"/>
      <stop offset="45%" stop-color="#020817" stop-opacity="0.35"/>
      <stop offset="100%" stop-color="#020817" stop-opacity="0.92"/>
    </linearGradient>
    <filter id="textShadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="2" stdDeviation="2.5" flood-color="#000000" flood-opacity="0.28"/>
    </filter>
    <filter id="glassShadow" x="-25%" y="-35%" width="150%" height="180%">
      <feDropShadow dx="0" dy="20" stdDeviation="18" flood-color="#00152e" flood-opacity="0.34"/>
      <feDropShadow dx="0" dy="-3" stdDeviation="4" flood-color="#ffffff" flood-opacity="0.46"/>
    </filter>
  </defs>
  <rect width="${W}" height="${H}" fill="#061329"/>
  ${imageLayer}
  <rect x="0" y="0" width="${W}" height="${H}" fill="#000" opacity="0.16"/>
  ${frame.kind !== "cover" && frame.kind !== "vocab-review" ? `<rect x="0" y="${Math.round(H * 0.838)}" width="${W}" height="${Math.round(H * 0.162)}" fill="url(#bottomCleanGradient)"/>` : ""}
  ${frame.kind === "cover" ? renderCoverOverlay(story, frame, layout) : ""}
  ${frame.kind === "vocab-review" ? renderVocabularyReviewOverlay(frame, layout) : ""}
  ${frame.kind !== "cover" && frame.kind !== "vocab-review" && frame.isPodcast ? `
  ${renderPodcastHosts(frame, layout)}
  ${frame.vocabWord ? renderVocabularyOverlay(frame, { podcast: true, layout }) : ""}
  ${renderPodcastCaption(frame, layout)}` : ""}
  ${frame.kind !== "cover" && frame.kind !== "vocab-review" && !frame.isPodcast ? `
  ${frame.kind === "vocabulary" || frame.vocabWord ? renderVocabularyOverlay(frame, { layout }) : ""}
  <rect x="${CAPTION_X}" y="${CAPTION_Y}" width="${CAPTION_W}" height="${CAPTION_H}" rx="34" fill="#04111f" opacity="0.61"/>
  <rect x="${CAPTION_X}" y="${CAPTION_Y}" width="${CAPTION_W}" height="${CAPTION_H}" rx="34" fill="none" stroke="#93c5fd" stroke-width="2.5" opacity="0.52"/>
  <rect x="${CAPTION_X + 4}" y="${CAPTION_Y + 4}" width="${CAPTION_W - 8}" height="${CAPTION_H - 8}" rx="30" fill="none" stroke="#ffffff" stroke-width="1.3" opacity="0.18"/>
  ${renderBottomText(frame, layout)}` : ""}
</svg>`;
}

function renderPodcastHosts(frame, layout) {
  const { W } = layout;
  const activeA = frame.speaker !== "host-b";
  const activeB = frame.speaker === "host-b";
  const cardW = Math.round(W * 0.219);
  const gap = Math.round(W * 0.05);
  const totalW = cardW * 2 + gap;
  const leftX = Math.round((W - totalW) / 2);
  const rightX = leftX + cardW + gap;
  return `
  ${renderPodcastHostCard({ x: leftX, y: 96, width: cardW, side: "left", label: "Host A", active: activeA })}
  ${renderPodcastHostCard({ x: rightX, y: 96, width: cardW, side: "right", label: "Host B", active: activeB })}`;
}

function renderPodcastHostCard({ x, y, width, side, label, active }) {
  const w = width || 420;
  const avatarX = x + (side === "left" ? Math.round(w * 0.186) : Math.round(w * 0.814));
  const micX = x + (side === "left" ? Math.round(w * 0.488) : Math.round(w * 0.376));
  const labelX = avatarX;
  const accent = active ? "#0b84ff" : "#94a3b8";
  const opacity = active ? 0.58 : 0.34;
  return `
  <g opacity="${opacity}">
    <rect x="${x}" y="${y}" width="${w}" height="178" rx="30" fill="#061527" opacity="0.36"/>
    <rect x="${x}" y="${y}" width="${w}" height="178" rx="30" fill="none" stroke="${accent}" stroke-width="${active ? 2.2 : 1.3}" opacity="0.46"/>
    <circle cx="${avatarX}" cy="${y + 72}" r="40" fill="${accent}" opacity="0.9"/>
    <circle cx="${avatarX}" cy="${y + 58}" r="17" fill="#eaf5ff"/>
    <path d="M${avatarX - 33} ${y + 116} C${avatarX - 22} ${y + 88} ${avatarX + 22} ${y + 88} ${avatarX + 33} ${y + 116} Z" fill="#eaf5ff"/>
    <rect x="${micX}" y="${y + 48}" width="26" height="78" rx="13" fill="#e2e8f0"/>
    <rect x="${micX - 33}" y="${y + 124}" width="92" height="9" rx="4.5" fill="#e2e8f0"/>
    <path d="M${micX - 24} ${y + 74} C${micX - 24} ${y + 126} ${micX + 50} ${y + 126} ${micX + 50} ${y + 74}" stroke="${accent}" stroke-width="6" fill="none" stroke-linecap="round"/>
    <text x="${labelX}" y="${y + 150}" text-anchor="middle" font-family="Arial, sans-serif" font-size="24" font-weight="900" fill="#ffffff">${label}</text>
  </g>`;
}

function renderPodcastCaption(frame, layout) {
  const { W, H } = layout;
  const isHostB = frame.speaker === "host-b";
  const captionY = Math.round(H * 0.652);
  const captionH = Math.round(H * 0.213);
  const captionW = Math.round(W * 0.76);
  const x = Math.round((W - captionW) / 2);
  const textX = Math.round(W / 2);
  const label = frame.speakerName || (isHostB ? "Host B" : "Host A");
  const badgeW = Math.round(W * 0.163);
  const badgeX = isHostB ? x + captionW - badgeW - Math.round(W * 0.025) : x + Math.round(W * 0.025);
  const speakerX = badgeX + Math.round(badgeW / 2);
  return `
  <rect x="${x}" y="${captionY}" width="${captionW}" height="${captionH}" rx="34" fill="#04111f" opacity="0.62"/>
  <rect x="${x}" y="${captionY}" width="${captionW}" height="${captionH}" rx="34" fill="none" stroke="${isHostB ? "#f59e0b" : "#38bdf8"}" stroke-width="2.6" opacity="0.68"/>
  <rect x="${badgeX}" y="${captionY + 26}" width="${badgeW}" height="52" rx="26" fill="${isHostB ? "#f59e0b" : "#0b84ff"}" opacity="0.94"/>
  <text x="${speakerX}" y="${captionY + 62}" text-anchor="middle" font-family="Arial, sans-serif" font-size="24" font-weight="900" fill="#ffffff">${escapeXml(label)}</text>
  ${renderPodcastBottomText(frame, textX, captionY, captionH, layout)}`;
}

function renderPodcastBottomText(frame, textX, captionY, captionH, layout) {
  const wrapLen = layout?.isPortrait ? 36 : 46;
  const chineseWrapLen = layout?.isPortrait ? 32 : 42;
  const englishLines = wrapWords(frame.english || "", wrapLen).slice(0, 2);
  const chineseLines = wrapMixed(frame.chinese || "", chineseWrapLen).slice(0, 2);
  const englishFont = englishLines.length > 1 ? 42 : 46;
  const chineseFont = chineseLines.length > 1 ? 27 : 29;
  const englishY = captionY + 118;
  const chineseY = captionY + 188;
  return `
  ${renderEnglishCaptionLinesAt(englishLines, frame.highlightedTerm, englishY, englishFont, textX)}
  ${chineseLines.map((line, index) => `<text x="${textX}" y="${chineseY + index * 34}" text-anchor="middle" font-family="PingFang SC, Noto Sans CJK SC, Arial, sans-serif" font-size="${chineseFont}" font-weight="800" fill="#e2e8f0" opacity="0.84" filter="url(#textShadow)">${escapeXml(line)}</text>`).join("\n  ")}`;
}

function renderCoverOverlay(story, frame, layout) {
  const { W, H } = layout;
  const gradeLevel = estimateUsGradeLevel(story);

  // Responsive dimensions
  const titleWrap = layout.isPortrait ? 18 : 24;
  const titleLines = wrapWords(story.title || frame.title || "English Story", titleWrap).slice(0, 3);
  const summaryWrap = layout.isPortrait ? 32 : 44;
  const summaryLines = wrapMixed(story.summary || "Practice listening, reading, and speaking with clear English.", summaryWrap).slice(0, 2);

  // Layout positions
  const centerX = Math.round(W / 2);
  const contentX = layout.isPortrait ? Math.round(W * 0.1) : Math.round(W * 0.12);
  const contentW = layout.isPortrait ? Math.round(W * 0.8) : Math.round(W * 0.76);

  // Title area
  const titleFontSize = layout.isPortrait ? (titleLines.length > 1 ? 44 : 52) : (titleLines.length > 1 ? 56 : 68);
  const titleLineHeight = Math.round(titleFontSize * 1.3);
  const titleHeight = titleLines.length * titleLineHeight;

  // Spacing and sizing
  const btnSize = layout.isPortrait ? Math.round(W * 0.22) : Math.round(W * 0.12);
  const btnGap = Math.round(H * 0.08);
  const listenGap = Math.round(H * 0.05);
  const listenHeight = 40;
  const summaryGap = Math.round(H * 0.05);
  const summaryLineHeight = Math.round(H * 0.035);
  const summaryHeight = summaryLines.length * summaryLineHeight;
  const diffGap = Math.round(H * 0.03);
  const diffHeight = 30;

  // Dynamic vertical centering
  const totalContentH = titleHeight + btnGap + btnSize + listenGap + listenHeight + summaryGap + summaryHeight + diffGap + diffHeight;
  const titleStartY = Math.max(Math.round(H * 0.05), Math.round((H - totalContentH) / 2));

  // Layout positions
  const btnY = titleStartY + titleHeight + btnGap;
  const btnRx = Math.round(btnSize * 0.28);
  
  // Triangle play icon
  const triSize = Math.round(btnSize * 0.32);
  const triLeft = centerX - Math.round(triSize * 0.4);
  const triRight = centerX + Math.round(triSize * 0.5);
  const triTop = btnY + Math.round(btnSize * 0.5) - Math.round(triSize * 0.5);
  const triBottom = btnY + Math.round(btnSize * 0.5) + Math.round(triSize * 0.5);

  // Text below button
  const listenY = btnY + btnSize + listenGap;
  const summaryY = listenY + listenHeight + summaryGap;
  const diffY = summaryY + summaryHeight + diffGap;

  return `
  <!-- Semi-transparent overlay -->
  <rect x="0" y="0" width="${W}" height="${H}" fill="#000" opacity="0.35"/>

  <!-- Main content card -->
  <rect x="${contentX - 20}" y="${titleStartY - 70}" width="${contentW + 40}" height="${diffY - titleStartY + 110}" rx="32" fill="#fff" opacity="0.92"/>

  <!-- Brand badge -->
  <rect x="${contentX}" y="${titleStartY - 45}" width="180" height="42" rx="21" fill="#3b82f6"/>
  <text x="${contentX + 90}" y="${titleStartY - 18}" text-anchor="middle" font-family="Arial, sans-serif" font-size="22" font-weight="800" letter-spacing="3" fill="#fff">ECHOENGLISH</text>

  <!-- Title -->
  ${titleLines.map((line, i) => `<text x="${centerX}" y="${titleStartY + i * titleLineHeight + titleFontSize}" text-anchor="middle" font-family="Arial, sans-serif" font-size="${titleFontSize}" font-weight="900" fill="#1e293b">${escapeXml(line)}</text>`).join("\n  ")}

  <!-- Play button -->
  <rect x="${centerX - btnSize / 2}" y="${btnY}" width="${btnSize}" height="${btnSize}" rx="${btnRx}" fill="#3b82f6"/>
  <polygon points="${triLeft},${triTop} ${triLeft},${triBottom} ${triRight},${Math.round((triTop + triBottom) / 2)}" fill="#fff"/>

  <!-- Listen text -->
  <text x="${centerX}" y="${listenY}" text-anchor="middle" font-family="Arial, sans-serif" font-size="32" font-weight="800" fill="#1e293b">Listen &amp; Shadow</text>
  <text x="${centerX}" y="${listenY + 34}" text-anchor="middle" font-family="PingFang SC, Noto Sans CJK SC, Arial, sans-serif" font-size="24" font-weight="700" fill="#64748b">边听边读 · 口语跟读</text>

  <!-- Summary -->
  ${summaryLines.map((line, i) => `<text x="${centerX}" y="${summaryY + i * summaryLineHeight}" text-anchor="middle" font-family="PingFang SC, Noto Sans CJK SC, Arial, sans-serif" font-size="24" font-weight="600" fill="#475569">${escapeXml(line)}</text>`).join("\n  ")}

  <!-- Difficulty -->
  <text x="${centerX}" y="${diffY}" text-anchor="middle" font-family="Arial, sans-serif" font-size="22" font-weight="700" fill="#94a3b8">Difficulty: U.S. Grade ${escapeXml(gradeLevel)}</text>`;
}

function renderVocabularyReviewOverlay(frame, layout) {
  const { W, H } = layout;
  const vocabulary = Array.isArray(frame.vocabulary) ? frame.vocabulary.slice(0, 54) : [];
  const columns = layout.isPortrait ? 2 : 3;
  const rowsPerColumn = Math.max(1, Math.ceil(vocabulary.length / columns));
  const columnWidth = layout.isPortrait ? Math.round(W * 0.42) : 560;
  const startX = layout.isPortrait ? Math.round(W * 0.08) : 170;
  const startY = layout.isPortrait ? Math.round(H * 0.18) : 276;
  const dense = rowsPerColumn > 13;
  const rowHeight = dense ? 39 : 48;
  const wordFont = dense ? 18 : 21;
  const phoneticFont = dense ? 14 : 16;
  const chineseFont = dense ? 16 : 19;
  const panelPad = Math.round(W * 0.0625);
  const panelW = W - panelPad * 2;
  const panelH = Math.round(H * 0.833);
  const panelY = Math.round(H * 0.083);
  const innerPad = Math.round(W * 0.016);

  return `
  <rect x="0" y="0" width="${W}" height="${H}" fill="#020817" opacity="0.52"/>
  <rect x="${panelPad}" y="${panelY}" width="${panelW}" height="${panelH}" rx="44" fill="#f8fbff" opacity="0.94"/>
  <rect x="${panelPad + innerPad}" y="${panelY + innerPad * 2}" width="${panelW - innerPad * 2}" height="${panelH - innerPad * 4}" rx="34" fill="none" stroke="#bfdbfe" stroke-width="2" opacity="0.46"/>
  <text x="${panelPad + innerPad * 2.5}" y="${panelY + Math.round(H * 0.074)}" font-family="Arial, sans-serif" font-size="34" font-weight="900" letter-spacing="5" fill="#1d4ed8">VOCABULARY REVIEW</text>
  <text x="${panelPad + innerPad * 2.5}" y="${panelY + Math.round(H * 0.115)}" font-family="PingFang SC, Noto Sans CJK SC, Arial, sans-serif" font-size="30" font-weight="800" fill="#334155">难点词汇总复习：单词 / 音标 / 中文释义</text>
  ${vocabulary.map((entry, index) => {
    const column = Math.floor(index / rowsPerColumn);
    const row = index % rowsPerColumn;
    const x = startX + column * columnWidth;
    const y = startY + row * rowHeight;
    const word = entry.word || entry[0] || "";
    const translation = entry.translation || entry[1] || "";
    const phonetic = entry.phonetic || entry[2] || "";
    return renderReviewEntry({ x, y, word, phonetic, translation, rowHeight, wordFont, phoneticFont, chineseFont });
  }).join("\n  ")}`;
}

function renderReviewEntry({ x, y, word, phonetic, translation, rowHeight, wordFont, phoneticFont, chineseFont }) {
  const wordText = fitSvgText(word, 22);
  const phoneticText = fitSvgText(phonetic, 24);
  const cleanTranslation = translation && translation !== "重点词" ? translation : "";
  const translationText = cleanTranslation ? fitSvgText(cleanTranslation, 18) : "";
  const wordSize = fitFontSize(wordText, wordFont, 150);
  const phoneticSize = fitFontSize(phoneticText, phoneticFont, 135);
  const translationSize = translationText ? fitFontSize(translationText, chineseFont, 205, true) : chineseFont;
  const baseline = y + Math.max(20, Math.round(rowHeight * 0.58));
  return `
  <g>
    <line x1="${x}" y1="${y + rowHeight - 7}" x2="${x + 510}" y2="${y + rowHeight - 7}" stroke="#dbeafe" stroke-width="1.2" opacity="0.58"/>
    <text x="${x}" y="${baseline}" font-family="Arial, sans-serif" font-size="${wordSize}" font-weight="900" fill="#0f172a">${escapeXml(wordText)}</text>
    <text x="${x + 168}" y="${baseline}" font-family="Arial, sans-serif" font-size="${phoneticSize}" font-weight="800" fill="#2563eb">${escapeXml(phoneticText)}</text>
    ${translationText ? `<text x="${x + 326}" y="${baseline}" font-family="PingFang SC, Noto Sans CJK SC, Arial, sans-serif" font-size="${translationSize}" font-weight="800" fill="#475569">${escapeXml(translationText)}</text>` : ""}
  </g>`;
}

function renderVocabularyOverlay(frame, options = {}) {
  const [word, translation, phonetic] = [frame.vocabWord, frame.vocabTranslation, frame.vocabPhonetic];
  if (!word) return "";
  const layout = options.layout;
  if (options.podcast) return renderPodcastVocabularyOverlay(frame, layout);
  const W = layout ? layout.W : 1920;
  const H = layout ? layout.H : 1080;
  const wordLines = wrapMixed(word, 24).slice(0, 1);
  const phoneticLines = wrapMixed(phonetic || "", 26).slice(0, 1);
  const hasTranslation = translation && translation !== "重点词";
  const translationLines = hasTranslation ? wrapMixed(translation, 18).slice(0, 1) : [];
  const x = options.podcast ? Math.round(W * 0.388) : Math.round(W * 0.745);
  const y = options.podcast ? Math.round(H * 0.076) : Math.round(H * 0.065);
  const width = Math.round(W * 0.224);
  const height = hasTranslation ? (options.podcast ? 134 : 136) : 100;
  return `
  <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="22" fill="#061527" opacity="0.72"/>
  <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="22" fill="none" stroke="#7dd3fc" stroke-width="2" opacity="0.46"/>
  ${wordLines.map((line) => `<text x="${x + 28}" y="${y + 42}" font-family="Georgia, 'Times New Roman', serif" font-size="27" font-weight="900" fill="#ffffff" filter="url(#textShadow)">${escapeXml(line)}</text>`).join("\n  ")}
  ${phoneticLines.map((line) => `<text x="${x + 28}" y="${y + 72}" font-family="Arial, sans-serif" font-size="20" font-weight="800" fill="#f59e0b">${escapeXml(line)}</text>`).join("\n  ")}
  ${translationLines.map((line) => `<text x="${x + 28}" y="${y + 104}" font-family="PingFang SC, Noto Sans CJK SC, Arial, sans-serif" font-size="24" font-weight="850" fill="#ffffff" filter="url(#textShadow)">${escapeXml(line)}</text>`).join("\n  ")}`;
}

function renderPodcastVocabularyOverlay(frame, layout) {
  const W = layout ? layout.W : 1920;
  const H = layout ? layout.H : 1080;
  const isHostB = frame.speaker === "host-b";
  const x = isHostB ? Math.round(W * 0.622) : Math.round(W * 0.154);
  const y = Math.round(H * 0.602);
  const width = Math.round(W * 0.224);
  const accent = isHostB ? "#f59e0b" : "#38bdf8";
  const word = fitSvgText(frame.vocabWord || "", 23);
  const phonetic = fitSvgText(frame.vocabPhonetic || "", 25);
  const rawTranslation = frame.vocabTranslation || "";
  const hasTranslation = rawTranslation && rawTranslation !== "重点词";
  const translation = hasTranslation ? fitSvgText(rawTranslation, 14) : "";
  const boxHeight = hasTranslation ? 82 : 58;
  const phoneticY = hasTranslation ? y + 63 : y + 48;
  return `
  <rect x="${x}" y="${y}" width="${width}" height="${boxHeight}" rx="24" fill="#061527" opacity="0.72"/>
  <rect x="${x}" y="${y}" width="${width}" height="${boxHeight}" rx="24" fill="none" stroke="${accent}" stroke-width="2.2" opacity="0.62"/>
  <text x="${x + 28}" y="${y + 33}" font-family="Georgia, 'Times New Roman', serif" font-size="${fitFontSize(word, 25, 190)}" font-weight="900" fill="#ffffff" filter="url(#textShadow)">${escapeXml(word)}</text>
  <text x="${x + 28}" y="${phoneticY}" font-family="Arial, sans-serif" font-size="${fitFontSize(phonetic, 18, 175)}" font-weight="800" fill="#f59e0b">${escapeXml(phonetic)}</text>
  ${hasTranslation ? `<text x="${x + 245}" y="${phoneticY}" font-family="PingFang SC, Noto Sans CJK SC, Arial, sans-serif" font-size="${fitFontSize(translation, 20, 140, true)}" font-weight="850" fill="#ffffff" filter="url(#textShadow)">${escapeXml(translation)}</text>` : ""}`;
}

function renderBottomText(frame, layout) {
  const { W, CAPTION_Y, CAPTION_H } = layout;
  const wrapLen = layout.isPortrait ? 42 : 52;
  const chineseWrapLen = layout.isPortrait ? 36 : 44;
  const englishLines = wrapWords(frame.english || "", wrapLen).slice(0, 3);
  const chineseLines = wrapMixed(frame.chinese || "", chineseWrapLen).slice(0, 3);
  const englishFont = englishLines.length > 2 ? 42 : englishLines.length > 1 ? 48 : 52;
  const chineseFont = chineseLines.length > 2 ? 26 : chineseLines.length > 1 ? 30 : 33;
  const englishLineHeight = englishLines.length > 2 ? 46 : 52;
  const chineseLineHeight = chineseLines.length > 2 ? 34 : 38;
  const gap = englishLines.length > 2 || chineseLines.length > 2 ? 32 : 42;
  const englishBlockHeight = englishFont + Math.max(0, englishLines.length - 1) * englishLineHeight;
  const chineseBlockHeight = chineseFont + Math.max(0, chineseLines.length - 1) * chineseLineHeight;
  const totalTextHeight = englishBlockHeight + gap + chineseBlockHeight;
  const top = CAPTION_Y + Math.max(34, (CAPTION_H - totalTextHeight) / 2);
  const englishY = top + englishFont;
  const chineseY = top + englishBlockHeight + gap + chineseFont;
  return `
  ${renderEnglishCaptionLines(englishLines, frame.highlightedTerm, englishY, englishFont, layout)}
  ${chineseLines.map((line, index) => `<text x="${W / 2}" y="${chineseY + index * 38}" text-anchor="middle" font-family="PingFang SC, Noto Sans CJK SC, Arial, sans-serif" font-size="${chineseFont}" font-weight="800" fill="#e2e8f0" opacity="0.86" filter="url(#textShadow)">${escapeXml(line)}</text>`).join("\n  ")}`;
}

function renderEnglishCaptionLines(lines, highlightedTerm, startY, fontSize, layout) {
  return renderEnglishCaptionLinesAt(lines, highlightedTerm, startY, fontSize, layout.W / 2);
}

function renderEnglishCaptionLinesAt(lines, highlightedTerm, startY, fontSize, centerX) {
  const plain = lines.map((line, index) => ({ line, y: startY + index * 52 }));
  if (!highlightedTerm) {
    return plain.map(({ line, y }) => renderCenteredTextAt(line, y, fontSize, "#ffffff", centerX)).join("\n  ");
  }

  const normalizedTerm = normalizeTermForMatch(highlightedTerm);
  return plain.map(({ line, y }) => {
    const match = findTermInLine(line, normalizedTerm);
    if (!match) return renderCenteredTextAt(line, y, fontSize, "#ffffff", centerX);
    const before = line.slice(0, match.start);
    const term = line.slice(match.start, match.end);
    const after = line.slice(match.end);
    return `<text x="${centerX}" y="${y}" xml:space="preserve" text-anchor="middle" font-family="Arial, sans-serif" font-size="${fontSize}" font-style="italic" font-weight="750" fill="#ffffff" filter="url(#textShadow)">
      <tspan xml:space="preserve">${escapeXml(before)}</tspan><tspan fill="#f59e0b">${escapeXml(term)}</tspan><tspan xml:space="preserve">${escapeXml(after)}</tspan>
    </text>`;
  }).join("\n  ");
}

function renderCenteredText(line, y, fontSize, fill, layout) {
  return renderCenteredTextAt(line, y, fontSize, fill, layout.W / 2);
}

function renderCenteredTextAt(line, y, fontSize, fill, centerX) {
  return `<text x="${centerX}" y="${y}" xml:space="preserve" text-anchor="middle" font-family="Arial, sans-serif" font-size="${fontSize}" font-style="italic" font-weight="750" fill="${fill}" filter="url(#textShadow)">${escapeXml(line)}</text>`;
}

function renderFallbackImage(frame, palette, layout) {
  const { W, H } = layout;
  const visual = String(frame.visual || "storybook learning scene");
  return `
  <rect x="0" y="0" width="${W}" height="${H}" fill="${palette.bg}"/>
  <rect x="0" y="0" width="${W}" height="${H}" fill="#f9efe1" opacity="0.1"/>
  ${renderSceneSetting(visual, palette, W, H)}
  ${renderCharacters(palette, W, H)}
  ${renderImportantObject(visual, palette, W, H)}`;
}

function renderSceneSetting(visual, palette, W, H) {
  const text = visual.toLowerCase();
  const s = W / 1920;
  const sy = H / 1080;
  const S = (v) => Math.round(v * s);
  const SY = (v) => Math.round(v * sy);

  if (text.includes("lighthouse") || text.includes("storm") || text.includes("coastal")) {
    return `
  <rect x="0" y="${SY(330)}" width="${W}" height="${SY(190)}" fill="#12354a" opacity="0.85"/>
  <path d="M0 ${SY(375)} C${S(260)} ${SY(315)} ${S(460)} ${SY(430)} ${S(700)} ${SY(370)} C${S(960)} ${SY(305)} ${S(1130)} ${SY(425)} ${S(1390)} ${SY(360)} C${S(1620)} ${SY(305)} ${S(1780)} ${SY(370)} ${W} ${SY(340)} L${W} ${SY(520)} L0 ${SY(520)} Z" fill="#1f6f92" opacity="0.72"/>
  <polygon points="${S(1240)},${SY(96)} ${S(1380)},${SY(96)} ${S(1430)},${SY(430)} ${S(1190)},${SY(430)}" fill="#eee8dc"/>
  <rect x="${S(1205)}" y="${SY(150)}" width="${S(210)}" height="${SY(52)}" fill="${palette.accent}" opacity="0.9"/>
  <polygon points="${S(1185)},${SY(96)} ${S(1435)},${SY(96)} ${S(1350)},${SY(40)} ${S(1260)},${SY(40)}" fill="#222936"/>
  <path d="M${S(1340)} ${SY(72)} L${S(1805)} ${SY(155)}" stroke="#ffd166" stroke-width="22" opacity="0.55"/>`;
  }

  if (text.includes("mountain") || text.includes("snow")) {
    return `
  <rect x="0" y="0" width="${W}" height="${SY(520)}" fill="#b9d8ea" opacity="0.62"/>
  <polygon points="0,${SY(520)} ${S(360)},${SY(115)} ${S(700)},${SY(520)}" fill="#435466"/>
  <polygon points="${S(320)},${SY(520)} ${S(820)},${SY(70)} ${S(1320)},${SY(520)}" fill="#57697b"/>
  <polygon points="${S(900)},${SY(520)} ${S(1390)},${SY(125)} ${W},${SY(520)}" fill="#36495c"/>
  <polygon points="${S(820)},${SY(70)} ${S(720)},${SY(178)} ${S(928)},${SY(176)}" fill="#f7fbff"/>
  <path d="M${S(180)} ${SY(430)} C${S(520)} ${SY(390)} ${S(780)} ${SY(460)} ${S(1060)} ${SY(410)} C${S(1350)} ${SY(358)} ${S(1590)} ${SY(430)} ${S(1840)} ${SY(380)}" stroke="#ffffff" stroke-width="18" opacity="0.75" fill="none"/>`;
  }

  if (text.includes("forest") || text.includes("tree") || text.includes("valley")) {
    return `
  <rect x="0" y="0" width="${W}" height="${SY(520)}" fill="#9cc6aa" opacity="0.48"/>
  ${[170, 360, 590, 1380, 1585, 1760].map((x, index) => `
  <rect x="${S(x)}" y="${SY(225 + (index % 2) * 18)}" width="${S(34)}" height="${SY(230)}" fill="#5b3f2f"/>
  <circle cx="${S(x + 17)}" cy="${SY(185 + (index % 2) * 20)}" r="${S(104 + (index % 3) * 18)}" fill="#1f6f58" opacity="0.86"/>`).join("\n")}
  <path d="M0 ${SY(455)} C${S(370)} ${SY(390)} ${S(650)} ${SY(510)} ${S(980)} ${SY(430)} C${S(1280)} ${SY(365)} ${S(1580)} ${SY(455)} ${W} ${SY(400)} L${W} ${SY(520)} L0 ${SY(520)} Z" fill="#274c3c" opacity="0.9"/>`;
  }

  if (text.includes("school") || text.includes("classroom") || text.includes("hallway")) {
    return `
  <rect x="0" y="0" width="${W}" height="${SY(520)}" fill="#d8c3a5" opacity="0.95"/>
  <rect x="0" y="${SY(405)}" width="${W}" height="${SY(115)}" fill="#795548"/>
  <rect x="${S(180)}" y="${SY(90)}" width="${S(500)}" height="${SY(260)}" fill="#263238" opacity="0.92"/>
  <rect x="${S(760)}" y="${SY(120)}" width="${S(260)}" height="${SY(285)}" fill="#9f6b45"/>
  <circle cx="${S(980)}" cy="${SY(262)}" r="11" fill="#f1d37a"/>
  <rect x="${S(1130)}" y="${SY(95)}" width="${S(560)}" height="${SY(250)}" fill="#f6fbff" opacity="0.72"/>
  <path d="M${S(1130)} ${SY(205)} L${S(1690)} ${SY(205)} M${S(1410)} ${SY(95)} L${S(1410)} ${SY(345)}" stroke="#6d8793" stroke-width="12" opacity="0.55"/>`;
  }

  if (text.includes("library") || text.includes("book")) {
    return `
  <rect x="0" y="0" width="${W}" height="${SY(520)}" fill="#6a4b35"/>
  ${[90, 520, 1180, 1535].map((x) => `
  <rect x="${S(x)}" y="${SY(75)}" width="${S(300)}" height="${SY(345)}" fill="#3a2418" opacity="0.9"/>
  ${[0, 1, 2, 3].map((row) => `<rect x="${S(x + 22)}" y="${SY(105 + row * 74)}" width="${S(256)}" height="${SY(44)}" fill="${row % 2 ? "#b45b45" : "#d29b52"}" opacity="0.9"/>`).join("\n")}`).join("\n")}
  <ellipse cx="${S(960)}" cy="${SY(445)}" rx="${S(390)}" ry="${SY(70)}" fill="#2b1a12" opacity="0.5"/>`;
  }

  if (text.includes("museum") || text.includes("statue")) {
    return `
  <rect x="0" y="0" width="${W}" height="${SY(520)}" fill="#cfc2ad"/>
  <rect x="0" y="${SY(400)}" width="${W}" height="${SY(120)}" fill="#8a8175"/>
  ${[360, 600, 840, 1080, 1320].map((x) => `<rect x="${S(x)}" y="${SY(115)}" width="${S(80)}" height="${SY(285)}" fill="#ece1d1"/><rect x="${S(x - 35)}" y="${SY(90)}" width="${S(150)}" height="${SY(34)}" fill="#ddd0be"/>`).join("\n")}
  <circle cx="${S(1510)}" cy="${SY(260)}" r="${S(92)}" fill="#59636f" opacity="0.82"/>
  <rect x="${S(1465)}" y="${SY(345)}" width="${S(90)}" height="${SY(80)}" fill="#59636f" opacity="0.82"/>`;
  }

  if (text.includes("train") || text.includes("station")) {
    return `
  <rect x="0" y="0" width="${W}" height="${SY(520)}" fill="#546a7b"/>
  <rect x="0" y="${SY(355)}" width="${W}" height="${SY(165)}" fill="#2d2f34"/>
  <path d="M${S(90)} ${SY(420)} L${S(1780)} ${SY(420)} M${S(130)} ${SY(480)} L${S(1820)} ${SY(480)}" stroke="#cfd8dc" stroke-width="14"/>
  <rect x="${S(430)}" y="${SY(165)}" width="${S(930)}" height="${SY(175)}" rx="26" fill="#dbe8ed"/>
  <rect x="${S(500)}" y="${SY(205)}" width="${S(170)}" height="${SY(88)}" fill="#254e70"/>
  <rect x="${S(735)}" y="${SY(205)}" width="${S(170)}" height="${SY(88)}" fill="#254e70"/>
  <rect x="${S(970)}" y="${SY(205)}" width="${S(170)}" height="${SY(88)}" fill="#254e70"/>`;
  }

  if (text.includes("bakery")) {
    return `
  <rect x="0" y="0" width="${W}" height="${SY(520)}" fill="#c98a5a"/>
  <rect x="${S(230)}" y="${SY(115)}" width="${S(1460)}" height="${SY(305)}" fill="#f4d6ad"/>
  <path d="M${S(230)} ${SY(115)} H${S(1690)} V${SY(190)} C${S(1560)} ${SY(155)} ${S(1450)} ${SY(220)} ${S(1320)} ${SY(185)} C${S(1190)} ${SY(150)} ${S(1090)} ${SY(215)} ${S(960)} ${SY(180)} C${S(830)} ${SY(145)} ${S(720)} ${SY(215)} ${S(590)} ${SY(180)} C${S(470)} ${SY(150)} ${S(350)} ${SY(210)} ${S(230)} ${SY(175)} Z" fill="#c03535"/>
  <rect x="${S(450)}" y="${SY(230)}" width="${S(280)}" height="${SY(160)}" fill="#5d4037"/>
  <rect x="${S(910)}" y="${SY(245)}" width="${S(580)}" height="${SY(95)}" fill="#fff2d6" opacity="0.95"/>`;
  }

  return `
  <rect x="0" y="0" width="${W}" height="${SY(520)}" fill="#92b8c7" opacity="0.54"/>
  <circle cx="${S(1570)}" cy="${SY(92)}" r="${S(80)}" fill="#ffd166" opacity="0.74"/>
  <path d="M0 ${SY(360)} C${S(260)} ${SY(300)} ${S(520)} ${SY(430)} ${S(780)} ${SY(350)} C${S(1030)} ${SY(275)} ${S(1310)} ${SY(410)} ${S(1600)} ${SY(330)} C${S(1740)} ${SY(290)} ${S(1845)} ${SY(315)} ${W} ${SY(300)} L${W} ${SY(520)} L0 ${SY(520)} Z" fill="${palette.secondary}" opacity="0.76"/>
  <rect x="${S(230)}" y="${SY(190)}" width="${S(390)}" height="${SY(220)}" fill="#f0dfc2" opacity="0.92"/>
  <polygon points="${S(200)},${SY(190)} ${S(425)},${SY(80)} ${S(650)},${SY(190)}" fill="${palette.accent}" opacity="0.9"/>
  <rect x="${S(780)}" y="${SY(155)}" width="${S(520)}" height="${SY(255)}" rx="18" fill="#2d3748" opacity="0.78"/>
  <rect x="${S(850)}" y="${SY(210)}" width="${S(150)}" height="${SY(100)}" fill="#f6fbff" opacity="0.72"/>
  <rect x="${S(1060)}" y="${SY(210)}" width="${S(150)}" height="${SY(100)}" fill="#f6fbff" opacity="0.72"/>`;
}

function renderCharacters(palette, W, H) {
  const s = W / 1920;
  const sy = H / 1080;
  const S = (v) => Math.round(v * s);
  const SY = (v) => Math.round(v * sy);
  return `
  <ellipse cx="${S(960)}" cy="${SY(438)}" rx="${S(390)}" ry="${SY(58)}" fill="#000000" opacity="0.18"/>
  <circle cx="${S(915)}" cy="${SY(245)}" r="${S(58)}" fill="#f2c9a0"/>
  <path d="M${S(850)} ${SY(335)} C${S(850)} ${SY(270)} ${S(980)} ${SY(270)} ${S(982)} ${SY(335)} L${S(1010)} ${SY(450)} L${S(815)} ${SY(450)} Z" fill="${palette.accent}" opacity="0.94"/>
  <path d="M${S(815)} ${SY(350)} C${S(760)} ${SY(380)} ${S(720)} ${SY(415)} ${S(690)} ${SY(462)}" stroke="#f2c9a0" stroke-width="24" stroke-linecap="round"/>
  <path d="M${S(1010)} ${SY(350)} C${S(1080)} ${SY(372)} ${S(1125)} ${SY(406)} ${S(1165)} ${SY(452)}" stroke="#f2c9a0" stroke-width="24" stroke-linecap="round"/>
  <circle cx="${S(1178)}" cy="${SY(292)}" r="${S(44)}" fill="#e9b889"/>
  <path d="M${S(1138)} ${SY(354)} C${S(1155)} ${SY(310)} ${S(1225)} ${SY(310)} ${S(1245)} ${SY(354)} L${S(1268)} ${SY(446)} L${S(1115)} ${SY(446)} Z" fill="#2f6f8f" opacity="0.95"/>`;
}

function renderImportantObject(visual, palette, W, H) {
  const s = W / 1920;
  const S = (v) => Math.round(v * s);
  return `
  <g transform="translate(${S(1280)} ${Math.round(H * 0.278)})">
    <ellipse cx="0" cy="${S(112)}" rx="${S(158)}" ry="${S(34)}" fill="#000000" opacity="0.18"/>
    <rect x="${S(-105)}" y="${S(-34)}" width="${S(210)}" height="${S(146)}" rx="26" fill="#fff7dc" opacity="0.94"/>
    <path d="M${S(-66)} ${S(26)} C${S(-18)} ${S(-46)} ${S(60)} ${S(-36)} ${S(70)} ${S(32)} C${S(80)} ${S(90)} ${S(-32)} ${S(110)} ${S(-66)} ${S(26)} Z" fill="${palette.accent}" opacity="0.88"/>
  </g>`;
}

function translateSentence(section, sentence) {
  const index = section.sentences.findIndex((candidate) => candidate === sentence);
  if (index >= 0 && section.translations?.[index]) return section.translations[index];
  return TRANSLATIONS[sentence] || "请跟读这个英文句子。";
}

function selectVocabularyForSentence(story, section, sentence) {
  const local = Array.isArray(section?.vocabulary) ? section.vocabulary : [];
  const global = Array.isArray(story?.vocabularyReview)
    ? story.vocabularyReview.map((entry) => [entry.word, entry.translation, entry.phonetic])
    : [];
  const sentenceText = normalizeSentenceForMatch(sentence);

  return selectMatchingVocabulary(local, sentenceText) || selectMatchingVocabulary(global, sentenceText);
}

function selectMatchingVocabulary(candidates, sentenceText) {
  return candidates
    .filter((entry) => entry?.[0] && sentenceIncludesTerm(sentenceText, entry[0]))
    .sort((a, b) => vocabularyScore(b[0]) - vocabularyScore(a[0]))[0] || null;
}

function vocabularyScore(term) {
  const normalized = normalizeTermForMatch(term);
  const words = normalized.split(/\s+/).filter(Boolean).length;
  return normalized.length + words * 6;
}

function sentenceIncludesTerm(sentenceText, term) {
  const normalized = normalizeTermForMatch(term);
  if (!normalized) return false;
  const variants = termVariants(normalized);
  return variants.some((variant) => new RegExp(`(^|[^a-z0-9])${escapeRegExp(variant)}([^a-z0-9]|$)`, "i").test(sentenceText));
}

function findTermInLine(line, normalizedTerm) {
  if (!normalizedTerm) return null;
  const variants = termVariants(normalizedTerm).sort((a, b) => b.length - a.length);
  for (const variant of variants) {
    const regex = new RegExp(`(^|[^a-z0-9])(${escapeRegExp(variant)})([^a-z0-9]|$)`, "i");
    const match = regex.exec(normalizeSentenceForMatch(line));
    if (!match) continue;
    const start = match.index + match[1].length;
    const end = start + match[2].length;
    return { start, end };
  }
  return null;
}

function termVariants(term) {
  const normalized = normalizeTermForMatch(term);
  const variants = new Set([normalized]);
  addNumberWordVariants(normalized, variants);
  if (normalized.endsWith("y")) variants.add(`${normalized.slice(0, -1)}ies`);
  if (normalized.endsWith("e")) {
    variants.add(`${normalized}d`);
    variants.add(`${normalized.slice(0, -1)}ing`);
  } else {
    variants.add(`${normalized}s`);
    variants.add(`${normalized}ed`);
    variants.add(`${normalized}ing`);
  }
  return [...variants].filter(Boolean);
}

function addNumberWordVariants(term, variants) {
  const numberWords = {
    zero: "0",
    one: "1",
    two: "2",
    three: "3",
    four: "4",
    five: "5",
    six: "6",
    seven: "7",
    eight: "8",
    nine: "9",
    ten: "10"
  };
  Object.entries(numberWords).forEach(([word, number]) => {
    if (new RegExp(`\\b${word}\\b`).test(term)) {
      variants.add(term.replace(new RegExp(`\\b${word}\\b`, "g"), number));
    }
    if (new RegExp(`\\b${number}\\b`).test(term)) {
      variants.add(term.replace(new RegExp(`\\b${number}\\b`, "g"), word));
    }
  });
}

function normalizeSentenceForMatch(value) {
  return String(value || "").toLowerCase();
}

function normalizeTermForMatch(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[“”"'.:,;!?()[\]/]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function estimateEnglishTextWidth(text, fontSize) {
  return Array.from(String(text || "")).reduce((total, char) => {
    if (char === " ") return total + fontSize * 0.28;
    if (/[A-Z]/.test(char)) return total + fontSize * 0.62;
    if (/[il.,'’]/.test(char)) return total + fontSize * 0.28;
    if (/[mwMW]/.test(char)) return total + fontSize * 0.82;
    return total + fontSize * 0.54;
  }, 0);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function collectReviewVocabulary(story) {
  const source = Array.isArray(story.vocabularyReview) && story.vocabularyReview.length
    ? story.vocabularyReview
    : (story.sections || []).flatMap((section) => section.vocabulary || []);
  const seen = new Set();
  const review = [];

  source.forEach((entry) => {
    const word = entry.word || entry[0] || "";
    const translation = entry.translation || entry[1] || "";
    const phonetic = entry.phonetic || entry[2] || "";
    const key = String(word).toLowerCase().trim();
    if (!key || seen.has(key)) return;
    seen.add(key);
    review.push({ word, translation, phonetic });
  });

  return review;
}

function estimateUsGradeLevel(story) {
  if (story?.contentMode === "factual-documentary") return "Grade 4-5";
  if (story?.level === "beginner") return "Grade 3-4";
  return "Grade 4-5";
}

function formatChineseGradeLevel(gradeLevel) {
  if (gradeLevel === "Grade 4-5") return "美国小学四到五年级";
  if (gradeLevel === "Grade 3-4") return "美国小学三到四年级";
  if (gradeLevel === "Grade 4") return "美国小学四年级";
  if (gradeLevel === "Grade 5") return "美国小学五年级";
  return `美国小学${gradeLevel.replace(/^Grade\s+/i, "")}年级`;
}

const TRANSLATIONS = {
  "Mia wakes up and hears rain at the window.": "米娅醒来，听见窗边的雨声。",
  "The sky is gray, but her room feels warm.": "天空是灰色的，但她的房间很温暖。",
  "She puts on her blue raincoat.": "她穿上蓝色雨衣。",
  "She takes a small umbrella from the door.": "她从门边拿起一把小雨伞。",
  "Mia walks slowly down the street.": "米娅慢慢地沿街走着。",
  "Small drops fall on her umbrella.": "小雨滴落在她的雨伞上。",
  "She sees a little dog under a tree.": "她看见一只小狗在树下。",
  "The dog looks cold, so Mia waits with it.": "小狗看起来很冷，所以米娅陪它等着。",
  "Ben comes home after school.": "本放学后回到家。",
  "He stands in front of the red door.": "他站在红色的门前。",
  "His key is not there.": "他的钥匙不在那里。",
  "Lily wakes up early.": "莉莉很早醒来。",
  "Today is her first day at a new school.": "今天是她去新学校的第一天。"
};

function getPalette(index) {
  const palettes = [
    { bg: "#59402f", accent: "#ff7a1a", secondary: "#2e7d6b" },
    { bg: "#26324b", accent: "#f45b69", secondary: "#4cc9f0" },
    { bg: "#2f463d", accent: "#f7b267", secondary: "#2a9d8f" },
    { bg: "#34314a", accent: "#82c0ff", secondary: "#f4a261" }
  ];
  return palettes[index % palettes.length];
}

function cleanTitle(title) {
  return String(title).replace(/\s+-\s+(Listen|Shadow|Review \d+)$/, "");
}

function isPodcastStory(story) {
  return story?.template?.id === "podcast-dialogue";
}

async function imageToDataUri(filePath) {
  const bytes = await fs.readFile(filePath);
  const mime = detectImageMime(bytes, filePath);
  return `data:${mime};base64,${bytes.toString("base64")}`;
}

function detectImageMime(bytes, filePath) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "image/png";
  }
  if (
    bytes.slice(0, 4).toString("ascii") === "RIFF" &&
    bytes.slice(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }

  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  return "image/png";
}

function wrapWords(text, maxChars) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";
  words.forEach((word) => {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  });
  if (current) lines.push(current);
  return lines;
}

function wrapMixed(text, maxChars) {
  const chars = String(text).match(/[A-Za-z0-9'"’:-]+|\s+|./g) || [];
  const lines = [];
  let current = "";
  chars.forEach((token) => {
    const next = current + token;
    if (displayWidth(next) > maxChars && current) {
      lines.push(current.trim());
      current = token.trimStart();
    } else {
      current = next;
    }
  });
  if (current.trim()) lines.push(current.trim());
  return lines;
}

function displayWidth(text) {
  return Array.from(text).reduce((total, char) => total + (char.charCodeAt(0) > 127 ? 1.8 : 1), 0);
}

function fitSvgText(text, maxWidth) {
  const value = String(text || "").trim();
  if (displayWidth(value) <= maxWidth) return value;
  let current = "";
  for (const char of value) {
    if (displayWidth(`${current}${char}...`) > maxWidth) break;
    current += char;
  }
  return current ? `${current}...` : value.slice(0, Math.max(1, maxWidth - 3));
}

function fitFontSize(text, baseSize, maxPixels, mixed = false) {
  const estimated = displayWidth(text) * baseSize * (mixed ? 0.58 : 0.54);
  if (!estimated || estimated <= maxPixels) return baseSize;
  return Math.max(12, Math.floor(baseSize * (maxPixels / estimated)));
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function assertCommand(command, args) {
  try {
    await execFileAsync(command, args, { maxBuffer: 1024 * 1024 });
  } catch (error) {
    throw new Error(`Required command failed: ${command}. ${error.message}`);
  }
}

function escapeConcatPath(file) {
  return file.replace(/'/g, "'\\''");
}

function loadSharp() {
  try {
    return require("sharp");
  } catch {
    const runtimeModules = "/Users/Mac/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules";
    const runtimeRequire = createRequire(path.join(runtimeModules, "package.json"));
    return runtimeRequire("sharp");
  }
}

function pushLog(logs, message) {
  if (Array.isArray(logs)) logs.push(`[${new Date().toISOString()}] ${message}`);
}

module.exports = {
  composeStoryVideo
};
