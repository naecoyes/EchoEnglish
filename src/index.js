#!/usr/bin/env node

const { generateStoryWorkflow, formatDuration } = require("./storyWorkflow");

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = await generateStoryWorkflow({
    topic: args.topic || "A Rainy Day",
    minutes: Number(args.minutes || 3),
    outputRoot: args.out || "outputs",
    ttsProvider: args["tts-provider"],
    minimaxModel: args["minimax-model"],
    minimaxVoice: args["minimax-voice"],
    minimaxCnVoice: args["minimax-cn-voice"],
    speed: args.speed,
    voice: args.voice,
    cnVoice: args["cn-voice"],
    rate: args.rate,
    imageMode: args["image-mode"] || "local",
    musicMode: args["music-mode"] || "none",
    musicModel: args["music-model"],
    musicVolume: args["music-volume"],
    storyMode: args["story-mode"] || "lesson",
    skipAudio: Boolean(args["skip-audio"])
  });

  console.log(`Generated: ${result.story.title}`);
  console.log(`Output: ${result.outputDir}`);
  console.log(`Duration: ${formatDuration(result.durationSeconds)}`);
  if (result.audioSummary) {
    console.log(`Audio: ${result.audioSummary.audioPath}`);
    console.log(`TTS Provider: ${result.audioSummary.provider}`);
    console.log(`Voices: English=${result.audioSummary.englishVoice}, Chinese=${result.audioSummary.chineseVoice}`);
    if (result.audioSummary.fallbackCount > 0) {
      console.log(`Warning: ${result.audioSummary.fallbackCount} TTS chunks were replaced with timed silence because local speech synthesis returned empty audio.`);
    }
  }
  if (result.videoSummary) {
    console.log(`Video: ${result.videoSummary.videoPath}`);
  }
  if (result.musicSummary) {
    console.log(`Music: ${result.musicSummary.musicPath}`);
  }
}

function parseArgs(argv) {
  const parsed = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      continue;
    }

    const key = arg.slice(2);
    if (key === "skip-audio") {
      parsed[key] = true;
      continue;
    }

    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      throw new Error(`Missing value for --${key}`);
    }

    parsed[key] = next;
    index += 1;
  }

  return parsed;
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
