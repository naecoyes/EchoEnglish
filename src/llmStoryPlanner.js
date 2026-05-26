const { DEFAULT_LLM, getEffectiveSettings } = require("./settingsStore");
const { formatSearchContext } = require("./tavilySearch");
const { enrichStoryVocabulary } = require("./vocabularyTools");

async function createStoryOutline({ topic, minutes, searchContext = null, template = null }) {
  const config = await getLlmConfig();
  if (!config.apiKey) {
    throw new Error("LLM API key is required for story overview generation. Open Settings and save an LLM API key.");
  }
  const factualMode = isFactualTemplate(template) || isFactualHistoryTopic(topic);

  const prompt = [
    "Create a concise story plan for a fixed 15-minute English learning story video.",
    "The user will review this plan before video generation.",
    template ? formatTemplateForPrompt(template) : "",
    factualMode
      ? "This topic is about a real company, product, person, or history. Use factual documentary mode, not fictional story mode."
      : "If the topic is fictional or generic, use a simple story mode.",
    "Return only valid JSON with this shape:",
    "{",
    '  "title": "string",',
    '  "genre": "string",',
    '  "level": "beginner",',
    '  "contentMode": "factual-documentary or fictional-story",',
    '  "summary": "2-3 sentences",',
    '  "mainCharacter": "string",',
    '  "setting": "string",',
    '  "visualStyle": "photorealistic cinematic still photo style",',
    '  "storyBeats": ["10-14 short plot beats"],',
    '  "vocabularyFocus": ["8-12 useful words or phrases"]',
    "}",
    `Topic: ${topic}`,
    `Target minutes: ${minutes}`,
    "Keep the plan simple, emotional, visual, and suitable for beginner English learners.",
    "Use the web search context when the topic involves real people, companies, places, history, news, or culture.",
    "Do not invent factual claims that conflict with the search context.",
    factualMode
      ? "For factual documentary mode: do not invent a fictional protagonist, fictional employee, fictional dialogue, or private scene. Use real dates, named public people or organizations from the sources, and a clear chronological timeline. The storyBeats must be factual milestones, not imagined workshop drama."
      : "",
    `Web search context:\n${formatSearchContext(searchContext)}`
  ].filter(Boolean).join("\n");

  const payload = await callChatJson(config, prompt, 2400);
  return normalizeOutline(payload, topic, minutes, searchContext ? "llm+tavily" : "llm", searchContext, template);
}

async function createPureStory({ topic, targetDurationMinutes, level, annotationStyle, outline, template = null }) {
  const config = await getLlmConfig();
  if (!config.apiKey) {
    throw new Error("LLM API key is required for story script generation. Open Settings and save an LLM API key.");
  }

  const payload = await callChatJson(config, buildStoryPrompt(topic, targetDurationMinutes, outline, template), 22000);
  return normalizeStory(payload, {
    topic,
    targetDurationMinutes,
    level,
    annotationStyle,
    outline,
    template,
    source: "llm"
  });
}

async function reviseStoryDraft({ topic, targetDurationMinutes, draft, feedback, template = null }) {
  const config = await getLlmConfig();
  if (!config.apiKey) {
    throw new Error("LLM API key is required for draft revision. Open Settings and save an LLM API key.");
  }
  if (!draft || typeof draft !== "object") {
    throw new Error("A current story draft is required before revision.");
  }

  const factualMode = isFactualTemplate(template) || draft.contentMode === "factual-documentary" || draft.outline?.contentMode === "factual-documentary" || isFactualHistoryTopic(topic);
  const prompt = [
    "Revise this English learning video story draft according to the user's feedback.",
    "Return the complete revised source JSON, not a patch.",
    template ? formatTemplateForPrompt(template) : "",
    "Hard requirements:",
    "- Target exactly 15 minutes.",
    "- Use 16-24 internal scenes.",
    "- Each scene has exactly 4 English sentences.",
    "- Use 30-45 total background image beats, about 2-3 images per minute.",
    "- Each scene should normally have 1 imageBeat covering all 4 sentences. Use 2 imageBeats only when the story clearly changes location, action, or speaker focus inside that scene.",
    "- Keep beginner English, Chinese sentence translations, 3 vocabulary notes, imageBeats, and photorealistic image prompts.",
    factualMode ? "- Factual documentary mode: do not invent fictional protagonists, employees, dialogue, or unsupported private scenes." : "",
    `Topic: ${topic}`,
    `User feedback:\n${cleanText(feedback) || "Improve clarity and accuracy."}`,
    `Current draft JSON:\n${JSON.stringify(draft)}`
  ].filter(Boolean).join("\n");

  const payload = await callChatJson(config, prompt, 22000);
  return normalizeStory(payload, {
    topic,
    targetDurationMinutes,
    level: draft.level || "beginner",
    annotationStyle: draft.annotationStyle || "zh-brief",
    outline: draft.outline || payload,
    template: template || draft.template || draft.outline?.template || null,
    source: "llm-revised"
  });
}

function buildStoryPrompt(topic, minutes, outline, template = null) {
  const factualMode = isFactualTemplate(template) || outline?.contentMode === "factual-documentary" || isFactualHistoryTopic(topic);
  const podcastMode = template?.id === "podcast-dialogue";
  return [
    podcastMode
      ? "Write the complete source JSON for a two-host English learning podcast video."
      : "Write the complete source JSON for a pure English story narration video.",
    template ? formatTemplateForPrompt(template) : "",
    "Important rules:",
    podcastMode
      ? "- Podcast mode: write natural two-host dialogue. Every sentence must begin with Host A: or Host B: so the TTS can choose the right voice."
      : "- Pure story mode only. Do not include Part, Chapter, Listen, Shadow, Review, teaching instructions, or repeated rounds.",
    podcastMode
      ? "- Use real conversational turns, not mechanical one-sentence alternation. A host may speak 1-3 short sentences in a row before the other host responds."
      : "- The English narration must be continuous story prose in short beginner-friendly sentences.",
    podcastMode
      ? "- For podcast mode, every scene still has exactly 4 sentences. Use varied turn patterns such as A,A,B,B or A,B,B,A when it sounds natural."
      : "",
    "- Use 16-24 internal scenes. Each scene has exactly 4 English sentences.",
    "- The story should naturally last about 15 minutes when read slowly with short pauses.",
    "- The video should use 30-45 total background image beats, about 2-3 images per minute. Do not create one image per sentence.",
    "- Each image beat should cover 2-4 adjacent sentences. Most scenes should use one image beat covering all 4 sentences; use two only for major visual changes.",
    "- Let the model decide image beat timing from the story flow by assigning sentenceStart and sentenceEnd for each imageBeat.",
    "- Every scene needs complete Chinese sentence translations, 3 useful vocabulary notes with IPA phonetics, and a concise photorealistic image prompt.",
    "- Chinese translations must be natural full-sentence Chinese. Do not shorten, omit named entities, or leave placeholders.",
    "- Vocabulary notes must not repeat across scenes. Avoid very easy words such as good, make, see, time, first, small, work, or help. Prefer useful B1/domain words such as launch, milestone, reusable, orbit, satellite, investment, strategy, production, challenge, founder.",
    "- Image prompts must be camera-ready prompts: subject, location, action, foreground/background, lighting, lens or camera feel, color mood, and a clear composition with a natural, uncluttered bottom area.",
    "- Image prompts must look like realistic documentary photography or cinematic production stills. No cartoon, no flat illustration, no PPT slide, no text, no subtitles, no logo, no UI, no black lower-third bar, no placeholder words like Your Text.",
    "- Avoid repeated generic wording. Each scene prompt must have a distinct place, object, camera angle, or action.",
    isPersonFocusedTopic(topic, template)
      ? "- Person-focused mode: keep the same public subject visually consistent. Prefer one-person portraits, public-stage photos, offices, documents, symbolic objects, and context shots. Do not generate multiple unrelated faces or group portraits unless the facts require a public group scene."
      : "",
    factualMode
      ? "- Factual documentary mode is required. Do not create fictional protagonists, invented employees, invented dialogue, private emotions, or scenes that are not supported by the outline/search context."
      : "- Fictional story mode is allowed only when the topic is not about real history, companies, people, or products.",
    factualMode
      ? "- Use a chronological timeline with real milestones, dates, public events, product names, factories, deliveries, and public leaders from the search context. Keep it simple for English learners, but factual."
      : "",
    factualMode
      ? "- The narration can be warm and story-like, but it must read like a documentary history, not a made-up workplace story."
      : "",
    "Return only valid JSON with this shape:",
    "{",
    '  "title": "string",',
    '  "summary": "string",',
    '  "storyboardDesign": {"visualStyle": "string", "learningFocus": "string", "framePattern": "string", "targetLength": "string"},',
    '  "sections": [',
    '    {"title": "short internal scene label, not spoken", "visual": "string", "imagePrompt": "45-70 word English photorealistic prompt", "imageBeats": [{"sentenceStart": 0, "sentenceEnd": 3, "durationNote": "covers the whole scene", "imagePrompt": "specific 45-70 word prompt for this beat"}], "sentences": ["English sentence"], "translations": ["完整中文翻译"], "vocabulary": [["word or phrase", "中文释义", "/IPA/"]]}',
    "  ]",
    "}",
    `Topic: ${topic}`,
    `Target minutes: ${minutes}`,
    `Confirmed outline: ${JSON.stringify(outline || fallbackOutline(topic, minutes, template))}`,
    `Web search context:\n${formatSearchContext(outline?.searchContext)}`
  ].filter(Boolean).join("\n");
}

async function callChatJson(config, prompt, maxTokens) {
  const isXiaomi = config.provider === "xiaomi";
  const model = isXiaomi ? String(config.model || "").trim().toLowerCase() : config.model;
  const headers = isXiaomi
    ? {
        "api-key": config.apiKey,
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json"
      }
    : {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json"
      };
  const body = isXiaomi
    ? {
        model,
        messages: [
          {
            role: "system",
            content: "You are a careful JSON generator for English learning story videos. Return JSON only."
          },
          { role: "user", content: prompt }
        ],
        temperature: 0.7,
        max_completion_tokens: maxTokens,
        stream: false,
        thinking: { type: "disabled" }
      }
    : {
        model,
        messages: [
          {
            role: "system",
            content: "You are a careful JSON generator for English learning story videos. Return JSON only."
          },
          { role: "user", content: prompt }
        ],
        temperature: 0.7,
        max_tokens: maxTokens
      };

  const response = await fetch(`${config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(formatLlmHttpError(response.status, data));
  }

  const text = data?.choices?.[0]?.message?.content;
  if (!text) {
    throw new Error("LLM response did not include message content.");
  }
  return parseJsonText(text);
}

function formatLlmHttpError(status, payload) {
  const message = payload?.error?.message
    || payload?.message
    || payload?.error_msg
    || payload?.msg
    || "";
  const code = payload?.error?.code || payload?.code || "";
  const requestId = payload?.request_id || payload?.requestId || payload?.id || "";
  return [
    `LLM returned HTTP ${status}`,
    code ? `code=${code}` : "",
    message ? `message=${message}` : "",
    requestId ? `requestId=${requestId}` : ""
  ].filter(Boolean).join(". ");
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

function normalizeOutline(input, topic, minutes, source = "local", searchContext = null, template = null) {
  const fallback = fallbackOutline(topic, minutes, template);
  const title = cleanText(input?.title) || fallback.title;
  const beats = normalizeStringArray(input?.storyBeats, fallback.storyBeats).slice(0, 14);
  return {
    title,
    genre: cleanText(input?.genre) || fallback.genre,
    level: "beginner",
    contentMode: cleanContentMode(input?.contentMode, topic, template),
    summary: cleanText(input?.summary) || fallback.summary,
    mainCharacter: cleanText(input?.mainCharacter) || fallback.mainCharacter,
    setting: cleanText(input?.setting) || fallback.setting,
    visualStyle: cleanText(input?.visualStyle) || fallback.visualStyle,
    storyBeats: beats.length >= 6 ? beats : fallback.storyBeats,
    vocabularyFocus: normalizeStringArray(input?.vocabularyFocus, fallback.vocabularyFocus).slice(0, 12),
    targetMinutes: Number(minutes || 15),
    source,
    searchContext: searchContext || input?.searchContext || null,
    template: template || input?.template || null
  };
}

function normalizeStory(input, context) {
  const outline = normalizeOutline(context.outline || input, context.topic, context.targetDurationMinutes, context.source, null, context.template);
  const sections = Array.isArray(input?.sections) ? input.sections : [];
  let normalizedSections = sections
    .map((section, index) => normalizeSection(section, index, input?.title || outline.title))
    .filter((section) => section.sentences.length === 4 && section.translations.length === section.sentences.length)
    .slice(0, 30);
  const generationWarnings = [];

  if (normalizedSections.length < 8) {
    return fallbackStoryFromOutline(outline, context);
  }

  if (normalizedSections.length < 16) {
    const receivedCount = normalizedSections.length;
    normalizedSections = completeSectionsFromOutline(normalizedSections, outline, 16);
    generationWarnings.push(`LLM returned ${receivedCount} valid scenes; EchoEnglish auto-filled ${normalizedSections.length - receivedCount} outline-based scenes so the draft can be reviewed.`);
  }

  const imageBeatCount = countImageBeats(normalizedSections);
  if (imageBeatCount < 30) {
    normalizedSections = ensureImageBeatTarget(normalizedSections, outline, 30);
    generationWarnings.push(`LLM returned ${imageBeatCount} image beats; EchoEnglish split story scenes into ${countImageBeats(normalizedSections)} visual beats for the 2-3 images per minute target.`);
  }

  return enrichStoryVocabulary({
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
    contentMode: outline.contentMode,
    template: context.template || outline.template || input?.template || null,
    outline,
    storyboardDesign: {
      visualStyle: cleanText(input?.storyboardDesign?.visualStyle) || outline.visualStyle,
      learningFocus: cleanText(input?.storyboardDesign?.learningFocus) || "beginner story listening, useful words, and bilingual meaning support",
      framePattern: cleanText(input?.storyboardDesign?.framePattern) || "Continuous story narration with cinematic image backgrounds and compact vocabulary overlays",
      targetLength: cleanText(input?.storyboardDesign?.targetLength) || "15-20 minutes without repeated teaching rounds",
      repairWarning: generationWarnings[0] || ""
    },
    generationWarnings,
    opening: [],
    sections: normalizedSections,
    closing: []
  });
}

function completeSectionsFromOutline(sections, outline, targetScenes) {
  const completed = sections.slice(0, Math.max(0, targetScenes));
  const beats = Array.isArray(outline.storyBeats) && outline.storyBeats.length
    ? outline.storyBeats
    : fallbackOutline(outline.title || "Story", outline.targetMinutes || 15, outline.template).storyBeats;

  while (completed.length < targetScenes) {
    const index = completed.length;
    const beat = beats[index % beats.length];
    const nextBeat = beats[(index + 1) % beats.length];
    completed.push(fallbackScene(outline, beat, nextBeat, index));
  }

  return completed;
}

function ensureImageBeatTarget(sections, outline, minimumBeats) {
  const updated = sections.map((section) => ({ ...section, imageBeats: [...(section.imageBeats || [])] }));
  let total = countImageBeats(updated);

  for (const section of updated) {
    if (total >= minimumBeats) break;
    if (!Array.isArray(section.sentences) || section.sentences.length < 4 || section.imageBeats.length >= 2) continue;

    section.imageBeats = [
      {
        sentenceStart: 0,
        sentenceEnd: 1,
        durationNote: "first half of the scene",
        imagePrompt: buildPhotoPrompt(outline.title, `${section.visual}, first story beat`, section.sentences.slice(0, 2))
      },
      {
        sentenceStart: 2,
        sentenceEnd: 3,
        durationNote: "second half of the scene",
        imagePrompt: buildPhotoPrompt(outline.title, `${section.visual}, second story beat`, section.sentences.slice(2, 4))
      }
    ];
    section.imageBeatSize = 2;
    section.imageBeatCount = 2;
    total += 1;
  }

  return updated;
}

function countImageBeats(sections) {
  return sections.reduce((total, section) => total + Math.max(1, Array.isArray(section.imageBeats) ? section.imageBeats.length : 0), 0);
}

function normalizeSection(section, index, storyTitle) {
  const parsedSentences = normalizeStringArray(section?.sentences, [])
    .map(parseSpeakerSentence)
    .filter((entry) => entry.text)
    .slice(0, 4);
  const sentences = parsedSentences.map((entry) => cleanSentence(entry.text)).filter(Boolean);
  const speakers = parsedSentences.map((entry) => entry.speaker || null);
  const translations = normalizeStringArray(section?.translations, []).slice(0, sentences.length);
  const vocabulary = Array.isArray(section?.vocabulary)
    ? section.vocabulary.map((pair) => [cleanText(pair?.[0]), cleanText(pair?.[1]), cleanText(pair?.[2])]).filter(([word, zh]) => word && zh).slice(0, 4)
    : [];
  const visual = cleanText(section?.visual) || `${storyTitle}, scene ${index + 1}, cinematic story moment`;
  const imageBeats = normalizeImageBeats(section?.imageBeats, sentences, section?.imagePrompt, visual, storyTitle);
  return {
    title: cleanText(section?.title) || `Scene ${index + 1}`,
    baseSectionIndex: index,
    imageVariantIndex: 0,
    imageBeatSize: Math.max(1, Math.ceil(sentences.length / imageBeats.length)),
    imageBeatCount: imageBeats.length,
    imageBeats,
    visual,
    imagePrompt: cleanText(section?.imagePrompt) || buildPhotoPrompt(storyTitle, visual, sentences),
    sentences,
    speakers,
    translations: translations.length === sentences.length ? translations : sentences.map(() => "中文释义待补充。"),
    vocabulary: vocabulary.length ? vocabulary : fallbackVocabulary(sentences.join(" "))
  };
}

function normalizeImageBeats(rawBeats, sentences, sectionPrompt, visual, storyTitle) {
  const sentenceCount = Math.max(1, sentences.length);
  const beats = Array.isArray(rawBeats)
    ? rawBeats.map((beat) => {
        const start = clampInteger(beat?.sentenceStart, 0, sentenceCount - 1);
        const end = clampInteger(beat?.sentenceEnd, start, sentenceCount - 1);
        return {
          sentenceStart: start,
          sentenceEnd: Math.max(start, end),
          durationNote: cleanText(beat?.durationNote) || "",
          imagePrompt: cleanText(beat?.imagePrompt)
        };
      }).filter((beat) => beat.imagePrompt || beat.sentenceEnd >= beat.sentenceStart)
    : [];

  const compact = beats
    .sort((a, b) => a.sentenceStart - b.sentenceStart)
    .slice(0, sentenceCount >= 4 ? 2 : 1)
    .map((beat) => ({
      ...beat,
      imagePrompt: beat.imagePrompt || buildPhotoPrompt(storyTitle, visual, sentences.slice(beat.sentenceStart, beat.sentenceEnd + 1))
    }));

  if (compact.length) return compact;
  return [{
    sentenceStart: 0,
    sentenceEnd: sentenceCount - 1,
    durationNote: "cover the full scene",
    imagePrompt: cleanText(sectionPrompt) || buildPhotoPrompt(storyTitle, visual, sentences)
  }];
}

function clampInteger(value, min, max) {
  const number = Number(value);
  const integer = Number.isFinite(number) ? Math.trunc(number) : min;
  return Math.min(max, Math.max(min, integer));
}

function parseSpeakerSentence(value) {
  const text = cleanText(value);
  const match = /^(host|speaker)\s*([ab12])\s*[:：-]\s*(.+)$/i.exec(text);
  if (!match) return { text, speaker: null };
  const marker = match[2].toLowerCase();
  const speaker = marker === "b" || marker === "2" ? "host-b" : "host-a";
  return {
    text: cleanText(match[3]),
    speaker
  };
}

function fallbackStoryFromOutline(outlineInput, context) {
  const outline = normalizeOutline(outlineInput, context.topic, context.targetDurationMinutes, "local", null, context.template);
  const targetScenes = 29;
  const sections = [];
  for (let index = 0; index < targetScenes; index += 1) {
    const beat = outline.storyBeats[index % outline.storyBeats.length];
    const nextBeat = outline.storyBeats[(index + 1) % outline.storyBeats.length];
    const scene = fallbackScene(outline, beat, nextBeat, index);
    sections.push(scene);
  }

  return enrichStoryVocabulary({
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
    contentMode: outline.contentMode,
    template: context.template || outline.template || null,
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
  });
}

function fallbackScene(outline, beat, nextBeat, index) {
  if (outline.contentMode === "factual-documentary") {
    return fallbackFactualScene(outline, beat, nextBeat, index);
  }
  const name = outline.mainCharacter || "Emma";
  const place = outline.setting || "a quiet city street";
  const object = outline.vocabularyFocus[index % outline.vocabularyFocus.length] || "small clue";
  const sentences = [
    `${name} moved through ${place} and noticed something new.`,
    `The moment felt simple, but it held a quiet question.`,
    `${name} looked at ${articleFor(object)} ${object} and tried to understand it.`,
    `The thought connected with the next event: ${cleanSentence(beat)}`
  ];
  const translations = [
    `${name}穿过${place}，注意到了一些新的东西。`,
    `这一刻看起来简单，却藏着一个安静的问题。`,
    `${name}看着${object}，试着理解它。`,
    `这个想法和故事的这一段有关：${beat}`
  ];
  const visual = `${name} in ${place}, reacting to ${object}, ${outline.visualStyle}, emotionally clear story moment`;
  return {
    title: `Scene ${index + 1}`,
    baseSectionIndex: index,
    imageVariantIndex: 0,
    imageBeatSize: sentences.length,
    imageBeatCount: 1,
    imageBeats: [{
      sentenceStart: 0,
      sentenceEnd: sentences.length - 1,
      durationNote: "cover the full scene",
      imagePrompt: buildPhotoPrompt(outline.title, visual, sentences)
    }],
    visual,
    imagePrompt: buildPhotoPrompt(outline.title, visual, sentences),
    sentences,
    translations,
    vocabulary: fallbackVocabulary(`${object} ${beat}`)
  };
}

function fallbackFactualScene(outline, beat, nextBeat, index) {
  const subject = outline.title;
  const sentences = [
    `${subject} reached an important public milestone in this part of the timeline.`,
    `The milestone showed how a plan became more concrete and visible.`,
    `Public reports connected this moment with a larger business decision.`,
    `The next step was also important: ${cleanSentence(nextBeat)}`
  ];
  const translations = [
    `${subject}在这段时间线中到达了一个重要的公开里程碑。`,
    `这个里程碑显示了一个计划如何变得更加具体和清晰。`,
    `公开信息把这一刻和更大的商业决定联系起来。`,
    `下一步同样重要：${nextBeat}`
  ];
  const visual = `${subject}, factual documentary scene about ${beat}, public event or realistic industry setting, ${outline.visualStyle}`;
  return {
    title: `Scene ${index + 1}`,
    baseSectionIndex: index,
    imageVariantIndex: 0,
    imageBeatSize: sentences.length,
    imageBeatCount: 1,
    imageBeats: [{
      sentenceStart: 0,
      sentenceEnd: sentences.length - 1,
      durationNote: "cover the full scene",
      imagePrompt: buildPhotoPrompt(outline.title, visual, sentences)
    }],
    visual,
    imagePrompt: buildPhotoPrompt(outline.title, visual, sentences),
    sentences,
    translations,
    vocabulary: fallbackVocabulary(`${beat} ${nextBeat}`)
  };
}

function fallbackOutline(topic, minutes, template = null) {
  const title = titleCase(topic || "A Quiet Story");
  const factualMode = isFactualTemplate(template) || isFactualHistoryTopic(topic);
  return {
    title,
    genre: factualMode ? "factual documentary history" : cleanText(template?.title) || "cinematic slice-of-life story",
    level: "beginner",
    contentMode: factualMode ? "factual-documentary" : "fictional-story",
    summary: factualMode
      ? `${title} is told as a simple factual documentary timeline for English learners. It focuses on public milestones, dates, decisions, products, and outcomes.`
      : `${title} follows one clear character through a simple problem, a meaningful choice, and a calm ending. The story is written for English learners who need natural, easy sentences.`,
    mainCharacter: factualMode ? "The company and its public leadership" : "Emma",
    setting: factualMode ? "public events, offices, factories, and launch stages" : chooseSetting(title),
    visualStyle: cleanText(template?.visualStyle) || "photorealistic cinematic still photo, natural light, realistic people, clear story emotion",
    storyBeats: [
      factualMode ? "The public plan is announced with a clear date." : "The main character notices an unusual detail.",
      factualMode ? "A new business unit or project team is formed." : "A small question appears in an ordinary place.",
      factualMode ? "The company invests resources and begins research and development." : "The character follows the first clue carefully.",
      factualMode ? "The first technology or product preview is shown to the public." : "A helpful person shares a simple idea.",
      factualMode ? "The factory or production plan becomes visible." : "The weather or setting changes the plan.",
      factualMode ? "The first product is officially launched." : "The character makes a careful choice.",
      factualMode ? "Early orders, deliveries, or public reactions show market interest." : "A hidden meaning becomes easier to see.",
      factualMode ? "The company expands the roadmap and prepares the next milestone." : "The problem grows for a short time.",
      factualMode ? "The story closes with the project becoming part of a larger strategy." : "The character remembers a kind lesson."
    ],
    vocabularyFocus: Array.isArray(template?.vocabularyFocus) ? template.vocabularyFocus : ["notice", "carefully", "choice", "clue", "quiet", "remember", "helpful", "change", "answer", "meaning"],
    targetMinutes: Number(minutes || 15),
    source: "local"
  };
}

function isFactualHistoryTopic(topic) {
  return /\b(history|development|timeline|startup|company|founder|founded|launch|launched|auto|automobile|car|ev|xiaomi|tesla|apple|microsoft|google|huawei|byd|nio|xpeng)\b/i.test(String(topic || ""));
}

function isFactualTemplate(template) {
  return cleanText(template?.contentMode) === "factual-documentary";
}

function isPersonFocusedTopic(topic, template) {
  return template?.id === "founder-biography"
    || /\b(founder|biography|leader|ceo|profile|life of|elon musk|steve jobs|lei jun|bill gates|person)\b/i.test(String(topic || ""));
}

function cleanContentMode(value, topic, template = null) {
  const text = cleanText(value).toLowerCase();
  if (text === "factual-documentary" || text === "fictional-story") return text;
  if (isFactualTemplate(template)) return "factual-documentary";
  return isFactualHistoryTopic(topic) ? "factual-documentary" : "fictional-story";
}

function formatTemplateForPrompt(template) {
  return [
    "Video type template:",
    `- Name: ${cleanText(template.title)}`,
    `- Content mode: ${cleanText(template.contentMode)}`,
    `- Summary: ${cleanText(template.summary)}`,
    `- Structure rules: ${cleanText(template.structureRules)}`,
    `- Visual style: ${cleanText(template.visualStyle)}`,
    `- Vocabulary focus: ${(template.vocabularyFocus || []).join(", ")}`,
    `- Draft guidance: ${cleanText(template.draftGuidance)}`
  ].filter(Boolean).join("\n");
}

function buildPhotoPrompt(storyTitle, visual, sentences = []) {
  return [
    "16:9 photorealistic cinematic still photograph for an English shadowing video background.",
    `Story: ${storyTitle}.`,
    `Scene: ${visual}.`,
    sentences.length ? `Moment: ${sentences.slice(0, 3).join(" ")}` : "",
    "Shot direction: one clear main subject, believable real-world location, visible story object, natural human scale, documentary realism.",
    "Camera: 35mm or 50mm lens look, cinematic depth of field, high dynamic range, realistic texture, no oversaturated fantasy colors.",
    "Composition: strong upper and middle frame detail, natural uncluttered bottom area, no artificial lower-third panel or text banner.",
    "Lighting: natural or motivated cinematic light, soft contrast, realistic shadows, professional production still quality.",
    "No text, no subtitles, no captions, no watermark, no logo, no UI elements, no black lower-third bar, no placeholder words like Your Text, no cartoon, no flat vector art, no slide design."
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

async function getLlmConfig() {
  const settings = await getEffectiveSettings();
  if (settings.provider === "xiaomi" && settings.xiaomi?.apiKey) {
    return {
      provider: "xiaomi",
      baseUrl: settings.xiaomi.baseUrl || "https://token-plan-sgp.xiaomimimo.com/v1",
      model: settings.xiaomi.textModel || "MiMo-V2.5-Pro",
      apiKey: settings.xiaomi.apiKey
    };
  }
  return {
    provider: "openai-compatible",
    baseUrl: settings.llm.baseUrl || DEFAULT_LLM.baseUrl,
    model: normalizeProviderModel(settings.llm.model || DEFAULT_LLM.model, settings.llm.baseUrl || DEFAULT_LLM.baseUrl),
    apiKey: settings.llm.apiKey || ""
  };
}

function normalizeProviderModel(model, baseUrl) {
  const text = String(model || "").trim();
  if (/dashscope\.aliyuncs\.com/i.test(String(baseUrl || "")) && text.startsWith("openai/")) {
    return text.slice("openai/".length);
  }
  return text || DEFAULT_LLM.model;
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
  reviseStoryDraft,
  getLlmConfig
};
