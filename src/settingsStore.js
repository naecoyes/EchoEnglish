const fs = require("node:fs/promises");
const path = require("node:path");
const { MINIMAX_IMAGE_MODEL, MINIMAX_MUSIC_MODEL, MINIMAX_TTS_MODEL } = require("./minimaxDefaults");

const ROOT = path.resolve(".");
const SETTINGS_FILE = path.join(ROOT, "settings.local.json");
const VOICE_TEST_URL = "https://api.minimaxi.com/v1/get_voice";

const DEFAULT_MODELS = {
  text: "MiniMax-M2.7",
  tts: MINIMAX_TTS_MODEL,
  image: MINIMAX_IMAGE_MODEL,
  music: MINIMAX_MUSIC_MODEL
};

async function readLocalSettings() {
  try {
    const raw = await fs.readFile(SETTINGS_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return normalizeSettings(parsed);
  } catch (error) {
    if (error.code === "ENOENT") {
      return normalizeSettings({});
    }
    throw new Error(`Could not read settings.local.json: ${error.message}`);
  }
}

async function getEffectiveSettings() {
  const local = await readLocalSettings();
  const envKey = process.env.MINIMAX_API_KEY || "";
  return normalizeSettings({
    ...local,
    minimaxApiKey: local.minimaxApiKey || envKey,
    keySource: local.minimaxApiKey ? "settings.local.json" : envKey ? "environment" : null
  });
}

async function getSettingsSummary() {
  const settings = await getEffectiveSettings();
  return {
    hasApiKey: Boolean(settings.minimaxApiKey),
    maskedApiKey: maskApiKey(settings.minimaxApiKey),
    keySource: settings.keySource,
    models: settings.models,
    settingsFile: "settings.local.json"
  };
}

async function saveSettings(input = {}) {
  const current = await readLocalSettings();
  const nextKey = typeof input.minimaxApiKey === "string" && input.minimaxApiKey.trim()
    ? input.minimaxApiKey.trim()
    : current.minimaxApiKey;
  const next = normalizeSettings({
    minimaxApiKey: nextKey,
    models: {
      ...current.models,
      ...(input.models || {})
    }
  });
  await writeLocalSettings(next);
  return getSettingsSummary();
}

async function clearSavedApiKey() {
  const current = await readLocalSettings();
  await writeLocalSettings(normalizeSettings({
    ...current,
    minimaxApiKey: ""
  }));
  return getSettingsSummary();
}

async function testMiniMaxConnection(input = {}) {
  const effective = await getEffectiveSettings();
  const apiKey = String(input.minimaxApiKey || effective.minimaxApiKey || "").trim();
  if (!apiKey) {
    return { ok: false, error: "MiniMax API key is missing." };
  }

  try {
    const response = await fetch(VOICE_TEST_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ voice_type: "system" })
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      return { ok: false, error: `MiniMax returned HTTP ${response.status}.` };
    }
    const statusCode = payload?.base_resp?.status_code;
    if (statusCode !== undefined && statusCode !== 0) {
      return { ok: false, error: payload?.base_resp?.status_msg || "MiniMax rejected the API key." };
    }
    return { ok: true, message: "MiniMax API key is valid." };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function normalizeSettings(settings = {}) {
  return {
    minimaxApiKey: typeof settings.minimaxApiKey === "string" ? settings.minimaxApiKey.trim() : "",
    keySource: settings.keySource || null,
    models: {
      text: cleanModel(settings.models?.text, DEFAULT_MODELS.text),
      tts: cleanModel(settings.models?.tts, DEFAULT_MODELS.tts),
      image: cleanModel(settings.models?.image, DEFAULT_MODELS.image),
      music: cleanModel(settings.models?.music, DEFAULT_MODELS.music)
    }
  };
}

function cleanModel(value, fallback) {
  const text = typeof value === "string" ? value.trim() : "";
  return text || fallback;
}

async function writeLocalSettings(settings) {
  const data = {
    minimaxApiKey: settings.minimaxApiKey,
    models: settings.models
  };
  const tmpFile = `${SETTINGS_FILE}.tmp`;
  await fs.writeFile(tmpFile, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(tmpFile, SETTINGS_FILE);
}

function maskApiKey(apiKey) {
  if (!apiKey) return "";
  if (apiKey.length <= 12) return `${apiKey.slice(0, 3)}...`;
  return `${apiKey.slice(0, 6)}...${apiKey.slice(-8)}`;
}

module.exports = {
  DEFAULT_MODELS,
  clearSavedApiKey,
  getEffectiveSettings,
  getSettingsSummary,
  readLocalSettings,
  saveSettings,
  testMiniMaxConnection
};
