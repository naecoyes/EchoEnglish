const path = require("node:path");
const { createRequire } = require("node:module");

async function inspectImage(filePath) {
  const sharp = loadSharp();
  const image = sharp(filePath, { failOn: "truncated" });
  const metadata = await image.metadata();
  const warnings = [];

  if (!metadata.width || !metadata.height) warnings.push("Image dimensions are missing.");
  if (metadata.width && metadata.width < 512) warnings.push(`Image width is low: ${metadata.width}.`);
  if (metadata.height && metadata.height < 512) warnings.push(`Image height is low: ${metadata.height}.`);

  const { data, info } = await sharp(filePath)
    .resize(32, 32, { fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const stats = computePixelStats(data, info.channels || 3);
  if (stats.meanLuma < 8) warnings.push(`Image is too dark: mean luma ${stats.meanLuma.toFixed(2)}.`);
  if (stats.lumaStdDev < 4) warnings.push(`Image has very low detail: luma stddev ${stats.lumaStdDev.toFixed(2)}.`);
  if (
    stats.topTwoThirds.meanLuma > 20
    && (
      (stats.bottomThird.meanLuma < 7 && stats.bottomThird.lumaStdDev < 5)
      || (stats.bottomThird.meanLuma < 12 && stats.bottomThird.darkRatio > 0.86 && stats.bottomThird.lumaStdDev < 10)
    )
  ) {
    warnings.push("Image appears to contain a blank black lower-third panel.");
  }

  return {
    ok: warnings.length === 0,
    warnings,
    width: metadata.width || null,
    height: metadata.height || null,
    format: metadata.format || path.extname(filePath).replace(".", "") || null,
    meanLuma: Number(stats.meanLuma.toFixed(3)),
    lumaStdDev: Number(stats.lumaStdDev.toFixed(3)),
    bottomLuma: Number(stats.bottomThird.meanLuma.toFixed(3)),
    bottomDarkRatio: Number(stats.bottomThird.darkRatio.toFixed(3))
  };
}

async function validateImageOrThrow(filePath) {
  const quality = await inspectImage(filePath);
  if (!quality.ok) {
    const error = new Error(`Generated image failed quality checks: ${quality.warnings.join(" ")}`);
    error.quality = quality;
    throw error;
  }
  return quality;
}

function computePixelStats(data, channels) {
  const values = [];
  const bottomValues = [];
  const topValues = [];
  const pixelCount = Math.max(1, Math.floor(data.length / channels));
  const width = Math.round(Math.sqrt(pixelCount));
  const height = Math.max(1, Math.floor(pixelCount / Math.max(1, width)));
  for (let index = 0; index < data.length; index += channels) {
    const r = data[index] || 0;
    const g = data[index + 1] || r;
    const b = data[index + 2] || g;
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const pixelIndex = Math.floor(index / channels);
    const y = Math.floor(pixelIndex / Math.max(1, width));
    values.push(luma);
    if (y >= Math.floor(height * 0.64)) bottomValues.push(luma);
    else topValues.push(luma);
  }
  const all = statsForValues(values);
  return {
    meanLuma: all.meanLuma,
    lumaStdDev: all.lumaStdDev,
    bottomThird: statsForValues(bottomValues),
    topTwoThirds: statsForValues(topValues)
  };
}

function statsForValues(values) {
  const meanLuma = values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
  const variance = values.reduce((sum, value) => sum + (value - meanLuma) ** 2, 0) / Math.max(1, values.length);
  return {
    meanLuma,
    lumaStdDev: Math.sqrt(variance),
    darkRatio: values.filter((value) => value < 18).length / Math.max(1, values.length)
  };
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

module.exports = {
  inspectImage,
  validateImageOrThrow
};
