function buildReadingItems(story) {
  const items = [];
  let counter = 1;

  if (story.mode === "pure-story") {
    const gradeLevel = estimateUsGradeLevel(story);
    const introText = `Today's practice is ${story.title}. Listen first, then read aloud with the story. The difficulty is about U.S. elementary ${gradeLevel} English.`;
    items.push(createItem(counter, "title-card", introText, "en", 1.4, {
      ttsText: introText
    }));
    counter += 1;

    story.sections.forEach((section, sectionIndex) => {
      section.sentences.forEach((sentence, sentenceIndex) => {
        const speaker = getSentenceSpeaker(story, section, sentenceIndex);
        items.push(createItem(counter, "story-sentence", sentence, "en", story.defaults.sentencePauseSeconds, {
          sectionIndex,
          sentenceIndex,
          speaker,
          speakerName: speakerName(speaker)
        }));
        counter += 1;
      });
    });

    items.push(createItem(counter, "vocabulary-review", "Review these important words.", "en", 6, {
      ttsText: "Now review these important words from today's story."
    }));
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
      const speaker = getSentenceSpeaker(story, section, sentenceIndex);
      items.push(createItem(counter, "story-sentence", sentence, "en", story.defaults.sentencePauseSeconds, {
        sectionIndex,
        sentenceIndex,
        speaker,
        speakerName: speakerName(speaker)
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

function estimateUsGradeLevel(story) {
  if (story?.contentMode === "factual-documentary") return "Grade 4 to 5";
  if (story?.level === "beginner") return "Grade 3 to 4";
  return "Grade 4 to 5";
}

function normalizeSectionTitleForSpeech(title) {
  return String(title).replace(/\s+-\s+(Listen|Shadow|Review\s+\d+)$/i, "");
}

function getSentenceSpeaker(story, section, sentenceIndex) {
  const explicit = section.speakers?.[sentenceIndex];
  if (explicit === "host-a" || explicit === "host-b") return explicit;
  if (story.template?.id === "podcast-dialogue") return sentenceIndex % 2 === 0 ? "host-a" : "host-b";
  return null;
}

function speakerName(speaker) {
  if (speaker === "host-a") return "Host A";
  if (speaker === "host-b") return "Host B";
  return null;
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
      const speaker = speakerName(section.speakers?.[index]);
      lines.push(`${index + 1}. ${speaker ? `${speaker}: ` : ""}${sentence}`);
      if (section.translations?.[index]) {
        lines.push(`   ${section.translations[index]}`);
      }
    });
    lines.push("", "Vocabulary:");
    section.vocabulary.forEach(([word, translation, phonetic]) => {
      lines.push(`- ${word}${phonetic ? ` ${phonetic}` : ""}: ${translation}`);
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
    "Keep a consistent main character across all scenes. Keep the bottom area natural and uncluttered; do not add caption bars or placeholder text.",
    ""
  ];

  story.sections.forEach((section, index) => {
    const baseIndex = Number.isInteger(section.baseSectionIndex) ? section.baseSectionIndex : index;
    const variantIndex = Number.isInteger(section.imageVariantIndex) ? section.imageVariantIndex : 0;
    const beatCount = getSectionImageBeats(section).length;
    for (let beatIndex = 0; beatIndex < beatCount; beatIndex += 1) {
      const sceneId = buildPromptSceneImageId(baseIndex, variantIndex, beatIndex);
      lines.push(`## ${sceneId} - ${section.title}`, "");
      lines.push(buildPromptBeatImagePrompt(story, section, beatIndex), "");
    }
  });

  return `${lines.join("\n")}\n`;
}

function buildPromptSceneImageId(baseIndex, variantIndex, beatIndex) {
  const suffix = ["a", "b", "c"][variantIndex] || String(variantIndex + 1);
  return `scene-${String(baseIndex + 1).padStart(3, "0")}-${suffix}-${String(beatIndex + 1).padStart(2, "0")}`;
}

function buildPromptBeatImagePrompt(story, section, beatIndex) {
  const sentences = section.sentences || [];
  const beat = getSectionImageBeats(section)[beatIndex];
  const moment = beat
    ? sentences.slice(beat.sentenceStart, beat.sentenceEnd + 1).join(" ")
    : sentences.join(" ");
  return [
    beat?.imagePrompt || section.imagePrompt,
    moment ? `Specific moment for this background: ${moment}` : "",
    beat?.durationNote ? `Timing note: ${beat.durationNote}` : "",
    "Make this image visually distinct from the nearby sentence backgrounds."
  ].filter(Boolean).join(" ");
}

function getSectionImageBeats(section) {
  const sentences = section.sentences || [];
  const sentenceCount = Math.max(1, sentences.length);
  if (Array.isArray(section.imageBeats) && section.imageBeats.length) {
    return section.imageBeats
      .map((beat) => {
        const start = clampInteger(beat.sentenceStart, 0, sentenceCount - 1);
        const end = clampInteger(beat.sentenceEnd, start, sentenceCount - 1);
        return {
          ...beat,
          sentenceStart: start,
          sentenceEnd: Math.max(start, end)
        };
      })
      .sort((a, b) => a.sentenceStart - b.sentenceStart)
      .slice(0, 2);
  }
  return [{
    sentenceStart: 0,
    sentenceEnd: sentenceCount - 1,
    imagePrompt: section.imagePrompt || "",
    durationNote: "cover the full scene"
  }];
}

function clampInteger(value, min, max) {
  const number = Number(value);
  const integer = Number.isFinite(number) ? Math.trunc(number) : min;
  return Math.min(max, Math.max(min, integer));
}

function renderSrt(items) {
  return items
    .map((item, index) => {
      const start = formatSrtTime(item.startSeconds || 0);
      const end = formatSrtTime(Math.max(item.endSeconds || 0, (item.startSeconds || 0) + 0.5));
      const speaker = item.speakerName ? `${item.speakerName}: ` : "";
      return `${index + 1}\n${start} --> ${end}\n${speaker}${item.text}\n`;
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
