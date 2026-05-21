const fs = require("node:fs/promises");

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function pathExists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

function slugify(value) {
  const slug = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "story";
}

module.exports = {
  ensureDir,
  pathExists,
  slugify
};
