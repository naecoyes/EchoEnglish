function buildCoverPromptSet(story) {
  const base = buildCoverBase(story);
  return {
    youtube: {
      id: "cover-youtube",
      label: "YouTube Landscape Cover",
      aspectRatio: "16:9",
      prompt: buildYouTubeCoverPrompt(story, base)
    },
    vertical: {
      id: "cover-vertical",
      label: "Douyin Vertical Cover",
      aspectRatio: "9:16",
      prompt: buildVerticalCoverPrompt(story, base)
    }
  };
}

function buildCoverBase(story) {
  return [
    `Video title: ${clean(story?.title || story?.topic || "English story", 120)}.`,
    story?.topic ? `Topic: ${clean(story.topic, 80)}.` : "",
    story?.summary ? `Story summary: ${clean(story.summary, 180)}.` : "",
    story?.template?.title ? `Video type: ${clean(story.template.title, 80)}.` : "",
    story?.storyboardDesign?.visualStyle ? `Visual style: ${clean(story.storyboardDesign.visualStyle, 140)}.` : "",
    story?.coverImagePrompt ? `Creative seed: ${clean(story.coverImagePrompt, 220)}.` : ""
  ].filter(Boolean).join(" ");
}

function buildYouTubeCoverPrompt(story, base) {
  return [
    "Create a 16:9 YouTube thumbnail background for an English shadowing learning video.",
    base,
    "Audience: English learners browsing YouTube. The image must be instantly readable at small thumbnail size.",
    "Composition: photorealistic cinematic poster frame, one powerful subject or symbolic object, strong depth, clean negative space for external title overlay.",
    "Thumbnail style: high contrast, bright focal light, rich natural colors, emotional curiosity, premium educational channel look.",
    coverSubjectRule(story),
    "Safe zones: leave the left-center and lower third visually clean enough for EchoEnglish title graphics added later.",
    "Negative constraints: no embedded text, no letters, no readable signs, no subtitles, no logo, no watermark, no black caption bar, no placeholder words like Your Text, no cartoon, no PPT design."
  ].filter(Boolean).join(" ");
}

function buildVerticalCoverPrompt(story, base) {
  return [
    "Create a 9:16 vertical cover background for Douyin/TikTok/Reels style short video preview.",
    base,
    "Audience: mobile viewers. The image must work as a full-screen vertical first frame.",
    "Composition: photorealistic vertical poster frame, close focal subject in upper or center area, strong depth, clean middle space for external title graphics.",
    "Mobile style: vivid realistic lighting, clear silhouette, strong emotional hook, premium short-video learning channel look.",
    coverSubjectRule(story),
    "Safe zones: keep the top 12% and bottom 18% clean enough for app UI and EchoEnglish overlays added later.",
    "Negative constraints: no embedded text, no letters, no readable signs, no subtitles, no logo, no watermark, no black caption bar, no placeholder words like Your Text, no cartoon, no PPT design."
  ].filter(Boolean).join(" ");
}

function coverSubjectRule(story) {
  const text = `${story?.topic || ""} ${story?.title || ""} ${story?.template?.id || ""}`.toLowerCase();
  if (isCountryHistoryStory(story)) {
    return "Country history rule: emphasize a strong landmark, historic building, artifact, museum space, map-like geography without labels, public memorial space, port, or city skyline. Keep a clean central title-safe area. Avoid wrong flags, readable signs, propaganda imagery, battle scenes, or unrelated faces.";
  }
  if (isPublicFigureBiographyStory(story)) {
    return "Public figure biography rule: use a respectful symbolic biography background such as a single silhouette, side-view portrait, public stage, study, laboratory, studio, archival documents, tools, awards, or memorial space. Keep clean central title-safe space. Avoid exact-face demands, unrelated faces, gossip imagery, paparazzi style, readable names, logos, or embedded text.";
  }
  if (/\b(founder|biography|ceo|person|life of|jobs|musk|lei jun|bill gates)\b/.test(text)) {
    return "Person-focused rule: use one consistent public-subject-inspired silhouette or contextual object/location shot. Avoid unrelated faces or group portraits unless required.";
  }
  if (/\b(company|startup|origin|product|launch|history|apple|spacex|xiaomi|tesla)\b/.test(text)) {
    return "Company/product rule: emphasize a symbolic product, workshop, launch stage, factory, office, or milestone object. Avoid fake logos and readable brand text.";
  }
  return "Story rule: show the key mood, conflict, or object from the topic with one clear focal subject and no unrelated people.";
}

function isCountryHistoryStory(story) {
  const text = `${story?.topic || ""} ${story?.title || ""} ${story?.template?.id || ""} ${story?.template?.title || ""}`.toLowerCase();
  return /\bcountry-history\b|\bcountry history\b|\bnational history\b|\bhistory of (japan|china|egypt|brazil|france|germany|india|italy|spain|turkey|iran|thailand|vietnam|korea|russia|mexico|canada|australia|greece|peru|morocco|indonesia|philippines)\b|\b(japanese|chinese|egyptian|brazilian|french|german|indian|italian|spanish|turkish|iranian|thai|vietnamese|korean|american|russian|mexican|canadian|australian|british|greek) history\b/.test(text)
    || /(国家历史|国家发展史|某国历史|某国发展史|中国历史|中国发展史|日本历史|日本发展史|法国历史|法国发展史|巴西历史|巴西发展史|埃及历史|埃及发展史|印度历史|印度发展史|美国历史|美国发展史|英国历史|英国发展史|德国历史|德国发展史|俄罗斯历史|俄罗斯发展史|韩国历史|韩国发展史)/.test(`${story?.topic || ""} ${story?.title || ""}`);
}

function isPublicFigureBiographyStory(story) {
  const text = `${story?.topic || ""} ${story?.title || ""} ${story?.template?.id || ""} ${story?.template?.title || ""}`.toLowerCase();
  return /\bpublic-figure-biography\b|\bpublic figure biography\b|\bbiography of\b|\blife of\b|\bprofile of\b|\bbiography\b/.test(text)
    || /(人物传记|人物纪录片|传记|生平|一生|个人传记|名人传记)/.test(`${story?.topic || ""} ${story?.title || ""}`);
}

function renderCoverPrompts(story, coverPrompts = buildCoverPromptSet(story)) {
  const lines = [
    `# Cover Prompts: ${story?.title || story?.topic || "Story Video"}`,
    "",
    "These cover prompts are separate from scene background prompts.",
    "The generated images should be clean background covers; EchoEnglish overlays title text later.",
    ""
  ];
  for (const item of [coverPrompts.youtube, coverPrompts.vertical].filter(Boolean)) {
    lines.push(`## ${item.label}`);
    lines.push("");
    lines.push(`- Scene ID: ${item.id}`);
    lines.push(`- Aspect Ratio: ${item.aspectRatio}`);
    lines.push("");
    lines.push(item.prompt);
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

function clean(value, maxChars = 220) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= maxChars) return text;
  const slice = text.slice(0, Math.max(40, maxChars - 1));
  const end = Math.max(slice.lastIndexOf(". "), slice.lastIndexOf(", "), slice.lastIndexOf("; "));
  return (end > maxChars * 0.55 ? slice.slice(0, end + 1) : slice).trim();
}

module.exports = {
  buildCoverPromptSet,
  renderCoverPrompts
};
