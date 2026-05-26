const fs = require("node:fs/promises");
const path = require("node:path");
const { ensureDir } = require("./utils");

async function writeYouTubeCopy({ outputDir, story, readingItems = [], qualityReport = null }) {
  const copy = buildYouTubeCopy({ story, readingItems, qualityReport });
  await ensureDir(outputDir);
  await fs.writeFile(path.join(outputDir, "youtube-copy.json"), `${JSON.stringify(copy, null, 2)}\n`, "utf8");
  await fs.writeFile(path.join(outputDir, "youtube-copy.md"), renderYouTubeCopyMarkdown(copy), "utf8");
  return copy;
}

function buildYouTubeCopy({ story, readingItems = [], qualityReport = null }) {
  const title = buildTitle(story);
  const duration = qualityReport?.duration?.videoSeconds || lastTimestamp(readingItems);
  const chapters = buildChapters(story, readingItems);
  const keywords = collectKeywords(story);
  const hashtags = ["#EnglishShadowing", "#LearnEnglish", "#EchoEnglish"];
  const description = [
    `Practice listening, reading, and speaking with this EchoEnglish story: ${story.title}.`,
    "",
    `Level: about U.S. elementary ${estimateUsGradeLevel(story)} English.`,
    `Video type: ${story.template?.title || story.contentMode || "English story"}.`,
    duration ? `Length: about ${formatDuration(duration)}.` : "",
    "",
    "How to practice:",
    "1. Listen to each sentence first.",
    "2. Read aloud during the quiet pauses.",
    "3. Review the vocabulary at the end.",
    "",
    chapters.length ? "Chapters:" : "",
    ...chapters.map((chapter) => `${chapter.time} ${chapter.title}`),
    "",
    keywords.length ? `Key words: ${keywords.join(", ")}` : "",
    "",
    hashtags.join(" ")
  ].filter((line) => line !== null && line !== undefined).join("\n");

  return {
    title,
    description,
    chapters,
    tags: buildTags(story, keywords),
    pinnedComment: `Which sentence was hardest for you to shadow? Write it below and practice it three more times. ${hashtags[0]}`,
    thumbnailText: {
      main: story.title,
      subtitle: "Listen and Shadow",
      level: `Grade ${estimateUsGradeLevel(story).replace(/^Grade\s+/i, "")}`
    },
    hashtags
  };
}

function buildTitle(story) {
  const base = String(story.title || story.topic || "English Story").trim();
  const suffix = story.template?.id === "podcast-dialogue" ? "Podcast English Practice" : "English Shadowing Story";
  const title = `${base} | ${suffix}`;
  return title.length <= 95 ? title : `${base.slice(0, 72).trim()} | EchoEnglish`;
}

function buildChapters(story, readingItems) {
  const chapters = [];
  const seen = new Set();
  const items = Array.isArray(readingItems) ? readingItems : [];
  for (const item of items) {
    if (item.kind !== "story-sentence" || !Number.isInteger(item.sectionIndex)) continue;
    if (seen.has(item.sectionIndex)) continue;
    if (item.sectionIndex % 5 !== 0 && item.sectionIndex !== 0) continue;
    const section = story.sections?.[item.sectionIndex];
    if (!section) continue;
    seen.add(item.sectionIndex);
    chapters.push({
      time: formatTimestamp(item.startSeconds || 0),
      title: section.title || `Scene ${item.sectionIndex + 1}`
    });
  }
  const vocabItem = items.find((item) => item.kind === "vocabulary-review");
  if (vocabItem) chapters.push({ time: formatTimestamp(vocabItem.startSeconds || 0), title: "Vocabulary Review" });
  return chapters.slice(0, 10);
}

function collectKeywords(story) {
  const words = [];
  for (const section of story.sections || []) {
    for (const [word] of section.vocabulary || []) {
      const text = String(word || "").trim();
      if (!text || words.includes(text)) continue;
      words.push(text);
      if (words.length >= 16) return words;
    }
  }
  return words;
}

function buildTags(story, keywords) {
  return [
    "English shadowing",
    "English listening practice",
    "learn English through stories",
    "beginner English",
    "bilingual subtitles",
    "English reading practice",
    story.template?.title,
    story.topic,
    ...keywords
  ].filter(Boolean).slice(0, 24);
}

function renderYouTubeCopyMarkdown(copy) {
  return [
    "# YouTube Copy",
    "",
    "## Title",
    copy.title,
    "",
    "## Description",
    copy.description,
    "",
    "## Tags",
    copy.tags.join(", "),
    "",
    "## Pinned Comment",
    copy.pinnedComment,
    "",
    "## Thumbnail Text",
    `- Main: ${copy.thumbnailText.main}`,
    `- Subtitle: ${copy.thumbnailText.subtitle}`,
    `- Level: ${copy.thumbnailText.level}`,
    ""
  ].join("\n");
}

function estimateUsGradeLevel(story) {
  if (story?.contentMode === "factual-documentary") return "Grade 4 to 5";
  if (story?.level === "beginner") return "Grade 3 to 4";
  return "Grade 4 to 5";
}

function lastTimestamp(readingItems) {
  const last = Array.isArray(readingItems) ? readingItems[readingItems.length - 1] : null;
  return Number(last?.endSeconds || last?.startSeconds || 0);
}

function formatTimestamp(seconds) {
  const safe = Math.max(0, Math.floor(Number(seconds || 0)));
  const minutes = Math.floor(safe / 60);
  const rest = safe % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

function formatDuration(seconds) {
  const safe = Math.max(0, Math.round(Number(seconds || 0)));
  const minutes = Math.floor(safe / 60);
  const rest = safe % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

module.exports = {
  buildYouTubeCopy,
  writeYouTubeCopy
};
