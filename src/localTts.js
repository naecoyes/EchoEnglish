const fs = require("node:fs/promises");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { ensureDir, pathExists } = require("./utils");

const execFileAsync = promisify(execFile);

async function createAudio({ readingItems, outputDir, englishVoice, chineseVoice, englishRate, logs = [] }) {
  await assertCommand("say", ["-v", "?"]);
  await assertCommand("ffmpeg", ["-version"]);
  await assertCommand("ffprobe", ["-version"]);

  const voices = await listVoices();
  const selectedEnglishVoice = pickVoice(voices, englishVoice, ["Samantha", "Alex", "Ava", "Daniel", "Karen"]);
  const selectedChineseVoice = pickVoice(voices, chineseVoice, ["Tingting", "Meijia", "Sinji", "Eddy (Chinese (China mainland))"]);
  const workDir = path.join(outputDir, "audio-work");
  await ensureDir(workDir);

  const concatFiles = [];
  const timedItems = [];
  let cursor = 0;
  let fallbackCount = 0;

  const total = readingItems.length;
  for (let index = 0; index < readingItems.length; index += 1) {
    const item = readingItems[index];
    pushLog(logs, `Audio ${index + 1}/${total}: ${item.text.slice(0, 60)}${item.text.length > 60 ? "…" : ""}`);

    const baseName = String(index + 1).padStart(4, "0");
    const aiffPath = path.join(workDir, `${baseName}.aiff`);
    const wavPath = path.join(workDir, `${baseName}.wav`);
    const voice = item.language === "zh" ? selectedChineseVoice : selectedEnglishVoice;
    const rate = item.language === "zh" ? 170 : englishRate;

    await execFileAsync("say", ["-v", voice, "-r", String(rate), "-o", aiffPath, item.text], {
      maxBuffer: 1024 * 1024 * 8
    });

    await execFileAsync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-i", aiffPath, "-ar", "44100", "-ac", "1", wavPath], {
      maxBuffer: 1024 * 1024 * 8
    });

    let spokenSeconds = await getDurationSeconds(wavPath);
    if (!spokenSeconds) {
      spokenSeconds = estimateSpeechSeconds(item.text, item.language);
      await createSilence(wavPath, spokenSeconds);
      fallbackCount += 1;
    }

    concatFiles.push(wavPath);

    const displayEnd = cursor + spokenSeconds + Math.min(item.pauseAfterSeconds, 1.2);
    timedItems.push({
      ...item,
      startSeconds: cursor,
      endSeconds: displayEnd,
      spokenSeconds
    });

    cursor += spokenSeconds;

    if (item.pauseAfterSeconds > 0) {
      const silencePath = await getSilenceFile(workDir, item.pauseAfterSeconds);
      concatFiles.push(silencePath);
      cursor += item.pauseAfterSeconds;
    }
  }

  pushLog(logs, `Merging ${concatFiles.length} audio clips into audio.wav…`);
  const concatPath = path.join(workDir, "concat.txt");
  await fs.writeFile(concatPath, concatFiles.map((file) => `file '${escapeConcatPath(file)}'`).join("\n"));

  const audioPath = path.join(outputDir, "audio.wav");
  await execFileAsync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", concatPath, "-c", "copy", audioPath], {
    maxBuffer: 1024 * 1024 * 8
  });

  return {
    provider: "local",
    audioPath,
    englishVoice: selectedEnglishVoice,
    chineseVoice: selectedChineseVoice,
    durationSeconds: cursor,
    fallbackCount,
    items: timedItems
  };
}

async function listVoices() {
  const { stdout } = await execFileAsync("say", ["-v", "?"], { maxBuffer: 1024 * 1024 * 8 });
  return stdout
    .split(/\r?\n/)
    .map((line) => {
      const match = line.match(/^(.+?)\s{2,}([a-z]{2}_[A-Z0-9]+)\s+#/);
      if (!match) return null;
      return {
        name: match[1].trim(),
        locale: match[2].trim()
      };
    })
    .filter(Boolean);
}

function pickVoice(voices, requested, fallbacks) {
  if (requested && voices.some((voice) => voice.name === requested)) {
    return requested;
  }

  const fallback = fallbacks.find((name) => voices.some((voice) => voice.name === name));
  if (fallback) return fallback;

  const englishVoice = voices.find((voice) => voice.locale.startsWith("en_"));
  return englishVoice ? englishVoice.name : voices[0].name;
}

async function getSilenceFile(workDir, seconds) {
  const normalized = Number(seconds).toFixed(1);
  const file = path.join(workDir, `silence_${normalized.replace(".", "_")}.wav`);
  if (await pathExists(file)) {
    return file;
  }

  await createSilence(file, normalized);

  return file;
}

async function createSilence(file, seconds) {
  await execFileAsync("ffmpeg", [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "anullsrc=r=44100:cl=mono",
    "-t",
    String(seconds),
    "-ar",
    "44100",
    "-ac",
    "1",
    file
  ], {
    maxBuffer: 1024 * 1024 * 8
  });
}

async function getDurationSeconds(file) {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    file
  ], {
    maxBuffer: 1024 * 1024
  });

  const duration = Number(stdout.trim());
  if (!Number.isFinite(duration)) {
    return null;
  }
  return duration;
}

function estimateSpeechSeconds(text, language) {
  if (language === "zh") {
    return Math.max(2.2, text.length / 4.5);
  }

  const wordCount = text.split(/\s+/).filter(Boolean).length;
  return Math.max(2, (wordCount / 135) * 60);
}

async function assertCommand(command, args) {
  try {
    await execFileAsync(command, args, { maxBuffer: 1024 * 1024 });
  } catch (error) {
    throw new Error(`Required command failed: ${command}. ${error.message}`);
  }
}

function escapeConcatPath(file) {
  return file.replace(/'/g, "'\\''");
}

function pushLog(logs, message) {
  if (Array.isArray(logs)) logs.push(`[${new Date().toISOString()}] ${message}`);
}

module.exports = {
  createAudio
};
