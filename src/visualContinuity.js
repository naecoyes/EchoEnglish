const DOCUMENTARY_NEGATIVE = [
  "no readable text",
  "no subtitles",
  "no logo",
  "no watermark",
  "no placeholder words",
  "no Your Text",
  "no black lower-third bar",
  "no slide deck",
  "no flat illustration"
].join(", ");

const PODCAST_WORDS = /\b(podcast|host|microphone|mic\b|headphones|recording studio|radio booth|talk-show|interview desk|presenter)\b/i;

function normalizeContinuityMode(value) {
  const mode = String(value || "documentary").trim().toLowerCase();
  if (["reference", "reference-character", "reference character"].includes(mode)) return "reference-character";
  if (["fixed", "fixed-hero", "fixed hero images"].includes(mode)) return "fixed-hero-images";
  return "documentary";
}

function applyVisualContinuity(story, options = {}) {
  const mode = normalizeContinuityMode(options.mode || story?.visualContinuity?.mode);
  const continuity = buildVisualContinuity(story, mode);
  story.visualContinuity = continuity;

  (story.sections || []).forEach((section, sectionIndex) => {
    const groupBase = buildContinuityGroupId(story, section, sectionIndex);
    section.continuityGroupId = section.continuityGroupId || groupBase;
    if (Array.isArray(section.imageBeats)) {
      section.imageBeats = section.imageBeats.map((beat, beatIndex) => ({
        ...beat,
        continuityGroupId: beat.continuityGroupId || `${groupBase}-beat-${String(beatIndex + 1).padStart(2, "0")}`
      }));
    }
  });

  return story;
}

function buildVisualContinuity(story, mode = "documentary") {
  const existing = story?.visualContinuity && typeof story.visualContinuity === "object" ? story.visualContinuity : {};
  const templateId = story?.template?.id || "";
  const topic = story?.topic || story?.title || "the topic";
  const isPodcast = templateId === "podcast-dialogue";
  const isBiography = isPersonFocused(story);
  const isCountry = isCountryHistory(story);
  const isFactual = story?.contentMode === "factual-documentary" || story?.template?.contentMode === "factual-documentary";
  const style = clean(existing.visualStyle)
    || clean(story?.storyboardDesign?.visualStyle)
    || clean(story?.outline?.visualStyle)
    || "photorealistic cinematic documentary still, natural light, realistic textures";

  const characterAnchors = Array.isArray(existing.characterAnchors) && existing.characterAnchors.length
    ? existing.characterAnchors
    : buildCharacterAnchors(story, { isPodcast, isBiography, isFactual });

  return {
    version: "1.0",
    mode,
    strategy: mode === "documentary"
      ? "Documentary continuity: stable visual world, repeated locations and objects, fewer exact-face demands, side/back views and environmental shots when identity may drift."
      : mode === "fixed-hero-images"
        ? "Fixed hero images: generate fewer strong images and reuse them across adjacent narration."
        : "Reference character: use uploaded or generated reference assets when available.",
    visualStyle: style,
    colorPalette: clean(existing.colorPalette) || inferPalette(story),
    cameraStyle: clean(existing.cameraStyle) || "documentary photography, 35mm lens feel, subtle depth of field, calm cinematic composition",
    locationAnchors: normalizeStringList(existing.locationAnchors).length
      ? normalizeStringList(existing.locationAnchors)
      : buildLocationAnchors(story, { isCountry, isBiography, isPodcast }),
    characterAnchors,
    negativePrompt: clean(existing.negativePrompt) || DOCUMENTARY_NEGATIVE,
    reusePolicy: clean(existing.reusePolicy) || "One image beat should cover 2-5 adjacent sentences. Reuse the same beat image across its sentence range.",
    topicAnchor: `All visuals must stay focused on "${topic}" and must not drift to another person, company, country, or story.`,
    createdAt: existing.createdAt || new Date().toISOString()
  };
}

function buildSceneContinuityAnchor(story, section, beatIndex, targetAspectRatio = "16:9") {
  const continuity = story?.visualContinuity || buildVisualContinuity(story);
  const beat = Array.isArray(section?.imageBeats) ? section.imageBeats[beatIndex] : null;
  const character = selectCharacterAnchor(continuity, story, section);
  const locationAnchor = selectLocationAnchor(continuity, section);
  const groupId = beat?.continuityGroupId || section?.continuityGroupId || "scene-continuity";
  const modeInstruction = continuity.mode === "fixed-hero-images"
    ? "Use a strong reusable hero-image composition that can stay on screen across multiple adjacent sentences."
    : continuity.mode === "reference-character"
      ? "If a reference image is supplied by the workflow, preserve the reference character's identity, wardrobe, and age; otherwise use documentary-safe side/back/context shots."
      : "Use documentary continuity: stable setting, consistent wardrobe/object motifs, side or back view when exact facial identity could drift.";

  return [
    `Continuity group: ${groupId}.`,
    `Aspect ratio: ${targetAspectRatio}.`,
    `Video visual anchor: ${continuity.visualStyle}.`,
    `Color palette: ${continuity.colorPalette}.`,
    `Camera style: ${continuity.cameraStyle}.`,
    character ? `Character/subject anchor: ${character}.` : "",
    locationAnchor ? `Location/object anchor: ${locationAnchor}.` : "",
    modeInstruction,
    `Topic lock: ${continuity.topicAnchor}`,
    `Global negative constraints: ${continuity.negativePrompt}.`
  ].filter(Boolean).join(" ");
}

function sceneContinuityMetadata(story, section, beatIndex, sceneId) {
  const continuity = story?.visualContinuity || buildVisualContinuity(story);
  const beat = Array.isArray(section?.imageBeats) ? section.imageBeats[beatIndex] : null;
  return {
    continuityMode: continuity.mode,
    continuityGroupId: beat?.continuityGroupId || section?.continuityGroupId || sceneId,
    characterAnchor: selectCharacterAnchor(continuity, story, section),
    locationAnchor: selectLocationAnchor(continuity, section),
    negativePrompt: continuity.negativePrompt
  };
}

function inspectImageContinuityManifest(manifest, story) {
  const warnings = [];
  const isPodcast = story?.template?.id === "podcast-dialogue";
  for (const item of manifest?.items || []) {
    const sceneId = String(item.sceneId || "");
    const prompt = String(item.prompt || "");
    if (!isPodcast && sceneId.startsWith("podcast-host")) {
      warnings.push(`Image manifest contains podcast host image ${sceneId} for a non-podcast video.`);
    }
    if (!isPodcast && /^scene-/.test(sceneId) && PODCAST_WORDS.test(prompt)) {
      warnings.push(`Scene image ${sceneId} prompt appears to contain podcast/studio terms for a non-podcast video.`);
    }
    if (item.status === "completed" && item.quality && item.quality.ok === false) {
      warnings.push(`Scene image ${sceneId} has failed image quality metadata.`);
    }
  }
  return warnings;
}

function buildContinuityGroupId(story, section, index) {
  const template = story?.template?.id || story?.contentMode || "story";
  const title = clean(section?.title).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32);
  return `${template}-scene-${String(index + 1).padStart(3, "0")}${title ? `-${title}` : ""}`;
}

function buildCharacterAnchors(story, flags) {
  if (flags.isPodcast) {
    return [
      "Host A: one warm confident female podcast host, same wardrobe and hairstyle across the video.",
      "Host B: one calm trustworthy male podcast host, same wardrobe and hairstyle across the video."
    ];
  }
  if (flags.isBiography) {
    return [
      `Public subject of "${story?.title || story?.topic}": show one consistent public-subject-inspired figure only when needed; prefer silhouette, side view, back view, desk objects, documents, tools, public stage, memorial space, or symbolic environment instead of exact face demands.`
    ];
  }
  if (flags.isFactual) {
    return [
      `Factual subject of "${story?.title || story?.topic}": use public documentary environments, products, locations, artifacts, and people only when supported by the story. Avoid invented private characters.`
    ];
  }
  return [
    `Main story character: keep one consistent age range, hairstyle, clothing palette, and calm realistic expression across scenes; prefer side view, back view, hands, objects, and location continuity when possible.`
  ];
}

function buildLocationAnchors(story, flags) {
  if (flags.isPodcast) return ["premium podcast studio desk, warm lamps, clean background with no readable screen text"];
  if (flags.isCountry) return ["geography, historic architecture, museums, artifacts, ports, city streets, public memorial spaces, map-like compositions without labels"];
  if (flags.isBiography) return ["school, laboratory, studio, study, public stage, archive room, tools, awards, city context, memorial space"];
  return ["recurring real-world locations from the story, consistent lighting, repeated objects, natural backgrounds"];
}

function selectCharacterAnchor(continuity, story, section) {
  const anchors = continuity.characterAnchors || [];
  if (!anchors.length) return "";
  if (story?.template?.id === "podcast-dialogue") {
    const text = `${section?.speakers?.join(" ") || ""} ${section?.title || ""}`.toLowerCase();
    if (text.includes("host-b")) return anchors.find((anchor) => /^host b/i.test(anchor)) || anchors[1] || anchors[0];
    return anchors.find((anchor) => /^host a/i.test(anchor)) || anchors[0];
  }
  return anchors[0];
}

function selectLocationAnchor(continuity, section) {
  const anchors = continuity.locationAnchors || [];
  if (!anchors.length) return "";
  const visual = String(section?.visual || section?.imagePrompt || "").toLowerCase();
  const matched = anchors.find((anchor) => {
    const firstWord = String(anchor).toLowerCase().split(/[\s,]+/).find(Boolean);
    return firstWord && visual.includes(firstWord);
  });
  return matched || anchors[0];
}

function inferPalette(story) {
  if (isCountryHistory(story)) return "earth tones, museum neutrals, soft blue skies, warm stone, restrained documentary contrast";
  if (isPersonFocused(story)) return "warm neutrals, deep blue shadows, soft gold highlights, archival paper tones";
  if (story?.contentMode === "factual-documentary") return "clean documentary blues, warm practical lights, realistic neutral colors";
  return "warm natural colors, soft contrast, consistent clothing accents, calm cinematic shadows";
}

function isPersonFocused(story) {
  const text = `${story?.topic || ""} ${story?.title || ""} ${story?.template?.id || ""} ${story?.template?.title || ""}`.toLowerCase();
  return /\b(founder|biography|life of|profile|public-figure-biography|person|leader|ceo)\b/.test(text)
    || /(人物传记|传记|生平|一生|创始人|企业家)/.test(`${story?.topic || ""} ${story?.title || ""}`);
}

function isCountryHistory(story) {
  const text = `${story?.topic || ""} ${story?.title || ""} ${story?.template?.id || ""} ${story?.template?.title || ""}`.toLowerCase();
  return /\bcountry-history\b|\bcountry history\b|\bnational history\b|\bhistory of\b/.test(text)
    || /(国家历史|国家发展史|中国历史|日本历史|法国历史|巴西历史|埃及历史|印度历史|美国历史|英国历史|德国历史|俄罗斯历史|韩国历史)/.test(`${story?.topic || ""} ${story?.title || ""}`);
}

function normalizeStringList(value) {
  if (!Array.isArray(value)) return [];
  return value.map(clean).filter(Boolean).slice(0, 12);
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

module.exports = {
  applyVisualContinuity,
  buildSceneContinuityAnchor,
  buildVisualContinuity,
  inspectImageContinuityManifest,
  normalizeContinuityMode,
  sceneContinuityMetadata
};
