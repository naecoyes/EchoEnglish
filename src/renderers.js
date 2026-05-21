function buildReadingItems(story) {
  const items = [];
  let counter = 1;

  if (story.mode === "pure-story") {
    story.sections.forEach((section, sectionIndex) => {
      section.sentences.forEach((sentence, sentenceIndex) => {
        items.push(createItem(counter, "story-sentence", sentence, "en", story.defaults.sentencePauseSeconds, {
          sectionIndex,
          sentenceIndex
        }));
        counter += 1;
      });
    });
    return items;
  }

  story.opening.forEach((text) => {
    items.push(createItem(counter, "opening", text, "en", story.defaults.sectionPauseSeconds));
    counter += 1;
  });

  story.sections.forEach((section, sectionIndex) => {
    items.push(createItem(counter, "section-title", section.title, "en", story.defaults.sectionPauseSeconds, {
      sectionIndex,
      ttsText: normalizeSectionTitleForSpeech(section.title)
    }));
    counter += 1;

    section.sentences.forEach((sentence, sentenceIndex) => {
      items.push(createItem(counter, "story-sentence", sentence, "en", story.defaults.sentencePauseSeconds, {
        sectionIndex,
        sentenceIndex
      }));
      counter += 1;
    });

    if (sectionIndex < story.sections.length - 1) {
      items.push(createItem(counter, "transition", "Now, let us continue.", "en", story.defaults.sectionPauseSeconds));
      counter += 1;
    }
  });

  story.closing.forEach((text) => {
    items.push(createItem(counter, "closing", text, "en", story.defaults.sectionPauseSeconds));
    counter += 1;
  });

  return items;
}

function normalizeSectionTitleForSpeech(title) {
  return String(title).replace(/\s+-\s+(Listen|Shadow|Review\s+\d+)$/i, "");
}

function createItem(counter, kind, text, language, pauseAfterSeconds, extra = {}) {
  return {
    id: `line-${String(counter).padStart(3, "0")}`,
    kind,
    text,
    language,
    pauseAfterSeconds,
    ...extra
  };
}

function renderMarkdown(story) {
  const lines = [
    `# ${story.title}`,
    "",
    `- Topic: ${story.topic}`,
    `- Level: ${story.level}`,
    `- Target Duration: ${story.targetDurationMinutes} minutes`,
    `- Annotation: 中文简注`,
    `- Visual Style: ${story.storyboardDesign?.visualStyle || "storybook learning video"}`,
    `- Learning Focus: ${story.storyboardDesign?.learningFocus || "beginner words and phrases"}`,
    ""
  ];

  if (story.mode !== "pure-story") {
    lines.push("## Opening", "");
    story.opening.forEach((line) => lines.push(line));
    lines.push("");
  }

  story.sections.forEach((section) => {
    lines.push(`## ${section.title}`, "");
    lines.push(`Image Prompt: ${section.imagePrompt}`, "");
    section.sentences.forEach((sentence, index) => {
      lines.push(`${index + 1}. ${sentence}`);
      if (section.translations?.[index]) {
        lines.push(`   ${section.translations[index]}`);
      }
    });
    lines.push("", "Vocabulary:");
    section.vocabulary.forEach(([word, translation]) => {
      lines.push(`- ${word}: ${translation}`);
    });
    lines.push("");
  });

  if (story.mode !== "pure-story") {
    lines.push("## Closing", "");
    story.closing.forEach((line) => lines.push(line));
  }
  lines.push("");

  return `${lines.join("\n")}\n`;
}

function renderImagePrompts(story) {
  const lines = [
    `# Image Prompts: ${story.title}`,
    "",
    "Use these prompts with Codex image generation, MiniMax image-01, or another image API. Recommended size: 1920x1080.",
    `Overall style: ${story.storyboardDesign?.visualStyle || "cinematic storybook illustration"}.`,
    "Keep a consistent main character across all scenes. Leave the lower half clean because captions are added during video composition.",
    ""
  ];

  story.sections.forEach((section, index) => {
    const sceneNumber = String(index + 1).padStart(3, "0");
    lines.push(`## scene-${sceneNumber} - ${section.title}`, "");
    lines.push(section.imagePrompt, "");
  });

  return `${lines.join("\n")}\n`;
}

function renderSrt(items) {
  return items
    .map((item, index) => {
      const start = formatSrtTime(item.startSeconds || 0);
      const end = formatSrtTime(Math.max(item.endSeconds || 0, (item.startSeconds || 0) + 0.5));
      return `${index + 1}\n${start} --> ${end}\n${item.text}\n`;
    })
    .join("\n");
}

function formatSrtTime(seconds) {
  const millis = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(millis / 3600000);
  const minutes = Math.floor((millis % 3600000) / 60000);
  const secs = Math.floor((millis % 60000) / 1000);
  const ms = millis % 1000;

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

module.exports = {
  buildReadingItems,
  renderImagePrompts,
  renderMarkdown,
  renderSrt
};
