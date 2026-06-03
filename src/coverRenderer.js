const path = require("node:path");
const { createRequire } = require("node:module");
const { ensureDir } = require("./utils");

const runtimeRequire = createRequire(__filename);

async function renderCoverImage({ story, sourcePath, outputPath, variant }) {
  const sharp = loadSharp();
  const isVertical = variant === "vertical";
  const W = isVertical ? 1080 : 1280;
  const H = isVertical ? 1920 : 720;
  await ensureDir(path.dirname(outputPath));
  const overlay = renderCoverOverlaySvg(story, { W, H, isVertical });
  await sharp(sourcePath, { failOn: "truncated" })
    .resize(W, H, { fit: "cover", position: "center" })
    .composite([{ input: Buffer.from(overlay), left: 0, top: 0 }])
    .png()
    .toFile(outputPath);
  return outputPath;
}

function renderCoverOverlaySvg(story, layout) {
  return svgShell(layout.W, layout.H, renderCoverOverlayContent(story, layout));
}

function renderCoverOverlayContent(story, layout) {
  return layout.isVertical ? renderVerticalCoverContent(story, layout) : renderYoutubeCoverContent(story, layout);
}

function renderYoutubeCoverContent(story, { W, H }) {
  const titleLines = wrapText(story?.title || story?.topic || "English Story", 34, 3);
  const summaryLines = wrapText(summaryText(story), 58, 3);
  const difficulty = difficultyText(story);
  const cx = Math.round(W / 2);
  const brandY = 50;
  const titleFont = titleLines.length > 2 ? 46 : 52;
  const titleLineHeight = Math.round(titleFont * 1.18);
  const titleStartY = 134;
  const titleBlock = titleLines.map((line, index) => centeredTextLine(line, cx, titleStartY + index * titleLineHeight, titleFont, 900, "#ffffff", 0, true)).join("");
  const playY = Math.max(318, titleStartY + titleLines.length * titleLineHeight + 96);
  const playR = 78;
  const listenY = playY + 128;
  const summaryY = listenY + 82;
  const summaryBlock = summaryLines.map((line, index) => centeredTextLine(line, cx, summaryY + index * 30, 24, 800, "#e5edf7", 0, true)).join("");
  const difficultyY = Math.min(H - 54, summaryY + summaryLines.length * 30 + 44);
  return `
    <rect width="${W}" height="${H}" fill="#020817" opacity="0.58"/>
    <rect width="${W}" height="${H}" fill="url(#centerVignette)"/>
    <rect x="${cx - 108}" y="${brandY - 20}" width="216" height="34" rx="17" fill="#0ea5e9" opacity="0.96"/>
    ${centeredTextLine("ECHOENGLISH", cx, brandY + 3, 14, 900, "#ffffff", 3.5, false)}
    ${titleBlock}
    <circle cx="${cx}" cy="${playY}" r="${playR}" fill="#0ea5e9" opacity="0.94" filter="url(#shadow)"/>
    <path d="M${cx - 26} ${playY - 42} L${cx - 26} ${playY + 42} L${cx + 42} ${playY} Z" fill="#ffffff"/>
    ${centeredTextLine("Listen & Shadow", cx, listenY, 28, 900, "#ffffff", 0, true)}
    ${centeredTextLine("边听边读 · 口语跟读", cx, listenY + 28, 22, 800, "#d6e2ef", 2, true)}
    ${summaryBlock}
    ${centeredTextLine(`Difficulty: U.S. ${difficulty.short}`, cx, difficultyY, 22, 900, "#38bdf8", 0, true)}
  `;
}

function renderVerticalCoverContent(story, { W, H }) {
  const titleLines = wrapText(story?.title || story?.topic || "English Story", 20, 4);
  const summaryLines = wrapText(summaryText(story), 30, 4);
  const difficulty = difficultyText(story);
  const cx = Math.round(W / 2);
  const brandY = Math.round(H * 0.095);
  const titleFont = titleLines.length > 3 ? 58 : 64;
  const titleLineHeight = Math.round(titleFont * 1.18);
  const titleStartY = Math.round(H * 0.19);
  const titleBlock = titleLines.map((line, index) => centeredTextLine(line, cx, titleStartY + index * titleLineHeight, titleFont, 900, "#ffffff", 0, true)).join("");
  const playY = Math.max(Math.round(H * 0.47), titleStartY + titleLines.length * titleLineHeight + 150);
  const playR = 112;
  const listenY = playY + 178;
  const summaryY = listenY + 104;
  const summaryBlock = summaryLines.map((line, index) => centeredTextLine(line, cx, summaryY + index * 40, 31, 800, "#e5edf7", 0, true)).join("");
  const difficultyY = Math.min(H - 118, summaryY + summaryLines.length * 40 + 62);
  return `
    <rect width="${W}" height="${H}" fill="#020817" opacity="0.62"/>
    <rect width="${W}" height="${H}" fill="url(#verticalCenterVignette)"/>
    <rect x="${cx - 118}" y="${brandY - 30}" width="236" height="54" rx="27" fill="#0ea5e9" opacity="0.96"/>
    ${centeredTextLine("ECHOENGLISH", cx, brandY + 6, 24, 900, "#ffffff", 5, false)}
    ${titleBlock}
    <circle cx="${cx}" cy="${playY}" r="${playR}" fill="#0ea5e9" opacity="0.94" filter="url(#shadow)"/>
    <path d="M${cx - 34} ${playY - 56} L${cx - 34} ${playY + 56} L${cx + 58} ${playY} Z" fill="#ffffff"/>
    ${centeredTextLine("Listen & Shadow", cx, listenY, 42, 900, "#ffffff", 0, true)}
    ${centeredTextLine("边听边读 · 口语跟读", cx, listenY + 42, 30, 800, "#d6e2ef", 3, true)}
    ${summaryBlock}
    ${centeredTextLine(`Difficulty: U.S. ${difficulty.short}`, cx, difficultyY, 31, 900, "#38bdf8", 0, true)}
  `;
}

function svgShell(W, H, content) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="shade" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#031225" stop-opacity="0.72"/>
      <stop offset="58%" stop-color="#031225" stop-opacity="0.28"/>
      <stop offset="100%" stop-color="#031225" stop-opacity="0.08"/>
    </linearGradient>
    <linearGradient id="verticalShade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#031225" stop-opacity="0.62"/>
      <stop offset="55%" stop-color="#031225" stop-opacity="0.24"/>
      <stop offset="100%" stop-color="#031225" stop-opacity="0.68"/>
    </linearGradient>
    <linearGradient id="panel" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#eef7ff" stop-opacity="0.92"/>
      <stop offset="100%" stop-color="#dbeafe" stop-opacity="0.66"/>
    </linearGradient>
    <linearGradient id="verticalPanel" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#eef7ff" stop-opacity="0.9"/>
      <stop offset="100%" stop-color="#dbeafe" stop-opacity="0.7"/>
    </linearGradient>
    <radialGradient id="centerVignette" cx="50%" cy="45%" r="74%">
      <stop offset="0%" stop-color="#020817" stop-opacity="0.12"/>
      <stop offset="58%" stop-color="#020817" stop-opacity="0.38"/>
      <stop offset="100%" stop-color="#020817" stop-opacity="0.82"/>
    </radialGradient>
    <radialGradient id="verticalCenterVignette" cx="50%" cy="42%" r="78%">
      <stop offset="0%" stop-color="#020817" stop-opacity="0.16"/>
      <stop offset="56%" stop-color="#020817" stop-opacity="0.42"/>
      <stop offset="100%" stop-color="#020817" stop-opacity="0.86"/>
    </radialGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="6" stdDeviation="8" flood-color="#00152e" flood-opacity="0.28"/>
    </filter>
  </defs>
  ${content}
</svg>`;
}

function textLine(value, x, y, size, weight = 600, color = "#07152f", letterSpacing = 0) {
  return `<text x="${x}" y="${y}" font-family="-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', Arial, sans-serif" font-size="${size}" font-weight="${weight}" fill="${color}" letter-spacing="${letterSpacing}" filter="url(#shadow)">${escapeXml(value)}</text>`;
}

function centeredTextLine(value, x, y, size, weight = 600, color = "#07152f", letterSpacing = 0, shadow = false) {
  const filter = shadow ? " filter=\"url(#shadow)\"" : "";
  return `<text x="${x}" y="${y}" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', Arial, sans-serif" font-size="${size}" font-weight="${weight}" fill="${color}" letter-spacing="${letterSpacing}"${filter}>${escapeXml(value)}</text>`;
}

function summaryText(story) {
  const summary = String(story?.summary || "").replace(/\s+/g, " ").trim();
  if (summary) return summary;
  return "Practice listening, reading, and speaking with a clear English story.";
}

function difficultyText(story) {
  const level = story?.contentMode === "factual-documentary" ? "Grade 4-5" : "Grade 3-4";
  return {
    en: `Difficulty: about U.S. elementary ${level} English`,
    zh: `难度约为美国小学${level === "Grade 4-5" ? "四到五" : "三到四"}年级英文阅读水平`,
    short: level
  };
}

function wrapText(text, maxChars, maxLines) {
  const words = String(text || "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (!words.length) return [];
  const lines = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
    if (lines.length >= maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (lines.length === maxLines && words.join(" ").length > lines.join(" ").length) {
    lines[lines.length - 1] = `${lines[lines.length - 1].replace(/[.,;:!?]$/, "")}...`;
  }
  return lines;
}

function escapeXml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function loadSharp() {
  try {
    return require("sharp");
  } catch {
    return runtimeRequire("sharp");
  }
}

module.exports = {
  renderCoverImage,
  renderCoverOverlayContent,
  renderCoverOverlaySvg
};
