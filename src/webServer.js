#!/usr/bin/env node

const crypto = require("node:crypto");
const { execFile } = require("node:child_process");
const http = require("node:http");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { promisify } = require("node:util");
const { generateStoryWorkflow } = require("./storyWorkflow");
const { createPureStory, createStoryOutline, getLlmConfig, reviseStoryDraft } = require("./llmStoryPlanner");
const { renderMarkdown } = require("./renderers");
const { MINIMAX_MUSIC_MODEL } = require("./minimaxDefaults");
const {
  clearSavedApiKey,
  clearSavedGoogleApiKey,
  clearSavedLlmApiKey,
  clearSavedTavilyApiKey,
  clearSavedXiaomiApiKey,
  DEFAULT_MODELS,
  getEffectiveSettings,
  getSettingsSummary,
  saveSettings,
  testLlmConnection,
  testGoogleConnection,
  testMiniMaxConnection,
  testTavilyConnection,
  testXiaomiConnection
} = require("./settingsStore");
const { listStoryPresets } = require("./storyPresets");
const { searchTopicContext } = require("./tavilySearch");
const { getVideoTemplate, listVideoTemplates } = require("./videoTemplates");
const { slugify, ensureDir } = require("./utils");
const { classifyError } = require("./errorClassifier");
const { createStages, firstFailedStage, markStage, summarizeStageCounts } = require("./jobStages");

const PORT = Number(process.env.PORT || 3001);
const HOST = process.env.HOST || "0.0.0.0";
const ROOT = path.resolve(".");
const OUTPUT_ROOT = path.join(ROOT, "outputs");
const DIST_ROOT = path.join(ROOT, "dist");
const ACCESS_COOKIE = "EchoEnglishAccess";
const execFileAsync = promisify(execFile);
const jobs = new Map();
const persistTimers = new Map();

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "GET" && url.pathname === "/api/access/status") {
      const access = await getAccessState(req, url);
      return sendJson(res, {
        protected: access.protected,
        authenticated: access.authenticated
      }, access.authenticated || !access.protected ? 200 : 401);
    }

    if (req.method === "POST" && url.pathname === "/api/access/login") {
      const access = await getAccessState(req, url);
      if (!access.protected) {
        return sendJson(res, { ok: true, message: "Access PIN is not configured." });
      }
      const body = await readJson(req);
      const pin = String(body.pin || "").trim();
      if (pin !== access.pin) {
        return sendJson(res, { error: "Invalid PIN." }, 401);
      }
      setAccessCookie(res, access.pin);
      return sendJson(res, { ok: true, message: "Access granted." });
    }

    const access = await getAccessState(req, url);
    if (access.protected && !access.authenticated) {
      if (req.method === "GET" && acceptsHtml(req)) {
        return sendHtml(res, renderAccessPage());
      }
      return sendJson(res, { error: "Access PIN required." }, 401);
    }

    if (req.method === "GET" && url.pathname === "/") {
      if (url.searchParams.get("output")) {
        return redirect(res, `/preview?output=${encodeURIComponent(url.searchParams.get("output"))}`);
      }
      if (url.searchParams.get("jobId")) {
        return redirect(res, `/status?jobId=${encodeURIComponent(url.searchParams.get("jobId"))}`);
      }
      return redirect(res, "/generate");
    }

    if (req.method === "GET" && url.pathname === "/api/config") {
      const settings = await getSettingsSummary();
      const llm = await getLlmConfig();
      return sendJson(res, {
        hasMiniMaxKey: settings.hasApiKey,
        hasLlmKey: settings.llm.hasApiKey,
        hasSearchKey: settings.search.hasTavilyKey,
        hasXiaomiKey: settings.xiaomi?.hasApiKey || false,
        hasGoogleKey: settings.google?.hasApiKey || false,
        defaultProvider: "minimax",
        provider: settings.provider || "minimax",
        media: settings.media,
        llm: {
          configured: Boolean(llm.apiKey),
          baseUrl: llm.baseUrl,
          model: llm.model
        },
        xiaomi: {
          configured: Boolean(settings.xiaomi?.hasApiKey),
          baseUrl: settings.xiaomi?.baseUrl,
          textModel: settings.xiaomi?.textModel,
          ttsModel: settings.xiaomi?.ttsModel
        },
        google: {
          configured: Boolean(settings.google?.hasApiKey),
          baseUrl: settings.google?.baseUrl,
          imageModel: settings.google?.imageModel,
          ttsModel: settings.google?.ttsModel,
          voice: settings.google?.voice
        },
        search: {
          configured: Boolean(settings.search.hasTavilyKey),
          provider: "tavily",
          keySource: settings.search.keySource
        },
        settings,
        presets: listStoryPresets(),
        videoTemplates: listVideoTemplates()
      });
    }

    if (req.method === "GET" && url.pathname === "/api/settings") {
      return sendJson(res, await getSettingsSummary());
    }

    if (req.method === "POST" && url.pathname === "/api/settings") {
      const body = await readJson(req);
      try {
        return sendJson(res, await saveSettings(body));
      } catch (error) {
        return sendJson(res, { error: error.message }, 400);
      }
    }

    if (req.method === "POST" && url.pathname === "/api/settings/test") {
      const body = await readJson(req);
      const result = await testMiniMaxConnection(body);
      return sendJson(res, result, result.ok ? 200 : 400);
    }

    if (req.method === "POST" && url.pathname === "/api/settings/llm-test") {
      const body = await readJson(req);
      const result = await testLlmConnection(body);
      return sendJson(res, result, result.ok ? 200 : 400);
    }

    if (req.method === "POST" && url.pathname === "/api/settings/tavily-test") {
      const body = await readJson(req);
      const result = await testTavilyConnection(body);
      return sendJson(res, result, result.ok ? 200 : 400);
    }

    if (req.method === "DELETE" && url.pathname === "/api/settings/key") {
      return sendJson(res, await clearSavedApiKey());
    }

    if (req.method === "DELETE" && url.pathname === "/api/settings/llm-key") {
      return sendJson(res, await clearSavedLlmApiKey());
    }

    if (req.method === "DELETE" && url.pathname === "/api/settings/tavily-key") {
      return sendJson(res, await clearSavedTavilyApiKey());
    }

    if (req.method === "POST" && url.pathname === "/api/settings/xiaomi-test") {
      const body = await readJson(req);
      const result = await testXiaomiConnection(body);
      return sendJson(res, result, result.ok ? 200 : 400);
    }

    if (req.method === "DELETE" && url.pathname === "/api/settings/xiaomi-key") {
      return sendJson(res, await clearSavedXiaomiApiKey());
    }

    if (req.method === "POST" && url.pathname === "/api/settings/google-test") {
      const body = await readJson(req);
      const result = await testGoogleConnection(body);
      return sendJson(res, result, result.ok ? 200 : 400);
    }

    if (req.method === "DELETE" && url.pathname === "/api/settings/google-key") {
      return sendJson(res, await clearSavedGoogleApiKey());
    }

    if (req.method === "GET" && url.pathname === "/api/recent-outputs") {
      return sendJson(res, { items: await listRecentOutputs() });
    }

    if (req.method === "POST" && url.pathname === "/api/generate-story-video") {
      const body = await readJson(req);
      return await startStoryJob(res, body);
    }

    if (req.method === "POST" && url.pathname === "/api/story-draft") {
      const body = await readJson(req);
      const topic = String(body.topic || "A Rainy Day in London").trim() || "A Rainy Day in London";
      const minutes = clampMinutes(body.minutes);
      const template = getVideoTemplate(body.templateId || body.template?.id);
      const { outline, searchContext } = await buildSearchBackedOutline(topic, minutes, template);
      const draft = await createPureStory({
        topic,
        targetDurationMinutes: minutes,
        level: "beginner",
        annotationStyle: "zh-brief",
        outline,
        template
      });
      const autosaved = await saveStoryDraft({ topic, template, outline, draft, searchContext, revisionNote: null });
      return sendJson(res, {
        outline,
        draft,
        searchContext,
        imageTarget: countDraftImages(draft),
        musicTarget: 3,
        template,
        autosaved
      });
    }

    if (req.method === "POST" && url.pathname === "/api/revise-story-draft") {
      const body = await readJson(req);
      const topic = String(body.topic || body.draft?.topic || "Story Video").trim() || "Story Video";
      const minutes = clampMinutes(body.minutes);
      const template = getVideoTemplate(body.templateId || body.template?.id || body.draft?.template?.id);
      const draft = await reviseStoryDraft({
        topic,
        targetDurationMinutes: minutes,
        draft: body.draft,
        feedback: body.feedback,
        template
      });
      const autosaved = await saveStoryDraft({
        topic,
        template,
        outline: draft.outline || body.draft?.outline || null,
        draft,
        searchContext: draft.outline?.searchContext || body.draft?.outline?.searchContext || null,
        revisionNote: body.feedback || null
      });
      return sendJson(res, {
        draft,
        imageTarget: countDraftImages(draft),
        musicTarget: 3,
        template,
        autosaved
      });
    }

    if (req.method === "POST" && url.pathname === "/api/story-outline") {
      const body = await readJson(req);
      const topic = String(body.topic || "A Rainy Day in London").trim() || "A Rainy Day in London";
      const minutes = clampMinutes(body.minutes);
      const template = getVideoTemplate(body.templateId || body.template?.id);
      const { outline, searchContext } = await buildSearchBackedOutline(topic, minutes, template);
      return sendJson(res, {
        outline,
        searchContext,
        template
      });
    }

    if (req.method === "GET" && url.pathname === "/api/jobs/latest") {
      return sendJson(res, await serializeLatestJob());
    }

    if (req.method === "POST" && url.pathname.startsWith("/api/jobs/") && url.pathname.endsWith("/continue")) {
      const id = url.pathname.split("/").at(-2);
      return await continueStoryJob(res, id);
    }

    if (req.method === "GET" && url.pathname.startsWith("/api/jobs/")) {
      const id = url.pathname.split("/").pop();
      return sendJson(res, await serializeJob(id));
    }

    if (req.method === "GET" && url.pathname === "/api/media-info") {
      return sendJson(res, await getMediaInfo(url.searchParams.get("path")));
    }

    if ((req.method === "GET" || req.method === "HEAD") && url.pathname.startsWith("/outputs/")) {
      return serveOutputFile(req, res, url.pathname);
    }

    if (req.method === "GET" && await serveFrontend(res, url.pathname)) {
      return;
    }

    return sendJson(res, { error: "Not found" }, 404);
  } catch (error) {
    return sendJson(res, { error: error.message }, 500);
  }
});

async function startStoryJob(res, body) {
  const topic = String(body.topic || "A Rainy Day in London").trim() || "A Rainy Day in London";
  const minutes = clampMinutes(body.minutes);
  const settings = await getEffectiveSettings();
  const validation = validateGenerationSettings(settings);
  if (validation) return sendJson(res, { error: validation }, 400);

  const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const slug = slugify(topic);
  const logs = [];
  const confirmedOutline = normalizeOutlineInput(body.outline);
  const confirmedDraft = normalizeStoryDraftInput(body.storyDraft);
  const template = getVideoTemplate(body.templateId || body.template?.id || confirmedDraft?.template?.id || confirmedOutline?.template?.id);
  const job = {
    id,
    status: "queued",
    topic,
    slug,
    minutes,
    logs,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    stages: createStages(),
    recoverable: false,
    failedStage: null,
    errorType: null,
    request: {
      topic,
      minutes,
      templateId: template?.id || null,
      outline: confirmedOutline,
      storyDraft: confirmedDraft
    },
    result: null,
    error: null
  };
  attachPersistentLogs(job);
  markStage(job.stages, "draft", confirmedDraft ? "completed" : "pending", {
    counts: confirmedDraft ? {
      scenes: confirmedDraft.sections?.length || 0,
      sentences: countDraftImages(confirmedDraft)
    } : null
  });
  jobs.set(id, job);
  await persistJob(job);

  runStoryJob(job);

  return sendJson(res, {
    id,
    status: job.status,
    topic,
    minutes,
    outputBase: `/outputs/${slug}/`
  }, 202);
}

async function continueStoryJob(res, id) {
  const job = await getJob(id);
  if (!job) {
    return sendJson(res, { error: "Job not found" }, 404);
  }
  if (job.status === "running" || job.status === "queued") {
    return sendJson(res, serializeJobObject(job), 409);
  }
  if (job.status === "completed") {
    return sendJson(res, { error: "This job is already completed." }, 400);
  }

  const settings = await getEffectiveSettings();
  const validation = validateGenerationSettings(settings);
  if (validation) return sendJson(res, { error: validation }, 400);

  attachPersistentLogs(job);
  job.stages = createStages(job.stages);
  job.status = "queued";
  job.error = null;
  job.errorType = null;
  job.recoverable = false;
  job.failedStage = null;
  job.updatedAt = new Date().toISOString();
  job.logs.push(`[${new Date().toISOString()}] Continue requested. Reusing saved draft, cached audio, existing images, and music files when available.`);
  await persistJob(job);
  jobs.set(job.id, job);
  runStoryJob(job);
  return sendJson(res, serializeJobObject(job), 202);
}

function runStoryJob(job) {
  attachPersistentLogs(job);
  job.stages = createStages(job.stages);
  setImmediate(async () => {
    job.status = "running";
    job.startedAt = job.startedAt || new Date().toISOString();
    job.updatedAt = new Date().toISOString();
    await persistJob(job);
    try {
      const settings = await getEffectiveSettings();
      const validation = validateGenerationSettings(settings);
      if (validation) throw new Error(validation);

      const ttsProvider = settings.media?.ttsProvider || (settings.provider === "xiaomi" ? "xiaomi" : "minimax");
      const imageMode = settings.media?.imageProvider || "minimax";
      const template = getVideoTemplate(job.request?.templateId || job.request?.storyDraft?.template?.id || job.request?.outline?.template?.id);
      const confirmedDraft = normalizeStoryDraftInput(job.request?.storyDraft);
      let storyOutline = normalizeOutlineInput(job.request?.outline);

      if (!confirmedDraft && !storyOutline?.searchContext) {
        job.logs.push(`[${new Date().toISOString()}] Searching topic context with Tavily`);
        const searchContext = await searchTopicContext({
          topic: job.topic,
          apiKey: settings.search.tavilyApiKey,
          searchHint: template.searchHint
        });
        storyOutline = {
          ...(storyOutline || {}),
          searchContext,
          source: storyOutline?.source || "tavily",
          template
        };
        job.request.outline = storyOutline;
        await persistJob(job);
      }

      job.result = await generateStoryWorkflow({
        topic: job.topic,
        minutes: job.minutes,
        outputRoot: OUTPUT_ROOT,
        ttsProvider,
        imageMode,
        apiKey: settings.minimaxApiKey,
        minimaxModel: settings.models.tts,
        minimaxVoice: settings.minimax.englishVoice,
        minimaxCnVoice: settings.minimax.chineseVoice,
        imageModel: settings.models.image,
        googleImageModel: settings.google?.imageModel,
        musicMode: "minimax",
        musicModel: settings.models.music || MINIMAX_MUSIC_MODEL,
        musicCount: settings.minimax.musicTrackCount || 3,
        musicVolume: 0.12,
        storyMode: "pure-story",
        template,
        storyOutline,
        storyDraft: confirmedDraft,
        logs: job.logs,
        onStage: async (stageId, status, patch) => {
          markStage(job.stages, stageId, status, patch);
          job.failedStage = firstFailedStage(job.stages);
          job.recoverable = Boolean(Object.values(job.stages).some((stage) => stage.status === "failed" && stage.recoverable));
          job.updatedAt = new Date().toISOString();
          await persistJob(job);
        }
      });
      job.status = "completed";
      job.error = null;
      job.errorType = null;
      job.recoverable = false;
      job.failedStage = null;
      job.completedAt = new Date().toISOString();
      job.updatedAt = new Date().toISOString();
      await persistJob(job);
    } catch (error) {
      const classification = classifyError(error);
      job.status = classification.recoverable ? "failed_recoverable" : "failed";
      job.error = error.message;
      job.errorType = classification.type;
      job.recoverable = classification.recoverable;
      job.failedStage = firstFailedStage(job.stages);
      job.updatedAt = new Date().toISOString();
      job.logs.push(`[${new Date().toISOString()}] Error: ${error.message}`);
      await persistJob(job);
    }
  });
}

function validateGenerationSettings(settings) {
  if (!settings.minimaxApiKey) {
    return "MiniMax API key is required for background music. Open Settings and save your MiniMax API key before generating videos.";
  }
  if ((settings.provider === "xiaomi" || settings.media?.ttsProvider === "xiaomi") && !settings.xiaomi?.apiKey) {
    return "Xiaomi MiMo API key is required when Xiaomi provider is active. Open Settings and save your Xiaomi key.";
  }
  if ((settings.media?.ttsProvider === "google" || settings.media?.imageProvider === "google") && !settings.google?.apiKey) {
    return "Google API key is required when Google TTS or Imagen is selected. Open Settings and save your Google key.";
  }
  if (settings.provider !== "xiaomi" && !settings.llm.apiKey) {
    return "LLM API key is required. Open Settings and save your LLM API key before generating story videos.";
  }
  if (!settings.search.tavilyApiKey) {
    return "Tavily API key is required. Open Settings and save your Tavily API key before generating story videos.";
  }
  return null;
}

async function buildSearchBackedOutline(topic, minutes, template = null) {
  const settings = await getEffectiveSettings();
  if (!settings.search.tavilyApiKey) {
    throw new Error("Tavily API key is required for search-backed story planning. Open Settings and save a Tavily key.");
  }
  const searchContext = await searchTopicContext({ topic, apiKey: settings.search.tavilyApiKey, searchHint: template?.searchHint });
  const outline = await createStoryOutline({ topic, minutes, searchContext, template });
  return { outline, searchContext };
}

async function serializeJob(id) {
  const job = await getJob(id);
  if (!job) {
    return { error: "Job not found" };
  }

  return serializeJobObject(job);
}

async function serializeLatestJob() {
  const activeJobs = [...jobs.values()].sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)));
  if (activeJobs[0]) return serializeJobObject(activeJobs[0]);
  const persisted = await listPersistedJobs();
  if (persisted[0]) return serializeJobObject(persisted[0]);
  return { error: "Job not found" };
}

function serializeJobObject(job) {
  const base = `/outputs/${job.slug}/`;
  return {
    id: job.id,
    status: job.status,
    topic: job.topic,
    slug: job.slug,
    minutes: job.minutes,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    recoverable: Boolean(job.recoverable),
    failedStage: job.failedStage || firstFailedStage(job.stages),
    errorType: job.errorType || null,
    stages: createStages(job.stages),
    counts: summarizeStageCounts(job.stages),
    logs: job.logs,
    error: job.error,
    outputs: {
      video: `${base}final.mp4`,
      script: `${base}script.md`,
      subtitles: `${base}subtitles.srt`,
      audio: `${base}audio.wav`,
      music: job.result?.musicSummary ? `${base}music/background.mp3` : null,
      imagePrompts: `${base}image-prompts.md`,
      scriptJson: `${base}script.json`,
      jobState: `${base}job-state.json`,
      audioManifest: `${base}audio-manifest.json`,
      imageManifest: `${base}image-manifest.json`,
      musicManifest: `${base}music-manifest.json`,
      qualityReport: `${base}quality-report.json`
    }
  };
}

async function getJob(id) {
  if (!id) return null;
  const liveJob = jobs.get(id);
  if (liveJob) return liveJob;
  const persisted = await readPersistedJobById(id);
  if (persisted) {
    normalizePersistedJob(persisted);
    attachPersistentLogs(persisted);
    jobs.set(persisted.id, persisted);
  }
  return persisted;
}

function attachPersistentLogs(job) {
  if (!job || job._logsAttached) return;
  if (!Array.isArray(job.logs)) job.logs = [];
  const originalPush = Array.prototype.push;
  Object.defineProperty(job.logs, "push", {
    configurable: true,
    value(...items) {
      const length = originalPush.apply(this, items);
      job.updatedAt = new Date().toISOString();
      persistJobSoon(job);
      return length;
    }
  });
  job._logsAttached = true;
}

function persistJobSoon(job) {
  if (!job?.id) return;
  clearTimeout(persistTimers.get(job.id));
  persistTimers.set(job.id, setTimeout(() => {
    persistTimers.delete(job.id);
    persistJob(job).catch(() => {});
  }, 250));
}

async function persistJob(job) {
  if (!job?.slug) return;
  const outputDir = path.join(OUTPUT_ROOT, job.slug);
  await ensureDir(outputDir);
  const persisted = {
    id: job.id,
    status: job.status,
    topic: job.topic,
    slug: job.slug,
    minutes: job.minutes,
    createdAt: job.createdAt,
    startedAt: job.startedAt || null,
    completedAt: job.completedAt || null,
    updatedAt: new Date().toISOString(),
    error: job.error || null,
    errorType: job.errorType || null,
    recoverable: Boolean(job.recoverable),
    failedStage: job.failedStage || firstFailedStage(job.stages),
    stages: createStages(job.stages),
    request: job.request || null,
    logs: Array.isArray(job.logs) ? [...job.logs] : [],
    result: job.result ? {
      durationSeconds: job.result.durationSeconds || null,
      files: job.result.files || null,
      audioSummary: summarizeMediaResult(job.result.audioSummary),
      musicSummary: summarizeMediaResult(job.result.musicSummary),
      videoSummary: summarizeMediaResult(job.result.videoSummary),
      qualityReport: job.result.qualityReport || null
    } : null
  };
  job.updatedAt = persisted.updatedAt;
  await fs.writeFile(path.join(outputDir, "job-state.json"), `${JSON.stringify(persisted, null, 2)}\n`, "utf8");
}

function summarizeMediaResult(value) {
  if (!value || typeof value !== "object") return value || null;
  return {
    provider: value.provider || null,
    model: value.model || null,
    durationSeconds: value.durationSeconds || null,
    reused: value.reused || false,
    tracks: Array.isArray(value.tracks) ? value.tracks.length : undefined
  };
}

async function readPersistedJobById(id) {
  const jobs = await listPersistedJobs();
  return jobs.find((job) => job.id === id) || null;
}

async function listPersistedJobs() {
  let entries = [];
  try {
    entries = await fs.readdir(OUTPUT_ROOT, { withFileTypes: true });
  } catch {
    return [];
  }
  const items = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const file = path.join(OUTPUT_ROOT, entry.name, "job-state.json");
    const job = await readOptionalJson(file);
    if (!job?.id) continue;
    normalizePersistedJob(job);
    items.push({
      ...job,
      slug: job.slug || entry.name,
      stages: createStages(job.stages),
      logs: Array.isArray(job.logs) ? job.logs : []
    });
  }
  return items.sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)));
}

function normalizePersistedJob(job) {
  job.stages = createStages(job.stages);
  job.logs = Array.isArray(job.logs) ? job.logs : [];
  if ((job.status === "failed" || job.status === "failed_recoverable") && job.error) {
    const classification = classifyError(job.error);
    job.errorType = job.errorType || classification.type;
    job.recoverable = Boolean(job.recoverable || classification.recoverable);
    if (classification.recoverable) job.status = "failed_recoverable";
  }
  if (!job.failedStage) {
    job.failedStage = firstFailedStage(job.stages) || inferFailedStageFromLogs(job.logs, job.error);
  }
  if (job.failedStage && job.stages[job.failedStage]?.status !== "failed" && job.error) {
    const classification = classifyError(job.error);
    const completedBefore = {
      images: ["draft", "script-assets", "tts"],
      music: ["draft", "script-assets", "tts", "images"],
      compose: ["draft", "script-assets", "tts", "images", "music"],
      quality: ["draft", "script-assets", "tts", "images", "music", "compose"]
    }[job.failedStage] || [];
    completedBefore.forEach((stageId) => markStage(job.stages, stageId, "completed"));
    markStage(job.stages, job.failedStage, "failed", {
      error: job.error,
      errorType: classification.type,
      recoverable: classification.recoverable
    });
  }
}

function inferFailedStageFromLogs(logs = [], error = "") {
  const text = `${logs.join("\n")}\n${error}`.toLowerCase();
  if (text.includes("generating scene images") || text.includes("image api")) return "images";
  if (text.includes("background music") || text.includes("music")) return "music";
  if (text.includes("composing final mp4") || text.includes("encoding final mp4")) return "compose";
  if (text.includes("quality report")) return "quality";
  if (text.includes("generating audio") || /audio \d+\/\d+/.test(text)) return "tts";
  if (text.includes("script.json") || text.includes("subtitles")) return "script-assets";
  return null;
}

async function listRecentOutputs(limit = 8) {
  let entries = [];
  try {
    entries = await fs.readdir(OUTPUT_ROOT, { withFileTypes: true });
  } catch {
    return [];
  }

  const items = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const slug = entry.name;
    const dir = path.join(OUTPUT_ROOT, slug);
    const video = path.join(dir, "final.mp4");
    try {
      const stat = await fs.stat(video);
      const scriptJson = await readOptionalJson(path.join(dir, "script.json"));
      const title = scriptJson?.title || titleFromSlug(slug);
      items.push({
        slug,
        title,
        updatedAt: stat.mtime.toISOString(),
        outputs: await outputPathsForSlug(slug)
      });
    } catch {
      // Skip incomplete output folders.
    }
  }

  return items
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, limit);
}

async function readOptionalJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return null;
  }
}

async function saveStoryDraft({ topic, template, outline, draft, searchContext, revisionNote }) {
  const slug = slugify(topic || draft?.topic || "story-draft");
  const outputDir = path.join(OUTPUT_ROOT, slug);
  await ensureDir(outputDir);
  const savedAt = new Date().toISOString();
  const draftJson = {
    savedAt,
    slug,
    topic: topic || draft?.topic || "",
    template: template || draft?.template || outline?.template || null,
    outline: outline || draft?.outline || null,
    searchContext: searchContext || outline?.searchContext || draft?.outline?.searchContext || null,
    revisionNote: typeof revisionNote === "string" && revisionNote.trim() ? revisionNote.trim() : null,
    draft
  };
  const draftJsonPath = path.join(outputDir, "draft.json");
  const draftMdPath = path.join(outputDir, "draft.md");
  await fs.writeFile(draftJsonPath, `${JSON.stringify(draftJson, null, 2)}\n`, "utf8");
  await fs.writeFile(draftMdPath, renderMarkdown(draft), "utf8");
  return {
    savedAt,
    draftJson: `/outputs/${slug}/draft.json`,
    draftMd: `/outputs/${slug}/draft.md`
  };
}

async function outputPathsForSlug(slug) {
  const base = `/outputs/${slug}/`;
  const musicPath = path.join(OUTPUT_ROOT, slug, "music", "background.mp3");
  return {
    video: `${base}final.mp4`,
    script: `${base}script.md`,
    subtitles: `${base}subtitles.srt`,
    audio: `${base}audio.wav`,
    music: await fileExists(musicPath) ? `${base}music/background.mp3` : null,
    draftJson: await fileExists(path.join(OUTPUT_ROOT, slug, "draft.json")) ? `${base}draft.json` : null,
    draftMd: await fileExists(path.join(OUTPUT_ROOT, slug, "draft.md")) ? `${base}draft.md` : null,
    imagePrompts: `${base}image-prompts.md`,
    scriptJson: `${base}script.json`,
    jobState: await fileExists(path.join(OUTPUT_ROOT, slug, "job-state.json")) ? `${base}job-state.json` : null,
    audioManifest: await fileExists(path.join(OUTPUT_ROOT, slug, "audio-manifest.json")) ? `${base}audio-manifest.json` : null,
    imageManifest: await fileExists(path.join(OUTPUT_ROOT, slug, "image-manifest.json")) ? `${base}image-manifest.json` : null,
    musicManifest: await fileExists(path.join(OUTPUT_ROOT, slug, "music-manifest.json")) ? `${base}music-manifest.json` : null,
    qualityReport: await fileExists(path.join(OUTPUT_ROOT, slug, "quality-report.json")) ? `${base}quality-report.json` : null
  };
}

async function getMediaInfo(outputPath) {
  const target = resolveOutputPath(outputPath);
  if (!target) {
    throw new Error("Invalid media path.");
  }
  const { stdout } = await execFileAsync("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    target
  ], {
    maxBuffer: 1024 * 1024
  });
  const durationSeconds = Number(stdout.trim());
  return {
    path: outputPath,
    durationSeconds: Number.isFinite(durationSeconds) ? durationSeconds : 0
  };
}

function resolveOutputPath(outputPath) {
  const text = String(outputPath || "");
  if (!text.startsWith("/outputs/")) return null;
  const relative = decodeURIComponent(text).replace(/^\/outputs\//, "");
  const target = path.resolve(OUTPUT_ROOT, relative);
  const insideOutputRoot = target === OUTPUT_ROOT || target.startsWith(`${OUTPUT_ROOT}${path.sep}`);
  return insideOutputRoot ? target : null;
}

async function fileExists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

function titleFromSlug(slug) {
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

async function serveOutputFile(req, res, pathname) {
  const target = resolveOutputPath(pathname);
  if (!target) {
    return sendJson(res, { error: "Invalid output path" }, 403);
  }

  const stat = await fs.stat(target);
  if (!stat.isFile()) {
    return sendJson(res, { error: "Output path is not a file" }, 404);
  }

  const type = contentType(target);
  const range = req.headers.range;
  if (range && /^bytes=\d*-\d*$/.test(range)) {
    const parsed = parseRangeHeader(range, stat.size);
    if (!parsed) {
      res.writeHead(416, {
        "Content-Range": `bytes */${stat.size}`,
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-store"
      });
      return res.end();
    }

    const { start, end } = parsed;
    res.writeHead(206, {
      "Content-Type": type,
      "Content-Length": end - start + 1,
      "Content-Range": `bytes ${start}-${end}/${stat.size}`,
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store"
    });
    if (req.method === "HEAD") return res.end();
    return fsSync.createReadStream(target, { start, end }).pipe(res);
  }

  res.writeHead(200, {
    "Content-Type": type,
    "Content-Length": stat.size,
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-store"
  });
  if (req.method === "HEAD") return res.end();
  return fsSync.createReadStream(target).pipe(res);
}

function parseRangeHeader(range, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(range || ""));
  if (!match || size <= 0) return null;
  let start = match[1] === "" ? null : Number(match[1]);
  let end = match[2] === "" ? null : Number(match[2]);

  if (start === null && end === null) return null;
  if (start === null) {
    const suffixLength = Math.max(0, end || 0);
    if (!suffixLength) return null;
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    if (!Number.isFinite(start) || start < 0 || start >= size) return null;
    end = end === null || !Number.isFinite(end) ? size - 1 : Math.min(end, size - 1);
  }

  if (end < start) return null;
  return { start, end };
}

async function serveFrontend(res, pathname) {
  const safePath = decodeURIComponent(pathname).replace(/^\/+/, "");
  const requested = safePath ? path.resolve(DIST_ROOT, safePath) : path.join(DIST_ROOT, "index.html");
  const insideDist = requested === DIST_ROOT || requested.startsWith(`${DIST_ROOT}${path.sep}`);

  if (insideDist && await fileExists(requested)) {
    const stat = await fs.stat(requested);
    if (stat.isFile()) {
      return serveFile(res, requested, cacheHeaderFor(requested));
    }
  }

  if (path.extname(pathname)) return false;

  const indexPath = path.join(DIST_ROOT, "index.html");
  if (await fileExists(indexPath)) {
    return serveFile(res, indexPath, "no-store");
  }

  sendHtml(res, "<!doctype html><p>Frontend build not found. Run <code>npm run build</code>, then restart <code>npm run web</code>.</p>");
  return true;
}

async function serveFile(res, file, cacheControl = "no-store") {
  const data = await fs.readFile(file);
  res.writeHead(200, {
    "Content-Type": contentType(file),
    "Cache-Control": cacheControl
  });
  res.end(data);
  return true;
}

function cacheHeaderFor(file) {
  return path.basename(path.dirname(file)) === "assets" ? "public, max-age=31536000, immutable" : "no-store";
}

function renderSettingsPage() {
  const defaults = DEFAULT_MODELS;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Settings · English Story Video Generator</title>
  <style>
    :root {
      --bg: #f4f6f8;
      --surface: #ffffff;
      --text: #16202a;
      --muted: #627184;
      --line: #dbe3ec;
      --blue: #0a4597;
      --green: #16845c;
      --red: #bd3f2f;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
    }
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
      min-height: 72px;
      padding: 14px 22px;
      background: #fff;
      border-bottom: 1px solid var(--line);
    }
    h1, h2, p { margin: 0; }
    h1 { font-size: 20px; }
    .subtitle { color: var(--muted); font-size: 13px; margin-top: 4px; }
    .nav-link {
      display: inline-flex;
      align-items: center;
      min-height: 34px;
      border: 1px solid #cfe0ff;
      border-radius: 6px;
      background: #f4f8ff;
      color: var(--blue);
      padding: 0 12px;
      font-size: 13px;
      font-weight: 850;
      text-decoration: none;
      white-space: nowrap;
    }
    main {
      max-width: 920px;
      margin: 0 auto;
      padding: 22px 16px 48px;
    }
    .panel {
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 18px;
      margin-bottom: 16px;
    }
    .panel h2 { font-size: 16px; margin-bottom: 10px; }
    .grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
    }
    label {
      display: block;
      margin: 12px 0 7px;
      color: #314154;
      font-size: 13px;
      font-weight: 750;
    }
    input {
      width: 100%;
      height: 42px;
      border: 1px solid #c9d4df;
      border-radius: 6px;
      padding: 0 10px;
      background: #fff;
      color: var(--text);
      font: inherit;
    }
    input:focus {
      border-color: #79a9f8;
      outline: 3px solid #dbeafe;
    }
    .hint {
      color: var(--muted);
      font-size: 12px;
      line-height: 1.45;
      margin-top: 6px;
    }
    .masked {
      display: inline-flex;
      min-height: 30px;
      align-items: center;
      padding: 5px 10px;
      border-radius: 999px;
      background: #eef2f7;
      color: #4a5a6b;
      font-size: 12px;
      font-weight: 800;
    }
    .masked.ok { background: #e7f5ee; color: var(--green); }
    .masked.bad { background: #fff0ec; color: var(--red); }
    .actions {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      margin-top: 16px;
    }
    button {
      height: 40px;
      border: 0;
      border-radius: 6px;
      padding: 0 14px;
      font: inherit;
      font-size: 13px;
      font-weight: 850;
      cursor: pointer;
    }
    .primary { background: var(--blue); color: #fff; }
    .secondary { background: #f4f8ff; color: var(--blue); border: 1px solid #cfe0ff; }
    .danger { background: #fff0ec; color: var(--red); border: 1px solid #ffd2c5; }
    .message {
      min-height: 42px;
      margin-top: 14px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: #f8fafc;
      color: #2d3748;
      padding: 11px;
      font-size: 13px;
      line-height: 1.45;
    }
    @media (max-width: 760px) {
      header { align-items: flex-start; flex-direction: column; }
      .grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>Settings</h1>
      <p class="subtitle">Configure the local MiniMax API key and global model defaults.</p>
    </div>
    <a class="nav-link" href="/generate">Back to Generator</a>
  </header>

  <main>
    <section class="panel">
      <h2>MiniMax API Key</h2>
      <span class="masked" id="keyStatus">Checking...</span>
      <label for="apiKey">API Key</label>
      <input id="apiKey" name="apiKey" type="password" placeholder="Paste a new MiniMax API key">
      <p class="hint">The saved key is stored only on this machine in settings.local.json. The page never echoes the full key back.</p>
      <div class="actions">
        <button class="primary" id="save" type="button">Save Settings</button>
        <button class="secondary" id="test" type="button">Test Connection</button>
        <button class="danger" id="clear" type="button">Clear Saved Key</button>
      </div>
      <div class="message" id="message">Ready.</div>
    </section>

    <section class="panel">
      <h2>Global Models</h2>
      <div class="grid">
        <div>
          <label for="textModel">Text Model</label>
          <input id="textModel" value="${escapeHtml(defaults.text)}">
        </div>
        <div>
          <label for="ttsModel">TTS Model</label>
          <input id="ttsModel" value="${escapeHtml(defaults.tts)}">
        </div>
        <div>
          <label for="imageModel">Image Model</label>
          <input id="imageModel" value="${escapeHtml(defaults.image)}">
        </div>
        <div>
          <label for="musicModel">Music Model</label>
          <input id="musicModel" value="${escapeHtml(defaults.music)}">
        </div>
      </div>
      <p class="hint">These are global defaults for future generation jobs. Background music is generated once per video and mixed quietly under the narration.</p>
    </section>
  </main>

  <script>
    const apiKey = document.getElementById("apiKey");
    const keyStatus = document.getElementById("keyStatus");
    const message = document.getElementById("message");
    const modelInputs = {
      text: document.getElementById("textModel"),
      tts: document.getElementById("ttsModel"),
      image: document.getElementById("imageModel"),
      music: document.getElementById("musicModel")
    };

    async function loadSettings() {
      const response = await fetch("/api/settings");
      const settings = await response.json();
      renderSettings(settings);
    }

    function renderSettings(settings) {
      keyStatus.textContent = settings.hasApiKey
        ? "Saved key: " + settings.maskedApiKey + " · " + (settings.keySource || "configured")
        : "No API key saved";
      keyStatus.className = "masked " + (settings.hasApiKey ? "ok" : "bad");
      Object.entries(settings.models || {}).forEach(([key, value]) => {
        if (modelInputs[key]) modelInputs[key].value = value;
      });
    }

    function readPayload() {
      return {
        minimaxApiKey: apiKey.value.trim(),
        models: {
          text: modelInputs.text.value.trim(),
          tts: modelInputs.tts.value.trim(),
          image: modelInputs.image.value.trim(),
          music: modelInputs.music.value.trim()
        }
      };
    }

    document.getElementById("save").addEventListener("click", async () => {
      message.textContent = "Saving settings...";
      const response = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(readPayload())
      });
      const result = await response.json();
      if (!response.ok || result.error) {
        message.textContent = result.error || "Failed to save settings.";
        return;
      }
      apiKey.value = "";
      renderSettings(result);
      message.textContent = "Settings saved.";
    });

    document.getElementById("test").addEventListener("click", async () => {
      message.textContent = "Testing MiniMax connection...";
      const response = await fetch("/api/settings/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ minimaxApiKey: apiKey.value.trim() })
      });
      const result = await response.json();
      message.textContent = result.ok ? result.message : result.error || "Connection test failed.";
    });

    document.getElementById("clear").addEventListener("click", async () => {
      message.textContent = "Clearing saved key...";
      const response = await fetch("/api/settings/key", { method: "DELETE" });
      const result = await response.json();
      renderSettings(result);
      apiKey.value = "";
      message.textContent = "Saved key cleared.";
    });

    loadSettings().catch((error) => {
      message.textContent = error.message;
    });
  </script>
</body>
</html>`;
}

function renderDashboard() {
  const presets = listStoryPresets();
  const presetOptions = [
    `<option value="">Custom topic - write your own</option>`,
    ...presets.map((preset) => `<option value="${escapeHtml(preset.title)}">${escapeHtml(preset.title)} · ${escapeHtml(preset.genre)}</option>`)
  ]
    .join("");
  const packageCards = presets
    .map((preset, index) => `
      <button class="package-card" type="button" data-title="${escapeHtml(preset.title)}">
        <span class="package-index">${String(index + 1).padStart(2, "0")}</span>
        <strong>${escapeHtml(preset.title)}</strong>
        <small>${escapeHtml(preset.genre)} · ${escapeHtml(preset.learningFocus)}</small>
      </button>`)
    .join("");
  const presetsJson = JSON.stringify(presets).replace(/</g, "\\u003c");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>English Story Video Generator</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f4f6f8;
      --surface: #ffffff;
      --surface-soft: #f8fafc;
      --text: #16202a;
      --muted: #627184;
      --line: #dbe3ec;
      --blue: #0a4597;
      --blue-deep: #073377;
      --orange: #f36b13;
      --green: #16845c;
      --red: #bd3f2f;
      --amber: #9a6910;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
    }
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 18px;
      min-height: 72px;
      padding: 14px 22px;
      background: #fff;
      border-bottom: 1px solid var(--line);
      position: sticky;
      top: 0;
      z-index: 5;
    }
    h1, h2, h3, p { margin: 0; }
    h1 { font-size: 20px; letter-spacing: 0; }
    .subtitle { color: var(--muted); font-size: 13px; margin-top: 4px; }
    .badge {
      display: inline-flex;
      align-items: center;
      min-height: 28px;
      padding: 5px 10px;
      border-radius: 999px;
      background: #eef2f7;
      color: #4a5a6b;
      font-size: 12px;
      font-weight: 750;
      white-space: nowrap;
    }
    .badge.completed { background: #e7f5ee; color: var(--green); }
    .badge.running, .badge.queued { background: #fff5dc; color: var(--amber); }
    .badge.failed { background: #fff0ec; color: var(--red); }
    .header-actions {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
      justify-content: flex-end;
    }
    .settings-link {
      display: inline-flex;
      align-items: center;
      min-height: 34px;
      border: 1px solid #cfe0ff;
      border-radius: 6px;
      background: #f4f8ff;
      color: var(--blue);
      padding: 0 12px;
      font-size: 13px;
      font-weight: 850;
      text-decoration: none;
      white-space: nowrap;
    }
    main {
      display: grid;
      grid-template-columns: minmax(330px, 420px) minmax(0, 1fr) minmax(300px, 380px);
      gap: 16px;
      padding: 16px;
      min-height: calc(100vh - 72px);
    }
    section, aside, .panel {
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: 8px;
    }
    .control-panel, .status-panel { padding: 16px; }
    .panel-heading {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 14px;
    }
    .panel-heading h2 { font-size: 15px; }
    .step {
      display: inline-grid;
      place-items: center;
      width: 25px;
      height: 25px;
      margin-right: 8px;
      border-radius: 999px;
      background: var(--blue);
      color: #fff;
      font-size: 13px;
      font-weight: 850;
    }
    label {
      display: block;
      margin: 14px 0 7px;
      color: #314154;
      font-size: 13px;
      font-weight: 750;
    }
    input, select {
      width: 100%;
      height: 42px;
      border: 1px solid #c9d4df;
      border-radius: 6px;
      padding: 0 10px;
      background: #fff;
      color: var(--text);
      font: inherit;
    }
    input:focus, select:focus {
      border-color: #79a9f8;
      outline: 3px solid #dbeafe;
    }
    .hint {
      margin-top: 6px;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.45;
    }
    .row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
    }
    .package-grid {
      display: grid;
      gap: 8px;
      max-height: 360px;
      overflow: auto;
      padding-right: 2px;
      margin-top: 10px;
    }
    .package-card {
      display: grid;
      grid-template-columns: 34px 1fr;
      grid-template-rows: auto auto;
      column-gap: 10px;
      width: 100%;
      border: 1px solid #d8e1ea;
      border-radius: 6px;
      padding: 10px;
      background: #fff;
      color: var(--text);
      text-align: left;
      cursor: pointer;
    }
    .package-card:hover, .package-card.selected {
      border-color: #83b3ff;
      background: #f3f8ff;
    }
    .package-index {
      grid-row: 1 / 3;
      align-self: start;
      display: inline-grid;
      place-items: center;
      width: 30px;
      height: 30px;
      border-radius: 999px;
      background: #102b4f;
      color: #fff;
      font-size: 12px;
      font-weight: 850;
    }
    .package-card strong {
      font-size: 13px;
      line-height: 1.25;
    }
    .package-card small {
      color: var(--muted);
      font-size: 12px;
      line-height: 1.35;
      margin-top: 3px;
    }
    .primary-button {
      width: 100%;
      height: 44px;
      border: 0;
      border-radius: 6px;
      margin-top: 16px;
      background: var(--blue);
      color: #fff;
      font-weight: 850;
      cursor: pointer;
    }
    .primary-button:disabled {
      opacity: 0.58;
      cursor: wait;
    }
    .outline-panel {
      display: none;
      margin-top: 14px;
      border: 1px solid #cfe0ff;
      border-radius: 8px;
      background: #f4f8ff;
      padding: 12px;
    }
    .outline-panel.visible { display: block; }
    .outline-panel h3 {
      font-size: 14px;
      margin-bottom: 6px;
    }
    .outline-panel p {
      color: #35465a;
      font-size: 13px;
      line-height: 1.45;
      margin-bottom: 8px;
    }
    .outline-panel ul {
      margin: 8px 0 0;
      padding-left: 18px;
      color: #35465a;
      font-size: 12px;
      line-height: 1.45;
    }
    .outline-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 8px;
    }
    .outline-meta span {
      border: 1px solid #d8e7ff;
      border-radius: 999px;
      background: #fff;
      color: #315176;
      padding: 4px 8px;
      font-size: 11px;
      font-weight: 800;
    }
    .small-action {
      height: 34px;
      border: 1px solid #cfe0ff;
      border-radius: 6px;
      background: #f4f8ff;
      color: var(--blue);
      padding: 0 10px;
      font-size: 12px;
      font-weight: 850;
      white-space: nowrap;
      cursor: pointer;
    }
    .blueprint {
      display: grid;
      grid-template-rows: auto 1fr;
      overflow: hidden;
    }
    .preview-stage {
      padding: 16px;
    }
    .reference-frame {
      width: 100%;
      aspect-ratio: 16 / 9;
      border-radius: 8px;
      overflow: hidden;
      background: #10151f;
      border: 1px solid #202b3a;
      display: grid;
      grid-template-rows: 48% 52%;
    }
    .mock-image {
      position: relative;
      background:
        linear-gradient(120deg, rgba(255,255,255,0.08), rgba(255,255,255,0)),
        linear-gradient(135deg, #73513d 0%, #27364a 100%);
      overflow: hidden;
    }
    .mock-image::before {
      content: "";
      position: absolute;
      left: 8%;
      right: 8%;
      bottom: -8%;
      height: 60%;
      background: #d9c2a4;
      clip-path: polygon(0 100%, 12% 20%, 26% 100%, 42% 12%, 60% 100%, 76% 28%, 100% 100%);
      opacity: 0.72;
    }
    .mock-image::after {
      content: "";
      position: absolute;
      width: 18%;
      height: 46%;
      left: 52%;
      bottom: 8%;
      border-radius: 36% 36% 10% 10%;
      background: var(--orange);
      box-shadow: -280px 20px 0 -34px #284f73, 240px -20px 0 -46px #f3d3a5;
    }
    .mock-caption {
      display: grid;
      align-content: center;
      gap: 12px;
      padding: 22px 28px 26px;
      background: linear-gradient(135deg, #082f3f, #123b67 58%, #242b63);
      color: #fff;
      text-align: center;
    }
    .mock-caption strong {
      font-size: clamp(22px, 3vw, 44px);
      font-style: italic;
      line-height: 1.12;
      text-shadow: 0 4px 8px rgba(0,0,0,0.35);
    }
    .mock-caption span {
      font-family: "PingFang SC", "Noto Sans CJK SC", Arial, sans-serif;
      font-size: clamp(16px, 2.1vw, 32px);
      font-weight: 800;
      text-shadow: 0 4px 8px rgba(0,0,0,0.35);
    }
    .style-notes {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 10px;
      margin-top: 14px;
    }
    .style-notes div {
      border: 1px solid var(--line);
      border-radius: 6px;
      background: var(--surface-soft);
      padding: 10px;
      min-height: 78px;
    }
    .style-notes strong {
      display: block;
      font-size: 13px;
      margin-bottom: 5px;
    }
    .style-notes span {
      color: var(--muted);
      font-size: 12px;
      line-height: 1.35;
    }
    .job-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 16px;
      border-bottom: 1px solid var(--line);
    }
    .job-title { font-size: 15px; font-weight: 800; }
    .job-subtitle { color: var(--muted); font-size: 12px; margin-top: 4px; }
    .video-box {
      position: relative;
      margin: 16px;
      background: #10151f;
      border-radius: 8px;
      overflow: hidden;
    }
    video {
      display: block;
      width: 100%;
      aspect-ratio: 16 / 9;
      background: #10151f;
    }
    .video-empty {
      position: absolute;
      inset: 0;
      display: grid;
      place-items: center;
      color: #cbd5e1;
      font-size: 13px;
      pointer-events: none;
    }
    .flow {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 8px;
      padding: 0 16px 16px;
    }
    .flow-step {
      min-height: 76px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: #f8fafc;
      padding: 9px;
    }
    .flow-step strong {
      display: block;
      font-size: 12px;
      margin-bottom: 5px;
    }
    .flow-step span {
      color: var(--muted);
      font-size: 11px;
      line-height: 1.35;
    }
    .flow-step.active {
      border-color: #efbe70;
      background: #fff9ed;
    }
    .flow-step.done {
      border-color: #b5dfc8;
      background: #f0fbf5;
    }
    .side-stack {
      display: grid;
      align-content: start;
      gap: 16px;
    }
    .links {
      display: grid;
      grid-template-columns: 1fr;
      gap: 8px;
    }
    .links a {
      display: block;
      border: 1px solid #cfe0ff;
      border-radius: 6px;
      background: #f4f8ff;
      color: var(--blue);
      padding: 9px 10px;
      font-size: 13px;
      font-weight: 800;
      text-decoration: none;
    }
    .empty-output {
      color: var(--muted);
      font-size: 13px;
      line-height: 1.45;
    }
    .recent-output {
      margin-top: 14px;
      padding-top: 14px;
      border-top: 1px solid var(--line);
    }
    .recent-heading {
      margin-bottom: 8px;
      font-size: 12px;
      font-weight: 850;
      color: #314154;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .recent-list {
      display: grid;
      gap: 8px;
    }
    .recent-button {
      display: block;
      width: 100%;
      border: 1px solid #d8e1ea;
      border-radius: 6px;
      background: #fff;
      color: var(--text);
      padding: 9px 10px;
      text-align: left;
      cursor: pointer;
    }
    .recent-button:hover {
      border-color: #83b3ff;
      background: #f3f8ff;
    }
    .recent-button strong {
      display: block;
      font-size: 13px;
      line-height: 1.25;
    }
    .recent-button span {
      display: block;
      margin-top: 3px;
      color: var(--muted);
      font-size: 11px;
    }
    .progress-wrap {
      display: none;
      margin-bottom: 12px;
    }
    .progress-track {
      height: 8px;
      border: 1px solid var(--line);
      border-radius: 999px;
      overflow: hidden;
      background: #eef2f7;
    }
    .progress-fill {
      width: 0%;
      height: 100%;
      background: var(--blue);
      transition: width 0.25s ease;
    }
    .progress-label {
      margin-top: 6px;
      color: var(--muted);
      font-size: 12px;
      text-align: right;
      font-weight: 700;
    }
    pre {
      margin: 0;
      max-height: 340px;
      overflow: auto;
      white-space: pre-wrap;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: #f8fafc;
      color: #2d3748;
      padding: 11px;
      font-size: 12px;
      line-height: 1.55;
    }
    @media (max-width: 1180px) {
      main { grid-template-columns: minmax(320px, 410px) minmax(0, 1fr); }
      .side-stack { grid-column: 1 / -1; grid-template-columns: 1fr 1fr; }
    }
    @media (max-width: 860px) {
      header { align-items: flex-start; flex-direction: column; }
      main { grid-template-columns: 1fr; }
      .side-stack { grid-template-columns: 1fr; }
      .row, .style-notes, .flow { grid-template-columns: 1fr; }
      .mock-caption { padding: 24px 20px; gap: 12px; }
    }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>English Story Video Generator</h1>
      <p class="subtitle">Create 15-20 minute pure English story videos with cinematic scenes, bilingual captions, and vocabulary notes.</p>
    </div>
    <div class="header-actions">
      <a class="settings-link" href="/settings">Settings</a>
      <span class="badge" id="keyState">Checking MiniMax key</span>
    </div>
  </header>

  <main>
    <section class="control-panel">
      <div class="panel-heading">
        <h2><span class="step">1</span>Plan A Story Topic</h2>
      </div>

      <form id="form">
        <label for="topic">Story Topic</label>
        <input id="topic" name="topic" value="A Rainy Day in London" placeholder="Example: A Rainy Day in London" autocomplete="off">
        <p class="hint">Type any topic. First generate a story overview, confirm the direction, then create a continuous English story video with no Part, Listen, Shadow, or Review rounds.</p>

        <label for="minutes">Target Minutes</label>
        <input id="minutes" name="minutes" type="number" min="15" max="20" step="1" value="15">
        <p class="hint">The dashboard clamps every web run to 15-20 minutes. Narration, images, and background music use the global MiniMax models from Settings.</p>

        <button class="primary-button" id="generate" type="submit">Generate Story Overview</button>

        <div class="outline-panel" id="outlinePanel">
          <h3 id="outlineTitle">Story Overview</h3>
          <p id="outlineSummary"></p>
          <div class="outline-meta" id="outlineMeta"></div>
          <ul id="outlineBeats"></ul>
        </div>

        <details>
          <summary style="margin-top:16px; cursor:pointer; font-size:13px; font-weight:800; color:#314154;">Optional: browse 15 example packages</summary>
          <label for="preset">Inspiration Library</label>
          <select id="preset" name="preset">${presetOptions}</select>
          <p class="hint" id="presetHint">The 15 packages are examples you can reuse or remix. They are not the limit.</p>
          <div class="package-grid" id="packageGrid">${packageCards}</div>
        </details>
      </form>
    </section>

    <section class="blueprint">
      <div class="job-header">
        <div>
          <div class="job-title" id="jobTitle">Pure Story Generation Flow</div>
          <p class="job-subtitle" id="jobHint">Topic to confirmed overview, continuous story, narration, cinematic frames, and MP4 preview.</p>
        </div>
        <div style="display:flex; align-items:center; gap:8px;">
          <button class="small-action" id="newTopic" type="button">Start New Topic</button>
          <span class="badge" id="status">idle</span>
        </div>
      </div>

      <div class="preview-stage">
        <div class="reference-frame" id="referenceFrame">
          <div class="mock-image"></div>
          <div class="mock-caption">
            <strong>She followed the small clue.</strong>
            <span>她跟着那条小线索。</span>
          </div>
        </div>

        <div class="video-box">
          <video id="video" controls></video>
          <div class="video-empty" id="emptyVideo">The generated final.mp4 will appear here.</div>
        </div>

        <div class="style-notes">
          <div><strong>Overview First</strong><span>Any topic becomes a reviewable story plan before generation starts.</span></div>
          <div><strong>Pure Story</strong><span>No teaching rounds, no Part narration, no repeated Listen/Shadow/Review loops.</span></div>
          <div><strong>Output</strong><span>script.json, script.md, prompts, subtitles, audio.wav, and final.mp4.</span></div>
        </div>
      </div>

      <div class="flow" id="flow">
        <div class="flow-step" data-flow="script"><strong>Story</strong><span>Continuous narration, translations, prompts</span></div>
        <div class="flow-step" data-flow="audio"><strong>Narration</strong><span>Voice and subtitle timing</span></div>
        <div class="flow-step" data-flow="video"><strong>Frames</strong><span>Cinematic images, captions, vocabulary notes</span></div>
        <div class="flow-step" data-flow="done"><strong>Export</strong><span>Preview and sidecar files</span></div>
      </div>
    </section>

    <aside class="side-stack">
      <div class="status-panel">
        <div class="panel-heading">
          <h2><span class="step">2</span>Output Files</h2>
        </div>
        <p class="empty-output" id="outputEmpty">Generate a video to see links for the MP4, script, subtitles, audio, JSON, and image prompts.</p>
        <div class="links" id="links"></div>
        <div class="recent-output">
          <div class="recent-heading">Recent Outputs</div>
          <div class="recent-list" id="recentList">Checking generated files...</div>
        </div>
      </div>

      <div class="status-panel">
        <div class="panel-heading">
          <h2><span class="step">3</span>Live Job Status</h2>
        </div>
        <div class="progress-wrap" id="progressWrap">
          <div class="progress-track"><div class="progress-fill" id="progressFill"></div></div>
          <div class="progress-label" id="progressLabel">0%</div>
        </div>
        <pre id="logs">Waiting for a generation job...</pre>
      </div>
    </aside>
  </main>

  <script>
    const presets = ${presetsJson};
    const form = document.getElementById("form");
    const preset = document.getElementById("preset");
    const topic = document.getElementById("topic");
    const presetHint = document.getElementById("presetHint");
    const packageGrid = document.getElementById("packageGrid");
    const button = document.getElementById("generate");
    const statusEl = document.getElementById("status");
    const logsEl = document.getElementById("logs");
    const linksEl = document.getElementById("links");
    const videoEl = document.getElementById("video");
    const emptyVideo = document.getElementById("emptyVideo");
    const outputEmpty = document.getElementById("outputEmpty");
    const jobTitle = document.getElementById("jobTitle");
    const jobHint = document.getElementById("jobHint");
    const keyState = document.getElementById("keyState");
    const progressWrap = document.getElementById("progressWrap");
    const progressFill = document.getElementById("progressFill");
    const progressLabel = document.getElementById("progressLabel");
    const newTopic = document.getElementById("newTopic");
    const recentList = document.getElementById("recentList");
    const outlinePanel = document.getElementById("outlinePanel");
    const outlineTitle = document.getElementById("outlineTitle");
    const outlineSummary = document.getElementById("outlineSummary");
    const outlineMeta = document.getElementById("outlineMeta");
    const outlineBeats = document.getElementById("outlineBeats");
    let activeJobId = null;
    let recentItems = [];
    let apiReady = false;
    let currentOutline = null;
    let outlineTopic = "";

    fetch("/api/config")
      .then((response) => response.json())
      .then((config) => {
        apiReady = Boolean(config.hasMiniMaxKey);
        keyState.textContent = apiReady ? "API configured" : "API key required";
        keyState.className = "badge " + (config.hasMiniMaxKey ? "completed" : "");
        button.disabled = false;
        button.textContent = apiReady ? "Generate Story Overview" : "Configure API Key to Generate";
        if (!apiReady) {
          logsEl.textContent = "Open Settings and save your MiniMax API key before generating videos.";
        } else if (config.llm && config.llm.configured) {
          logsEl.textContent = "Ready. Text planning will use " + config.llm.model + ".";
        }
      })
      .catch(() => {
        apiReady = false;
        button.disabled = false;
        button.textContent = "Configure API Key to Generate";
        keyState.textContent = "API key required";
      });

    loadRecentOutputs();

    function selectPackage(title) {
      if (!title) {
        presetHint.textContent = "Write any topic above, then generate. The examples below are optional inspiration.";
        document.querySelectorAll(".package-card").forEach((card) => card.classList.remove("selected"));
        return;
      }
      const selected = presets.find((item) => item.title === title);
      if (!selected) return;
      preset.value = selected.title;
      topic.value = selected.title;
      resetOutline();
      presetHint.textContent = selected.visualStyle + ". Focus: " + selected.learningFocus + ".";
      let selectedCard = null;
      document.querySelectorAll(".package-card").forEach((card) => {
        const isSelected = card.dataset.title === selected.title;
        card.classList.toggle("selected", isSelected);
        if (isSelected) selectedCard = card;
      });
      if (selectedCard) selectedCard.scrollIntoView({ block: "nearest" });
    }

    preset.addEventListener("change", (event) => selectPackage(event.target.value));
    topic.addEventListener("input", () => {
      preset.value = "";
      selectPackage("");
      resetOutline();
    });
    packageGrid.addEventListener("click", (event) => {
      const card = event.target.closest(".package-card");
      if (card) selectPackage(card.dataset.title);
    });
    selectPackage("");

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!apiReady) {
        setStatus("failed");
        logsEl.textContent = "MiniMax API key is required. Opening Settings...";
        window.location.href = "/settings";
        return;
      }
      button.disabled = true;
      linksEl.innerHTML = "";
      outputEmpty.style.display = "block";
      emptyVideo.style.display = "grid";
      videoEl.removeAttribute("src");
      videoEl.load();
      setStatus("queued");
      setFlow("script");
      updateProgress([], "queued");

      const body = Object.fromEntries(new FormData(form).entries());
      body.minutes = String(clampMinutes(body.minutes));

      if (!currentOutline || outlineTopic !== body.topic.trim()) {
        logsEl.textContent = "Generating story overview for confirmation...";
        try {
          const response = await fetch("/api/story-outline", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
          });
          const result = await response.json();
          if (!response.ok || result.error) throw new Error(result.error || "Failed to generate outline.");
          currentOutline = result.outline;
          outlineTopic = body.topic.trim();
          renderOutline(currentOutline);
          button.disabled = false;
          button.textContent = "Confirm Overview And Generate Video";
          setStatus("idle");
          updateProgress([], "idle");
          logsEl.textContent = "Review the story overview, then click Confirm Overview And Generate Video.";
          return;
        } catch (error) {
          button.disabled = false;
          setStatus("failed");
          setFlow("failed");
          updateProgress([], "failed");
          logsEl.textContent = error.message;
          return;
        }
      }

      logsEl.textContent = "Confirmed. Generating pure story video...";
      body.outline = currentOutline;

      const response = await fetch("/api/generate-story-video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const job = await response.json();
      if (!response.ok || job.error) {
        button.disabled = false;
        setStatus("failed");
        setFlow("failed");
        updateProgress([], "failed");
        logsEl.textContent = job.error || "Failed to start job.";
        return;
      }

      jobTitle.textContent = body.topic || "Story Video";
      jobHint.textContent = job.minutes + "-minute generation job: " + job.id;
      activeJobId = job.id;
      window.history.pushState(null, "", "?jobId=" + encodeURIComponent(job.id));
      poll(job.id);
    });

    async function poll(id) {
      if (activeJobId && id !== activeJobId) return;
      const response = await fetch("/api/jobs/" + encodeURIComponent(id));
      const job = await response.json();
      if (job.error) {
        if (job.error === "Job not found") {
          activeJobId = null;
          button.disabled = false;
          setStatus("idle");
          setFlow("script");
          updateProgress([], "idle");
          jobTitle.textContent = "Pure Story Generation Flow";
          jobHint.textContent = "This server restarted, so the old live job id is gone. Recent outputs are still available.";
          logsEl.textContent = "Start a new topic on the left, or open a completed video from Recent Outputs.";
          loadRecentOutputs();
          return;
        }
        setStatus("failed");
        setFlow("failed");
        updateProgress([], "failed");
        logsEl.textContent = job.error + "\\nGenerated files are still available in Recent Outputs when the MP4 exists on disk.";
        button.disabled = false;
        return;
      }

      jobTitle.textContent = job.topic || "Story Video";
      jobHint.textContent = job.minutes ? job.minutes + "-minute shadowing video" : "Generation in progress";
      setStatus(job.status || "unknown");
      logsEl.textContent = (job.logs || []).join("\\n") || "Working...";
      updateProgress(job.logs, job.status);
      syncFlow(job);

      if (job.status === "completed") {
        button.disabled = false;
        renderOutputs(job.outputs);
        loadRecentOutputs();
        return;
      }

      if (job.status === "failed") {
        button.disabled = false;
        setFlow("failed");
        logsEl.textContent += "\\n" + (job.error || "Generation failed.");
        return;
      }

      setTimeout(() => poll(id), 1400);
    }

    function renderOutline(outline) {
      outlinePanel.classList.add("visible");
      outlineTitle.textContent = outline.title || "Story Overview";
      outlineSummary.textContent = outline.summary || "";
      outlineMeta.innerHTML = [
        outline.genre,
        outline.mainCharacter ? "Character: " + outline.mainCharacter : "",
        outline.setting ? "Setting: " + outline.setting : "",
        outline.source ? "Source: " + outline.source : ""
      ].filter(Boolean).map((item) => "<span>" + escapeHtmlClient(item) + "</span>").join("");
      outlineBeats.innerHTML = (outline.storyBeats || []).slice(0, 8)
        .map((beat) => "<li>" + escapeHtmlClient(beat) + "</li>")
        .join("");
    }

    function resetOutline() {
      currentOutline = null;
      outlineTopic = "";
      outlinePanel.classList.remove("visible");
      if (apiReady) button.textContent = "Generate Story Overview";
    }

    function renderOutputs(outputs) {
      if (!outputs) return;
      videoEl.src = outputs.video + "?t=" + Date.now();
      emptyVideo.style.display = "none";
      outputEmpty.style.display = "none";
      const labels = {
        video: "Final Video · final.mp4",
        script: "Readable Script · script.md",
        subtitles: "Subtitles · subtitles.srt",
        audio: "Narration · audio.wav",
        music: "Background Music · music/background.mp3",
        imagePrompts: "Scene Prompts · image-prompts.md",
        scriptJson: "Structured Data · script.json"
      };
      linksEl.innerHTML = Object.entries(labels)
        .map(([key, label]) => outputs[key] ? '<a href="' + outputs[key] + '" target="_blank">' + label + '</a>' : "")
        .join("");
    }

    async function loadRecentOutputs() {
      try {
        const response = await fetch("/api/recent-outputs");
        const data = await response.json();
        recentItems = data.items || [];
        renderRecentOutputs(recentItems);

        const params = new URLSearchParams(window.location.search);
        const selectedSlug = params.get("output");
        if (selectedSlug) {
          const selected = recentItems.find((item) => item.slug === selectedSlug);
          if (selected) showRecentOutput(selected, false);
        }
      } catch {
        recentList.textContent = "Could not read generated files.";
      }
    }

    function renderRecentOutputs(items) {
      recentList.innerHTML = "";
      if (!items.length) {
        recentList.textContent = "No completed videos yet.";
        return;
      }

      items.forEach((item) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "recent-button";
        button.dataset.slug = item.slug;
        const title = document.createElement("strong");
        title.textContent = item.title;
        const meta = document.createElement("span");
        meta.textContent = "Open generated MP4 and sidecar files";
        button.append(title, meta);
        button.addEventListener("click", () => showRecentOutput(item, true));
        recentList.appendChild(button);
      });
    }

    function showRecentOutput(item, updateUrl) {
      activeJobId = null;
      button.disabled = false;
      renderOutputs(item.outputs);
      setStatus("completed");
      setFlow("done");
      updateProgress([], "completed");
      jobTitle.textContent = item.title;
      jobHint.textContent = "Loaded from outputs/" + item.slug + "/";
      logsEl.textContent = "Loaded completed output from disk. Start a new topic on the left, or open the files above.";
      if (updateUrl) {
        window.history.pushState(null, "", "/?output=" + encodeURIComponent(item.slug));
      }
    }

    function syncFlow(job) {
      const logs = (job.logs || []).join("\\n");
      if (job.status === "completed") return setFlow("done");
      if (logs.includes("Composing final MP4") || logs.includes("Rendering frame") || logs.includes("Generating background music")) return setFlow("video");
      if (logs.includes("Generating audio") || logs.includes("Audio ")) return setFlow("audio");
      return setFlow("script");
    }

    function setStatus(value) {
      statusEl.textContent = value;
      statusEl.className = "badge " + value;
    }

    function setFlow(active) {
      const order = ["script", "audio", "video", "done"];
      const activeIndex = order.indexOf(active);
      document.querySelectorAll(".flow-step").forEach((step) => {
        const index = order.indexOf(step.dataset.flow);
        step.classList.remove("active", "done");
        if (active === "failed") return;
        if (index < activeIndex) step.classList.add("done");
        if (index === activeIndex) step.classList.add(active === "done" ? "done" : "active");
      });
    }

    function updateProgress(logs, status) {
      progressWrap.style.display = status === "idle" ? "none" : "block";
      if (status === "completed") {
        progressFill.style.width = "100%";
        progressFill.style.background = "var(--green)";
        progressLabel.textContent = "100%";
        return;
      }
      if (status === "failed") {
        progressFill.style.width = "100%";
        progressFill.style.background = "var(--red)";
        progressLabel.textContent = "Failed";
        return;
      }

      progressFill.style.background = "var(--blue)";
      let progress = 8;
      for (let i = (logs || []).length - 1; i >= 0; i -= 1) {
        const text = logs[i];
        const audioMatch = text.match(/Audio (\\d+)\\/(\\d+)/);
        const frameMatch = text.match(/Rendering frame (\\d+)\\/(\\d+)/);
        if (text.includes("Encoding final MP4")) {
          progress = 96;
          break;
        }
        if (text.includes("Generating background music") || text.includes("Background music ready")) {
          progress = 58;
          break;
        }
        if (frameMatch) {
          progress = 62 + Math.floor((Number(frameMatch[1]) / Number(frameMatch[2])) * 32);
          break;
        }
        if (text.includes("Generating scene images")) {
          progress = 54;
          break;
        }
        if (audioMatch) {
          progress = 12 + Math.floor((Number(audioMatch[1]) / Number(audioMatch[2])) * 42);
          break;
        }
      }
      progressFill.style.width = progress + "%";
      progressLabel.textContent = progress + "%";
    }

    function clampMinutes(value) {
      const minutes = Number(value || 15);
      if (!Number.isFinite(minutes)) return 15;
      return Math.min(20, Math.max(15, Math.round(minutes)));
    }

    newTopic.addEventListener("click", () => {
      activeJobId = null;
      button.disabled = false;
      resetOutline();
      setStatus("idle");
      setFlow("script");
      updateProgress([], "idle");
      jobTitle.textContent = "Pure Story Generation Flow";
      jobHint.textContent = "Enter a topic on the left, then confirm the story overview.";
      logsEl.textContent = apiReady ? "Ready for a new topic." : "Open Settings and save your MiniMax API key before generating videos.";
      button.textContent = apiReady ? "Generate Story Overview" : "Configure API Key to Generate";
      window.history.pushState(null, "", "/");
      topic.focus();
    });

    function escapeHtmlClient(value) {
      return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    }

    const urlParams = new URLSearchParams(window.location.search);
    const existingJobId = urlParams.get("jobId");
    if (existingJobId) {
      activeJobId = existingJobId;
      button.disabled = false;
      setStatus("queued");
      setFlow("script");
      updateProgress([], "queued");
      logsEl.textContent = "Reconnecting to job...";
      jobHint.textContent = "Job id: " + existingJobId;
      poll(existingJobId);
    }
  </script>
</body>
</html>`;
}

function clampMinutes(value) {
  return 15;
}

function resolveOption(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function normalizeOutlineInput(outline) {
  if (!outline || typeof outline !== "object") return null;
  return {
    title: String(outline.title || "").trim(),
    genre: String(outline.genre || "").trim(),
    level: "beginner",
    summary: String(outline.summary || "").trim(),
    mainCharacter: String(outline.mainCharacter || "").trim(),
    setting: String(outline.setting || "").trim(),
    visualStyle: String(outline.visualStyle || "").trim(),
    storyBeats: Array.isArray(outline.storyBeats) ? outline.storyBeats.map((item) => String(item || "").trim()).filter(Boolean) : [],
    vocabularyFocus: Array.isArray(outline.vocabularyFocus) ? outline.vocabularyFocus.map((item) => String(item || "").trim()).filter(Boolean) : [],
    targetMinutes: Number(outline.targetMinutes || 15),
    source: outline.source || "user-confirmed",
    searchContext: normalizeSearchContextInput(outline.searchContext)
  };
}

function normalizeStoryDraftInput(draft) {
  if (!draft || typeof draft !== "object") return null;
  const sections = Array.isArray(draft.sections)
    ? draft.sections.map((section, index) => ({
      ...section,
      title: String(section?.title || `Scene ${index + 1}`).trim(),
      baseSectionIndex: Number.isInteger(section?.baseSectionIndex) ? section.baseSectionIndex : index,
      imageVariantIndex: Number.isInteger(section?.imageVariantIndex) ? section.imageVariantIndex : 0,
      imageBeatSize: 1,
      imageBeatCount: Array.isArray(section?.sentences) ? section.sentences.length : 1,
      sentences: Array.isArray(section?.sentences) ? section.sentences.map((item) => String(item || "").trim()).filter(Boolean) : [],
      translations: Array.isArray(section?.translations) ? section.translations.map((item) => String(item || "").trim()) : [],
      vocabulary: Array.isArray(section?.vocabulary) ? section.vocabulary : []
    })).filter((section) => section.sentences.length)
    : [];
  return {
    ...draft,
    version: draft.version || "0.2.0",
    mode: "pure-story",
    topic: String(draft.topic || "").trim(),
    targetDurationMinutes: 15,
    defaults: {
      sentencePauseSeconds: Number(draft.defaults?.sentencePauseSeconds || 0.45),
      sectionPauseSeconds: 0,
      vocabularyPauseSeconds: 0
    },
    sections,
    opening: [],
    closing: []
  };
}

function countDraftImages(draft) {
  return (draft?.sections || []).reduce((total, section) => total + Math.max(1, Number(section.imageBeatCount || section.sentences?.length || 1)), 0);
}

function normalizeSearchContextInput(searchContext) {
  if (!searchContext || typeof searchContext !== "object") return null;
  return {
    source: String(searchContext.source || "tavily").trim(),
    query: String(searchContext.query || "").trim(),
    answer: String(searchContext.answer || "").trim(),
    searchedAt: String(searchContext.searchedAt || "").trim(),
    results: Array.isArray(searchContext.results)
      ? searchContext.results.map((result) => ({
        title: String(result?.title || "").trim(),
        url: String(result?.url || "").trim(),
        content: String(result?.content || "").trim(),
        score: Number.isFinite(Number(result?.score)) ? Number(result.score) : null
      })).filter((result) => result.title || result.url || result.content).slice(0, 8)
      : []
  };
}

async function getAccessState(req, url) {
  const settings = await getEffectiveSettings();
  const pin = String(settings.access?.pin || "").trim();
  return {
    protected: Boolean(pin),
    authenticated: !pin || isAccessAuthenticated(req, url, pin),
    pin
  };
}

function isAccessAuthenticated(req, url, pin) {
  const providedPin = String(req.headers["x-echoenglish-pin"] || url.searchParams.get("pin") || "").trim();
  if (providedPin && providedPin === pin) return true;
  const cookies = parseCookies(req.headers.cookie || "");
  return cookies[ACCESS_COOKIE] === accessTokenFor(pin);
}

function setAccessCookie(res, pin) {
  res.setHeader("Set-Cookie", [
    `${ACCESS_COOKIE}=${accessTokenFor(pin)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`
  ]);
}

function accessTokenFor(pin) {
  return crypto.createHmac("sha256", String(pin)).update("echoenglish-access-v1").digest("hex");
}

function parseCookies(header) {
  return String(header || "").split(";").reduce((cookies, pair) => {
    const index = pair.indexOf("=");
    if (index === -1) return cookies;
    const key = pair.slice(0, index).trim();
    const value = pair.slice(index + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
    return cookies;
  }, {});
}

function acceptsHtml(req) {
  return String(req.headers.accept || "").includes("text/html");
}

function renderAccessPage() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="theme-color" content="#eef6ff">
  <title>EchoEnglish Access</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      background:
        radial-gradient(circle at 18% 25%, rgba(61, 143, 255, 0.16), transparent 28%),
        radial-gradient(circle at 78% 72%, rgba(85, 217, 186, 0.15), transparent 30%),
        linear-gradient(135deg, #f9fbff, #eef5ff);
      color: #07142d;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
    }
    main {
      width: min(430px, calc(100vw - 32px));
      padding: 34px;
      border: 1px solid rgba(255, 255, 255, 0.85);
      border-radius: 34px;
      background: rgba(255, 255, 255, 0.72);
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.95), 0 24px 80px rgba(43, 83, 150, 0.18);
      backdrop-filter: blur(24px) saturate(1.2);
    }
    .logo {
      width: 42px;
      height: 42px;
      display: grid;
      place-items: center;
      border-radius: 14px;
      background: linear-gradient(135deg, #eaf4ff, #ffffff);
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.95), 0 10px 26px rgba(24, 119, 255, 0.18);
      color: #0878ff;
      font-weight: 900;
      margin-bottom: 18px;
    }
    h1 { margin: 0 0 8px; font-size: 28px; line-height: 1.05; letter-spacing: 0; }
    p { margin: 0 0 24px; color: #52627d; font-size: 14px; line-height: 1.55; }
    label { display: grid; gap: 9px; color: #20304a; font-size: 12px; font-weight: 800; }
    input {
      width: 100%;
      height: 50px;
      border: 1px solid rgba(125, 153, 190, 0.35);
      border-radius: 16px;
      background: rgba(255,255,255,0.82);
      padding: 0 16px;
      font-size: 18px;
      letter-spacing: 0.2em;
      outline: none;
      box-shadow: inset 0 1px 2px rgba(20, 45, 82, 0.06);
    }
    input:focus { border-color: #1683ff; box-shadow: 0 0 0 4px rgba(22, 131, 255, 0.12); }
    button {
      width: 100%;
      height: 50px;
      margin-top: 16px;
      border: 0;
      border-radius: 18px;
      background: linear-gradient(180deg, #2e93ff, #0878ff);
      color: #fff;
      font-weight: 900;
      cursor: pointer;
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.38), 0 16px 30px rgba(8,120,255,0.24);
    }
    .message { min-height: 20px; margin-top: 14px; color: #b42318; font-weight: 800; font-size: 13px; }
  </style>
</head>
<body>
  <main>
    <div class="logo">E</div>
    <h1>EchoEnglish</h1>
    <p>This local dashboard is protected. Enter the access PIN to continue.</p>
    <form id="form">
      <label>Access PIN
        <input id="pin" name="pin" type="password" inputmode="numeric" autocomplete="current-password" autofocus>
      </label>
      <button type="submit">Unlock Dashboard</button>
      <div class="message" id="message"></div>
    </form>
  </main>
  <script>
    const form = document.getElementById("form");
    const pin = document.getElementById("pin");
    const message = document.getElementById("message");
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      message.textContent = "";
      const response = await fetch("/api/access/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: pin.value })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        message.textContent = data.error || "Could not unlock.";
        return;
      }
      window.location.reload();
    });
  </script>
</body>
</html>`;
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8") || "{}";
  return JSON.parse(raw);
}

function sendHtml(res, html) {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

function sendJson(res, data, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function redirect(res, location) {
  res.writeHead(302, { Location: location });
  res.end();
}

function contentType(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".js" || ext === ".mjs") return "text/javascript; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".mp4") return "video/mp4";
  if (ext === ".wav") return "audio/wav";
  if (ext === ".mp3") return "audio/mpeg";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".webmanifest") return "application/manifest+json; charset=utf-8";
  if (ext === ".srt") return "text/plain; charset=utf-8";
  if (ext === ".md") return "text/markdown; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  return "application/octet-stream";
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

server.listen(PORT, HOST, () => {
  const localUrl = `http://127.0.0.1:${PORT}`;
  const networkUrls = getLanAddresses().map((address) => `http://${address}:${PORT}`);
  console.log(`English story video generator: ${localUrl}`);
  if (HOST === "0.0.0.0" || HOST === "::") {
    networkUrls.forEach((url) => console.log(`LAN access: ${url}`));
  }
});

function getLanAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((entry) => entry && entry.family === "IPv4" && !entry.internal)
    .map((entry) => entry.address);
}
