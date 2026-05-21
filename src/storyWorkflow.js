const fs = require("node:fs/promises");
const path = require("node:path");
const { generateStory } = require("./storyGenerator");
const { buildReadingItems, renderImagePrompts, renderMarkdown, renderSrt } = require("./renderers");
const { createAudio: createLocalAudio } = require("./localTts");
const { createAudio: createMiniMaxAudio } = require("./minimaxTts");
const { composeStoryVideo } = require("./storyVideoComposer");
const { generateImages } = require("./minimaxImage");
const { generateMusic } = require("./minimaxMusic");
const { MINIMAX_TTS_MODEL, MINIMAX_IMAGE_MODEL, MINIMAX_MUSIC_MODEL } = require("./minimaxDefaults");
const { getEffectiveSettings } = require("./settingsStore");
const { slugify, ensureDir } = require("./utils");

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

  const story = await generateStory({
    topic,
    targetDurationMinutes: minutes,
    level: "beginner",
    annotationStyle: "zh-brief",
    mode: options.storyMode || "lesson",
    outline: options.storyOutline || null
  });

  let readingItems = buildReadingItems(story);
  let audioSummary = null;
  let musicSummary = null;

  if (!options.skipAudio) {
    const provider = resolveTtsProvider(options.ttsProvider, effectiveApiKey);
    pushLog(logs, `Generating audio with ${provider} TTS`);
    audioSummary = provider === "minimax"
      ? await createMiniMaxAudio({
        readingItems,
        outputDir,
        apiKey: effectiveApiKey,
        model: options.minimaxModel || effectiveModels.tts || MINIMAX_TTS_MODEL,
        englishVoice: options.minimaxVoice || "English_Graceful_Lady",
        chineseVoice: options.minimaxCnVoice || "Chinese (Mandarin)_Sweet_Lady",
        speed: Number(options.speed || 0.92),
        requestIntervalMs: options.ttsRequestIntervalMs,
        logs
      })
      : await createLocalAudio({
        readingItems,
        outputDir,
        englishVoice: options.voice,
        chineseVoice: options.cnVoice,
        englishRate: Number(options.rate || 150),
        logs
      });
    readingItems = audioSummary.items;
  } else {
    pushLog(logs, "Skipping audio; estimating subtitle timings");
    readingItems = addEstimatedTimings(readingItems);
  }

  const outputs = {
    markdown: "script.md",
    subtitles: "subtitles.srt",
    imagePrompts: "image-prompts.md",
    audio: options.skipAudio ? null : "audio.wav",
    music: !options.skipAudio && resolveMusicMode(options.musicMode) === "minimax" ? "music/background.mp3" : null,
    video: options.skipAudio ? null : "final.mp4"
  };

  const scriptJson = {
    ...story,
    readingOrder: readingItems.map(({ id, kind, text, ttsText, language, pauseAfterSeconds, startSeconds, endSeconds, sectionIndex, sentenceIndex, vocabularyIndex, word, translation }) => ({
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
      translation
    })),
    outputs
  };

  await fs.writeFile(path.join(outputDir, "script.json"), `${JSON.stringify(scriptJson, null, 2)}\n`);
  await fs.writeFile(path.join(outputDir, "script.md"), renderMarkdown(story), "utf8");
  await fs.writeFile(path.join(outputDir, "image-prompts.md"), renderImagePrompts(story), "utf8");
  await fs.writeFile(path.join(outputDir, "subtitles.srt"), renderSrt(readingItems), "utf8");

  if (options.imageMode === "minimax") {
    pushLog(logs, "Generating scene images with MiniMax");
    const scenes = getUniqueImageScenes(story);
    pushLog(logs, `Image API requests: ${scenes.length}; reused across ${story.sections.length} story sections.`);
    await generateImages({
      scenes,
      outputDir,
      apiKey: effectiveApiKey,
      model: options.imageModel || effectiveModels.image || MINIMAX_IMAGE_MODEL,
      aspectRatio: "16:9",
      promptOptimizer: true
    });
  }

  if (!options.skipAudio && resolveMusicMode(options.musicMode) === "minimax") {
    pushLog(logs, "Generating background music with MiniMax");
    try {
      musicSummary = await generateMusic({
        outputDir,
        apiKey: effectiveApiKey,
        model: options.musicModel || effectiveModels.music || MINIMAX_MUSIC_MODEL,
        prompt: options.musicPrompt || buildMusicPrompt(story)
      });
      pushLog(logs, "Background music ready: music/background.mp3");
    } catch (error) {
      pushLog(logs, `Background music skipped: ${error.message}`);
      musicSummary = null;
    }
  }

  let videoSummary = null;
  if (!options.skipAudio) {
    pushLog(logs, "Composing final MP4");
    videoSummary = await composeStoryVideo({
      story,
      readingItems,
      outputDir,
      audioPath: audioSummary.audioPath,
      musicPath: musicSummary?.musicPath || null,
      musicVolume: Number(options.musicVolume || 0.12),
      imageMode: options.imageMode || "local",
      logs
    });
  }

  const duration = readingItems.length ? readingItems[readingItems.length - 1].endSeconds : 0;
  pushLog(logs, `Done: ${formatDuration(duration)}`);

  return {
    story,
    slug,
    outputDir,
    durationSeconds: duration,
    audioSummary,
    musicSummary,
    videoSummary,
    files: {
      scriptJson: path.join(outputDir, "script.json"),
      scriptMd: path.join(outputDir, "script.md"),
      imagePrompts: path.join(outputDir, "image-prompts.md"),
      subtitles: path.join(outputDir, "subtitles.srt"),
      audio: options.skipAudio ? null : path.join(outputDir, "audio.wav"),
      music: musicSummary ? path.join(outputDir, "music", "background.mp3") : null,
      video: options.skipAudio ? null : path.join(outputDir, "final.mp4")
    }
  };
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
      seen.set(key, {
        id: buildSceneImageId(baseIndex, variantIndex, beatIndex),
        visual: section.visual,
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

function buildBeatImagePrompt(story, section, beatIndex) {
  const sentences = section.sentences || [];
  const beatSize = Number.isInteger(section.imageBeatSize) ? section.imageBeatSize : story.mode === "pure-story" ? 3 : 2;
  const moment = sentences.slice(beatIndex * beatSize, beatIndex * beatSize + beatSize).join(" ");
  const parts = [
    section.imagePrompt,
    moment ? `Specific moment for this background: ${moment}` : "",
    "Make this image visually distinct from other beats in the same scene."
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

function resolveTtsProvider(requestedProvider, apiKey) {
  const provider = requestedProvider || "auto";
  if (!["auto", "minimax", "local"].includes(provider)) {
    throw new Error("--tts-provider must be one of: auto, minimax, local.");
  }

  const hasKey = Boolean(apiKey);

  if (provider === "minimax" && !hasKey) {
    throw new Error("MINIMAX_API_KEY is required when --tts-provider minimax is used.");
  }

  if (provider === "auto") {
    return hasKey ? "minimax" : "local";
  }

  return provider;
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
