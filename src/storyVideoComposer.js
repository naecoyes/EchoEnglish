const fs = require("node:fs/promises");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { createRequire } = require("node:module");
const { ensureDir, pathExists } = require("./utils");

const execFileAsync = promisify(execFile);
const { runFfmpeg } = require("./ffmpegGateway");
const WIDTH = 1920;
const HEIGHT = 1080;
const CAPTION_Y = 760;
const CAPTION_H = 250;
let cachedFfmpegEncoders = null;

async function composeStoryVideo({ story, readingItems, outputDir, audioPath, musicPath = null, musicVolume = 0.12, logs = [], videoEncoder = "auto" }) {
  await assertCommand("ffmpeg", ["-version"]);
  const slidesDir = path.join(outputDir, "slides");
  await ensureDir(slidesDir);

  const frames = buildLearningFrames(story, readingItems);
  const sharp = loadSharp();

  const totalFrames = frames.length;
  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index];
    if (index % 5 === 0 || index === totalFrames - 1) {
      pushLog(logs, `Rendering frame ${index + 1}/${totalFrames}: ${frame.title || frame.kind}`);
    }

    const existingImage = await findExistingSceneImage(outputDir, story, frame);
    const imageDataUri = existingImage ? await imageToDataUri(existingImage) : null;
    const svg = renderLearningFrame({ story, frame, frameIndex: index, imageDataUri });
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

  const videoPath = path.join(outputDir, "final.mp4");
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

  return {
    videoPath,
    musicPath,
    scenes: frames.map((frame) => ({
      id: frame.id,
      kind: frame.kind,
      title: frame.title,
      startSeconds: frame.startSeconds,
      endSeconds: frame.endSeconds,
      durationSeconds: frame.durationSeconds
    }))
  };
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
  const beatIndex = getImageBeatIndexForSentence(section, frameSentenceIndex, story);
  const beatBase = path.join(outputDir, "images", `scene-${String(baseIndex + 1).padStart(3, "0")}-${variantSuffix}-${String(beatIndex + 1).padStart(2, "0")}`);
  const variantBase = path.join(outputDir, "images", `scene-${String(baseIndex + 1).padStart(3, "0")}-${variantSuffix}`);
  const legacyBase = path.join(outputDir, "images", `scene-${String(baseIndex + 1).padStart(3, "0")}`);
  const candidates = [
    `${beatBase}.png`,
    `${beatBase}.jpg`,
    `${beatBase}.jpeg`,
    `${beatBase}.webp`,
    `${variantBase}.png`,
    `${variantBase}.jpg`,
    `${variantBase}.jpeg`,
    `${variantBase}.webp`,
    `${legacyBase}.png`,
    `${legacyBase}.jpg`,
    `${legacyBase}.jpeg`,
    `${legacyBase}.webp`
  ];
  for (const candidate of candidates) {
    if (await pathExists(candidate)) return candidate;
  }
  return null;
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

function renderLearningFrame({ story, frame, frameIndex, imageDataUri }) {
  const palette = getPalette(frameIndex);
  const imageLayer = imageDataUri
    ? `<image href="${imageDataUri}" x="0" y="0" width="${WIDTH}" height="${HEIGHT}" preserveAspectRatio="xMidYMid slice"/>`
    : renderFallbackImage(frame, palette);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
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
    <filter id="textShadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="2" stdDeviation="2.5" flood-color="#000000" flood-opacity="0.28"/>
    </filter>
    <filter id="glassShadow" x="-25%" y="-35%" width="150%" height="180%">
      <feDropShadow dx="0" dy="20" stdDeviation="18" flood-color="#00152e" flood-opacity="0.34"/>
      <feDropShadow dx="0" dy="-3" stdDeviation="4" flood-color="#ffffff" flood-opacity="0.46"/>
    </filter>
  </defs>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="#061329"/>
  ${imageLayer}
  <rect x="0" y="0" width="${WIDTH}" height="${HEIGHT}" fill="#000" opacity="0.16"/>
  ${frame.kind === "cover" ? renderCoverOverlay(story, frame) : ""}
  ${frame.kind === "vocab-review" ? renderVocabularyReviewOverlay(frame) : ""}
  ${frame.kind !== "cover" && frame.kind !== "vocab-review" && frame.isPodcast ? `
  ${renderPodcastHosts(frame)}
  ${frame.vocabWord ? renderVocabularyOverlay(frame, { podcast: true }) : ""}
  ${renderPodcastCaption(frame)}` : ""}
  ${frame.kind !== "cover" && frame.kind !== "vocab-review" && !frame.isPodcast ? `
  ${frame.kind === "vocabulary" || frame.vocabWord ? renderVocabularyOverlay(frame) : ""}
  <rect x="150" y="${CAPTION_Y}" width="1620" height="${CAPTION_H}" rx="34" fill="#04111f" opacity="0.61"/>
  <rect x="150" y="${CAPTION_Y}" width="1620" height="${CAPTION_H}" rx="34" fill="none" stroke="#93c5fd" stroke-width="2.5" opacity="0.52"/>
  <rect x="154" y="${CAPTION_Y + 4}" width="1612" height="${CAPTION_H - 8}" rx="30" fill="none" stroke="#ffffff" stroke-width="1.3" opacity="0.18"/>
  ${renderBottomText(frame)}` : ""}
</svg>`;
}

function renderPodcastHosts(frame) {
  const activeA = frame.speaker !== "host-b";
  const activeB = frame.speaker === "host-b";
  return `
  ${renderPodcastHostCard({ x: 112, y: 96, side: "left", label: "Host A", active: activeA })}
  ${renderPodcastHostCard({ x: 1388, y: 96, side: "right", label: "Host B", active: activeB })}`;
}

function renderPodcastHostCard({ x, y, side, label, active }) {
  const width = 420;
  const avatarX = x + (side === "left" ? 78 : 342);
  const micX = x + (side === "left" ? 205 : 158);
  const labelX = x + (side === "left" ? 78 : 342);
  const accent = active ? "#0b84ff" : "#94a3b8";
  const opacity = active ? 0.58 : 0.34;
  return `
  <g opacity="${opacity}">
    <rect x="${x}" y="${y}" width="${width}" height="178" rx="30" fill="#061527" opacity="0.36"/>
    <rect x="${x}" y="${y}" width="${width}" height="178" rx="30" fill="none" stroke="${accent}" stroke-width="${active ? 2.2 : 1.3}" opacity="0.46"/>
    <circle cx="${avatarX}" cy="${y + 72}" r="40" fill="${accent}" opacity="0.9"/>
    <circle cx="${avatarX}" cy="${y + 58}" r="17" fill="#eaf5ff"/>
    <path d="M${avatarX - 33} ${y + 116} C${avatarX - 22} ${y + 88} ${avatarX + 22} ${y + 88} ${avatarX + 33} ${y + 116} Z" fill="#eaf5ff"/>
    <rect x="${micX}" y="${y + 48}" width="26" height="78" rx="13" fill="#e2e8f0"/>
    <rect x="${micX - 33}" y="${y + 124}" width="92" height="9" rx="4.5" fill="#e2e8f0"/>
    <path d="M${micX - 24} ${y + 74} C${micX - 24} ${y + 126} ${micX + 50} ${y + 126} ${micX + 50} ${y + 74}" stroke="${accent}" stroke-width="6" fill="none" stroke-linecap="round"/>
    <text x="${labelX}" y="${y + 150}" text-anchor="middle" font-family="Arial, sans-serif" font-size="24" font-weight="900" fill="#ffffff">${label}</text>
  </g>`;
}

function renderPodcastCaption(frame) {
  const isHostB = frame.speaker === "host-b";
  const captionY = 704;
  const captionH = 230;
  const x = 230;
  const speakerX = isHostB ? 1548 : 372;
  const textX = 960;
  const label = frame.speakerName || (isHostB ? "Host B" : "Host A");
  return `
  <rect x="${x}" y="${captionY}" width="1460" height="${captionH}" rx="34" fill="#04111f" opacity="0.62"/>
  <rect x="${x}" y="${captionY}" width="1460" height="${captionH}" rx="34" fill="none" stroke="${isHostB ? "#f59e0b" : "#38bdf8"}" stroke-width="2.6" opacity="0.68"/>
  <rect x="${isHostB ? 1392 : 258}" y="${captionY + 26}" width="312" height="52" rx="26" fill="${isHostB ? "#f59e0b" : "#0b84ff"}" opacity="0.94"/>
  <text x="${speakerX}" y="${captionY + 62}" text-anchor="middle" font-family="Arial, sans-serif" font-size="24" font-weight="900" fill="#ffffff">${escapeXml(label)}</text>
  ${renderPodcastBottomText(frame, textX, captionY, captionH)}`;
}

function renderPodcastBottomText(frame, textX, captionY, captionH) {
  const englishLines = wrapWords(frame.english || "", 46).slice(0, 2);
  const chineseLines = wrapMixed(frame.chinese || "", 42).slice(0, 2);
  const englishFont = englishLines.length > 1 ? 42 : 46;
  const chineseFont = chineseLines.length > 1 ? 27 : 29;
  const englishY = captionY + 118;
  const chineseY = captionY + 188;
  return `
  ${renderEnglishCaptionLinesAt(englishLines, frame.highlightedTerm, englishY, englishFont, textX)}
  ${chineseLines.map((line, index) => `<text x="${textX}" y="${chineseY + index * 34}" text-anchor="middle" font-family="PingFang SC, Noto Sans CJK SC, Arial, sans-serif" font-size="${chineseFont}" font-weight="800" fill="#e2e8f0" opacity="0.84" filter="url(#textShadow)">${escapeXml(line)}</text>`).join("\n  ")}`;
}

function renderCoverOverlay(story, frame) {
  const titleLines = wrapWords(story.title || frame.title || "English Story", 24).slice(0, 3);
  const summaryLines = wrapMixed(story.summary || "Practice listening, reading, and speaking with a clear English story.", 50).slice(0, 2);
  const gradeLevel = estimateUsGradeLevel(story);
  return `
  <rect x="0" y="0" width="${WIDTH}" height="${HEIGHT}" fill="#020817" opacity="0.42"/>
  <rect x="0" y="0" width="${WIDTH}" height="${HEIGHT}" fill="#04111f" opacity="0.2"/>
  <rect x="80" y="110" width="1760" height="860" rx="58" fill="#020817" opacity="0.34"/>
  <rect x="120" y="150" width="1680" height="780" rx="54" fill="url(#coverPanel)" opacity="0.88"/>
  <rect x="120" y="150" width="1680" height="780" rx="54" fill="#ffffff" opacity="0.14"/>
  <rect x="152" y="182" width="1616" height="716" rx="42" fill="none" stroke="#ffffff" stroke-width="2" opacity="0.25"/>
  <rect x="250" y="235" width="330" height="58" rx="29" fill="#0b84ff" opacity="0.95"/>
  <text x="415" y="274" text-anchor="middle" font-family="Arial, sans-serif" font-size="27" font-weight="900" letter-spacing="4" fill="#ffffff">ECHOENGLISH</text>
  <text x="250" y="365" font-family="PingFang SC, Noto Sans CJK SC, Arial, sans-serif" font-size="52" font-weight="900" fill="#0f172a">今天的故事</text>
  ${titleLines.map((line, index) => `<text x="250" y="${470 + index * 82}" font-family="Arial, sans-serif" font-size="74" font-weight="950" fill="#071126">${escapeXml(line)}</text>`).join("\n  ")}
  <rect x="1250" y="300" width="260" height="260" rx="64" fill="#0b84ff" opacity="0.92"/>
  <polygon points="1346,384 1346,476 1428,430" fill="#ffffff" opacity="0.96"/>
  <text x="1380" y="622" text-anchor="middle" font-family="Arial, sans-serif" font-size="34" font-weight="950" fill="#0f172a">Listen &amp; Shadow</text>
  <text x="1380" y="665" text-anchor="middle" font-family="PingFang SC, Noto Sans CJK SC, Arial, sans-serif" font-size="25" font-weight="850" fill="#1d4ed8">边听边读 · 口语跟读</text>
  <text x="250" y="720" font-family="Arial, sans-serif" font-size="31" font-weight="900" fill="#1d4ed8">Practice listening, reading, and speaking.</text>
  ${summaryLines.map((line, index) => `<text x="250" y="${768 + index * 34}" font-family="PingFang SC, Noto Sans CJK SC, Arial, sans-serif" font-size="25" font-weight="750" fill="#334155">${escapeXml(line)}</text>`).join("\n  ")}
  <text x="250" y="838" font-family="Arial, sans-serif" font-size="27" font-weight="900" fill="#0f172a">Difficulty: about U.S. elementary ${escapeXml(gradeLevel)} English</text>
  <text x="250" y="876" font-family="PingFang SC, Noto Sans CJK SC, Arial, sans-serif" font-size="23" font-weight="800" fill="#475569">难度约为${escapeXml(formatChineseGradeLevel(gradeLevel))}英文阅读水平</text>`;
}

function renderVocabularyReviewOverlay(frame) {
  const vocabulary = Array.isArray(frame.vocabulary) ? frame.vocabulary.slice(0, 54) : [];
  const columns = 3;
  const rowsPerColumn = Math.max(1, Math.ceil(vocabulary.length / columns));
  const columnWidth = 520;
  const startX = 190;
  const startY = 276;
  const dense = rowsPerColumn > 13;
  const rowHeight = dense ? 39 : 58;
  const wordFont = dense ? 19 : 23;
  const phoneticFont = dense ? 14 : 17;
  const chineseFont = dense ? 17 : 20;

  return `
  <rect x="0" y="0" width="${WIDTH}" height="${HEIGHT}" fill="#020817" opacity="0.52"/>
  <rect x="120" y="90" width="1680" height="900" rx="44" fill="#f8fbff" opacity="0.94"/>
  <rect x="150" y="120" width="1620" height="840" rx="34" fill="none" stroke="#bfdbfe" stroke-width="2" opacity="0.46"/>
  <text x="190" y="170" font-family="Arial, sans-serif" font-size="34" font-weight="900" letter-spacing="5" fill="#1d4ed8">VOCABULARY REVIEW</text>
  <text x="190" y="215" font-family="PingFang SC, Noto Sans CJK SC, Arial, sans-serif" font-size="30" font-weight="800" fill="#334155">难点词汇总复习：单词 / 音标 / 中文释义</text>
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
  const wordText = fitSvgText(word, 26);
  const phoneticText = fitSvgText(phonetic, 30);
  const translationText = fitSvgText(translation, 15);
  const wordSize = fitFontSize(wordText, wordFont, 230);
  const phoneticSize = fitFontSize(phoneticText, phoneticFont, 278);
  const translationSize = fitFontSize(translationText, chineseFont, 178, true);
  const secondLineY = y + Math.min(29, Math.max(23, rowHeight * 0.48));
  return `
  <g>
    <line x1="${x}" y1="${y + rowHeight - 12}" x2="${x + 470}" y2="${y + rowHeight - 12}" stroke="#dbeafe" stroke-width="1.2" opacity="0.62"/>
    <text x="${x}" y="${y}" font-family="Arial, sans-serif" font-size="${wordSize}" font-weight="900" fill="#0f172a">${escapeXml(wordText)}</text>
    <text x="${x}" y="${secondLineY}" font-family="Arial, sans-serif" font-size="${phoneticSize}" font-weight="800" fill="#2563eb">${escapeXml(phoneticText)}</text>
    <text x="${x + 315}" y="${secondLineY}" font-family="PingFang SC, Noto Sans CJK SC, Arial, sans-serif" font-size="${translationSize}" font-weight="800" fill="#475569">${escapeXml(translationText)}</text>
  </g>`;
}

function renderVocabularyOverlay(frame, options = {}) {
  const [word, translation, phonetic] = [frame.vocabWord, frame.vocabTranslation, frame.vocabPhonetic];
  if (!word) return "";
  if (options.podcast) return renderPodcastVocabularyOverlay(frame);
  const wordLines = wrapMixed(word, 24).slice(0, 1);
  const phoneticLines = wrapMixed(phonetic || "", 26).slice(0, 1);
  const translationLines = wrapMixed(translation || "", 18).slice(0, 1);
  const x = options.podcast ? 745 : 1430;
  const y = options.podcast ? 82 : 70;
  const width = options.podcast ? 430 : 430;
  const height = options.podcast ? 134 : 136;
  return `
  <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="22" fill="#061527" opacity="0.72"/>
  <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="22" fill="none" stroke="#7dd3fc" stroke-width="2" opacity="0.46"/>
  ${wordLines.map((line) => `<text x="${x + 28}" y="${y + 42}" font-family="Georgia, 'Times New Roman', serif" font-size="27" font-weight="900" fill="#ffffff" filter="url(#textShadow)">${escapeXml(line)}</text>`).join("\n  ")}
  ${phoneticLines.map((line) => `<text x="${x + 28}" y="${y + 79}" font-family="Arial, sans-serif" font-size="20" font-weight="800" fill="#f59e0b">${escapeXml(line)}</text>`).join("\n  ")}
  ${translationLines.map((line) => `<text x="${x + 28}" y="${y + 114}" font-family="PingFang SC, Noto Sans CJK SC, Arial, sans-serif" font-size="24" font-weight="850" fill="#ffffff" filter="url(#textShadow)">${escapeXml(line)}</text>`).join("\n  ")}`;
}

function renderPodcastVocabularyOverlay(frame) {
  const isHostB = frame.speaker === "host-b";
  const x = isHostB ? 1195 : 295;
  const y = 650;
  const width = 430;
  const accent = isHostB ? "#f59e0b" : "#38bdf8";
  const word = fitSvgText(frame.vocabWord || "", 23);
  const phonetic = fitSvgText(frame.vocabPhonetic || "", 25);
  const translation = fitSvgText(frame.vocabTranslation || "", 14);
  return `
  <rect x="${x}" y="${y}" width="${width}" height="82" rx="24" fill="#061527" opacity="0.72"/>
  <rect x="${x}" y="${y}" width="${width}" height="82" rx="24" fill="none" stroke="${accent}" stroke-width="2.2" opacity="0.62"/>
  <text x="${x + 28}" y="${y + 33}" font-family="Georgia, 'Times New Roman', serif" font-size="${fitFontSize(word, 25, 190)}" font-weight="900" fill="#ffffff" filter="url(#textShadow)">${escapeXml(word)}</text>
  <text x="${x + 28}" y="${y + 63}" font-family="Arial, sans-serif" font-size="${fitFontSize(phonetic, 18, 175)}" font-weight="800" fill="#f59e0b">${escapeXml(phonetic)}</text>
  <text x="${x + 245}" y="${y + 63}" font-family="PingFang SC, Noto Sans CJK SC, Arial, sans-serif" font-size="${fitFontSize(translation, 20, 140, true)}" font-weight="850" fill="#ffffff" filter="url(#textShadow)">${escapeXml(translation)}</text>`;
}

function renderBottomText(frame) {
  const englishLines = wrapWords(frame.english || "", 46).slice(0, 2);
  const chineseLines = wrapMixed(frame.chinese || "", 40).slice(0, 2);
  const englishFont = englishLines.length > 1 ? 50 : 54;
  const chineseFont = chineseLines.length > 1 ? 32 : 35;
  const englishLineHeight = 52;
  const chineseLineHeight = 38;
  const gap = 66;
  const englishBlockHeight = englishFont + Math.max(0, englishLines.length - 1) * englishLineHeight;
  const chineseBlockHeight = chineseFont + Math.max(0, chineseLines.length - 1) * chineseLineHeight;
  const totalTextHeight = englishBlockHeight + gap + chineseBlockHeight;
  const top = CAPTION_Y + Math.max(34, (CAPTION_H - totalTextHeight) / 2);
  const englishY = top + englishFont;
  const chineseY = top + englishBlockHeight + gap + chineseFont;
  return `
  ${renderEnglishCaptionLines(englishLines, frame.highlightedTerm, englishY, englishFont)}
  ${chineseLines.map((line, index) => `<text x="${WIDTH / 2}" y="${chineseY + index * 38}" text-anchor="middle" font-family="PingFang SC, Noto Sans CJK SC, Arial, sans-serif" font-size="${chineseFont}" font-weight="800" fill="#e2e8f0" opacity="0.86" filter="url(#textShadow)">${escapeXml(line)}</text>`).join("\n  ")}`;
}

function renderEnglishCaptionLines(lines, highlightedTerm, startY, fontSize) {
  return renderEnglishCaptionLinesAt(lines, highlightedTerm, startY, fontSize, WIDTH / 2);
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
    const beforeWidth = estimateEnglishTextWidth(before, fontSize);
    const termWidth = estimateEnglishTextWidth(term, fontSize);
    const afterWidth = estimateEnglishTextWidth(after, fontSize);
    const totalWidth = beforeWidth + termWidth + afterWidth;
    const x = centerX - totalWidth / 2;
    return `<text x="${x}" y="${y}" xml:space="preserve" font-family="Arial, sans-serif" font-size="${fontSize}" font-style="italic" font-weight="750" fill="#ffffff" filter="url(#textShadow)">
      <tspan xml:space="preserve">${escapeXml(before)}</tspan><tspan fill="#f59e0b">${escapeXml(term)}</tspan><tspan xml:space="preserve">${escapeXml(after)}</tspan>
    </text>`;
  }).join("\n  ");
}

function renderCenteredText(line, y, fontSize, fill) {
  return renderCenteredTextAt(line, y, fontSize, fill, WIDTH / 2);
}

function renderCenteredTextAt(line, y, fontSize, fill, centerX) {
  return `<text x="${centerX}" y="${y}" xml:space="preserve" text-anchor="middle" font-family="Arial, sans-serif" font-size="${fontSize}" font-style="italic" font-weight="750" fill="${fill}" filter="url(#textShadow)">${escapeXml(line)}</text>`;
}

function renderFallbackImage(frame, palette) {
  const visual = String(frame.visual || "storybook learning scene");
  return `
  <rect x="0" y="0" width="${WIDTH}" height="${HEIGHT}" fill="${palette.bg}"/>
  <rect x="0" y="0" width="${WIDTH}" height="${HEIGHT}" fill="#f9efe1" opacity="0.1"/>
  ${renderSceneSetting(visual, palette)}
  ${renderCharacters(palette)}
  ${renderImportantObject(visual, palette)}`;
}

function renderSceneSetting(visual, palette) {
  const text = visual.toLowerCase();

  if (text.includes("lighthouse") || text.includes("storm") || text.includes("coastal")) {
    return `
  <rect x="0" y="330" width="${WIDTH}" height="190" fill="#12354a" opacity="0.85"/>
  <path d="M0 375 C260 315 460 430 700 370 C960 305 1130 425 1390 360 C1620 305 1780 370 1920 340 L1920 520 L0 520 Z" fill="#1f6f92" opacity="0.72"/>
  <polygon points="1240,96 1380,96 1430,430 1190,430" fill="#eee8dc"/>
  <rect x="1205" y="150" width="210" height="52" fill="${palette.accent}" opacity="0.9"/>
  <polygon points="1185,96 1435,96 1350,40 1260,40" fill="#222936"/>
  <path d="M1340 72 L1805 155" stroke="#ffd166" stroke-width="22" opacity="0.55"/>`;
  }

  if (text.includes("mountain") || text.includes("snow")) {
    return `
  <rect x="0" y="0" width="${WIDTH}" height="520" fill="#b9d8ea" opacity="0.62"/>
  <polygon points="0,520 360,115 700,520" fill="#435466"/>
  <polygon points="320,520 820,70 1320,520" fill="#57697b"/>
  <polygon points="900,520 1390,125 1920,520" fill="#36495c"/>
  <polygon points="820,70 720,178 928,176" fill="#f7fbff"/>
  <path d="M180 430 C520 390 780 460 1060 410 C1350 358 1590 430 1840 380" stroke="#ffffff" stroke-width="18" opacity="0.75" fill="none"/>`;
  }

  if (text.includes("forest") || text.includes("tree") || text.includes("valley")) {
    return `
  <rect x="0" y="0" width="${WIDTH}" height="520" fill="#9cc6aa" opacity="0.48"/>
  ${[170, 360, 590, 1380, 1585, 1760].map((x, index) => `
  <rect x="${x}" y="${225 + (index % 2) * 18}" width="34" height="230" fill="#5b3f2f"/>
  <circle cx="${x + 17}" cy="${185 + (index % 2) * 20}" r="${104 + (index % 3) * 18}" fill="#1f6f58" opacity="0.86"/>`).join("\n")}
  <path d="M0 455 C370 390 650 510 980 430 C1280 365 1580 455 1920 400 L1920 520 L0 520 Z" fill="#274c3c" opacity="0.9"/>`;
  }

  if (text.includes("school") || text.includes("classroom") || text.includes("hallway")) {
    return `
  <rect x="0" y="0" width="${WIDTH}" height="520" fill="#d8c3a5" opacity="0.95"/>
  <rect x="0" y="405" width="${WIDTH}" height="115" fill="#795548"/>
  <rect x="180" y="90" width="500" height="260" fill="#263238" opacity="0.92"/>
  <rect x="760" y="120" width="260" height="285" fill="#9f6b45"/>
  <circle cx="980" cy="262" r="11" fill="#f1d37a"/>
  <rect x="1130" y="95" width="560" height="250" fill="#f6fbff" opacity="0.72"/>
  <path d="M1130 205 L1690 205 M1410 95 L1410 345" stroke="#6d8793" stroke-width="12" opacity="0.55"/>`;
  }

  if (text.includes("library") || text.includes("book")) {
    return `
  <rect x="0" y="0" width="${WIDTH}" height="520" fill="#6a4b35"/>
  ${[90, 520, 1180, 1535].map((x) => `
  <rect x="${x}" y="75" width="300" height="345" fill="#3a2418" opacity="0.9"/>
  ${[0, 1, 2, 3].map((row) => `<rect x="${x + 22}" y="${105 + row * 74}" width="256" height="44" fill="${row % 2 ? "#b45b45" : "#d29b52"}" opacity="0.9"/>`).join("\n")}`).join("\n")}
  <ellipse cx="960" cy="445" rx="390" ry="70" fill="#2b1a12" opacity="0.5"/>`;
  }

  if (text.includes("museum") || text.includes("statue")) {
    return `
  <rect x="0" y="0" width="${WIDTH}" height="520" fill="#cfc2ad"/>
  <rect x="0" y="400" width="${WIDTH}" height="120" fill="#8a8175"/>
  ${[360, 600, 840, 1080, 1320].map((x) => `<rect x="${x}" y="115" width="80" height="285" fill="#ece1d1"/><rect x="${x - 35}" y="90" width="150" height="34" fill="#ddd0be"/>`).join("\n")}
  <circle cx="1510" cy="260" r="92" fill="#59636f" opacity="0.82"/>
  <rect x="1465" y="345" width="90" height="80" fill="#59636f" opacity="0.82"/>`;
  }

  if (text.includes("train") || text.includes("station")) {
    return `
  <rect x="0" y="0" width="${WIDTH}" height="520" fill="#546a7b"/>
  <rect x="0" y="355" width="${WIDTH}" height="165" fill="#2d2f34"/>
  <path d="M90 420 L1780 420 M130 480 L1820 480" stroke="#cfd8dc" stroke-width="14"/>
  <rect x="430" y="165" width="930" height="175" rx="26" fill="#dbe8ed"/>
  <rect x="500" y="205" width="170" height="88" fill="#254e70"/>
  <rect x="735" y="205" width="170" height="88" fill="#254e70"/>
  <rect x="970" y="205" width="170" height="88" fill="#254e70"/>`;
  }

  if (text.includes("bakery")) {
    return `
  <rect x="0" y="0" width="${WIDTH}" height="520" fill="#c98a5a"/>
  <rect x="230" y="115" width="1460" height="305" fill="#f4d6ad"/>
  <path d="M230 115 H1690 V190 C1560 155 1450 220 1320 185 C1190 150 1090 215 960 180 C830 145 720 215 590 180 C470 150 350 210 230 175 Z" fill="#c03535"/>
  <rect x="450" y="230" width="280" height="160" fill="#5d4037"/>
  <rect x="910" y="245" width="580" height="95" fill="#fff2d6" opacity="0.95"/>`;
  }

  return `
  <rect x="0" y="0" width="${WIDTH}" height="520" fill="#92b8c7" opacity="0.54"/>
  <circle cx="1570" cy="92" r="80" fill="#ffd166" opacity="0.74"/>
  <path d="M0 360 C260 300 520 430 780 350 C1030 275 1310 410 1600 330 C1740 290 1845 315 1920 300 L1920 520 L0 520 Z" fill="${palette.secondary}" opacity="0.76"/>
  <rect x="230" y="190" width="390" height="220" fill="#f0dfc2" opacity="0.92"/>
  <polygon points="200,190 425,80 650,190" fill="${palette.accent}" opacity="0.9"/>
  <rect x="780" y="155" width="520" height="255" rx="18" fill="#2d3748" opacity="0.78"/>
  <rect x="850" y="210" width="150" height="100" fill="#f6fbff" opacity="0.72"/>
  <rect x="1060" y="210" width="150" height="100" fill="#f6fbff" opacity="0.72"/>`;
}

function renderCharacters(palette) {
  return `
  <ellipse cx="960" cy="438" rx="390" ry="58" fill="#000000" opacity="0.18"/>
  <circle cx="915" cy="245" r="58" fill="#f2c9a0"/>
  <path d="M850 335 C850 270 980 270 982 335 L1010 450 L815 450 Z" fill="${palette.accent}" opacity="0.94"/>
  <path d="M815 350 C760 380 720 415 690 462" stroke="#f2c9a0" stroke-width="24" stroke-linecap="round"/>
  <path d="M1010 350 C1080 372 1125 406 1165 452" stroke="#f2c9a0" stroke-width="24" stroke-linecap="round"/>
  <circle cx="1178" cy="292" r="44" fill="#e9b889"/>
  <path d="M1138 354 C1155 310 1225 310 1245 354 L1268 446 L1115 446 Z" fill="#2f6f8f" opacity="0.95"/>`;
}

function renderImportantObject(visual, palette) {
  return `
  <g transform="translate(1280 300)">
    <ellipse cx="0" cy="112" rx="158" ry="34" fill="#000000" opacity="0.18"/>
    <rect x="-105" y="-34" width="210" height="146" rx="26" fill="#fff7dc" opacity="0.94"/>
    <path d="M-66 26 C-18 -46 60 -36 70 32 C80 90 -32 110 -66 26 Z" fill="${palette.accent}" opacity="0.88"/>
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
