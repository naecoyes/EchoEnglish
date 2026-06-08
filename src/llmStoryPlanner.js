const { DEFAULT_LLM, getEffectiveSettings } = require("./settingsStore");
const { formatSearchContext } = require("./tavilySearch");
const { enrichStoryVocabulary } = require("./vocabularyTools");
const { filterBoilerplateSections, findStoryQualityIssues, sectionHasBoilerplate } = require("./storyQuality");

async function generateVideoTemplate({ topic, minutes = 15, searchContext = null }) {
  const config = await getLlmConfig();
  if (!config.apiKey) {
    throw new Error("LLM API key is required for template generation. Open Settings and save an LLM API key.");
  }

  const prompt = [
    "Generate a video template configuration for an English learning story video.",
    "The template should define the structure, style, and content guidelines for the video.",
    "Return only valid JSON with this exact shape:",
    "{",
    '  "id": "auto-generated",',
    '  "title": "descriptive template title",',
    '  "contentMode": "factual-documentary or fictional-story",',
    '  "summary": "1-2 sentence description of what this video template covers",',
    '  "structureRules": "detailed guidance on how to structure the story (opening, middle, ending)",',
    '  "visualStyle": "detailed visual style description for image generation",',
    '  "vocabularyFocus": ["8-12 domain-specific vocabulary words"],',
    '  "searchHint": "keywords for web search to find factual information",',
    '  "draftGuidance": "specific instructions for writing the story content"',
    "}",
    `Topic: ${topic}`,
    `Target minutes: ${minutes}`,
    "Guidelines:",
    "- If the topic is about a real company, person, product, or historical event, use contentMode: factual-documentary",
    "- If the topic is fictional or generic, use contentMode: fictional-story",
    "- structureRules should provide a clear narrative arc appropriate for the topic",
    "- visualStyle should be specific enough for AI image generation (photorealistic, cinematic, etc.)",
    "- vocabularyFocus should include B1-level words relevant to the topic domain",
    "- searchHint should help find accurate information for factual topics",
    "- draftGuidance should ensure the story is appropriate for English learners",
    searchContext ? `Web search context for reference:\n${formatSearchContext(searchContext)}` : ""
  ].filter(Boolean).join("\n");

  const payload = await callChatJson(config, prompt, 1500);

  // Validate and normalize the generated template
  const template = {
    id: payload.id || "auto-generated",
    title: cleanText(payload.title) || "Generated Story",
    contentMode: payload.contentMode === "factual-documentary" ? "factual-documentary" : "fictional-story",
    summary: cleanText(payload.summary) || `A story about ${topic}.`,
    structureRules: cleanText(payload.structureRules) || "Follow a clear narrative structure with beginning, middle, and end.",
    visualStyle: cleanText(payload.visualStyle) || "photorealistic cinematic still photo, natural lighting, clear composition",
    vocabularyFocus: Array.isArray(payload.vocabularyFocus) ? payload.vocabularyFocus.slice(0, 12) : ["story", "character", "scene", "moment", "detail", "emotion", "choice", "result"],
    searchHint: cleanText(payload.searchHint) || `${topic} facts timeline history`,
    draftGuidance: cleanText(payload.draftGuidance) || "Keep sentences simple and clear for beginner English learners."
  };

  return template;
}

async function createStoryOutline({ topic, minutes, searchContext = null, template = null }) {
  const config = await getLlmConfig();
  if (!config.apiKey) {
    throw new Error("LLM API key is required for story overview generation. Open Settings and save an LLM API key.");
  }
  const countryHistoryMode = isCountryHistoryTemplate(template) || isCountryHistoryTopic(topic);
  const publicBiographyMode = isPublicFigureBiographyTemplate(template) || isPublicFigureBiographyTopic(topic);
  const factualMode = countryHistoryMode || publicBiographyMode || isFactualTemplate(template) || isFactualHistoryTopic(topic);

  const prompt = [
    "Create a story plan for an English learning story video.",
    "The user will review this plan before video generation.",
    template ? formatTemplateForPrompt(template) : "",
    factualMode
      ? "This topic is about a real company, product, person, or history. Use factual documentary mode, not fictional story mode."
      : "If the topic is fictional or generic, use a simple story mode.",
    `- CRITICAL TOPIC ADHERENCE: The entire outline from beginning to end MUST remain focused exclusively on the topic: "${topic}". NEVER switch to discussing a different person, company, or historical figure halfway through. Maintain strict subject continuity.`,
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
    '  "targetScenes": number (15-30, based on topic complexity),',
    '  "sentencesPerScene": number (3-6, based on content needs),',
    '  "targetImages": number (20-50, about 2-3 per minute),',
    '  "storyBeats": ["array of plot beats, number should match targetScenes"],',
    '  "vocabularyFocus": ["8-12 useful words or phrases"]',
    "}",
    `Topic: ${topic}`,
    `Target minutes: ${minutes}`,
    "IMPORTANT: Determine the optimal structure based on the topic:",
    "- Complex topics with many milestones: use more scenes (20-30) with fewer sentences each (3-4)",
    "- Simple narrative topics: use fewer scenes (15-20) with more sentences each (4-6)",
    "- Rich historical topics: use 2-3 images per minute for visual variety without visual overload",
    countryHistoryMode ? "- Country history documentaries should target 12-15 minutes. Use 34-44 scenes, 4-5 sentences per scene, and 38-50 total image beats." : "",
    countryHistoryMode ? "- Country history structure: ancient origins, geography, early civilization, key dynasties/kingdoms/periods, outside influences, independence or modern state, culture/economy today, and peaceful recap." : "",
    countryHistoryMode ? "- Country history tone: soft educational overview. Avoid heavy conflict detail, graphic war scenes, patriotic slogans, and political judgment." : "",
    publicBiographyMode ? "- Public figure biographies should target 12-15 minutes. Use 34-44 scenes, 4-5 sentences per scene, and 38-50 total image beats." : "",
    publicBiographyMode ? "- Public figure biography structure: early life, education or influences, first turning point, main work and achievements, setbacks or challenges, public impact, legacy, and calm recap." : "",
    publicBiographyMode ? "- Public figure biography tone: respectful, neutral, educational. Avoid hero worship, gossip, political judgment, unsupported private emotions, and invented conversations." : "",
    "- Keep the total duration around the target minutes when read slowly with pauses",
    "Keep the plan simple, emotional, visual, and suitable for beginner English learners.",
    "Use the web search context when the topic involves real people, companies, places, history, news, or culture.",
    "Do not invent factual claims that conflict with the search context.",
    factualMode
      ? "For factual documentary mode: do not invent a fictional protagonist, fictional employee, fictional dialogue, or private scene. Use real dates, named public people or organizations from the sources, and a clear chronological timeline. The storyBeats must be factual milestones, not imagined workshop drama."
      : "",
    countryHistoryMode
      ? "For country history mode: do not create a fictional hero, tourist narrator, private family scene, or invented conversation. Use public facts from the search context and explain large events with simple English."
      : "",
    publicBiographyMode
      ? "For public figure biography mode: use only public biography facts from the search context. Do not invent private conversations, family scenes, gossip, or inner thoughts."
      : "",
    `Web search context:\n${formatSearchContext(searchContext)}`
  ].filter(Boolean).join("\n");

  const payload = await callChatJson(config, prompt, 2400);
  return normalizeOutline(payload, topic, minutes, searchContext ? "llm+tavily" : "llm", searchContext, template);
}

async function reviseStoryDraft({ topic, targetDurationMinutes, draft, feedback, template = null }) {
  const config = await getLlmConfig();
  if (!config.apiKey) {
    throw new Error("LLM API key is required for draft revision. Open Settings and save an LLM API key.");
  }
  if (!draft || typeof draft !== "object") {
    throw new Error("A current story draft is required before revision.");
  }

  const countryHistoryMode = isCountryHistoryTemplate(template || draft.template || draft.outline?.template) || isCountryHistoryTopic(topic);
  const publicBiographyMode = isPublicFigureBiographyTemplate(template || draft.template || draft.outline?.template) || isPublicFigureBiographyTopic(topic);
  const factualMode = countryHistoryMode || publicBiographyMode || isFactualTemplate(template) || draft.contentMode === "factual-documentary" || draft.outline?.contentMode === "factual-documentary" || isFactualHistoryTopic(topic);
  const prompt = [
    "Revise this English learning video story draft according to the user's feedback.",
    "Return the complete revised source JSON, not a patch.",
    template ? formatTemplateForPrompt(template) : "",
    "Hard requirements:",
    "- Target 12-15 minutes of natural read-aloud time.",
    countryHistoryMode ? "- Use 34-44 internal scenes for the ancient-to-modern country overview." : publicBiographyMode ? "- Use 34-44 internal scenes for the public figure biography." : "- Use 16-24 internal scenes.",
    countryHistoryMode || publicBiographyMode ? "- Each scene has 4-5 English sentences." : "- Each scene has exactly 4 English sentences.",
    countryHistoryMode || publicBiographyMode ? "- Use 38-50 total background image beats, about 3 images per minute." : "- Use 30-45 total background image beats, about 2-3 images per minute.",
    countryHistoryMode ? "- Each scene should normally have 1 imageBeat covering the full scene. Use 2 imageBeats only when the story clearly changes period, place, object, or public setting." : publicBiographyMode ? "- Each scene should normally have 1 imageBeat covering the full scene. Use 2 imageBeats only when the biography clearly changes place, time period, public role, or symbolic object." : "- Each scene should normally have 1 imageBeat covering all 4 sentences. Use 2 imageBeats only when the story clearly changes location, action, or speaker focus inside that scene.",
    "- Keep beginner English, Chinese sentence translations, exactly 3 valid vocabulary notes per scene, imageBeats, and photorealistic image prompts.",
    "- Each vocabulary note must be [\"word or phrase\", \"中文释义\", \"/IPA/\"] with all fields non-empty.",
    factualMode ? "- Factual documentary mode: do not invent fictional protagonists, employees, dialogue, or unsupported private scenes." : "",
    countryHistoryMode ? "- Country history mode: keep a soft overview from ancient origins to modern culture and economy. Avoid political judgment, heavy battle detail, propaganda, or fictional private scenes." : "",
    publicBiographyMode ? "- Public figure biography mode: keep a respectful neutral timeline. Avoid hero worship, gossip, unsupported private emotions, private family drama, or invented dialogue." : "",
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
  const countryHistoryMode = isCountryHistoryTemplate(template || outline?.template) || isCountryHistoryTopic(topic);
  const publicBiographyMode = isPublicFigureBiographyTemplate(template || outline?.template) || isPublicFigureBiographyTopic(topic);
  const factualMode = countryHistoryMode || publicBiographyMode || isFactualTemplate(template) || outline?.contentMode === "factual-documentary" || isFactualHistoryTopic(topic);
  const podcastMode = template?.id === "podcast-dialogue";

  // Get model-determined parameters from outline
  const targetScenes = outline?.targetScenes || (countryHistoryMode ? 38 : publicBiographyMode ? 38 : Math.max(12, Math.round(minutes * 1.1)));
  const sentencesPerScene = outline?.sentencesPerScene || 4;
  const targetImages = outline?.targetImages || (countryHistoryMode || publicBiographyMode ? Math.min(40, Math.max(30, Math.round(minutes * 2.5))) : Math.round(minutes * 2.5));

  return [
    podcastMode
      ? "Write the complete source JSON for a two-host English learning podcast video."
      : "Write the complete source JSON for a pure English story narration video.",
    template ? formatTemplateForPrompt(template) : "",
    "Important rules:",
    `- CRITICAL TOPIC ADHERENCE: The entire story from beginning to end MUST remain focused exclusively on the topic: "${topic}". NEVER switch to discussing a different person, company, or historical figure halfway through the story. Maintain strict subject continuity across all scenes.`,
    podcastMode
      ? "- Podcast mode: write natural two-host dialogue. Every sentence must begin with Host A: or Host B: so the TTS can choose the right voice."
      : "- Pure story mode only. Do not include Part, Chapter, Listen, Shadow, Review, teaching instructions, or repeated rounds.",
    podcastMode
      ? "- Use real conversational turns, not mechanical one-sentence alternation. A host may speak 1-3 short sentences in a row before the other host responds."
      : "- The English narration must be continuous story prose in short beginner-friendly sentences.",
    podcastMode
      ? `- For podcast mode, every scene still has exactly ${sentencesPerScene} sentences. Use varied turn patterns such as A,A,B,B or A,B,B,A when it sounds natural.`
      : "",
    countryHistoryMode
      ? `- Use ${targetScenes} internal scenes. Each scene has 3-4 English sentences.`
      : publicBiographyMode
      ? `- Use ${targetScenes} internal scenes. Each scene has 3-4 English sentences.`
      : `- Use ${targetScenes} internal scenes. Each scene has exactly ${sentencesPerScene} English sentences.`,
    `- The story should naturally last about ${minutes} minutes when read slowly with short pauses.`,
    `- The video should use ${targetImages} total background image beats. Do not create one image per sentence.`,
    "- Each image beat should cover 2-4 adjacent sentences. Most scenes should use one image beat covering all sentences; use two only for major visual changes.",
    "- Let the model decide image beat timing from the story flow by assigning sentenceStart and sentenceEnd for each imageBeat.",
    "- Every scene must have complete Chinese sentence translations, exactly 3 useful vocabulary notes, IPA phonetics, and a concise photorealistic image prompt.",
    "- Chinese translations must be natural full-sentence Chinese. Do not shorten, omit named entities, or leave placeholders.",
    "- Vocabulary notes must use this exact structure: [\"word or phrase\", \"中文释义\", \"/IPA/\"]. All three fields must be non-empty. Each scene must include 3 valid entries, not 1 or 2.",
    "- Vocabulary notes must not repeat across scenes. Choose words or short phrases that appear in that scene's English sentences whenever possible. Avoid very easy words such as good, make, see, time, first, small, work, or help.",
    "- Prefer useful B1/domain words. For public biographies, prefer words such as ambition, discipline, breakthrough, legacy, contribution, challenge, influence, achievement, resilience, mentor, reform, innovation.",
    "- Image prompts must be camera-ready prompts: subject, location, action, foreground/background, lighting, lens or camera feel, color mood, and a clear composition with a natural, uncluttered bottom area.",
    "- Image prompts must look like realistic documentary photography or cinematic production stills. No cartoon, no flat illustration, no PPT slide, no text, no subtitles, no logo, no black lower-third bar, no placeholder words like Your Text. Product interfaces (websites, apps, software screens) are allowed when the story topic requires them, but they must look like real screenshots in a natural environment, not mockups or slides.",
    "- Avoid repeated generic wording. Each scene prompt must have a distinct place, object, camera angle, or action.",
    isPersonFocusedTopic(topic, template)
      ? "- Person-focused mode: keep the same public subject visually consistent. Prefer one-person portraits, public-stage photos, offices, documents, symbolic objects, and context shots. Do not generate multiple unrelated faces or group portraits unless the facts require a public group scene."
      : "",
    publicBiographyMode
      ? "- Public figure biography mode: do not invent fictional scenes, private conversations, gossip, unsupported emotions, or private family drama. Use public facts from the outline/search context."
      : "",
    publicBiographyMode
      ? "- Public figure biography structure must move from early life, education or influences, first turning point, main work and achievements, setbacks or challenges, public impact, legacy, and a calm recap."
      : "",
    publicBiographyMode
      ? "- Public figure biography tone: respectful, neutral, educational documentary. Avoid hero worship, partisan judgment, sensational claims, and celebrity gossip."
      : "",
    publicBiographyMode
      ? "- Public figure biography image prompts: mix public stage scenes, schools, laboratories, studies, studios, city context, archival documents, tools, awards, memorial spaces, and symbolic close-ups."
      : "",
    publicBiographyMode
      ? "- For awards or ceremonies, prefer symbolic visuals such as a medal on a desk, an empty podium, archival documents, a side-view silhouette, or a quiet public hall. Avoid crowded award stages, dignitary handshakes, exact celebrity faces, and many unrelated people."
      : "",
    publicBiographyMode
      ? "- Public figure visual safety: if no reference image is provided, avoid demanding an exact face. Prefer single-person silhouettes, side views, back views, public-context portraits, documents, tools, and symbolic environments. No podcast hosts, microphones, embedded text, logos, paparazzi style, or Your Text."
      : "",
    countryHistoryMode
      ? "- Country history mode: do not create fictional protagonists, fictional dialogue, private scenes, or tourist storylines. Use only public facts from the outline/search context."
      : "",
    countryHistoryMode
      ? "- Country history structure must move from geography and ancient origins to early civilization, key kingdoms/dynasties/periods, outside influences, independence or modern state formation, culture/economy today, and a peaceful recap."
      : "",
    countryHistoryMode
      ? "- Country history tone: soft educational documentary. Explain large events briefly in beginner English, avoid dense war detail, graphic violence, patriotic slogans, and political judgment."
      : "",
    countryHistoryMode
      ? "- Country history image prompts: mix maps without text labels, landmarks, historic architecture, museums, artifacts, ports, city streets, and public memorial spaces. Use documentary-style historical reconstruction only when needed."
      : "",
    countryHistoryMode
      ? "- Country history visual safety: no podcast hosts, studios, microphones, fictional heroes, wrong flags, readable signs, propaganda posters, embedded labels, or Your Text. Use geography, architecture, colors, artifacts, and public spaces to express national identity."
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
    outline?.validationFeedback ? `- IMPORTANT: Previous generation had issues. Fix these problems: ${outline.validationFeedback}` : "",
    "Return only valid JSON with this shape:",
    "{",
    '  "title": "string",',
    '  "summary": "string",',
    '  "coverImagePrompt": "A 45-70 word creative seed for the video cover image. Describe the strongest visual hook, subject, mood, and setting. Do not request embedded text, signs, logos, subtitles, typography, or placeholder words.",',
    '  "storyboardDesign": {"visualStyle": "string", "learningFocus": "string", "framePattern": "string", "targetLength": "string"},',
    '  "sections": [',
    `    {"title": "short internal scene label, not spoken", "visual": "string", "imagePrompt": "45-70 word English photorealistic prompt", "imageBeats": [{"sentenceStart": 0, "sentenceEnd": ${sentencesPerScene - 1}, "durationNote": "covers the whole scene", "imagePrompt": "specific 45-70 word prompt for this beat"}], "sentences": ["English sentence"], "translations": ["完整中文翻译"], "vocabulary": [["word or phrase 1", "中文释义", "/IPA/"], ["word or phrase 2", "中文释义", "/IPA/"], ["word or phrase 3", "中文释义", "/IPA/"]]}`,
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

  const timeoutMs = Number(process.env.LLM_REQUEST_TIMEOUT_MS || 600000);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(`${config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`LLM request timed out after ${Math.round(timeoutMs / 1000)} seconds.`);
    }
    throw new Error(`LLM request failed: ${error.message}`);
  } finally {
    clearTimeout(timeout);
  }

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
  const countryHistoryMode = isCountryHistoryTemplate(template || input?.template) || isCountryHistoryTopic(topic);
  const publicBiographyMode = isPublicFigureBiographyTemplate(template || input?.template) || isPublicFigureBiographyTopic(topic);
  const title = cleanText(input?.title) || fallback.title;
  const beats = normalizeStringArray(input?.storyBeats, fallback.storyBeats);

  // Use model-determined values or defaults
  const rawTargetScenes = Number(input?.targetScenes) || (countryHistoryMode || publicBiographyMode ? 20 : Math.max(12, Math.round(minutes * 1.1)));
  const rawSentencesPerScene = Number(input?.sentencesPerScene) || 4;
  const rawTargetImages = Number(input?.targetImages) || Math.round(minutes * 2.5);
  const targetScenes = countryHistoryMode ? clampInteger(rawTargetScenes, 34, 44) : publicBiographyMode ? clampInteger(rawTargetScenes, 34, 44) : rawTargetScenes;
  const sentencesPerScene = countryHistoryMode || publicBiographyMode ? clampInteger(rawSentencesPerScene, 4, 5) : rawSentencesPerScene;
  const targetImages = countryHistoryMode || publicBiographyMode ? clampInteger(rawTargetImages, 38, 50) : rawTargetImages;

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
    targetScenes,
    sentencesPerScene,
    targetImages,
    source,
    searchContext: searchContext || input?.searchContext || null,
    template: template || input?.template || null
  };
}

function normalizeStory(input, context) {
  const outline = normalizeOutline(context.outline || input, context.topic, context.targetDurationMinutes, context.source, null, context.template);
  const sections = Array.isArray(input?.sections) ? input.sections : [];

  // Use outline's sentencesPerScene for validation (default 4)
  const sentencesPerScene = outline.sentencesPerScene || 4;

  let normalizedSections = sections
    .map((section, index) => normalizeSection(section, index, input?.title || outline.title))
    .filter((section) => section.sentences.length >= 3 && section.sentences.length <= 6 && section.translations.length === section.sentences.length)
    .slice(0, outline.targetScenes || 30);
  normalizedSections = filterBoilerplateSections(deduplicateSections(normalizedSections));
  const generationWarnings = [];
  const targetScenes = outline.targetScenes || Math.max(12, Math.round((context.targetDurationMinutes || 15) * 1.1));
  const targetImages = outline.targetImages || Math.round((context.targetDurationMinutes || 15) * 2.5);
  const countryHistoryMode = isCountryHistoryTemplate(outline.template || context.template) || isCountryHistoryTopic(context.topic);
  const publicBiographyMode = isPublicFigureBiographyTemplate(outline.template || context.template) || isPublicFigureBiographyTopic(context.topic);
  const minimumScenes = countryHistoryMode || publicBiographyMode ? 30 : Math.min(12, Math.max(8, targetScenes - 4));

  // Require enough non-boilerplate scenes. Failing here is better than producing a video
  // whose final minutes repeat generic filler sentences.
  if (normalizedSections.length < minimumScenes) {
    throw new Error(`LLM returned only ${normalizedSections.length} usable non-repetitive scenes. Minimum ${minimumScenes} scenes required. Please retry generation.`);
  }

  // Don't force-fill to target scenes - use what LLM generated
  if (normalizedSections.length < targetScenes) {
    generationWarnings.push(`LLM returned ${normalizedSections.length} scenes (target was ${targetScenes}). Using all generated scenes without filling.`);
  }

  const imageBeatCount = countImageBeats(normalizedSections);
  if (imageBeatCount < targetImages) {
    normalizedSections = ensureImageBeatTarget(normalizedSections, outline, targetImages);
    generationWarnings.push(`LLM returned ${imageBeatCount} image beats; EchoEnglish split story scenes into ${countImageBeats(normalizedSections)} visual beats for the target.`);
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

function deduplicateSections(sections) {
  const seen = new Set();
  const result = [];
  for (const section of sections) {
    const sentences = section.sentences || [];
    const signature = sentences.map((s) => normalizeForDedupe(s)).join("|");
    if (seen.has(signature)) continue;
    const firstSentence = normalizeForDedupe(sentences[0] || "");
    if (firstSentence.length > 20) {
      const isNearDup = result.some((prev) => {
        const prevFirst = normalizeForDedupe((prev.sentences || [])[0] || "");
        if (prevFirst === firstSentence) return true;
        // Only flag as near-dup if 80%+ of first sentence overlaps
        const minLen = Math.min(prevFirst.length, firstSentence.length);
        if (minLen < 40) return false;
        const overlap = Math.min(80, minLen);
        return prevFirst.slice(0, overlap) === firstSentence.slice(0, overlap);
      });
      if (isNearDup) continue;
    }
    if (sectionHasBoilerplate(section)) continue;
    seen.add(signature);
    result.push(section);
  }
  return result;
}

function normalizeForDedupe(text) {
  return String(text || "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 100);
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
  const beats = outline.storyBeats || [];
  const sections = [];

  // Generate scenes from beats without repeating
  for (let index = 0; index < beats.length; index += 1) {
    const beat = beats[index];
    const nextBeat = beats[index + 1] || beats[beats.length - 1];
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
  const subject = outline.title || "The company";
  const beatText = cleanSentence(beat);
  const nextText = cleanSentence(nextBeat);

  // Expand the story beat into 4 meaningful sentences
  const beatLower = beatText.toLowerCase();
  let sentences, translations;

  if (beatLower.includes("founded") || beatLower.includes("started") || beatLower.includes("began")) {
    sentences = [
      `${beatText}`,
      `This was the beginning of a new chapter for ${subject}.`,
      `The team worked hard to turn their vision into reality.`,
      `${nextText}`
    ];
    translations = [
      beatText.replace(/^In \d{4},/, (m) => m + "，"),
      `这是${subject}新篇章的开始。`,
      `团队努力将愿景变为现实。`,
      nextText
    ];
  } else if (beatLower.includes("launch") || beatLower.includes("release") || beatLower.includes("introduce")) {
    sentences = [
      `${beatText}`,
      `The market responded with great interest and excitement.`,
      `This product helped the company reach many new customers.`,
      `${nextText}`
    ];
    translations = [
      beatText,
      `市场反响热烈，引起了很大的关注。`,
      `这款产品帮助公司接触到了很多新客户。`,
      nextText
    ];
  } else if (beatLower.includes("ipo") || beatLower.includes("public") || beatLower.includes("invest")) {
    sentences = [
      `${beatText}`,
      `This event brought significant new resources for future growth.`,
      `The company used this opportunity to expand its business further.`,
      `${nextText}`
    ];
    translations = [
      beatText,
      `这一事件为未来的发展带来了重要的新资源。`,
      `公司利用这个机会进一步扩展了业务。`,
      nextText
    ];
  } else if (beatLower.includes("expand") || beatLower.includes("global") || beatLower.includes("international")) {
    sentences = [
      `${beatText}`,
      `Entering new markets brought both opportunities and challenges.`,
      `The company adapted its strategy to succeed in different regions.`,
      `${nextText}`
    ];
    translations = [
      beatText,
      `进入新市场带来了机遇和挑战。`,
      `公司调整了策略以在不同地区取得成功。`,
      nextText
    ];
  } else {
    sentences = [
      `${beatText}`,
      `This step was an important part of ${subject}'s growth story.`,
      `The results showed that the company was moving in the right direction.`,
      `${nextText}`
    ];
    translations = [
      beatText,
      `这一步是${subject}发展历程中的重要一环。`,
      `结果表明公司正在朝着正确的方向前进。`,
      nextText
    ];
  }

  const visual = `${subject}, factual documentary scene about ${beat}, public event or realistic industry setting, ${outline.visualStyle || "cinematic lighting"}`;
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
  const countryHistoryMode = isCountryHistoryTemplate(template) || isCountryHistoryTopic(topic);
  const publicBiographyMode = isPublicFigureBiographyTemplate(template) || isPublicFigureBiographyTopic(topic);
  const factualMode = countryHistoryMode || publicBiographyMode || isFactualTemplate(template) || isFactualHistoryTopic(topic);
  const countryHistoryBeats = [
    "Introduce the country with its geography, landscape, and position on the map.",
    "Explain the ancient origins and the earliest known communities in simple terms.",
    "Describe how early civilization grew through farming, rivers, coastlines, trade, or cities.",
    "Show one or two important kingdoms, dynasties, empires, or historical periods.",
    "Explain how outside influences, trade routes, migrations, or neighbors shaped the country.",
    "Describe a major cultural heritage moment through architecture, language, art, or belief.",
    "Explain the path toward independence, modern state formation, or major reform with neutral language.",
    "Show how cities, education, culture, and the economy developed in modern times.",
    "Describe the country today through public life, heritage, identity, and peaceful everyday scenes.",
    "Close with a calm recap of how history shaped the country's modern identity."
  ];
  const publicBiographyBeats = [
    "Introduce the public figure and explain why their life still matters.",
    "Describe early life and the environment that shaped their first interests.",
    "Explain education, mentors, influences, or early practice in simple terms.",
    "Show the first turning point when their path became clearer.",
    "Describe the main work, craft, research, leadership, or public contribution.",
    "Explain one major breakthrough, achievement, publication, performance, or decision.",
    "Describe a challenge or setback with neutral respectful language.",
    "Show how the person continued working, learning, or changing direction.",
    "Explain the wider public impact of their work or choices.",
    "Close with their legacy and a calm recap for English learners."
  ];
  return {
    title,
    genre: countryHistoryMode ? "soft country history documentary" : publicBiographyMode ? "public figure biography documentary" : factualMode ? "factual documentary history" : cleanText(template?.title) || "cinematic slice-of-life story",
    level: "beginner",
    contentMode: factualMode ? "factual-documentary" : "fictional-story",
    summary: countryHistoryMode
      ? `${title} is told as a soft ancient-to-modern country history overview for English learners. It focuses on geography, civilization, public milestones, culture, economy, and modern identity.`
      : publicBiographyMode
      ? `${title} is told as a respectful factual public biography for English learners. It focuses on public facts, turning points, achievements, challenges, impact, and legacy.`
      : factualMode
      ? `${title} is told as a simple factual documentary timeline for English learners. It focuses on public milestones, dates, decisions, products, and outcomes.`
      : `${title} follows one clear character through a simple problem, a meaningful choice, and a calm ending. The story is written for English learners who need natural, easy sentences.`,
    mainCharacter: countryHistoryMode ? "The country, its people, public places, and historical record" : publicBiographyMode ? "The public figure and their documented public life" : factualMode ? "The company and its public leadership" : "Emma",
    setting: countryHistoryMode ? "geography, ancient sites, museums, landmarks, public streets, ports, and modern cities" : publicBiographyMode ? "public stages, schools, workplaces, documents, city context, symbolic objects, and memorial spaces" : factualMode ? "public events, offices, factories, and launch stages" : chooseSetting(title),
    visualStyle: cleanText(template?.visualStyle) || "photorealistic cinematic still photo, natural light, realistic people, clear story emotion",
    storyBeats: countryHistoryMode ? countryHistoryBeats : publicBiographyMode ? publicBiographyBeats : factualMode ? [
      "The founders meet and discover a shared vision for innovation.",
      "They work in a small garage or office, building the first prototype.",
      "The team faces early technical challenges and solves them creatively.",
      "The first product launch creates excitement in the market.",
      "Early customers provide feedback that shapes the next version.",
      "The company secures funding from investors who believe in the vision.",
      "A major partnership or deal accelerates growth significantly.",
      "The company expands internationally, entering new markets.",
      "New product lines are introduced to meet growing demand.",
      "The company reaches a major milestone in revenue or users.",
      "Leadership changes bring fresh strategy and direction.",
      "The company invests heavily in research and development.",
      "A crisis or challenge tests the company's resilience.",
      "The company adapts and emerges stronger than before.",
      "Today, the company stands as a leader in its industry."
    ] : [
      "The main character notices an unusual detail.",
      "A small question appears in an ordinary place.",
      "The character follows the first clue carefully.",
      "A helpful person shares a simple idea.",
      "The weather or setting changes the plan.",
      "The character makes a careful choice.",
      "A hidden meaning becomes easier to see.",
      "The problem grows for a short time.",
      "The character remembers a kind lesson."
    ],
    vocabularyFocus: Array.isArray(template?.vocabularyFocus) ? template.vocabularyFocus : ["notice", "carefully", "choice", "clue", "quiet", "remember", "helpful", "change", "answer", "meaning"],
    targetMinutes: Number(minutes || 15),
    targetScenes: countryHistoryMode || publicBiographyMode ? 20 : undefined,
    sentencesPerScene: countryHistoryMode || publicBiographyMode ? 4 : undefined,
    targetImages: countryHistoryMode || publicBiographyMode ? Math.min(40, Math.max(30, Math.round(Number(minutes || 15) * 2.5))) : undefined,
    source: "local"
  };
}

function isFactualHistoryTopic(topic) {
  return isCountryHistoryTopic(topic) || isPublicFigureBiographyTopic(topic) || /\b(history|development|timeline|startup|company|founder|founded|launch|launched|auto|automobile|car|ev|xiaomi|tesla|apple|microsoft|google|huawei|byd|nio|xpeng)\b/i.test(String(topic || ""));
}

function isFactualTemplate(template) {
  return cleanText(template?.contentMode) === "factual-documentary";
}

function isCountryHistoryTemplate(template) {
  return cleanText(template?.id) === "country-history" || /\bcountry history documentary\b/i.test(cleanText(template?.title));
}

function isPublicFigureBiographyTemplate(template) {
  return cleanText(template?.id) === "public-figure-biography" || /\bpublic figure biography\b/i.test(cleanText(template?.title));
}

function isCountryHistoryTopic(topic) {
  const text = String(topic || "").trim();
  const countryNames = [
    "japan", "china", "egypt", "brazil", "france", "germany", "india", "italy", "spain", "turkey", "iran", "thailand", "vietnam",
    "korea", "south korea", "united states", "america", "russia", "mexico", "canada", "australia", "britain", "united kingdom",
    "england", "greece", "peru", "morocco", "saudi arabia", "uae", "indonesia", "philippines", "malaysia", "singapore"
  ];
  const adjectives = [
    "japanese", "chinese", "egyptian", "brazilian", "french", "german", "indian", "italian", "spanish", "turkish", "iranian",
    "thai", "vietnamese", "korean", "american", "russian", "mexican", "canadian", "australian", "british", "greek", "peruvian"
  ];
  const names = countryNames.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const descriptors = adjectives.join("|");
  const englishPattern = new RegExp(`\\b(country history|national history|history of (?:${names})|(?:${names}|${descriptors}) (?:country )?history|(?:${names}) development history)\\b`, "i");
  const chinesePattern = /(国家历史|国家发展史|某国历史|某国发展史|中国历史|中国发展史|日本历史|日本发展史|法国历史|法国发展史|巴西历史|巴西发展史|埃及历史|埃及发展史|印度历史|印度发展史|美国历史|美国发展史|英国历史|英国发展史|德国历史|德国发展史|俄罗斯历史|俄罗斯发展史|韩国历史|韩国发展史|意大利历史|意大利发展史|西班牙历史|西班牙发展史|土耳其历史|土耳其发展史|越南历史|越南发展史|泰国历史|泰国发展史)/;
  return englishPattern.test(text) || chinesePattern.test(text);
}

function isPublicFigureBiographyTopic(topic) {
  const text = String(topic || "").trim();
  return /\b(biography of|life of|profile of|biography|personal biography|public figure biography|historical figure biography)\b/i.test(text)
    || /(人物传记|人物纪录片|传记|生平|一生|个人传记|名人传记)/.test(text);
}

function isStrictVocabularyTemplate(template, topic) {
  return isCountryHistoryTemplate(template)
    || isCountryHistoryTopic(topic)
    || isPublicFigureBiographyTemplate(template)
    || isPublicFigureBiographyTopic(topic);
}

function isPersonFocusedTopic(topic, template) {
  return template?.id === "founder-biography"
    || isPublicFigureBiographyTemplate(template)
    || isPublicFigureBiographyTopic(topic)
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
    "Composition: strong upper and middle frame detail, natural uncluttered bottom area with visible floor, desk, objects, landscape, or architecture; no artificial lower-third panel, no blank black band, and no text banner.",
    "Lighting: natural or motivated cinematic light, soft contrast, realistic shadows, professional production still quality.",
    "No text, no subtitles, no captions, no watermark, no logo, no black lower-third bar, no placeholder words like Your Text, no cartoon, no flat vector art, no slide design. Product interfaces (websites, apps, software screens) are allowed when the story topic requires them, but they must look like real screenshots in a natural environment."
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
    ? unique.map((word) => [word, translations[word] || ""])
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

async function validateStoryWithLLM(story, topic, config) {
  const prompt = `You are a video content quality validator. Review this English learning story video script and check for issues.

Topic: ${topic}

Script to validate:
${JSON.stringify(story, null, 2)}

Check the following and return a JSON response:
1. Are all scenes complete with 3-6 sentences each?
2. Do all scenes have proper Chinese translations?
3. Do all scenes have vocabulary notes?
4. Do all scenes have image prompts?
5. Is the content logical and non-repetitive?
6. Are there any factual inconsistencies?
7. Is the story flow natural and engaging?

Return JSON:
{
  "valid": true/false,
  "issues": ["list of specific issues found"],
  "suggestions": ["list of improvements"],
  "sceneCount": number,
  "totalSentences": number,
  "qualityScore": 1-10
}`;

  try {
    const payload = await callChatJson(config, prompt, 1500);
    return {
      valid: payload.valid !== false,
      issues: Array.isArray(payload.issues) ? payload.issues : [],
      suggestions: Array.isArray(payload.suggestions) ? payload.suggestions : [],
      sceneCount: payload.sceneCount || 0,
      totalSentences: payload.totalSentences || 0,
      qualityScore: payload.qualityScore || 0
    };
  } catch (error) {
    console.error("Validation failed:", error.message);
    return { valid: true, issues: [], suggestions: [], sceneCount: 0, totalSentences: 0, qualityScore: 0 };
  }
}

async function createPureStory({ topic, targetDurationMinutes, level, annotationStyle, outline, template = null }) {
  const config = await getLlmConfig();
  if (!config.apiKey) {
    throw new Error("LLM API key is required for story script generation. Open Settings and save an LLM API key.");
  }

  const maxRetries = 3;
  const useLlmValidation = process.env.ECHOENGLISH_LLM_DRAFT_VALIDATION === "1";
  let lastStory = null;
  let lastValidation = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    console.log(`[Story Generation] Attempt ${attempt}/${maxRetries} for topic: ${topic}`);

    let story = null;
    let validation = null;
    try {
      const payload = await callChatJson(config, buildStoryPrompt(topic, targetDurationMinutes, outline, template), 22000);
      story = normalizeStory(payload, {
        topic,
        targetDurationMinutes,
        level,
        annotationStyle,
        outline,
        template,
        source: "llm"
      });

      const localIssues = findStoryQualityIssues(story, {
        minimumSections: Math.min(12, Math.max(8, Number(story.outline?.targetScenes || 16) - 4)),
        minimumVocabularyNotes: isStrictVocabularyTemplate(story.outline?.template || template, topic) ? 3 : 2
      });
      if (localIssues.length) {
        const vocabularyIssue = localIssues.some((issue) => /vocabulary/i.test(issue));
        validation = {
          valid: false,
          issues: localIssues,
          suggestions: vocabularyIssue
            ? ["Every scene must include exactly 3 non-empty vocabulary entries with word, Chinese meaning, and IPA."]
            : ["Rewrite the ending with specific, non-repeated story beats."],
          sceneCount: story.sections?.length || 0,
          totalSentences: countStorySentences(story),
          qualityScore: 0
        };
      } else if (!useLlmValidation) {
        const sceneCount = story.sections?.length || 0;
        const totalSentences = countStorySentences(story);
        console.log(`[Story Generation] Local quality gate passed.`);
        console.log(`[Story Generation] Scenes: ${sceneCount}, Sentences: ${totalSentences}`);
        return story;
      }
    } catch (error) {
      validation = {
        valid: false,
        issues: [error.message],
        suggestions: ["Return complete, specific scenes instead of generic filler."],
        sceneCount: 0,
        totalSentences: 0,
        qualityScore: 0
      };
      if (isNonRetryableDraftError(error)) {
        lastValidation = validation;
        console.log(`[Story Generation] Draft request failed before a usable story was returned: ${error.message}`);
        throw new Error(`LLM draft request failed: ${error.message}`);
      }
    }

    // Validate the generated story
    if (!validation) {
      console.log(`[Story Generation] Running optional LLM validation (attempt ${attempt})...`);
      validation = await validateStoryWithLLM(story, topic, config);
    }

    if (validation.valid && validation.qualityScore >= 7) {
      console.log(`[Story Generation] Validation passed! Quality score: ${validation.qualityScore}/10`);
      console.log(`[Story Generation] Scenes: ${validation.sceneCount}, Sentences: ${validation.totalSentences}`);
      if (validation.suggestions.length > 0) {
        console.log(`[Story Generation] Suggestions:`, validation.suggestions.join("; "));
      }
      return story;
    }

    console.log(`[Story Generation] Validation failed (attempt ${attempt}). Issues:`, validation.issues.join("; "));
    lastStory = story;
    lastValidation = validation;

    if (attempt < maxRetries) {
      console.log(`[Story Generation] Retrying with feedback...`);
      // Add validation feedback to outline for next attempt
      outline = {
        ...outline,
        validationFeedback: validation.issues.join("; ")
      };
    }
  }

  console.log(`[Story Generation] All ${maxRetries} attempts failed validation.`);
  if (lastValidation) {
    console.log(`[Story Generation] Last validation score: ${lastValidation.qualityScore}/10`);
    console.log(`[Story Generation] Issues:`, lastValidation.issues.join("; "));
  }
  throw new Error(`LLM draft did not pass quality checks after ${maxRetries} attempts: ${(lastValidation?.issues || ["unknown issue"]).join("; ")}`);
}

function isNonRetryableDraftError(error) {
  const text = String(error?.message || "").toLowerCase();
  return text.includes("llm returned http")
    || text.includes("llm request timed out")
    || text.includes("llm request failed")
    || text.includes("api key is required");
}

function countStorySentences(story) {
  return (story.sections || []).reduce((total, section) => total + (section.sentences?.length || 0), 0);
}

async function rewriteSensitiveImagePrompt(prompt, attempt) {
  const config = await getLlmConfig();
  if (!config || !config.apiKey) {
    throw new Error("No LLM configuration available to rewrite sensitive prompt.");
  }

  let sys = "You are an image prompt rewriting assistant. The user will provide a prompt that was rejected by an image API due to sensitive content (e.g. real-world politicians, sensitive historical figures, or violence). Your task is to rewrite the prompt to describe the visual scene generically, REMOVING ALL NAMES of real people, places, or sensitive events. Keep the visual style, lighting, and general composition intact, but make the subjects entirely generic. Return ONLY the new rewritten prompt text, nothing else.";
  if (attempt > 2) {
     sys += " The previous rewrite was ALSO rejected. Be extremely cautious this time. Strip out all specific subjects and make it a highly abstract, safe, generic landscape or architectural scene matching the original mood.";
  } else if (attempt > 1) {
     sys += " The previous rewrite was still flagged. Try harder to remove anything remotely sensitive. Replace human figures with silhouettes or generic archetypes.";
  }

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

  const body = {
    model,
    messages: [
      { role: "system", content: sys },
      { role: "user", content: prompt }
    ],
    temperature: 0.7,
    max_tokens: 200
  };

  const response = await fetch(`${config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });

  const payload = await response.json();
  if (!response.ok || payload.error) {
    throw new Error(formatLlmHttpError(response.status, payload));
  }
  return payload.choices?.[0]?.message?.content?.trim() || prompt;
}

module.exports = {
  createStoryOutline,
  createPureStory,
  reviseStoryDraft,
  validateStoryWithLLM,
  generateVideoTemplate,
  getLlmConfig,
  rewriteSensitiveImagePrompt
};
