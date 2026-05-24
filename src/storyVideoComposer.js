const fs = require("node:fs/promises");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { createRequire } = require("node:module");
const { ensureDir, pathExists } = require("./utils");

const execFileAsync = promisify(execFile);
const WIDTH = 1920;
const HEIGHT = 1080;
const CAPTION_Y = 740;
const CAPTION_H = 300;

async function composeStoryVideo({ story, readingItems, outputDir, audioPath, musicPath = null, musicVolume = 0.12, logs = [] }) {
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

    const existingImage = await findExistingSceneImage(outputDir, story, frame.sectionIndex, frame.sentenceIndex);
    const imageDataUri = existingImage ? await imageToDataUri(existingImage) : null;
    const svg = renderLearningFrame({ story, frame, frameIndex: index, imageDataUri });
    await sharp(Buffer.from(svg)).png().toFile(path.join(slidesDir, `${frame.id}.png`));
  }

  pushLog(logs, `Encoding final MP4 (${frames.length} frames)…`);
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

  ffmpegArgs.push(
    "-c:v",
    "libx264",
    "-c:a",
    "aac",
    "-shortest",
    videoPath
  );

  await execFileAsync("ffmpeg", ffmpegArgs, {
    maxBuffer: 1024 * 1024 * 16
  });

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
  return baseFrame(item, sectionIndex, index, {
    kind: "sentence",
    title: cleanTitle(section.title),
    english: item.text,
    chinese: translateSentence(section, item.text),
    vocabWord,
    vocabTranslation,
    vocabPhonetic,
    highlightedTerm: vocabWord,
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

async function findExistingSceneImage(outputDir, story, index, sentenceIndex = 0) {
  const section = story.sections[index] || {};
  const baseIndex = Number.isInteger(section.baseSectionIndex) ? section.baseSectionIndex : index;
  const variantIndex = Number.isInteger(section.imageVariantIndex) ? section.imageVariantIndex : 0;
  const variantSuffix = ["a", "b", "c"][variantIndex] || String(variantIndex + 1);
  const beatSize = Number.isInteger(section.imageBeatSize) ? section.imageBeatSize : story.mode === "pure-story" ? 3 : 2;
  const beatIndex = Math.max(0, Math.floor(Number(sentenceIndex || 0) / beatSize));
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
  ${frame.kind !== "cover" && frame.kind !== "vocab-review" ? `
  ${frame.kind === "vocabulary" || frame.vocabWord ? renderVocabularyOverlay(frame) : ""}
  <rect x="150" y="${CAPTION_Y}" width="1620" height="${CAPTION_H}" rx="34" fill="#04111f" opacity="0.68"/>
  <rect x="150" y="${CAPTION_Y}" width="1620" height="${CAPTION_H}" rx="34" fill="none" stroke="#93c5fd" stroke-width="2.5" opacity="0.52"/>
  <rect x="154" y="${CAPTION_Y + 4}" width="1612" height="${CAPTION_H - 8}" rx="30" fill="none" stroke="#ffffff" stroke-width="1.3" opacity="0.18"/>
  ${renderBottomText(frame)}` : ""}
</svg>`;
}

function renderCoverOverlay(story, frame) {
  const titleLines = wrapWords(story.title || frame.title || "English Story", 26).slice(0, 3);
  const summaryLines = wrapMixed(story.summary || "Practice listening, reading, and speaking with a clear English story.", 46).slice(0, 2);
  const gradeLevel = estimateUsGradeLevel(story);
  return `
  <rect x="0" y="0" width="${WIDTH}" height="${HEIGHT}" fill="#020817" opacity="0.42"/>
  <rect x="150" y="120" width="1620" height="850" rx="52" fill="url(#coverPanel)" opacity="0.9"/>
  <rect x="150" y="120" width="1620" height="850" rx="52" fill="#ffffff" opacity="0.18"/>
  <text x="240" y="265" font-family="Arial, sans-serif" font-size="32" font-weight="900" letter-spacing="6" fill="#1d4ed8">ECHOENGLISH</text>
  <text x="240" y="350" font-family="PingFang SC, Noto Sans CJK SC, Arial, sans-serif" font-size="56" font-weight="900" fill="#0f172a">今天的故事</text>
  ${titleLines.map((line, index) => `<text x="240" y="${450 + index * 82}" font-family="Arial, sans-serif" font-size="76" font-weight="900" fill="#081225">${escapeXml(line)}</text>`).join("\n  ")}
  <text x="245" y="685" font-family="Arial, sans-serif" font-size="34" font-weight="900" fill="#1d4ed8">Practice listening, reading, and speaking.</text>
  ${summaryLines.map((line, index) => `<text x="245" y="${732 + index * 38}" font-family="PingFang SC, Noto Sans CJK SC, Arial, sans-serif" font-size="28" font-weight="700" fill="#334155">${escapeXml(line)}</text>`).join("\n  ")}
  <text x="245" y="820" font-family="Arial, sans-serif" font-size="30" font-weight="900" fill="#0f172a">Difficulty: about U.S. elementary ${escapeXml(gradeLevel)} English</text>
  <text x="245" y="858" font-family="PingFang SC, Noto Sans CJK SC, Arial, sans-serif" font-size="26" font-weight="800" fill="#475569">难度约为${escapeXml(formatChineseGradeLevel(gradeLevel))}英文阅读水平</text>
  <rect x="245" y="884" width="360" height="66" rx="33" fill="#0b84ff" opacity="0.95"/>
  <text x="425" y="926" text-anchor="middle" font-family="Arial, sans-serif" font-size="28" font-weight="900" fill="#ffffff">Listen and Shadow</text>
  <text x="635" y="926" font-family="PingFang SC, Noto Sans CJK SC, Arial, sans-serif" font-size="24" font-weight="900" fill="#1d4ed8">听力 · 阅读 · 口语跟读</text>`;
}

function renderVocabularyReviewOverlay(frame) {
  const vocabulary = Array.isArray(frame.vocabulary) ? frame.vocabulary.slice(0, 54) : [];
  const columns = 3;
  const rowsPerColumn = Math.max(1, Math.ceil(vocabulary.length / columns));
  const columnWidth = 520;
  const startX = 195;
  const startY = 230;
  const rowHeight = vocabulary.length > 45 ? 42 : 48;

  return `
  <rect x="0" y="0" width="${WIDTH}" height="${HEIGHT}" fill="#020817" opacity="0.52"/>
  <rect x="120" y="90" width="1680" height="900" rx="44" fill="#f8fbff" opacity="0.94"/>
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
    return `
  <text x="${x}" y="${y}" font-family="Arial, sans-serif" font-size="24" font-weight="900" fill="#0f172a">${escapeXml(word)}</text>
  <text x="${x + 190}" y="${y}" font-family="Arial, sans-serif" font-size="20" font-weight="700" fill="#2563eb">${escapeXml(phonetic)}</text>
  <text x="${x + 315}" y="${y}" font-family="PingFang SC, Noto Sans CJK SC, Arial, sans-serif" font-size="22" font-weight="800" fill="#475569">${escapeXml(translation)}</text>`;
  }).join("\n  ")}`;
}

function renderVocabularyOverlay(frame) {
  const [word, translation, phonetic] = [frame.vocabWord, frame.vocabTranslation, frame.vocabPhonetic];
  if (!word) return "";
  const wordLines = wrapMixed(word, 24).slice(0, 1);
  const phoneticLines = wrapMixed(phonetic || "", 26).slice(0, 1);
  const translationLines = wrapMixed(translation || "", 18).slice(0, 1);
  return `
  <rect x="1390" y="68" width="470" height="150" rx="22" fill="#061527" opacity="0.72"/>
  <rect x="1390" y="68" width="470" height="150" rx="22" fill="none" stroke="#7dd3fc" stroke-width="2" opacity="0.42"/>
  ${wordLines.map((line) => `<text x="1418" y="113" font-family="Georgia, 'Times New Roman', serif" font-size="29" font-weight="900" fill="#ffffff" filter="url(#textShadow)">${escapeXml(line)}</text>`).join("\n  ")}
  ${phoneticLines.map((line) => `<text x="1418" y="153" font-family="Arial, sans-serif" font-size="22" font-weight="800" fill="#f59e0b">${escapeXml(line)}</text>`).join("\n  ")}
  ${translationLines.map((line) => `<text x="1418" y="193" font-family="PingFang SC, Noto Sans CJK SC, Arial, sans-serif" font-size="26" font-weight="850" fill="#ffffff" filter="url(#textShadow)">${escapeXml(line)}</text>`).join("\n  ")}`;
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
  ${chineseLines.map((line, index) => `<text x="${WIDTH / 2}" y="${chineseY + index * 38}" text-anchor="middle" font-family="PingFang SC, Noto Sans CJK SC, Arial, sans-serif" font-size="${chineseFont}" font-weight="800" fill="#ffffff" filter="url(#textShadow)">${escapeXml(line)}</text>`).join("\n  ")}`;
}

function renderEnglishCaptionLines(lines, highlightedTerm, startY, fontSize) {
  const plain = lines.map((line, index) => ({ line, y: startY + index * 52 }));
  if (!highlightedTerm) {
    return plain.map(({ line, y }) => renderCenteredText(line, y, fontSize, "#ffffff")).join("\n  ");
  }

  const normalizedTerm = normalizeTermForMatch(highlightedTerm);
  return plain.map(({ line, y }) => {
    const match = findTermInLine(line, normalizedTerm);
    if (!match) return renderCenteredText(line, y, fontSize, "#ffffff");
    const before = line.slice(0, match.start);
    const term = line.slice(match.start, match.end);
    const after = line.slice(match.end);
    const beforeWidth = estimateEnglishTextWidth(before, fontSize);
    const termWidth = estimateEnglishTextWidth(term, fontSize);
    const afterWidth = estimateEnglishTextWidth(after, fontSize);
    const totalWidth = beforeWidth + termWidth + afterWidth;
    const x = WIDTH / 2 - totalWidth / 2;
    return `<text x="${x}" y="${y}" font-family="Arial, sans-serif" font-size="${fontSize}" font-style="italic" font-weight="750" fill="#ffffff" filter="url(#textShadow)">
      <tspan>${escapeXml(before)}</tspan><tspan fill="#f59e0b">${escapeXml(term)}</tspan><tspan>${escapeXml(after)}</tspan>
    </text>`;
  }).join("\n  ");
}

function renderCenteredText(line, y, fontSize, fill) {
  return `<text x="${WIDTH / 2}" y="${y}" text-anchor="middle" font-family="Arial, sans-serif" font-size="${fontSize}" font-style="italic" font-weight="750" fill="${fill}" filter="url(#textShadow)">${escapeXml(line)}</text>`;
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
  const candidates = [...local, ...global].filter((entry) => entry?.[0]);
  const sentenceText = normalizeSentenceForMatch(sentence);

  return candidates.find((entry) => sentenceIncludesTerm(sentenceText, entry[0])) || null;
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
