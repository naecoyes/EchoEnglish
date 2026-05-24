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

  return {
    ok: warnings.length === 0,
    warnings,
    width: metadata.width || null,
    height: metadata.height || null,
    format: metadata.format || path.extname(filePath).replace(".", "") || null,
    meanLuma: Number(stats.meanLuma.toFixed(3)),
    lumaStdDev: Number(stats.lumaStdDev.toFixed(3))
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
  for (let index = 0; index < data.length; index += channels) {
    const r = data[index] || 0;
    const g = data[index + 1] || r;
    const b = data[index + 2] || g;
    values.push(0.2126 * r + 0.7152 * g + 0.0722 * b);
  }
  const meanLuma = values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
  const variance = values.reduce((sum, value) => sum + (value - meanLuma) ** 2, 0) / Math.max(1, values.length);
  return {
    meanLuma,
    lumaStdDev: Math.sqrt(variance)
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
