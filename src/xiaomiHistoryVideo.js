#!/usr/bin/env node

const fs = require("node:fs/promises");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { createRequire } = require("node:module");
const { createAudio: createMiniMaxAudio } = require("./minimaxTts");
const { createAudio: createLocalAudio } = require("./localTts");
const { generateImages } = require("./minimaxImage");
const { generateMusic } = require("./minimaxMusic");
const { renderSrt } = require("./renderers");
const { MINIMAX_IMAGE_MODEL, MINIMAX_MUSIC_MODEL, MINIMAX_TTS_MODEL } = require("./minimaxDefaults");
const { ensureDir } = require("./utils");

const execFileAsync = promisify(execFile);

const WIDTH = 1920;
const HEIGHT = 1080;
const OUTPUT_DIR = path.resolve("outputs/xiaomi-history");

const SCENES = [
  {
    year: "2010",
    title: "Starting With Software",
    subtitle: "Lei Jun and partners founded Xiaomi, beginning with MIUI",
    narration: "In twenty ten, Xiaomi was founded in Beijing. Instead of starting with a big retail network, the team began with software. MIUI became its first bridge to users, and feedback from early fans shaped the product quickly.",
    bullets: ["Founded in April 2010", "First focus: MIUI and user community", "Method: fast iteration with early fans"],
    visual: "a small Beijing startup office at night in 2010, three founders gathered around laptops and early Android phones, a whiteboard filled with interface sketches, cardboard takeout boxes, warm desk lamps, quiet determination"
  },
  {
    year: "2011",
    title: "The First Xiaomi Phone",
    subtitle: "Mi 1 turned value for money into a brand signal",
    narration: "In twenty eleven, Xiaomi released its first smartphone, the Mi 1. Strong specifications, an aggressive price, online launches, and flash sales gave Xiaomi a clear identity: make good technology feel more accessible.",
    bullets: ["Mi 1 entered the market", "Online launches amplified attention", "Value for money drove early growth"],
    visual: "a 2011 product launch stage seen from the audience, a presenter holding a black smartphone silhouette under orange spotlights, young fans raising phones to take photos, energetic but realistic tech conference atmosphere"
  },
  {
    year: "2013-2015",
    title: "The Internet Phone Model",
    subtitle: "Online sales, fan culture, and hit-product logic",
    narration: "Over the next few years, Xiaomi treated hardware like an internet product. Launch events created momentum, social media spread the story, online channels lowered cost, and fans joined the conversation around the product.",
    bullets: ["Online channels reduced cost", "Fan culture powered distribution", "Hit-product logic entered hardware"],
    visual: "an isometric command-center view of an online flash sale, warehouse workers moving orange-and-white phone boxes, social media comment streams abstracted as glowing interface panels, delivery routes crossing a night city map"
  },
  {
    year: "2016-2018",
    title: "From Phones to Ecosystem",
    subtitle: "IoT and lifestyle products expanded the boundary",
    narration: "Xiaomi did not stay only in smartphones. It invested in ecosystem companies and connected bands, televisions, air purifiers, and smart-home devices into a wider consumer technology map.",
    bullets: ["Ecosystem companies expanded categories", "IoT devices entered the home", "Mi Home strengthened offline contact"],
    visual: "a modern apartment cutaway showing a smartphone controlling a smart TV, fitness band, air purifier, lamp, and small appliances, subtle connection lines, clean lifestyle technology, morning light, human-scale domestic scene"
  },
  {
    year: "2018",
    title: "Listing in Hong Kong",
    subtitle: "An eight-year startup entered the public market",
    narration: "On July ninth, twenty eighteen, Xiaomi listed on the Hong Kong Stock Exchange. The listing was not an ending. It was a public test of whether a startup built on hardware, internet services, and efficiency could become a global technology group.",
    bullets: ["Listed on the Hong Kong Stock Exchange", "Stock code: 1810.HK", "Keywords: globalization, hardware, internet services"],
    visual: "a cinematic view of a Hong Kong financial district trading hall moment, executives applauding near a ceremonial market bell, glass walls, city skyline reflections, orange light accents, no readable stock tickers"
  },
  {
    year: "2021",
    title: "Entering Electric Vehicles",
    subtitle: "Lei Jun led Xiaomi into smart EVs",
    narration: "In twenty twenty one, Xiaomi announced its entry into the smart electric vehicle business and planned long-term investment. For Xiaomi, a car was not just another device. It was a new gateway after phones, homes, operating systems, and services.",
    bullets: ["Smart EV business began", "Long-term investment led by Lei Jun", "From phone ecosystem to people-car-home"],
    visual: "an electric vehicle design studio in 2021, engineers reviewing a clay car model beside large screens of battery and cockpit diagrams, a smartphone and smart-home dashboard on the table, serious long-term engineering mood"
  },
  {
    year: "2024",
    title: "The SU7 Arrives",
    subtitle: "Xiaomi Auto made its key public debut",
    narration: "In March twenty twenty four, Xiaomi officially launched the SU7. The moment showed that Xiaomi's story was never only about phones. It was about entering harder and more complex consumer technology battles.",
    bullets: ["SU7 launched in March 2024", "Pricing drew wide attention", "Xiaomi crossed into car manufacturing"],
    visual: "a sleek electric sedan silhouette on a dramatic launch stage, reflective floor, orange and cool blue lighting, audience in soft focus, premium automotive reveal, futuristic but believable"
  },
  {
    year: "Takeaway",
    title: "The Xiaomi Playbook",
    subtitle: "Users, efficiency, ecosystem, and long-term bets",
    narration: "Looking back, the constant in Xiaomi's startup history is not one single product. It is a method: stay close to users, improve efficiency, expand the ecosystem, and make long-term bets when the market changes.",
    bullets: ["User participation began with community", "Efficiency came from channels and supply chain", "Long-term bets shaped ecosystem and EVs"],
    visual: "a polished visual timeline flowing from a software interface to a smartphone, then smart-home devices, then an electric car on a clean road, sunrise in the background, connected but not cluttered, hopeful ending frame"
  }
];

const SOURCES = [
  ["Britannica - Xiaomi overview and history", "https://www.britannica.com/topic/Xiaomi"],
  ["PR Newswire - Xiaomi founded in April 2010 and listed July 9, 2018", "https://en.prnasia.com/story/220428-0.shtml"],
  ["CNBC - Xiaomi EV registration and March 2021 car-building context", "https://www.cnbc.com/2021/09/01/xiaomi-officially-registers-electric-vehicle-business-led-by-founder.html"],
  ["AP News - Xiaomi SU7 launch, price range, and early orders", "https://apnews.com/article/13900c059ca3c530cf35ddd486328f99"]
];

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const provider = resolveTtsProvider(args["tts-provider"]);

  await ensureDir(OUTPUT_DIR);
  await ensureDir(path.join(OUTPUT_DIR, "slides"));

  const preparedScenes = SCENES.map((scene, index) => ({
    ...scene,
    id: `scene-${String(index + 1).padStart(3, "0")}`,
    imagePrompt: buildImagePrompt(scene)
  }));

  const generatedImages = await maybeGenerateImages(preparedScenes, args);
  const imageByScene = new Map(generatedImages.map((image) => [image.sceneId, image.imagePath]));

  const slideItems = preparedScenes.map((scene) => ({
    id: scene.id,
    kind: "narration",
    text: scene.narration,
    language: "en",
    pauseAfterSeconds: 0.8
  }));

  const audioSummary = await createNarrationAudio(provider, slideItems, args);
  const musicSummary = await maybeGenerateMusic(args);
  const timedScenes = preparedScenes.map((scene, index) => {
    const item = audioSummary.items[index];
    return {
      ...scene,
      generatedImagePath: imageByScene.get(scene.id) || null,
      startSeconds: item.startSeconds,
      endSeconds: item.endSeconds,
      durationSeconds: Math.max(4, item.endSeconds - item.startSeconds)
    };
  });

  await writeScriptFiles(timedScenes, audioSummary, musicSummary);
  await renderSlides(timedScenes);
  await renderVideo(timedScenes, audioSummary.audioPath, musicSummary?.musicPath, Number(args["music-volume"] || 0.16));

  console.log(`Generated Xiaomi history video workflow: ${OUTPUT_DIR}`);
  console.log(`Video: ${path.join(OUTPUT_DIR, "final.mp4")}`);
  console.log(`TTS Provider: ${audioSummary.provider}`);
  if (musicSummary) {
    console.log(`Music: ${musicSummary.musicPath}`);
  }
  if (audioSummary.fallbackCount > 0) {
    console.log(`Warning: ${audioSummary.fallbackCount} narration chunks used timed silence because local TTS returned empty audio.`);
  }
}

async function maybeGenerateMusic(args) {
  const provider = args["music-provider"] || "none";
  if (!["none", "minimax"].includes(provider)) {
    throw new Error("--music-provider must be one of: none, minimax.");
  }

  if (provider === "none") {
    return null;
  }

  return generateMusic({
    outputDir: OUTPUT_DIR,
    apiKey: process.env.MINIMAX_API_KEY,
    model: args["music-model"] || MINIMAX_MUSIC_MODEL,
    prompt: args["music-prompt"] || "instrumental corporate technology documentary, calm, inspiring, modern, light electronic pulse, subtle piano, no vocals, suitable for startup history narration"
  });
}

async function maybeGenerateImages(scenes, args) {
  const provider = args["image-provider"] || "local";
  if (!["local", "minimax"].includes(provider)) {
    throw new Error("--image-provider must be one of: local, minimax.");
  }

  if (provider === "local") {
    return [];
  }

  return generateImages({
    scenes,
    outputDir: OUTPUT_DIR,
    apiKey: process.env.MINIMAX_API_KEY,
    model: args["image-model"] || MINIMAX_IMAGE_MODEL,
    aspectRatio: args["aspect-ratio"] || "16:9",
    promptOptimizer: args["prompt-optimizer"] !== "false"
  });
}

async function createNarrationAudio(provider, readingItems, args) {
  if (provider === "minimax") {
    return createMiniMaxAudio({
      readingItems,
      outputDir: OUTPUT_DIR,
      apiKey: process.env.MINIMAX_API_KEY,
      model: args["minimax-model"] || MINIMAX_TTS_MODEL,
      englishVoice: args["minimax-voice"] || "English_Graceful_Lady",
      chineseVoice: args["minimax-cn-voice"] || "Chinese (Mandarin)_Warm_Girl",
      speed: Number(args.speed || 0.95)
    });
  }

  return createLocalAudio({
    readingItems,
    outputDir: OUTPUT_DIR,
    englishVoice: args.voice,
    chineseVoice: args["cn-voice"],
    englishRate: Number(args.rate || 150)
  });
}

async function writeScriptFiles(timedScenes, audioSummary, musicSummary) {
  const script = {
    title: "Xiaomi Startup History",
    language: "en-US",
    style: "timeline documentary",
    generatedAt: new Date().toISOString(),
    ttsProvider: audioSummary.provider,
    music: musicSummary,
    scenes: timedScenes,
    outputs: {
      markdown: "script.md",
      subtitles: "subtitles.srt",
      images: "images/",
      music: musicSummary ? "music/background.mp3" : null,
      sources: "sources.md",
      video: "final.mp4"
    }
  };

  const markdown = [
    "# Xiaomi Startup History",
    "",
    "Format: short English timeline documentary.",
    "",
    ...timedScenes.flatMap((scene, index) => [
      `## ${index + 1}. ${scene.year} - ${scene.title}`,
      "",
      `Narration: ${scene.narration}`,
      "",
      "On-screen points:",
      ...scene.bullets.map((bullet) => `- ${bullet}`),
      "",
      `Image prompt: ${buildImagePrompt(scene)}`,
      ""
    ])
  ].join("\n");

  const sources = [
    "# Sources",
    "",
    "This video is an educational summary based on public sources.",
    "",
    ...SOURCES.map(([label, url]) => `- [${label}](${url})`),
    ""
  ].join("\n");

  await fs.writeFile(path.join(OUTPUT_DIR, "script.json"), `${JSON.stringify(script, null, 2)}\n`);
  await fs.writeFile(path.join(OUTPUT_DIR, "script.md"), markdown);
  await fs.writeFile(path.join(OUTPUT_DIR, "subtitles.srt"), renderSrt(audioSummary.items));
  await fs.writeFile(path.join(OUTPUT_DIR, "sources.md"), sources);
}

async function renderSlides(timedScenes) {
  const sharp = loadSharp();
  for (let index = 0; index < timedScenes.length; index += 1) {
    const scene = timedScenes[index];
    const imageDataUri = scene.generatedImagePath ? await imageToDataUri(scene.generatedImagePath) : null;
    const svg = renderSlideSvg(scene, index, imageDataUri);
    const slidePath = path.join(OUTPUT_DIR, "slides", `${scene.id}.png`);
    await sharp(Buffer.from(svg)).png().toFile(slidePath);
  }
}

async function renderVideo(timedScenes, audioPath, musicPath, musicVolume) {
  const concatPath = path.join(OUTPUT_DIR, "slides", "concat.txt");
  const lines = [];

  timedScenes.forEach((scene) => {
    const slidePath = path.join(OUTPUT_DIR, "slides", `${scene.id}.png`);
    lines.push(`file '${escapeConcatPath(slidePath)}'`);
    lines.push(`duration ${scene.durationSeconds.toFixed(3)}`);
  });

  const lastScene = timedScenes[timedScenes.length - 1];
  lines.push(`file '${escapeConcatPath(path.join(OUTPUT_DIR, "slides", `${lastScene.id}.png`))}'`);
  await fs.writeFile(concatPath, lines.join("\n"));

  const args = [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    concatPath,
    "-i",
    audioPath
  ];

  if (musicPath) {
    args.push("-stream_loop", "-1", "-i", musicPath);
  }

  args.push(
    "-vf",
    "fps=30,format=yuv420p",
  );

  if (musicPath) {
    args.push(
      "-filter_complex",
      `[1:a]volume=1.0[narration];[2:a]volume=${musicVolume}[music];[narration][music]amix=inputs=2:duration=first:dropout_transition=2[aout]`,
      "-map",
      "0:v",
      "-map",
      "[aout]"
    );
  }

  args.push(
    "-c:v",
    "libx264",
    "-c:a",
    "aac",
    "-shortest",
    path.join(OUTPUT_DIR, "final.mp4")
  );

  await execFileAsync("ffmpeg", args, {
    maxBuffer: 1024 * 1024 * 16
  });
}

function renderSlideSvg(scene, index, imageDataUri) {
  const accent = index % 2 === 0 ? "#ff6900" : "#00a1d6";
  const secondary = index % 2 === 0 ? "#2f7d67" : "#7a4bd8";
  const titleLines = wrapWords(scene.title, 26).slice(0, 2);
  const captionHeight = titleLines.length > 1 ? 282 : 224;
  const subtitleY = titleLines.length > 1 ? 248 : 196;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <defs>
    <linearGradient id="shade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#000000" stop-opacity="0.22"/>
      <stop offset="48%" stop-color="#000000" stop-opacity="0.04"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0.72"/>
    </linearGradient>
    <linearGradient id="sceneBg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#10151d"/>
      <stop offset="48%" stop-color="#27313b"/>
      <stop offset="100%" stop-color="#0f1115"/>
    </linearGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${accent}"/>
      <stop offset="100%" stop-color="${secondary}"/>
    </linearGradient>
  </defs>
  ${imageDataUri
    ? `<image href="${imageDataUri}" x="0" y="0" width="${WIDTH}" height="${HEIGHT}" preserveAspectRatio="xMidYMid slice"/>`
    : renderLocalSceneArt(index, accent, secondary)}
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#shade)"/>
  <rect x="0" y="0" width="${WIDTH}" height="${HEIGHT}" fill="none" stroke="#000000" stroke-opacity="0.24" stroke-width="2"/>

  <g transform="translate(112 742)">
    <rect x="0" y="0" width="980" height="${captionHeight}" rx="28" fill="#05070a" opacity="0.72"/>
    <rect x="0" y="0" width="10" height="${captionHeight}" rx="5" fill="url(#accent)"/>
    <text x="46" y="68" font-family="Arial, sans-serif" font-size="34" font-weight="700" fill="${accent}">${escapeXml(scene.year)}</text>
    ${titleLines.map((line, lineIndex) => `<text x="46" y="${132 + lineIndex * 58}" font-family="Arial, sans-serif" font-size="54" font-weight="800" fill="#ffffff">${escapeXml(line)}</text>`).join("\n    ")}
    <text x="46" y="${subtitleY}" font-family="Arial, sans-serif" font-size="25" fill="#d9dde2">${escapeXml(scene.subtitle)}</text>
  </g>

  <text x="112" y="1026" font-family="Arial, sans-serif" font-size="22" fill="#ffffff" opacity="0.58">Xiaomi Startup History / generated by Codex workflow</text>
</svg>`;
}

function renderLocalSceneArt(index, accent, secondary) {
  const variants = [
    renderStartupOffice,
    renderPhoneLaunch,
    renderFlashSale,
    renderSmartHome,
    renderMarketListing,
    renderEvStudio,
    renderCarLaunch,
    renderTimelineFinale
  ];

  return variants[index % variants.length](accent, secondary);
}

function renderStartupOffice(accent, secondary) {
  return `
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#sceneBg)"/>
  <rect x="0" y="650" width="${WIDTH}" height="430" fill="#11161d"/>
  <rect x="260" y="210" width="980" height="430" rx="20" fill="#202833"/>
  <rect x="306" y="254" width="886" height="310" rx="12" fill="#e7efe9" opacity="0.9"/>
  <path d="M370 350 H620 M370 410 H820 M370 470 H710" stroke="${secondary}" stroke-width="10" opacity="0.55"/>
  <rect x="430" y="675" width="1060" height="54" rx="12" fill="#4d3524"/>
  <rect x="560" y="560" width="290" height="170" rx="18" fill="#111318"/>
  <rect x="920" y="570" width="270" height="160" rx="18" fill="#151a20"/>
  <circle cx="610" cy="805" r="56" fill="${accent}" opacity="0.85"/>
  <circle cx="1030" cy="810" r="52" fill="${secondary}" opacity="0.86"/>
  <circle cx="1340" cy="810" r="50" fill="#f1b15a" opacity="0.78"/>
  <path d="M1250 420 C1380 310 1550 350 1660 250" stroke="${accent}" stroke-width="16" fill="none" opacity="0.65"/>
  <circle cx="1540" cy="250" r="190" fill="${accent}" opacity="0.12"/>`;
}

function renderPhoneLaunch(accent, secondary) {
  return `
  <rect width="${WIDTH}" height="${HEIGHT}" fill="#111116"/>
  <path d="M0 860 C420 690 740 760 1100 690 C1420 630 1700 690 1920 560 L1920 1080 L0 1080 Z" fill="#1f2228"/>
  <circle cx="960" cy="430" r="330" fill="${accent}" opacity="0.18"/>
  <rect x="790" y="230" width="310" height="560" rx="48" fill="#050609" stroke="#3c4653" stroke-width="10"/>
  <rect x="830" y="292" width="230" height="405" rx="22" fill="#202833"/>
  <path d="M690 805 C860 875 1060 870 1240 800" stroke="${secondary}" stroke-width="18" opacity="0.78" fill="none"/>
  ${Array.from({ length: 11 }, (_, i) => `<circle cx="${360 + i * 120}" cy="${900 + (i % 2) * 28}" r="${32 + (i % 3) * 6}" fill="#d8dde3" opacity="0.34"/>`).join("")}`;
}

function renderFlashSale(accent, secondary) {
  return `
  <rect width="${WIDTH}" height="${HEIGHT}" fill="#121821"/>
  <path d="M200 220 H1720 V690 H200 Z" fill="#1c2631"/>
  ${Array.from({ length: 7 }, (_, i) => `<rect x="${290 + i * 205}" y="${305 + (i % 2) * 34}" width="132" height="92" rx="10" fill="${i % 2 ? secondary : accent}" opacity="0.72"/>`).join("")}
  <path d="M360 770 C560 650 700 850 900 720 S1260 650 1500 760" stroke="${accent}" stroke-width="14" fill="none"/>
  <path d="M280 860 H1640" stroke="#eef3f7" stroke-width="6" opacity="0.42"/>
  ${Array.from({ length: 9 }, (_, i) => `<circle cx="${330 + i * 155}" cy="${860}" r="16" fill="#eef3f7" opacity="0.65"/>`).join("")}
  <circle cx="1590" cy="250" r="210" fill="${secondary}" opacity="0.12"/>`;
}

function renderSmartHome(accent, secondary) {
  return `
  <rect width="${WIDTH}" height="${HEIGHT}" fill="#dbe6e2"/>
  <rect x="230" y="185" width="1440" height="690" rx="36" fill="#f7f5ef"/>
  <rect x="330" y="310" width="430" height="250" rx="24" fill="#222831"/>
  <rect x="870" y="305" width="220" height="330" rx="34" fill="#101318"/>
  <circle cx="1210" cy="420" r="95" fill="${secondary}" opacity="0.74"/>
  <rect x="1320" y="520" width="190" height="165" rx="28" fill="#ffffff" stroke="#d0d7dd" stroke-width="10"/>
  <path d="M980 470 C800 380 670 610 520 435 M980 470 C1120 340 1240 500 1410 600" stroke="${accent}" stroke-width="10" fill="none" opacity="0.62"/>
  <circle cx="980" cy="470" r="72" fill="${accent}"/>
  <rect x="0" y="875" width="${WIDTH}" height="205" fill="#becbc5"/>`;
}

function renderMarketListing(accent, secondary) {
  return `
  <rect width="${WIDTH}" height="${HEIGHT}" fill="#0d141d"/>
  <path d="M0 790 C340 650 620 730 900 620 C1240 490 1540 600 1920 430 L1920 1080 L0 1080 Z" fill="#16202b"/>
  <rect x="300" y="230" width="1320" height="470" rx="26" fill="#e8edf0" opacity="0.92"/>
  <path d="M420 575 H1490" stroke="#252a32" stroke-width="10" opacity="0.35"/>
  <circle cx="960" cy="505" r="118" fill="${accent}" opacity="0.82"/>
  <path d="M640 430 C800 330 1010 360 1220 260 C1330 208 1430 198 1530 220" stroke="${secondary}" stroke-width="16" fill="none"/>
  <circle cx="1545" cy="230" r="180" fill="${accent}" opacity="0.12"/>`;
}

function renderEvStudio(accent, secondary) {
  return `
  <rect width="${WIDTH}" height="${HEIGHT}" fill="#12161d"/>
  <rect x="190" y="160" width="1540" height="640" rx="34" fill="#1e2630"/>
  <path d="M410 660 C550 470 760 390 1010 430 C1230 465 1370 560 1510 660 Z" fill="#d9dde2" opacity="0.88"/>
  <circle cx="610" cy="670" r="64" fill="#111318"/>
  <circle cx="1290" cy="670" r="64" fill="#111318"/>
  <rect x="320" y="240" width="390" height="220" rx="18" fill="#0c1117"/>
  <rect x="1210" y="240" width="330" height="220" rx="18" fill="#0c1117"/>
  <path d="M370 360 L620 300 M1260 370 C1340 300 1430 330 1490 270" stroke="${accent}" stroke-width="10" opacity="0.76"/>
  <circle cx="960" cy="290" r="130" fill="${secondary}" opacity="0.14"/>`;
}

function renderCarLaunch(accent, secondary) {
  return `
  <rect width="${WIDTH}" height="${HEIGHT}" fill="#08090d"/>
  <path d="M0 760 H1920 V1080 H0 Z" fill="#151921"/>
  <ellipse cx="960" cy="760" rx="680" ry="90" fill="${accent}" opacity="0.18"/>
  <path d="M450 675 C620 510 830 470 1060 505 C1240 530 1405 580 1530 678 Z" fill="#dce3e8" opacity="0.94"/>
  <path d="M690 560 C820 500 980 505 1120 575" stroke="#111318" stroke-width="18" fill="none" opacity="0.72"/>
  <circle cx="690" cy="690" r="70" fill="#101217"/>
  <circle cx="1280" cy="690" r="70" fill="#101217"/>
  <path d="M300 365 C620 230 1240 210 1620 355" stroke="${secondary}" stroke-width="18" fill="none" opacity="0.54"/>
  <circle cx="960" cy="415" r="310" fill="${accent}" opacity="0.10"/>`;
}

function renderTimelineFinale(accent, secondary) {
  return `
  <rect width="${WIDTH}" height="${HEIGHT}" fill="#101820"/>
  <path d="M0 780 C480 620 780 740 1180 590 C1460 485 1660 500 1920 420 L1920 1080 L0 1080 Z" fill="#1e2b34"/>
  <path d="M260 620 C520 430 780 560 1000 440 S1370 340 1660 490" stroke="${accent}" stroke-width="16" fill="none"/>
  <rect x="250" y="550" width="190" height="130" rx="18" fill="#e8edf0" opacity="0.88"/>
  <rect x="600" y="420" width="130" height="230" rx="24" fill="#e8edf0" opacity="0.9"/>
  <circle cx="980" cy="445" r="92" fill="${secondary}" opacity="0.82"/>
  <path d="M1230 565 C1320 460 1480 435 1620 540 L1670 600 H1170 Z" fill="#e8edf0" opacity="0.9"/>
  <circle cx="1295" cy="610" r="44" fill="#12161d"/>
  <circle cx="1560" cy="610" r="44" fill="#12161d"/>
  <circle cx="1545" cy="240" r="190" fill="${accent}" opacity="0.15"/>`;
}

async function imageToDataUri(filePath) {
  const bytes = await fs.readFile(filePath);
  return `data:image/png;base64,${bytes.toString("base64")}`;
}

function buildImagePrompt(scene) {
  return [
    "Create a 16:9 key visual for a premium business-history documentary about Xiaomi's startup journey.",
    `Scene brief: ${scene.visual}.`,
    "Style: cinematic editorial illustration with realistic lighting, high-end technology magazine art direction, subtle orange accent color, deep contrast, clean composition, detailed but not busy.",
    "Camera: medium-wide documentary frame, clear foreground subject, layered background, strong sense of time period and business context.",
    "Use no readable text, no UI words, no subtitles, no watermarks, no logos, no brand marks, no distorted hands, no extra fingers, no celebrity likeness."
  ].join(" ");
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

function resolveTtsProvider(requestedProvider) {
  const provider = requestedProvider || "auto";
  if (!["auto", "minimax", "local"].includes(provider)) {
    throw new Error("--tts-provider must be one of: auto, minimax, local.");
  }

  if (provider === "minimax" && !process.env.MINIMAX_API_KEY) {
    throw new Error("MINIMAX_API_KEY is required when --tts-provider minimax is used.");
  }

  if (provider === "auto") {
    return process.env.MINIMAX_API_KEY ? "minimax" : "local";
  }

  return provider;
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;

    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      throw new Error(`Missing value for --${key}`);
    }
    parsed[key] = next;
    index += 1;
  }
  return parsed;
}

function wrapText(text, maxChars) {
  if (/^[\x00-\x7F\s.,:;'"!?()/-]+$/.test(text)) {
    return wrapWords(text, maxChars);
  }

  const chars = Array.from(text);
  const lines = [];
  let current = "";

  chars.forEach((char) => {
    const next = `${current}${char}`;
    if (displayWidth(next) > maxChars && current) {
      lines.push(current);
      current = char;
    } else {
      current = next;
    }
  });

  if (current) lines.push(current);
  return lines;
}

function wrapWords(text, maxChars) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";

  words.forEach((word) => {
    const next = current ? `${current} ${word}` : word;
    if (displayWidth(next) > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  });

  if (current) lines.push(current);
  return lines;
}

function displayWidth(text) {
  return Array.from(text).reduce((total, char) => total + (char.charCodeAt(0) > 127 ? 1.8 : 1), 0);
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeConcatPath(file) {
  return file.replace(/'/g, "'\\''");
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
