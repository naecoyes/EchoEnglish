const { execFile } = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");
const { promisify } = require("node:util");
const { generateStory } = require("./storyGenerator");
const { buildReadingItems, renderImagePrompts, renderMarkdown, renderSrt } = require("./renderers");
const { createAudio: createLocalAudio } = require("./localTts");
const { createAudio: createMiniMaxAudio } = require("./minimaxTts");
const { createAudio: createXiaomiAudio } = require("./xiaomiTts");
const { createAudio: createGoogleAudio } = require("./googleTts");
const { composeStoryVideo } = require("./storyVideoComposer");
const { generateImages } = require("./minimaxImage");
const { generateImages: generateGoogleImages } = require("./googleImage");
const { generateMusic } = require("./minimaxMusic");
const { MINIMAX_TTS_MODEL, MINIMAX_IMAGE_MODEL, MINIMAX_MUSIC_MODEL } = require("./minimaxDefaults");
const { getEffectiveSettings } = require("./settingsStore");
const { slugify, ensureDir, pathExists } = require("./utils");
const { classifyError } = require("./errorClassifier");
const { enrichStoryVocabulary } = require("./vocabularyTools");

const execFileAsync = promisify(execFile);

async function generateStoryWorkflow(options = {}) {
  const topic = options.topic || "A Rainy Day";
  const minutes = Number(options.minutes || 3);
  const outputRoot = path.resolve(options.outputRoot || options.out || "outputs");
  const slug = slugify(topic);
  const outputDir = path.join(outputRoot, slug);
  const logs = options.logs || [];

  if (!Number.isFinite(minutes) || minutes <= 0) {
    throw new Error("--minutes must be a positive number.");
  }

  await ensureDir(outputDir);
  pushLog(logs, `Preparing story: ${topic}`);
  const settings = await getEffectiveSettings();
  const effectiveApiKey = options.apiKey || settings.minimaxApiKey;
  const effectiveModels = settings.models || {};

  const story = enrichStoryVocabulary(options.storyDraft || await generateStory({
    topic,
    targetDurationMinutes: minutes,
    level: "beginner",
    annotationStyle: "zh-brief",
    mode: options.storyMode || "lesson",
    outline: options.storyOutline || null
  }));
  if (options.template && !story.template) {
    story.template = options.template;
  }
  if (options.storyDraft) {
    await runStage(options, "draft", async () => ({
      status: "completed",
      counts: {
        scenes: story.sections?.length || 0,
        sentences: countSentences(story)
      }
    }));
  }

  let readingItems = buildReadingItems(story);
  readingItems = assignPodcastVoices(readingItems, settings, options);
  let audioSummary = null;
  let musicSummary = null;

  if (!options.skipAudio) {
    audioSummary = await runStage(options, "tts", async () => {
    const provider = resolveTtsProvider(options.ttsProvider, effectiveApiKey, settings);
    pushLog(logs, `Generating audio with ${provider} TTS`);
    if (provider === "xiaomi") {
      try {
        return await createXiaomiAudio({
          readingItems,
          outputDir,
          apiKey: settings.xiaomi?.apiKey,
          baseUrl: settings.xiaomi?.baseUrl,
          model: settings.xiaomi?.ttsModel || "MiMo-V2.5-TTS",
          voice: options.xiaomiVoice || "alloy",
          speed: Number(options.speed || 1.0),
          requestIntervalMs: options.ttsRequestIntervalMs,
          logs
        });
      } catch (error) {
        if (!isRecoverableXiaomiTtsError(error)) throw error;
        pushLog(logs, `Xiaomi TTS unavailable: ${cleanErrorMessage(error.message)}`);
        pushLog(logs, "Falling back to MiniMax TTS for narration.");
        const fallbackSummary = await createMiniMaxNarration({
          readingItems,
          outputDir,
          apiKey: effectiveApiKey,
          model: options.minimaxModel || effectiveModels.tts || MINIMAX_TTS_MODEL,
          englishVoice: options.minimaxVoice || "English_Graceful_Lady",
          chineseVoice: options.minimaxCnVoice || "Chinese (Mandarin)_Sweet_Lady",
          speed: Number(options.speed || 0.92),
          requestIntervalMs: options.ttsRequestIntervalMs,
          logs
        });
        fallbackSummary.provider = "minimax-fallback";
        return fallbackSummary;
      }
    } else if (provider === "minimax") {
      return await createMiniMaxNarration({
        readingItems,
        outputDir,
        apiKey: effectiveApiKey,
        model: options.minimaxModel || effectiveModels.tts || MINIMAX_TTS_MODEL,
        englishVoice: options.minimaxVoice || "English_Graceful_Lady",
        chineseVoice: options.minimaxCnVoice || "Chinese (Mandarin)_Sweet_Lady",
        speed: Number(options.speed || 0.92),
        requestIntervalMs: options.ttsRequestIntervalMs,
        logs
      });
    } else if (provider === "google") {
      return await createGoogleAudio({
        readingItems,
        outputDir,
        apiKey: settings.google?.apiKey,
        baseUrl: settings.google?.baseUrl,
        model: settings.google?.ttsModel,
        voice: settings.google?.voice,
        requestIntervalMs: options.ttsRequestIntervalMs,
        logs
      });
    }
    return await createLocalAudio({
      readingItems,
      outputDir,
      englishVoice: options.voice,
      chineseVoice: options.cnVoice,
      englishRate: Number(options.rate || 150),
      logs
    });
    });
    readingItems = audioSummary.items;
  } else {
    pushLog(logs, "Skipping audio; estimating subtitle timings");
    readingItems = addEstimatedTimings(readingItems);
    await notifyStage(options, "tts", "skipped", { counts: { completed: 0, total: readingItems.length } });
  }

  const scriptJson = await runStage(options, "script-assets", async () => {
    const outputs = {
    markdown: "script.md",
    subtitles: "subtitles.srt",
    imagePrompts: "image-prompts.md",
    audio: options.skipAudio ? null : "audio.wav",
    music: !options.skipAudio && resolveMusicMode(options.musicMode) === "minimax" ? "music/background.mp3" : null,
    video: options.skipAudio ? null : "final.mp4",
    qualityReport: "quality-report.json"
  };

    const nextScriptJson = {
    ...story,
    readingOrder: readingItems.map(({ id, kind, text, ttsText, language, pauseAfterSeconds, startSeconds, endSeconds, sectionIndex, sentenceIndex, vocabularyIndex, word, translation, phonetic, speaker, speakerName, voice }) => ({
      id,
      kind,
      text,
      ttsText,
      language,
      pauseAfterSeconds,
      startSeconds,
      endSeconds,
      sectionIndex,
      sentenceIndex,
      vocabularyIndex,
      word,
      translation,
      phonetic,
      speaker,
      speakerName,
      voice
    })),
    outputs
  };

    await fs.writeFile(path.join(outputDir, "script.json"), `${JSON.stringify(nextScriptJson, null, 2)}\n`);
    await fs.writeFile(path.join(outputDir, "script.md"), renderMarkdown(story), "utf8");
    await fs.writeFile(path.join(outputDir, "image-prompts.md"), renderImagePrompts(story), "utf8");
    await fs.writeFile(path.join(outputDir, "subtitles.srt"), renderSrt(readingItems), "utf8");
    return nextScriptJson;
  });

  if (options.imageMode === "minimax" || options.imageMode === "google") {
    await runStage(options, "images", async () => {
    const imageProviderName = options.imageMode === "google" ? "Google Imagen" : "MiniMax";
    pushLog(logs, `Generating scene images with ${imageProviderName}`);
    const scenes = getUniqueImageScenes(story);
    pushLog(logs, `Image API requests: ${scenes.length}; reused across ${story.sections.length} story sections.`);
    const results = options.imageMode === "google"
      ? await generateGoogleImages({
        scenes,
        outputDir,
        apiKey: settings.google?.apiKey,
        baseUrl: settings.google?.baseUrl,
        model: options.googleImageModel || settings.google?.imageModel,
        onProgress: (progress) => reportImageProgress(options, logs, progress)
      })
      : await generateImages({
        scenes,
        outputDir,
        apiKey: effectiveApiKey,
        model: options.imageModel || effectiveModels.image || MINIMAX_IMAGE_MODEL,
        aspectRatio: "16:9",
        promptOptimizer: true,
        onProgress: (progress) => reportImageProgress(options, logs, progress)
      });
    return {
      status: "completed",
      counts: {
        completed: results.length,
        total: scenes.length
      }
    };
    });
  } else {
    await notifyStage(options, "images", "skipped", { counts: { completed: 0, total: 0 } });
  }

  if (!options.skipAudio && resolveMusicMode(options.musicMode) === "minimax") {
    await runStage(options, "music", async () => {
    const musicCount = Number(options.musicCount || settings.minimax?.musicTrackCount || 3);
    pushLog(logs, `Generating ${musicCount} background music tracks with MiniMax`);
    musicSummary = await generateMusic({
      outputDir,
      apiKey: effectiveApiKey,
      model: options.musicModel || effectiveModels.music || MINIMAX_MUSIC_MODEL,
      prompt: options.musicPrompt || buildMusicPrompt(story),
      count: musicCount
    });
    pushLog(logs, "Background music ready: music/background.mp3");
    return {
      status: musicSummary ? "completed" : "skipped",
      counts: {
        completed: Array.isArray(musicSummary?.tracks) ? musicSummary.tracks.length : 0,
        total: musicCount
      }
    };
    });
  } else {
    await notifyStage(options, "music", "skipped", { counts: { completed: 0, total: 0 } });
  }

  let videoSummary = null;
  if (!options.skipAudio) {
    videoSummary = await runStage(options, "compose", async () => {
    await assertComposeInputs({ outputDir, story, audioSummary, musicSummary, options });
    pushLog(logs, "Composing final MP4");
    return await composeStoryVideo({
      story,
      readingItems,
      outputDir,
      audioPath: audioSummary.audioPath,
      musicPath: musicSummary?.musicPath || null,
      musicVolume: Number(options.musicVolume || 0.12),
      imageMode: options.imageMode || "local",
      logs
    });
    });
  } else {
    await notifyStage(options, "compose", "skipped", { counts: { completed: 0, total: 0 } });
  }

  const duration = readingItems.length ? readingItems[readingItems.length - 1].endSeconds : 0;
  const qualityReport = await runStage(options, "quality", async () => {
    const report = await writeQualityReport({
    outputDir,
    story,
    readingItems,
    audioSummary,
    musicSummary,
    videoSummary,
    expectedMusicTracks: Number(options.musicCount || settings.minimax?.musicTrackCount || 3),
    skipAudio: options.skipAudio
  });
    return report;
  });
  pushLog(logs, "Quality report ready: quality-report.json");
  pushLog(logs, `Done: ${formatDuration(duration)}`);

  return {
    story,
    slug,
    outputDir,
    durationSeconds: duration,
    audioSummary,
    musicSummary,
    videoSummary,
    qualityReport,
    files: {
      scriptJson: path.join(outputDir, "script.json"),
      scriptMd: path.join(outputDir, "script.md"),
      imagePrompts: path.join(outputDir, "image-prompts.md"),
      subtitles: path.join(outputDir, "subtitles.srt"),
      audio: options.skipAudio ? null : path.join(outputDir, "audio.wav"),
      music: musicSummary ? path.join(outputDir, "music", "background.mp3") : null,
      video: options.skipAudio ? null : path.join(outputDir, "final.mp4"),
      qualityReport: path.join(outputDir, "quality-report.json")
    }
  };
}

function assignPodcastVoices(readingItems, settings, options) {
  const ttsProvider = resolveTtsProvider(options.ttsProvider, options.apiKey || settings.minimaxApiKey, settings);
  const voiceMap = getPodcastVoiceMap(ttsProvider, settings, options);
  return readingItems.map((item) => {
    if (item.speaker !== "host-a" && item.speaker !== "host-b") return item;
    const voice = voiceMap[item.speaker];
    return voice ? { ...item, voice } : item;
  });
}

function getPodcastVoiceMap(provider, settings, options) {
  if (provider === "google") {
    return {
      "host-a": settings.google?.podcastHostAVoice || settings.google?.voice || "Kore",
      "host-b": settings.google?.podcastHostBVoice || "Puck"
    };
  }
  if (provider === "xiaomi") {
    return {
      "host-a": settings.xiaomi?.podcastHostAVoice || options.xiaomiVoice || "alloy",
      "host-b": settings.xiaomi?.podcastHostBVoice || "echo"
    };
  }
  return {
    "host-a": settings.minimax?.podcastHostAVoice || options.minimaxVoice || settings.minimax?.englishVoice || "English_Graceful_Lady",
    "host-b": settings.minimax?.podcastHostBVoice || "English_Trustworthy_Man"
  };
}

async function runStage(options, stageId, fn) {
  await notifyStage(options, stageId, "running");
  try {
    const result = await fn();
    if (result && typeof result === "object" && ["completed", "skipped"].includes(result.status)) {
      const { status, ...patch } = result;
      await notifyStage(options, stageId, status, patch);
      return result;
    }
    await notifyStage(options, stageId, "completed", inferStagePatch(stageId, result));
    return result;
  } catch (error) {
    const classification = classifyError(error);
    await notifyStage(options, stageId, "failed", {
      error: error.message,
      errorType: classification.type,
      recoverable: classification.recoverable
    });
    throw error;
  }
}

async function notifyStage(options, stageId, status, patch = {}) {
  if (typeof options.onStage === "function") {
    await options.onStage(stageId, status, patch);
  }
}

async function reportImageProgress(options, logs, progress) {
  const completed = Number(progress.completed || 0);
  const total = Number(progress.total || 0);
  if (progress.status === "completed") {
    pushLog(logs, `Image ${completed}/${total}: ${progress.sceneId}`);
  }
  await notifyStage(options, "images", "running", {
    counts: { completed, total },
    currentSceneId: progress.sceneId
  });
}

function inferStagePatch(stageId, result) {
  if (stageId === "tts" && result?.items) {
    return { counts: { completed: result.items.length, total: result.items.length } };
  }
  if (stageId === "compose" && result) {
    return { counts: { completed: 1, total: 1 } };
  }
  if (stageId === "quality" && result?.counts) {
    return { counts: result.counts };
  }
  return {};
}

async function assertComposeInputs({ outputDir, story, audioSummary, musicSummary, options }) {
  if (!audioSummary?.audioPath || !(await pathExists(audioSummary.audioPath))) {
    throw new Error("Compose blocked: audio.wav is not ready.");
  }
  if (options.imageMode === "minimax" || options.imageMode === "google") {
    const scenes = getUniqueImageScenes(story);
    let completed = 0;
    for (const scene of scenes) {
      if (await findSceneImage(outputDir, scene.id)) completed += 1;
    }
    if (completed < scenes.length) {
      throw new Error(`Compose blocked: scene images are incomplete (${completed}/${scenes.length}).`);
    }
  }
  if (resolveMusicMode(options.musicMode) === "minimax" && musicSummary?.musicPath && !(await pathExists(musicSummary.musicPath))) {
    throw new Error("Compose blocked: background music manifest points to a missing file.");
  }
}

async function findSceneImage(outputDir, sceneId) {
  const candidates = [".png", ".jpg", ".jpeg", ".webp"].map((ext) => path.join(outputDir, "images", `${sceneId}${ext}`));
  for (const candidate of candidates) {
    if (await pathExists(candidate)) return candidate;
  }
  return null;
}

async function writeQualityReport({ outputDir, story, readingItems, audioSummary, musicSummary, expectedMusicTracks, skipAudio }) {
  const audioPath = audioSummary?.audioPath || path.join(outputDir, "audio.wav");
  const videoPath = path.join(outputDir, "final.mp4");
  const subtitleLastTimestamp = readingItems.length ? Number(readingItems[readingItems.length - 1].endSeconds || 0) : 0;
  const imageCount = getUniqueImageScenes(story).length;
  const musicTrackCount = Array.isArray(musicSummary?.tracks) ? musicSummary.tracks.length : musicSummary ? 1 : 0;
  const audioDuration = skipAudio ? 0 : await probeDuration(audioPath);
  const videoDuration = skipAudio ? 0 : await probeDuration(videoPath);
  const warnings = [];

  if (imageCount < 110 || imageCount > 120) {
    warnings.push(`Image count ${imageCount} is outside the target range of 110-120.`);
  }
  if (!skipAudio && audioDuration && Math.abs(audioDuration - subtitleLastTimestamp) > 0.1) {
    warnings.push(`Audio duration and subtitle timeline differ by ${Math.abs(audioDuration - subtitleLastTimestamp).toFixed(3)} seconds.`);
  }
  if (!skipAudio && videoDuration && audioDuration && Math.abs(videoDuration - audioDuration) > 0.1) {
    warnings.push(`Video duration and audio duration differ by ${Math.abs(videoDuration - audioDuration).toFixed(3)} seconds.`);
  }
  if (!skipAudio && musicTrackCount < expectedMusicTracks) {
    warnings.push(`Music generated ${musicTrackCount} tracks, expected ${expectedMusicTracks}.`);
  }

  const report = {
    generatedAt: new Date().toISOString(),
    title: story.title,
    topic: story.topic,
    factualMode: story.contentMode === "factual-documentary" || story.outline?.contentMode === "factual-documentary",
    duration: {
      readingOrderSeconds: roundSeconds(subtitleLastTimestamp),
      audioSeconds: roundSeconds(audioDuration),
      videoSeconds: roundSeconds(videoDuration),
      subtitleLastTimestamp: roundSeconds(subtitleLastTimestamp)
    },
    counts: {
      sections: story.sections?.length || 0,
      sentences: countSentences(story),
      images: imageCount,
      musicTracks: musicTrackCount
    },
    targets: {
      minutes: 15,
      images: "110-120",
      musicTracks: expectedMusicTracks
    },
    warnings
  };
  await fs.writeFile(path.join(outputDir, "quality-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
}

async function probeDuration(file) {
  try {
    await fs.access(file);
    const { stdout } = await execFileAsync("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      file
    ], { maxBuffer: 1024 * 1024 });
    const seconds = Number(stdout.trim());
    return Number.isFinite(seconds) ? seconds : 0;
  } catch {
    return 0;
  }
}

function countSentences(story) {
  return (story.sections || []).reduce((total, section) => total + (section.sentences?.length || 0), 0);
}

function roundSeconds(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? Number(number.toFixed(3)) : 0;
}

function getUniqueImageScenes(story) {
  const seen = new Map();
  story.sections.forEach((section, index) => {
    const baseIndex = Number.isInteger(section.baseSectionIndex) ? section.baseSectionIndex : index;
    const variantIndex = Number.isInteger(section.imageVariantIndex) ? section.imageVariantIndex : 0;
    const beatCount = Number.isInteger(section.imageBeatCount) ? section.imageBeatCount : 1;
    for (let beatIndex = 0; beatIndex < beatCount; beatIndex += 1) {
      const key = `${baseIndex}:${variantIndex}:${beatIndex}`;
      if (seen.has(key)) continue;
      const moment = getSectionBeatMoment(story, section, beatIndex);
      seen.set(key, {
        id: buildSceneImageId(baseIndex, variantIndex, beatIndex),
        visual: section.visual,
        title: story.title,
        contentMode: story.contentMode,
        templateTitle: story.template?.title,
        visualStyle: story.storyboardDesign?.visualStyle || story.outline?.visualStyle,
        moment,
        imagePrompt: buildBeatImagePrompt(story, section, beatIndex)
      });
    }
  });
  return [...seen.entries()]
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .map(([, scene]) => scene);
}

function buildSceneImageId(baseIndex, variantIndex, beatIndex) {
  const suffix = ["a", "b", "c"][variantIndex] || String(variantIndex + 1);
  return `scene-${String(baseIndex + 1).padStart(3, "0")}-${suffix}-${String(beatIndex + 1).padStart(2, "0")}`;
}

function getSectionBeatMoment(story, section, beatIndex) {
  const sentences = section.sentences || [];
  const beatSize = Number.isInteger(section.imageBeatSize) ? section.imageBeatSize : story.mode === "pure-story" ? 3 : 2;
  return sentences.slice(beatIndex * beatSize, beatIndex * beatSize + beatSize).join(" ");
}

function buildBeatImagePrompt(story, section, beatIndex) {
  const moment = getSectionBeatMoment(story, section, beatIndex);
  const visualStyle = story.storyboardDesign?.visualStyle || story.outline?.visualStyle || "photorealistic cinematic documentary still";
  const factual = story.contentMode === "factual-documentary" || story.template?.contentMode === "factual-documentary";
  const podcast = story.template?.id === "podcast-dialogue";
  const parts = [
    "Create one 16:9 photorealistic cinematic still image for an English shadowing video.",
    `Video title: ${story.title}.`,
    story.template?.title ? `Video type: ${story.template.title}.` : "",
    `Overall visual style: ${visualStyle}.`,
    section.imagePrompt ? `Base scene prompt: ${section.imagePrompt}` : "",
    section.visual ? `Scene setting: ${section.visual}` : "",
    moment ? `Exact sentence moment to visualize: ${moment}` : "",
    factual ? "Factual documentary mode: show public, realistic, verifiable-feeling environments; avoid fictional private scenes and invented characters." : "",
    podcast ? "Podcast mode: show two hosts in a premium podcast studio, microphones, warm desk lighting, topic-related background screen with no readable text." : "",
    "Camera direction: realistic documentary photography, 35mm lens look, subtle depth of field, natural perspective, professional lighting, detailed foreground and background.",
    "Composition: one clear focal subject, strong visual story action, clean lower third for subtitles, no clutter over the bottom caption zone.",
    "Image quality: high detail, sharp but natural, cinematic color grade, realistic skin/material texture, no black frames, no abstract gradients.",
    "Negative constraints: no text, no readable signs, no subtitles, no logos, no watermark, no UI, no slide deck, no cartoon, no flat vector illustration.",
    `Distinctness: make this beat visually different from nearby beats by changing camera angle, distance, subject pose, object focus, or lighting. Beat ${beatIndex + 1}.`
  ];
  return parts.filter(Boolean).join(" ");
}

function buildMusicPrompt(story) {
  const visualStyle = story.storyboardDesign?.visualStyle || "warm cinematic beginner English story";
  return [
    "instrumental background music for an English shadowing story video",
    `story title: ${story.title}`,
    `mood: ${visualStyle}`,
    "gentle piano, soft ambient pads, light rhythm",
    "no vocals, no lyrics, unobtrusive, calm, suitable under spoken English narration"
  ].join(", ");
}

function resolveMusicMode(requestedMode) {
  const mode = requestedMode || "none";
  if (!["none", "minimax"].includes(mode)) {
    throw new Error("--music-mode must be one of: none, minimax.");
  }
  return mode;
}

function resolveTtsProvider(requestedProvider, apiKey, settings = {}) {
  const provider = requestedProvider || "auto";
  if (!["auto", "minimax", "xiaomi", "google", "local"].includes(provider)) {
    throw new Error("--tts-provider must be one of: auto, minimax, xiaomi, google, local.");
  }

  const hasMinimaxKey = Boolean(apiKey);
  const hasXiaomiKey = Boolean(settings.xiaomi?.apiKey);

  if (provider === "minimax" && !hasMinimaxKey) {
    throw new Error("MINIMAX_API_KEY is required when --tts-provider minimax is used.");
  }

  if (provider === "xiaomi" && !hasXiaomiKey) {
    throw new Error("XIAOMI_API_KEY is required when --tts-provider xiaomi is used.");
  }

  if (provider === "google" && !settings.google?.apiKey) {
    throw new Error("GOOGLE_API_KEY is required when --tts-provider google is used.");
  }

  if (provider === "auto") {
    if (settings.provider === "xiaomi" && hasXiaomiKey) return "xiaomi";
    if (settings.media?.ttsProvider === "google" && settings.google?.apiKey) return "google";
    return hasMinimaxKey ? "minimax" : "local";
  }

  return provider;
}

async function createMiniMaxNarration({ readingItems, outputDir, apiKey, model, englishVoice, chineseVoice, speed, requestIntervalMs, logs }) {
  return createMiniMaxAudio({
    readingItems,
    outputDir,
    apiKey,
    model,
    englishVoice,
    chineseVoice,
    speed,
    requestIntervalMs,
    logs
  });
}

function isRecoverableXiaomiTtsError(error) {
  const message = String(error?.message || "");
  return /HTTP 404|Not Found|audio\/speech|Xiaomi TTS request failed/i.test(message);
}

function cleanErrorMessage(message) {
  return String(message || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

function addEstimatedTimings(items) {
  let cursor = 0;
  return items.map((item) => {
    const spokenSeconds = estimateSpeechSeconds(item.text, item.language);
    const startSeconds = cursor;
    const endSeconds = startSeconds + spokenSeconds + Math.min(item.pauseAfterSeconds, 1.2);
    cursor = startSeconds + spokenSeconds + item.pauseAfterSeconds;
    return {
      ...item,
      startSeconds,
      endSeconds,
      spokenSeconds
    };
  });
}

function estimateSpeechSeconds(text, language) {
  if (language === "zh") {
    return Math.max(2.2, text.length / 4.5);
  }

  const wordCount = text.split(/\s+/).filter(Boolean).length;
  return Math.max(2, (wordCount / 135) * 60);
}

function formatDuration(seconds) {
  const total = Math.round(seconds);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

function pushLog(logs, message) {
  logs.push(`[${new Date().toISOString()}] ${message}`);
}

module.exports = {
  generateStoryWorkflow,
  resolveTtsProvider,
  formatDuration
};
