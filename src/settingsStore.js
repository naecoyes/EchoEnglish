const fs = require("node:fs/promises");
const path = require("node:path");
const { MINIMAX_IMAGE_MODEL, MINIMAX_MUSIC_MODEL, MINIMAX_TTS_MODEL } = require("./minimaxDefaults");
const { testTavilySearch } = require("./tavilySearch");

const ROOT = path.resolve(".");
const SETTINGS_FILE = path.join(ROOT, "settings.local.json");
const VOICE_TEST_URL = "https://api.minimaxi.com/v1/get_voice";

const DEFAULT_MODELS = {
  text: "MiniMax-M2.7",
  tts: MINIMAX_TTS_MODEL,
  image: MINIMAX_IMAGE_MODEL,
  music: MINIMAX_MUSIC_MODEL
};

const DEFAULT_LLM = {
  baseUrl: "https://coding.dashscope.aliyuncs.com/v1",
  model: "qwen3.6-plus"
};

const DEFAULT_MINIMAX = {
  tts: MINIMAX_TTS_MODEL,
  image: MINIMAX_IMAGE_MODEL,
  music: MINIMAX_MUSIC_MODEL,
  englishVoice: "English_Graceful_Lady",
  chineseVoice: "Chinese (Mandarin)_Sweet_Lady",
  podcastHostAVoice: "English_captivating_female1",
  podcastHostBVoice: "English_Trustworthy_Man",
  musicTrackCount: 3
};

const DEFAULT_XIAOMI = {
  baseUrl: "https://token-plan-sgp.xiaomimimo.com/v1",
  ttsBaseUrl: "https://token-plan-sgp.xiaomimimo.com/v1",
  textModel: "MiMo-V2.5-Pro",
  ttsModel: "MiMo-V2.5-TTS",
  voice: "mimo_default",
  podcastHostAVoice: "Mia",
  podcastHostBVoice: "Milo",
  ttsModels: [
    "mimo-v2-tts",
    "MiMo-V2.5-TTS-VoiceClone",
    "MiMo-V2.5-TTS-VoiceDesign",
    "MiMo-V2.5-TTS",
    "MiMo-V2-TTS"
  ],
  textModels: [
    "MiMo-V2.5-Pro",
    "MiMo-V2.5",
    "MiMo-V2-Pro",
    "MiMo-V2-Omni"
  ]
};

const DEFAULT_GOOGLE = {
  baseUrl: "https://generativelanguage.googleapis.com/v1beta",
  imageModel: "imagen-4.0-generate-001",
  ttsModel: "gemini-2.5-flash-preview-tts",
  voice: "Kore",
  podcastHostAVoice: "Kore",
  podcastHostBVoice: "Puck",
  voices: [
    "Zephyr", "Puck", "Charon", "Kore", "Fenrir", "Leda", "Orus", "Aoede",
    "Callirrhoe", "Autonoe", "Enceladus", "Iapetus", "Umbriel", "Algieba",
    "Despina", "Erinome", "Algenib", "Rasalgethi", "Laomedeia", "Achernar",
    "Alnilam", "Schedar", "Gacrux", "Pulcherrima", "Achird", "Zubenelgenubi",
    "Vindemiatrix", "Sadachbia", "Sadaltager", "Sulafat"
  ]
};

const DEFAULT_MEDIA = {
  ttsProvider: "minimax",
  imageProvider: "minimax",
  videoEncoder: "auto"
};

const DEFAULT_PROFILE_ID = "balanced";

const DEFAULT_PROFILES = {
  balanced: {
    label: "Balanced",
    description: "Default production profile for 15-minute videos.",
    llm: { ...DEFAULT_LLM },
    minimax: { ...DEFAULT_MINIMAX },
    search: { provider: "tavily" }
  },
  "fast-draft": {
    label: "Fast Draft",
    description: "Keeps the same media defaults, tuned for quick script iteration.",
    llm: { ...DEFAULT_LLM, model: "qwen3.6-plus" },
    minimax: { ...DEFAULT_MINIMAX, musicTrackCount: 3 },
    search: { provider: "tavily" }
  },
  "high-quality-media": {
    label: "High Quality Media",
    description: "Prioritizes HD voice and full MiniMax image/music generation.",
    llm: { ...DEFAULT_LLM },
    minimax: { ...DEFAULT_MINIMAX, tts: MINIMAX_TTS_MODEL, image: MINIMAX_IMAGE_MODEL, music: MINIMAX_MUSIC_MODEL, musicTrackCount: 4 },
    search: { provider: "tavily" }
  },
  manual: {
    label: "Manual",
    description: "Use the advanced model and voice fields exactly as configured.",
    llm: { ...DEFAULT_LLM },
    minimax: { ...DEFAULT_MINIMAX },
    search: { provider: "tavily" }
  }
};

async function readLocalSettings() {
  return normalizeSettings(await readRawLocalSettings());
}

async function readRawLocalSettings() {
  try {
    const raw = await fs.readFile(SETTINGS_FILE, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === "ENOENT") {
      return {};
    }
    throw new Error(`Could not read settings.local.json: ${error.message}`);
  }
}

async function getEffectiveSettings() {
  const raw = await readRawLocalSettings();
  const local = normalizeSettings(raw);
  const envKey = process.env.MINIMAX_API_KEY || "";
  const envLlmKey = process.env.LLM_API_KEY || "";
  const envLlmBase = process.env.LLM_API_BASE || "";
  const envLlmModel = process.env.STRIX_LLM || "";
  const envTavilyKey = process.env.TAVILY_API_KEY || "";
  const envXiaomiKey = process.env.XIAOMI_API_KEY || "";
  const envGoogleKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || "";
  return normalizeSettings({
    ...local,
    minimaxApiKey: raw.minimaxApiKey || envKey,
    keySource: raw.minimaxApiKey ? "settings.local.json" : envKey ? "environment" : null,
    provider: raw.provider || "minimax",
    llm: {
      ...local.llm,
      apiKey: raw.llm?.apiKey || envLlmKey,
      baseUrl: raw.llm?.baseUrl || envLlmBase || local.llm.baseUrl || DEFAULT_LLM.baseUrl,
      model: raw.llm?.model || envLlmModel || local.llm.model || DEFAULT_LLM.model,
      keySource: raw.llm?.apiKey ? "settings.local.json" : envLlmKey ? "environment" : null
    },
    xiaomi: {
      apiKey: raw.xiaomi?.apiKey || envXiaomiKey,
      ttsApiKey: raw.xiaomi?.ttsApiKey || local.xiaomi?.ttsApiKey || raw.xiaomi?.apiKey || envXiaomiKey,
      baseUrl: raw.xiaomi?.baseUrl || DEFAULT_XIAOMI.baseUrl,
      ttsBaseUrl: raw.xiaomi?.ttsBaseUrl || local.xiaomi?.ttsBaseUrl || DEFAULT_XIAOMI.ttsBaseUrl,
      textModel: normalizeXiaomiModel(raw.xiaomi?.textModel, DEFAULT_XIAOMI.textModel),
      ttsModel: normalizeXiaomiModel(raw.xiaomi?.ttsModel, DEFAULT_XIAOMI.ttsModel),
      voice: raw.xiaomi?.voice || local.xiaomi?.voice || DEFAULT_XIAOMI.voice,
      podcastHostAVoice: raw.xiaomi?.podcastHostAVoice || local.xiaomi?.podcastHostAVoice || DEFAULT_XIAOMI.podcastHostAVoice,
      podcastHostBVoice: raw.xiaomi?.podcastHostBVoice || local.xiaomi?.podcastHostBVoice || DEFAULT_XIAOMI.podcastHostBVoice,
      keySource: raw.xiaomi?.apiKey ? "settings.local.json" : envXiaomiKey ? "environment" : null
    },
    google: {
      apiKey: raw.google?.apiKey || envGoogleKey,
      baseUrl: raw.google?.baseUrl || local.google?.baseUrl || DEFAULT_GOOGLE.baseUrl,
      imageModel: raw.google?.imageModel || local.google?.imageModel || DEFAULT_GOOGLE.imageModel,
      ttsModel: raw.google?.ttsModel || local.google?.ttsModel || DEFAULT_GOOGLE.ttsModel,
      voice: raw.google?.voice || local.google?.voice || DEFAULT_GOOGLE.voice,
      podcastHostAVoice: raw.google?.podcastHostAVoice || local.google?.podcastHostAVoice || DEFAULT_GOOGLE.podcastHostAVoice,
      podcastHostBVoice: raw.google?.podcastHostBVoice || local.google?.podcastHostBVoice || DEFAULT_GOOGLE.podcastHostBVoice,
      keySource: raw.google?.apiKey ? "settings.local.json" : envGoogleKey ? "environment" : null
    },
    search: {
      ...local.search,
      tavilyApiKey: raw.search?.tavilyApiKey || envTavilyKey,
      keySource: raw.search?.tavilyApiKey ? "settings.local.json" : envTavilyKey ? "environment" : null
    },
    access: {
      ...local.access,
      pin: raw.access?.pin || process.env.ACCESS_PIN || "",
      pinSource: raw.access?.pin ? "settings.local.json" : process.env.ACCESS_PIN ? "environment" : null
    }
  });
}

async function getSettingsSummary() {
  const settings = await getEffectiveSettings();
  return {
    hasApiKey: Boolean(settings.minimaxApiKey),
    maskedApiKey: maskApiKey(settings.minimaxApiKey),
    keySource: settings.keySource,
    activeProfile: settings.activeProfile,
    profiles: settings.profiles,
    profile: settings.profile,
    models: settings.models,
    minimax: settings.minimax,
    llm: {
      hasApiKey: Boolean(settings.llm.apiKey),
      maskedApiKey: maskApiKey(settings.llm.apiKey),
      keySource: settings.llm.keySource,
      baseUrl: settings.llm.baseUrl,
      model: settings.llm.model
    },
    provider: settings.provider || "minimax",
    xiaomi: {
      hasApiKey: Boolean(settings.xiaomi?.apiKey),
      maskedApiKey: maskApiKey(settings.xiaomi?.apiKey),
      hasTtsApiKey: Boolean(settings.xiaomi?.ttsApiKey || settings.xiaomi?.apiKey),
      maskedTtsApiKey: maskApiKey(settings.xiaomi?.ttsApiKey || settings.xiaomi?.apiKey),
      keySource: settings.xiaomi?.keySource,
      baseUrl: settings.xiaomi?.baseUrl || DEFAULT_XIAOMI.baseUrl,
      ttsBaseUrl: settings.xiaomi?.ttsBaseUrl || DEFAULT_XIAOMI.ttsBaseUrl,
      textModel: settings.xiaomi?.textModel || DEFAULT_XIAOMI.textModel,
      ttsModel: settings.xiaomi?.ttsModel || DEFAULT_XIAOMI.ttsModel,
      voice: settings.xiaomi?.voice || DEFAULT_XIAOMI.voice,
      podcastHostAVoice: settings.xiaomi?.podcastHostAVoice || DEFAULT_XIAOMI.podcastHostAVoice,
      podcastHostBVoice: settings.xiaomi?.podcastHostBVoice || DEFAULT_XIAOMI.podcastHostBVoice,
      textModels: DEFAULT_XIAOMI.textModels,
      ttsModels: DEFAULT_XIAOMI.ttsModels
    },
    google: {
      hasApiKey: Boolean(settings.google?.apiKey),
      maskedApiKey: maskApiKey(settings.google?.apiKey),
      keySource: settings.google?.keySource,
      baseUrl: settings.google?.baseUrl || DEFAULT_GOOGLE.baseUrl,
      imageModel: settings.google?.imageModel || DEFAULT_GOOGLE.imageModel,
      ttsModel: settings.google?.ttsModel || DEFAULT_GOOGLE.ttsModel,
      voice: settings.google?.voice || DEFAULT_GOOGLE.voice,
      podcastHostAVoice: settings.google?.podcastHostAVoice || DEFAULT_GOOGLE.podcastHostAVoice,
      podcastHostBVoice: settings.google?.podcastHostBVoice || DEFAULT_GOOGLE.podcastHostBVoice,
      voices: DEFAULT_GOOGLE.voices
    },
    media: settings.media,
    search: {
      provider: "tavily",
      hasTavilyKey: Boolean(settings.search.tavilyApiKey),
      maskedTavilyKey: maskApiKey(settings.search.tavilyApiKey),
      keySource: settings.search.keySource
    },
    access: {
      hasPin: Boolean(settings.access.pin),
      pinSource: settings.access.pinSource
    },
    settingsFile: "settings.local.json"
  };
}

async function saveSettings(input = {}) {
  const current = await readLocalSettings();
  const googleApiKeyInput = normalizeOptionalSecret(input.google?.apiKey, "Google API key");
  const nextKey = typeof input.minimaxApiKey === "string" && input.minimaxApiKey.trim()
    ? input.minimaxApiKey.trim()
    : current.minimaxApiKey;
  const next = normalizeSettings({
    activeProfile: input.activeProfile || current.activeProfile,
    provider: input.provider || current.provider || "minimax",
    profiles: {
      ...current.profiles,
      ...(input.profiles || {})
    },
    minimaxApiKey: nextKey,
    models: {
      ...current.models,
      ...(input.models || {})
    },
    minimax: {
      ...current.minimax,
      ...(input.minimax || {})
    },
    llm: {
      ...current.llm,
      ...(input.llm || {}),
      apiKey: typeof input.llm?.apiKey === "string" && input.llm.apiKey.trim()
        ? input.llm.apiKey.trim()
        : current.llm.apiKey
    },
    xiaomi: {
      ...current.xiaomi,
      ...(input.xiaomi || {}),
      apiKey: typeof input.xiaomi?.apiKey === "string" && input.xiaomi.apiKey.trim()
        ? input.xiaomi.apiKey.trim()
        : current.xiaomi?.apiKey
    },
    google: {
      ...current.google,
      ...(input.google || {}),
      apiKey: googleApiKeyInput
        ? googleApiKeyInput
        : current.google?.apiKey
    },
    media: {
      ...current.media,
      ...(input.media || {})
    },
    search: {
      ...current.search,
      ...(input.search || {}),
      tavilyApiKey: typeof input.search?.tavilyApiKey === "string" && input.search.tavilyApiKey.trim()
        ? input.search.tavilyApiKey.trim()
        : current.search.tavilyApiKey
    },
    access: {
      ...current.access,
      ...(input.access || {}),
      pin: typeof input.access?.pin === "string" && input.access.pin.trim()
        ? input.access.pin.trim()
        : current.access.pin
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

async function clearSavedLlmApiKey() {
  const current = await readLocalSettings();
  await writeLocalSettings(normalizeSettings({
    ...current,
    llm: {
      ...current.llm,
      apiKey: ""
    }
  }));
  return getSettingsSummary();
}

async function clearSavedTavilyApiKey() {
  const current = await readLocalSettings();
  await writeLocalSettings(normalizeSettings({
    ...current,
    search: {
      ...current.search,
      tavilyApiKey: ""
    }
  }));
  return getSettingsSummary();
}

async function clearSavedXiaomiApiKey() {
  const current = await readLocalSettings();
  await writeLocalSettings(normalizeSettings({
    ...current,
    xiaomi: {
      ...current.xiaomi,
      apiKey: ""
    }
  }));
  return getSettingsSummary();
}

async function clearSavedGoogleApiKey() {
  const current = await readLocalSettings();
  await writeLocalSettings(normalizeSettings({
    ...current,
    google: {
      ...current.google,
      apiKey: ""
    }
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

async function testLlmConnection(input = {}) {
  const effective = await getEffectiveSettings();
  const llm = {
    apiKey: String(input.llm?.apiKey || effective.llm.apiKey || "").trim(),
    baseUrl: String(input.llm?.baseUrl || effective.llm.baseUrl || DEFAULT_LLM.baseUrl).trim(),
    model: String(input.llm?.model || effective.llm.model || DEFAULT_LLM.model).trim()
  };
  llm.model = normalizeLlmModel(llm.model, llm.baseUrl);
  if (!llm.apiKey) {
    return { ok: false, error: "LLM API key is missing." };
  }

  try {
    const response = await fetch(`${llm.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${llm.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: llm.model,
        messages: [
          { role: "system", content: "Return one short plain response." },
          { role: "user", content: "Reply with OK." }
        ],
        temperature: 0,
        max_tokens: 8
      })
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      return { ok: false, error: `LLM returned HTTP ${response.status}.` };
    }
    if (!payload?.choices?.[0]?.message?.content) {
      return { ok: false, error: "LLM response did not include message content." };
    }
    return { ok: true, message: "LLM API key is valid." };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

async function testTavilyConnection(input = {}) {
  const effective = await getEffectiveSettings();
  const apiKey = String(input.search?.tavilyApiKey || effective.search.tavilyApiKey || "").trim();
  return testTavilySearch(apiKey);
}

async function testXiaomiConnection(input = {}) {
  const effective = await getEffectiveSettings();
  const xiaomi = {
    apiKey: String(input.xiaomi?.apiKey || effective.xiaomi?.apiKey || "").trim(),
    baseUrl: String(input.xiaomi?.baseUrl || effective.xiaomi?.baseUrl || DEFAULT_XIAOMI.baseUrl).trim(),
    textModel: String(input.xiaomi?.textModel || effective.xiaomi?.textModel || DEFAULT_XIAOMI.textModel).trim()
  };
  if (!xiaomi.apiKey) {
    return { ok: false, error: "Xiaomi API key is missing." };
  }

  try {
    const response = await fetch(`${xiaomi.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "api-key": xiaomi.apiKey,
        Authorization: `Bearer ${xiaomi.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: xiaomi.textModel.toLowerCase(),
        messages: [
          { role: "user", content: "Reply with exactly OK." }
        ],
        temperature: 0,
        max_completion_tokens: 64,
        stream: false,
        thinking: { type: "disabled" }
      })
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      return { ok: false, error: `Xiaomi returned HTTP ${response.status}.` };
    }
    if (!payload?.choices?.[0]?.message?.content) {
      return { ok: false, error: "Xiaomi response did not include message content." };
    }
    return { ok: true, message: "Xiaomi API key is valid." };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

async function testGoogleConnection(input = {}) {
  const effective = await getEffectiveSettings();
  let inputGoogleKey = "";
  try {
    inputGoogleKey = normalizeOptionalSecret(input.google?.apiKey, "Google API key");
  } catch (error) {
    return { ok: false, error: error.message };
  }
  const google = {
    apiKey: String(inputGoogleKey || effective.google?.apiKey || "").trim(),
    baseUrl: String(input.google?.baseUrl || effective.google?.baseUrl || DEFAULT_GOOGLE.baseUrl).trim(),
    imageModel: String(input.google?.imageModel || effective.google?.imageModel || DEFAULT_GOOGLE.imageModel).trim(),
    ttsModel: String(input.google?.ttsModel || effective.google?.ttsModel || DEFAULT_GOOGLE.ttsModel).trim(),
    voice: String(input.google?.voice || effective.google?.voice || DEFAULT_GOOGLE.voice).trim()
  };
  if (!google.apiKey) {
    return { ok: false, error: "Google API key is missing." };
  }

  try {
    const url = `${google.baseUrl.replace(/\/$/, "")}/models`;
    const response = await fetch(url, {
      method: "GET",
      headers: { "x-goog-api-key": google.apiKey }
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      return { ok: false, error: `Google returned HTTP ${response.status}. ${payload?.error?.message || ""}`.trim() };
    }
    if (!Array.isArray(payload?.models)) {
      return { ok: false, error: "Google response did not include a models list." };
    }
    return {
      ok: true,
      message: `Google API key is valid. Configured TTS: ${google.ttsModel}; Imagen: ${google.imageModel}; voice: ${google.voice}.`
    };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function normalizeSettings(settings = {}) {
  const profiles = normalizeProfiles(settings.profiles);
  const activeProfile = profiles[settings.activeProfile] ? settings.activeProfile : DEFAULT_PROFILE_ID;
  const profile = profiles[activeProfile] || profiles[DEFAULT_PROFILE_ID];
  const profileModels = {
    text: profile.llm.model,
    tts: profile.minimax.tts,
    image: profile.minimax.image,
    music: profile.minimax.music
  };
  const textModel = normalizeTextModel(settings.models?.text, settings.llm?.model, profileModels.text);
  const minimax = {
    englishVoice: cleanModel(settings.minimax?.englishVoice, profile.minimax.englishVoice),
    chineseVoice: cleanModel(settings.minimax?.chineseVoice, profile.minimax.chineseVoice),
    podcastHostAVoice: cleanModel(settings.minimax?.podcastHostAVoice, profile.minimax.podcastHostAVoice || DEFAULT_MINIMAX.podcastHostAVoice),
    podcastHostBVoice: cleanModel(settings.minimax?.podcastHostBVoice, profile.minimax.podcastHostBVoice || DEFAULT_MINIMAX.podcastHostBVoice),
    musicTrackCount: clampTrackCount(settings.minimax?.musicTrackCount, profile.minimax.musicTrackCount)
  };
  return {
    activeProfile,
    profiles,
    profile,
    minimaxApiKey: typeof settings.minimaxApiKey === "string" ? settings.minimaxApiKey.trim() : "",
    keySource: settings.keySource || null,
    provider: settings.provider === "xiaomi" ? "xiaomi" : "minimax",
    media: {
      ttsProvider: normalizeProvider(settings.media?.ttsProvider, DEFAULT_MEDIA.ttsProvider, ["minimax", "xiaomi", "google"]),
      imageProvider: normalizeProvider(settings.media?.imageProvider, DEFAULT_MEDIA.imageProvider, ["minimax", "google"]),
      videoEncoder: normalizeProvider(settings.media?.videoEncoder, DEFAULT_MEDIA.videoEncoder, ["auto", "cpu-libx264", "apple-videotoolbox", "nvidia-nvenc", "intel-qsv"])
    },
    models: {
      text: textModel,
      tts: cleanModel(settings.models?.tts, profileModels.tts || DEFAULT_MODELS.tts),
      image: cleanModel(settings.models?.image, profileModels.image || DEFAULT_MODELS.image),
      music: cleanModel(settings.models?.music, profileModels.music || DEFAULT_MODELS.music)
    },
    minimax,
    llm: {
      apiKey: typeof settings.llm?.apiKey === "string" ? settings.llm.apiKey.trim() : "",
      baseUrl: cleanModel(settings.llm?.baseUrl, profile.llm.baseUrl || DEFAULT_LLM.baseUrl),
      model: cleanModel(settings.llm?.model, profile.llm.model || DEFAULT_LLM.model),
      keySource: settings.llm?.keySource || null
    },
    xiaomi: {
      apiKey: typeof settings.xiaomi?.apiKey === "string" ? settings.xiaomi.apiKey.trim() : "",
      ttsApiKey: typeof settings.xiaomi?.ttsApiKey === "string" ? settings.xiaomi.ttsApiKey.trim() : "",
      baseUrl: cleanModel(settings.xiaomi?.baseUrl, DEFAULT_XIAOMI.baseUrl),
      ttsBaseUrl: cleanModel(settings.xiaomi?.ttsBaseUrl, DEFAULT_XIAOMI.ttsBaseUrl),
      textModel: normalizeXiaomiModel(settings.xiaomi?.textModel, DEFAULT_XIAOMI.textModel),
      ttsModel: normalizeXiaomiModel(settings.xiaomi?.ttsModel, DEFAULT_XIAOMI.ttsModel),
      voice: cleanModel(settings.xiaomi?.voice, DEFAULT_XIAOMI.voice),
      podcastHostAVoice: cleanModel(settings.xiaomi?.podcastHostAVoice, DEFAULT_XIAOMI.podcastHostAVoice),
      podcastHostBVoice: cleanModel(settings.xiaomi?.podcastHostBVoice, DEFAULT_XIAOMI.podcastHostBVoice),
      keySource: settings.xiaomi?.keySource || null
    },
    google: {
      apiKey: typeof settings.google?.apiKey === "string" ? settings.google.apiKey.trim() : "",
      baseUrl: cleanModel(settings.google?.baseUrl, DEFAULT_GOOGLE.baseUrl),
      imageModel: cleanModel(settings.google?.imageModel, DEFAULT_GOOGLE.imageModel),
      ttsModel: cleanModel(settings.google?.ttsModel, DEFAULT_GOOGLE.ttsModel),
      voice: cleanModel(settings.google?.voice, DEFAULT_GOOGLE.voice),
      podcastHostAVoice: cleanModel(settings.google?.podcastHostAVoice, DEFAULT_GOOGLE.podcastHostAVoice),
      podcastHostBVoice: cleanModel(settings.google?.podcastHostBVoice, DEFAULT_GOOGLE.podcastHostBVoice),
      keySource: settings.google?.keySource || null
    },
    search: {
      provider: "tavily",
      tavilyApiKey: typeof settings.search?.tavilyApiKey === "string" ? settings.search.tavilyApiKey.trim() : "",
      keySource: settings.search?.keySource || null
    },
    access: {
      pin: typeof settings.access?.pin === "string" ? settings.access.pin.trim() : "",
      pinSource: settings.access?.pinSource || null
    }
  };
}

function normalizeProfiles(input = {}) {
  const profiles = {};
  for (const [id, fallback] of Object.entries(DEFAULT_PROFILES)) {
    const profile = input?.[id] || {};
    profiles[id] = {
      label: cleanModel(profile.label, fallback.label),
      description: cleanModel(profile.description, fallback.description),
      llm: {
        baseUrl: cleanModel(profile.llm?.baseUrl, fallback.llm.baseUrl),
        model: cleanModel(profile.llm?.model, fallback.llm.model)
      },
      minimax: {
        tts: cleanModel(profile.minimax?.tts, fallback.minimax.tts),
        image: cleanModel(profile.minimax?.image, fallback.minimax.image),
        music: cleanModel(profile.minimax?.music, fallback.minimax.music),
        englishVoice: cleanModel(profile.minimax?.englishVoice, fallback.minimax.englishVoice),
        chineseVoice: cleanModel(profile.minimax?.chineseVoice, fallback.minimax.chineseVoice),
        podcastHostAVoice: cleanModel(profile.minimax?.podcastHostAVoice, fallback.minimax.podcastHostAVoice || DEFAULT_MINIMAX.podcastHostAVoice),
        podcastHostBVoice: cleanModel(profile.minimax?.podcastHostBVoice, fallback.minimax.podcastHostBVoice || DEFAULT_MINIMAX.podcastHostBVoice),
        musicTrackCount: clampTrackCount(profile.minimax?.musicTrackCount, fallback.minimax.musicTrackCount)
      },
      search: {
        provider: "tavily"
      }
    };
  }
  return profiles;
}

function cleanModel(value, fallback) {
  const text = typeof value === "string" ? value.trim() : "";
  return text || fallback;
}

function normalizeOptionalSecret(value, label) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return "";
  if (/^https?:\/\//i.test(text)) {
    throw new Error(`${label} should be the actual API key, not a documentation URL.`);
  }
  return text;
}

function normalizeTextModel(value, llmModel, fallback) {
  const text = typeof value === "string" ? value.trim() : "";
  if (text === DEFAULT_MODELS.text && cleanModel(llmModel, "")) {
    return cleanModel(llmModel, fallback);
  }
  return text || fallback || DEFAULT_LLM.model;
}

function normalizeXiaomiModel(value, fallback) {
  const text = typeof value === "string" ? value.trim() : "";
  const model = text || fallback || "";
  const canonical = new Map([
    ...DEFAULT_XIAOMI.textModels.map((name) => [name.toLowerCase(), name]),
    ...DEFAULT_XIAOMI.ttsModels.map((name) => [name.toLowerCase(), name])
  ]);
  return canonical.get(model.toLowerCase()) || model;
}

function normalizeProvider(value, fallback, allowed) {
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  return allowed.includes(text) ? text : fallback;
}

function clampTrackCount(value, fallback = 3) {
  const count = Number(value);
  if (!Number.isFinite(count)) return fallback;
  return Math.max(3, Math.min(4, Math.round(count)));
}

async function writeLocalSettings(settings) {
  const data = {
    activeProfile: settings.activeProfile,
    provider: settings.provider,
    profiles: settings.profiles,
    minimaxApiKey: settings.minimaxApiKey,
    models: settings.models,
    minimax: settings.minimax,
    llm: {
      apiKey: settings.llm.apiKey,
      baseUrl: settings.llm.baseUrl,
      model: settings.llm.model
    },
    xiaomi: {
      apiKey: settings.xiaomi?.apiKey || "",
      ttsApiKey: settings.xiaomi?.ttsApiKey || settings.xiaomi?.apiKey || "",
      baseUrl: settings.xiaomi?.baseUrl || DEFAULT_XIAOMI.baseUrl,
      ttsBaseUrl: settings.xiaomi?.ttsBaseUrl || DEFAULT_XIAOMI.ttsBaseUrl,
      textModel: settings.xiaomi?.textModel || DEFAULT_XIAOMI.textModel,
      ttsModel: settings.xiaomi?.ttsModel || DEFAULT_XIAOMI.ttsModel,
      voice: settings.xiaomi?.voice || DEFAULT_XIAOMI.voice,
      podcastHostAVoice: settings.xiaomi?.podcastHostAVoice || DEFAULT_XIAOMI.podcastHostAVoice,
      podcastHostBVoice: settings.xiaomi?.podcastHostBVoice || DEFAULT_XIAOMI.podcastHostBVoice
    },
    google: {
      apiKey: settings.google?.apiKey || "",
      baseUrl: settings.google?.baseUrl || DEFAULT_GOOGLE.baseUrl,
      imageModel: settings.google?.imageModel || DEFAULT_GOOGLE.imageModel,
      ttsModel: settings.google?.ttsModel || DEFAULT_GOOGLE.ttsModel,
      voice: settings.google?.voice || DEFAULT_GOOGLE.voice,
      podcastHostAVoice: settings.google?.podcastHostAVoice || DEFAULT_GOOGLE.podcastHostAVoice,
      podcastHostBVoice: settings.google?.podcastHostBVoice || DEFAULT_GOOGLE.podcastHostBVoice
    },
    media: settings.media,
    search: {
      tavilyApiKey: settings.search.tavilyApiKey
    },
    access: {
      pin: settings.access.pin
    }
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

function normalizeLlmModel(model, baseUrl) {
  const text = String(model || "").trim();
  if (/dashscope\.aliyuncs\.com/i.test(String(baseUrl || "")) && text.startsWith("openai/")) {
    return text.slice("openai/".length);
  }
  return text || DEFAULT_LLM.model;
}

module.exports = {
  DEFAULT_LLM,
  DEFAULT_GOOGLE,
  DEFAULT_MODELS,
  DEFAULT_MINIMAX,
  DEFAULT_PROFILES,
  DEFAULT_XIAOMI,
  clearSavedApiKey,
  clearSavedGoogleApiKey,
  clearSavedLlmApiKey,
  clearSavedTavilyApiKey,
  clearSavedXiaomiApiKey,
  getEffectiveSettings,
  getSettingsSummary,
  readLocalSettings,
  saveSettings,
  testLlmConnection,
  testGoogleConnection,
  testMiniMaxConnection,
  testTavilyConnection,
  testXiaomiConnection
};
