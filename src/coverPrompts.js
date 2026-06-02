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
  if (/\b(founder|biography|ceo|person|life of|jobs|musk|lei jun|bill gates)\b/.test(text)) {
    return "Person-focused rule: use one consistent public-subject-inspired silhouette or contextual object/location shot. Avoid unrelated faces or group portraits unless required.";
  }
  if (/\b(company|startup|origin|product|launch|history|apple|spacex|xiaomi|tesla)\b/.test(text)) {
    return "Company/product rule: emphasize a symbolic product, workshop, launch stage, factory, office, or milestone object. Avoid fake logos and readable brand text.";
  }
  return "Story rule: show the key mood, conflict, or object from the topic with one clear focal subject and no unrelated people.";
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
