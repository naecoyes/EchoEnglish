const fs = require("node:fs/promises");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { createRequire } = require("node:module");
const { ensureDir, pathExists } = require("./utils");

const execFileAsync = promisify(execFile);
const WIDTH = 1920;
const HEIGHT = 1080;
const CAPTION_Y = 770;
const CAPTION_H = 250;

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
  const [vocabWord, vocabTranslation] = section.vocabulary?.[item.sentenceIndex] || [];
  return baseFrame(item, sectionIndex, index, {
    kind: "sentence",
    title: cleanTitle(section.title),
    english: item.text,
    chinese: translateSentence(section, item.text),
    vocabWord,
    vocabTranslation,
    visual: section.visual
  });
}

function createVocabularyFrame(story, item, sectionIndex, index) {
  const section = story.sections[sectionIndex] || story.sections[0];
  const [word, translation] = item.word
    ? [item.word, item.translation]
    : section.vocabulary[item.vocabularyIndex || 0] || ["word", "词汇"];
  return baseFrame(item, sectionIndex, index, {
    kind: "vocabulary",
    title: cleanTitle(section.title),
    english: section.sentences[item.sentenceIndex || 0] || section.sentences[0],
    chinese: translateSentence(section, section.sentences[item.sentenceIndex || 0] || section.sentences[0]),
    vocabWord: word,
    vocabTranslation: translation,
    vocabulary: section.vocabulary,
    visual: section.visual
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
      <stop offset="0%" stop-color="#f59e0b" stop-opacity="0.96"/>
      <stop offset="100%" stop-color="#d97706" stop-opacity="0.9"/>
    </linearGradient>
    <filter id="textShadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="4" stdDeviation="4" flood-color="#000000" flood-opacity="0.45"/>
    </filter>
  </defs>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="#061329"/>
  ${imageLayer}
  <rect x="0" y="0" width="${WIDTH}" height="${HEIGHT}" fill="#000" opacity="0.16"/>
  ${frame.kind === "vocabulary" || frame.vocabWord ? renderVocabularyOverlay(frame) : ""}
  <rect x="150" y="${CAPTION_Y}" width="1620" height="${CAPTION_H}" rx="34" fill="#04111f" opacity="0.78"/>
  <rect x="150" y="${CAPTION_Y}" width="9" height="${CAPTION_H}" rx="5" fill="#67e8f9" opacity="0.72"/>
  ${renderBottomText(frame)}
</svg>`;
}

function renderVocabularyOverlay(frame) {
  const [word, translation] = [frame.vocabWord, frame.vocabTranslation];
  const lines = wrapMixed(`${word}   ${translation}`, 34).slice(0, 2);
  return `
  <rect x="1180" y="96" width="610" height="180" rx="28" fill="url(#vocabPanel)" opacity="0.92"/>
  <text x="1230" y="154" font-family="Arial, sans-serif" font-size="24" font-weight="800" fill="#fff7ed" opacity="0.92">VOCAB</text>
  ${lines.map((line, index) => `<text x="1230" y="${220 + index * 52}" font-family="Georgia, 'Times New Roman', serif" font-size="42" font-weight="800" fill="#ffffff" filter="url(#textShadow)">${escapeXml(line)}</text>`).join("\n  ")}`;
}

function renderBottomText(frame) {
  const englishLines = wrapWords(frame.english || "", 48).slice(0, 2);
  const chineseLines = wrapMixed(frame.chinese || "", 34).slice(0, 1);
  const englishY = CAPTION_Y + 88;
  const chineseY = CAPTION_Y + 202;
  return `
  ${englishLines.map((line, index) => `<text x="${WIDTH / 2}" y="${englishY + index * 60}" text-anchor="middle" font-family="Arial, sans-serif" font-size="56" font-style="italic" font-weight="750" fill="#ffffff" filter="url(#textShadow)">${escapeXml(line)}</text>`).join("\n  ")}
  ${chineseLines.map((line, index) => `<text x="${WIDTH / 2}" y="${chineseY + index * 50}" text-anchor="middle" font-family="PingFang SC, Noto Sans CJK SC, Arial, sans-serif" font-size="42" font-weight="800" fill="#ffffff" filter="url(#textShadow)">${escapeXml(line)}</text>`).join("\n  ")}`;
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
