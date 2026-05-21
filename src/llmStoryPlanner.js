const DEFAULT_LLM_BASE = "https://coding.dashscope.aliyuncs.com/v1";
const DEFAULT_LLM_MODEL = "openai/qwen3.6-plus";

async function createStoryOutline({ topic, minutes }) {
  const config = getLlmConfig();
  if (!config.apiKey) {
    return {
      ...fallbackOutline(topic, minutes),
      source: "local"
    };
  }

  const prompt = [
    "Create a concise story plan for a 15-20 minute English learning story video.",
    "The user will review this plan before video generation.",
    "Return only valid JSON with this shape:",
    "{",
    '  "title": "string",',
    '  "genre": "string",',
    '  "level": "beginner",',
    '  "summary": "2-3 sentences",',
    '  "mainCharacter": "string",',
    '  "setting": "string",',
    '  "visualStyle": "photorealistic cinematic still photo style",',
    '  "storyBeats": ["10-14 short plot beats"],',
    '  "vocabularyFocus": ["8-12 useful words or phrases"]',
    "}",
    `Topic: ${topic}`,
    `Target minutes: ${minutes}`,
    "Keep the plot simple, emotional, visual, and suitable for beginner English learners."
  ].join("\n");

  try {
    const payload = await callChatJson(config, prompt, 2400);
    return normalizeOutline(payload, topic, minutes, "llm");
  } catch (error) {
    return {
      ...fallbackOutline(topic, minutes),
      source: "local",
      warning: `LLM outline failed: ${error.message}`
    };
  }
}

async function createPureStory({ topic, targetDurationMinutes, level, annotationStyle, outline }) {
  const config = getLlmConfig();
  if (config.apiKey) {
    try {
      const payload = await callChatJson(config, buildStoryPrompt(topic, targetDurationMinutes, outline), 22000);
      return normalizeStory(payload, {
        topic,
        targetDurationMinutes,
        level,
        annotationStyle,
        outline,
        source: "llm"
      });
    } catch (error) {
      const story = fallbackStoryFromOutline(outline || fallbackOutline(topic, targetDurationMinutes), {
        topic,
        targetDurationMinutes,
        level,
        annotationStyle
      });
      story.generationWarning = `LLM story failed: ${error.message}`;
      return story;
    }
  }

  return fallbackStoryFromOutline(outline || fallbackOutline(topic, targetDurationMinutes), {
    topic,
    targetDurationMinutes,
    level,
    annotationStyle
  });
}

function buildStoryPrompt(topic, minutes, outline) {
  return [
    "Write the complete source JSON for a pure English story narration video.",
    "Important rules:",
    "- Pure story mode only. Do not include Part, Chapter, Listen, Shadow, Review, teaching instructions, or repeated rounds.",
    "- The English narration must be continuous story prose in short beginner-friendly sentences.",
    "- Use 24-34 internal scenes. Each scene has 4-6 English sentences.",
    "- The story should naturally last about 15-20 minutes when read slowly with short pauses.",
    "- Every scene needs Chinese sentence translations, 3 vocabulary notes, and a photorealistic image prompt.",
    "- Image prompts must describe a real photographed/cinematic background, no text, no subtitles, no logo, no UI.",
    "Return only valid JSON with this shape:",
    "{",
    '  "title": "string",',
    '  "summary": "string",',
    '  "storyboardDesign": {"visualStyle": "string", "learningFocus": "string", "framePattern": "string", "targetLength": "string"},',
    '  "sections": [',
    '    {"title": "short internal scene label, not spoken", "visual": "string", "imagePrompt": "string", "sentences": ["English sentence"], "translations": ["中文翻译"], "vocabulary": [["word or phrase", "中文释义"]]}',
    "  ]",
    "}",
    `Topic: ${topic}`,
    `Target minutes: ${minutes}`,
    `Confirmed outline: ${JSON.stringify(outline || fallbackOutline(topic, minutes))}`
  ].join("\n");
}

async function callChatJson(config, prompt, maxTokens) {
  const response = await fetch(`${config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        {
          role: "system",
          content: "You are a careful JSON generator for English learning story videos. Return JSON only."
        },
        { role: "user", content: prompt }
      ],
      temperature: 0.7,
      max_tokens: maxTokens
    })
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`LLM returned HTTP ${response.status}.`);
  }

  const text = data?.choices?.[0]?.message?.content;
  if (!text) {
    throw new Error("LLM response did not include message content.");
  }
  return parseJsonText(text);
}

function parseJsonText(text) {
  const cleaned = String(text)
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Could not find JSON object in LLM response.");
    return JSON.parse(match[0]);
  }
}

function normalizeOutline(input, topic, minutes, source = "local") {
  const fallback = fallbackOutline(topic, minutes);
  const title = cleanText(input?.title) || fallback.title;
  const beats = normalizeStringArray(input?.storyBeats, fallback.storyBeats).slice(0, 14);
  return {
    title,
    genre: cleanText(input?.genre) || fallback.genre,
    level: "beginner",
    summary: cleanText(input?.summary) || fallback.summary,
    mainCharacter: cleanText(input?.mainCharacter) || fallback.mainCharacter,
    setting: cleanText(input?.setting) || fallback.setting,
    visualStyle: cleanText(input?.visualStyle) || fallback.visualStyle,
    storyBeats: beats.length >= 6 ? beats : fallback.storyBeats,
    vocabularyFocus: normalizeStringArray(input?.vocabularyFocus, fallback.vocabularyFocus).slice(0, 12),
    targetMinutes: Number(minutes || 15),
    source
  };
}

function normalizeStory(input, context) {
  const outline = normalizeOutline(context.outline || input, context.topic, context.targetDurationMinutes, context.source);
  const sections = Array.isArray(input?.sections) ? input.sections : [];
  const normalizedSections = sections
    .map((section, index) => normalizeSection(section, index, input?.title || outline.title))
    .filter((section) => section.sentences.length && section.translations.length === section.sentences.length);

  if (normalizedSections.length < 12) {
    return fallbackStoryFromOutline(outline, context);
  }

  return {
    version: "0.2.0",
    mode: "pure-story",
    source: context.source,
    title: cleanText(input?.title) || outline.title,
    topic: context.topic,
    level: context.level,
    annotationStyle: context.annotationStyle,
    targetDurationMinutes: context.targetDurationMinutes,
    generatedAt: new Date().toISOString(),
    defaults: pureStoryDefaults(),
    summary: cleanText(input?.summary) || outline.summary,
    outline,
    storyboardDesign: {
      visualStyle: cleanText(input?.storyboardDesign?.visualStyle) || outline.visualStyle,
      learningFocus: cleanText(input?.storyboardDesign?.learningFocus) || "beginner story listening, useful words, and bilingual meaning support",
      framePattern: cleanText(input?.storyboardDesign?.framePattern) || "Continuous story narration with cinematic image backgrounds and compact vocabulary overlays",
      targetLength: cleanText(input?.storyboardDesign?.targetLength) || "15-20 minutes without repeated teaching rounds"
    },
    opening: [],
    sections: normalizedSections,
    closing: []
  };
}

function normalizeSection(section, index, storyTitle) {
  const sentences = normalizeStringArray(section?.sentences, []).map(cleanSentence).filter(Boolean).slice(0, 7);
  const translations = normalizeStringArray(section?.translations, []).slice(0, sentences.length);
  const vocabulary = Array.isArray(section?.vocabulary)
    ? section.vocabulary.map((pair) => [cleanText(pair?.[0]), cleanText(pair?.[1])]).filter(([word, zh]) => word && zh).slice(0, 4)
    : [];
  const visual = cleanText(section?.visual) || `${storyTitle}, scene ${index + 1}, cinematic story moment`;
  return {
    title: cleanText(section?.title) || `Scene ${index + 1}`,
    baseSectionIndex: index,
    imageVariantIndex: 0,
    imageBeatSize: 3,
    imageBeatCount: Math.max(1, Math.ceil(sentences.length / 3)),
    visual,
    imagePrompt: cleanText(section?.imagePrompt) || buildPhotoPrompt(storyTitle, visual, sentences),
    sentences,
    translations: translations.length === sentences.length ? translations : sentences.map(() => "中文释义待补充。"),
    vocabulary: vocabulary.length ? vocabulary : fallbackVocabulary(sentences.join(" "))
  };
}

function fallbackStoryFromOutline(outlineInput, context) {
  const outline = normalizeOutline(outlineInput, context.topic, context.targetDurationMinutes, "local");
  const targetScenes = context.targetDurationMinutes >= 18 ? 36 : 32;
  const sections = [];
  for (let index = 0; index < targetScenes; index += 1) {
    const beat = outline.storyBeats[index % outline.storyBeats.length];
    const nextBeat = outline.storyBeats[(index + 1) % outline.storyBeats.length];
    const scene = fallbackScene(outline, beat, nextBeat, index);
    sections.push(scene);
  }

  return {
    version: "0.2.0",
    mode: "pure-story",
    source: "local",
    title: outline.title,
    topic: context.topic,
    level: context.level,
    annotationStyle: context.annotationStyle,
    targetDurationMinutes: context.targetDurationMinutes,
    generatedAt: new Date().toISOString(),
    defaults: pureStoryDefaults(),
    summary: outline.summary,
    outline,
    storyboardDesign: {
      visualStyle: outline.visualStyle,
      learningFocus: "beginner story listening, useful words, and bilingual meaning support",
      framePattern: "Continuous story narration with cinematic image backgrounds and compact vocabulary overlays",
      targetLength: "15-20 minutes without repeated teaching rounds"
    },
    opening: [],
    sections,
    closing: []
  };
}

function fallbackScene(outline, beat, nextBeat, index) {
  const name = outline.mainCharacter || "Emma";
  const place = outline.setting || "a quiet city street";
  const object = outline.vocabularyFocus[index % outline.vocabularyFocus.length] || "small clue";
  const sentences = [
    `${name} moved through ${place} and noticed something new.`,
    `The moment felt simple, but it held a quiet question.`,
    `${name} looked at ${articleFor(object)} ${object} and tried to understand it.`,
    `The thought connected with the next event: ${cleanSentence(beat)}`,
    `Before moving on, ${name} remembered one useful detail.`,
    `That detail would matter when ${cleanSentence(nextBeat).toLowerCase()}`
  ];
  const translations = [
    `${name}穿过${place}，注意到了一些新的东西。`,
    `这一刻看起来简单，却藏着一个安静的问题。`,
    `${name}看着${object}，试着理解它。`,
    `这个想法和故事的这一段有关：${beat}`,
    `继续前进之前，${name}记住了一个有用的细节。`,
    `当下一步发生时，这个细节会变得重要。`
  ];
  const visual = `${name} in ${place}, reacting to ${object}, ${outline.visualStyle}, emotionally clear story moment`;
  return {
    title: `Scene ${index + 1}`,
    baseSectionIndex: index,
    imageVariantIndex: 0,
    imageBeatSize: 3,
    imageBeatCount: Math.ceil(sentences.length / 3),
    visual,
    imagePrompt: buildPhotoPrompt(outline.title, visual, sentences),
    sentences,
    translations,
    vocabulary: fallbackVocabulary(`${object} ${beat}`)
  };
}

function fallbackOutline(topic, minutes) {
  const title = titleCase(topic || "A Quiet Story");
  return {
    title,
    genre: "cinematic slice-of-life story",
    level: "beginner",
    summary: `${title} follows one clear character through a simple problem, a meaningful choice, and a calm ending. The story is written for English learners who need natural, easy sentences.`,
    mainCharacter: "Emma",
    setting: chooseSetting(title),
    visualStyle: "photorealistic cinematic still photo, natural light, realistic people, clear story emotion",
    storyBeats: [
      "The main character notices an unusual detail.",
      "A small question appears in an ordinary place.",
      "The character follows the first clue carefully.",
      "A helpful person shares a simple idea.",
      "The weather or setting changes the plan.",
      "The character makes a careful choice.",
      "A hidden meaning becomes easier to see.",
      "The problem grows for a short time.",
      "The character remembers a kind lesson.",
      "The answer appears in a quiet moment.",
      "The character helps someone else.",
      "The day ends with a gentle change."
    ],
    vocabularyFocus: ["notice", "carefully", "choice", "clue", "quiet", "remember", "helpful", "change", "answer", "meaning"],
    targetMinutes: Number(minutes || 15),
    source: "local"
  };
}

function buildPhotoPrompt(storyTitle, visual, sentences = []) {
  return [
    "16:9 photorealistic cinematic still photo for an English story video background.",
    `Story: ${storyTitle}.`,
    `Scene: ${visual}.`,
    sentences.length ? `Moment: ${sentences.slice(0, 3).join(" ")}` : "",
    "Natural light, realistic people, real location, emotional but subtle, full-screen background.",
    "No text, no subtitles, no captions, no watermark, no logo, no UI elements."
  ].filter(Boolean).join(" ");
}

function fallbackVocabulary(text) {
  const words = String(text).toLowerCase().match(/[a-z][a-z'-]{3,}/g) || [];
  const unique = [...new Set(words)].slice(0, 3);
  const translations = {
    notice: "注意到",
    carefully: "小心地",
    choice: "选择",
    clue: "线索",
    quiet: "安静的",
    remember: "记得",
    helpful: "有帮助的",
    change: "变化",
    answer: "答案",
    meaning: "意义"
  };
  return unique.length
    ? unique.map((word) => [word, translations[word] || "重点词"])
    : [["notice", "注意到"], ["choice", "选择"], ["carefully", "小心地"]];
}

function getLlmConfig() {
  return {
    baseUrl: process.env.LLM_API_BASE || DEFAULT_LLM_BASE,
    model: process.env.STRIX_LLM || DEFAULT_LLM_MODEL,
    apiKey: process.env.LLM_API_KEY || ""
  };
}

function pureStoryDefaults() {
  return {
    sentencePauseSeconds: 0.45,
    sectionPauseSeconds: 0,
    vocabularyPauseSeconds: 0
  };
}

function normalizeStringArray(value, fallback) {
  if (!Array.isArray(value)) return fallback;
  return value.map(cleanText).filter(Boolean);
}

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function cleanSentence(value) {
  const text = cleanText(value);
  if (!text) return "";
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

function titleCase(value) {
  return String(value || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function chooseSetting(topic) {
  const lower = String(topic).toLowerCase();
  if (lower.includes("rain") || lower.includes("london")) return "a rainy London street";
  if (lower.includes("school")) return "a bright school hallway";
  if (lower.includes("library") || lower.includes("book")) return "an old city library";
  if (lower.includes("mountain")) return "a snowy mountain village";
  if (lower.includes("sea") || lower.includes("island")) return "a quiet coastal town";
  if (lower.includes("space") || lower.includes("moon")) return "a small space station";
  return "a quiet city neighborhood";
}

function articleFor(word) {
  return /^[aeiou]/i.test(String(word)) ? "an" : "a";
}

module.exports = {
  createPureStory,
  createStoryOutline,
  getLlmConfig
};
