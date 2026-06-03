const VIDEO_TEMPLATES = [
  {
    id: "company-origin",
    title: "Company Origin Story",
    contentMode: "factual-documentary",
    summary: "A factual origin timeline for a real company, founder team, or brand.",
    structureRules: "Open with the market context, then explain founding, early products, key decisions, growth, setbacks, and current impact.",
    visualStyle: "photorealistic documentary stills, offices, public events, product shots, factories, city context, realistic lighting",
    vocabularyFocus: ["founder", "launch", "market", "investment", "strategy", "growth", "challenge", "milestone"],
    searchHint: "official company timeline founders funding launch milestones products annual report documentary facts",
    draftGuidance: "Use public facts and a chronological documentary voice. Do not invent fictional employees, private scenes, or dialogue."
  },
  {
    id: "product-launch",
    title: "Product Launch History",
    contentMode: "factual-documentary",
    summary: "A factual launch story for a real product, vehicle, phone, app, or platform.",
    structureRules: "Explain the need, development period, announcement, launch event, first reactions, production, delivery, and later influence.",
    visualStyle: "cinematic product photography, launch stages, close-up product details, production lines, realistic press-event atmosphere",
    vocabularyFocus: ["prototype", "launch", "feature", "production", "delivery", "customer", "review", "upgrade"],
    searchHint: "product launch date announcement prototype production delivery reviews official press release",
    draftGuidance: "Keep the story factual and product-centered. Use dates and public milestones from search results."
  },
  {
    id: "founder-biography",
    title: "Founder Biography",
    contentMode: "factual-documentary",
    summary: "A simple English biography of a real founder or public leader.",
    structureRules: "Move from early life and education to first work, founding moment, leadership style, major decisions, and legacy.",
    visualStyle: "realistic portrait documentary stills, schools, offices, stages, city streets, understated emotional lighting",
    vocabularyFocus: ["leader", "decision", "vision", "career", "risk", "team", "success", "legacy"],
    searchHint: "biography early life education career founder official profile interview timeline",
    draftGuidance: "Use only public biography facts. Do not invent private conversations or unsupported emotions."
  },
  buildPublicFigureBiographyTemplate(),
  {
    id: "city-travel",
    title: "City Travel Story",
    contentMode: "fictional-story",
    summary: "A gentle travel story that teaches practical English through a city journey.",
    structureRules: "Follow one traveler through arrival, transport, food, landmarks, a small problem, help from locals, and a calm ending.",
    visualStyle: "photorealistic travel photography, streets, cafes, stations, rain or sunlight, human-scale city details",
    vocabularyFocus: ["station", "ticket", "corner", "museum", "weather", "ask for help", "map", "return"],
    searchHint: "city landmarks local culture neighborhoods travel guide simple facts",
    draftGuidance: "Use a fictional traveler, but keep the city details realistic and visually specific."
  },
  {
    id: "school-life",
    title: "School Life Story",
    contentMode: "fictional-story",
    summary: "A beginner-friendly story about school, friendship, confidence, and daily choices.",
    structureRules: "Start with a normal school day, introduce a small challenge, show classmates helping, and end with personal growth.",
    visualStyle: "bright realistic school photography, classrooms, hallways, notebooks, sports field, natural student moments",
    vocabularyFocus: ["classmate", "homework", "practice", "answer", "teacher", "promise", "mistake", "confidence"],
    searchHint: "school vocabulary daily routine classroom friendship beginner English story",
    draftGuidance: "Keep sentences simple, warm, and emotionally clear for beginner learners."
  },
  {
    id: "mystery-adventure",
    title: "Mystery Adventure",
    contentMode: "fictional-story",
    summary: "A soft mystery story with clues, choices, and a satisfying answer.",
    structureRules: "Introduce a strange object, follow clues through changing locations, reveal a harmless truth, and close with a lesson.",
    visualStyle: "cinematic realistic mystery stills, old streets, libraries, rain, lanterns, detailed objects, subtle suspense",
    vocabularyFocus: ["clue", "secret", "follow", "shadow", "doorway", "whisper", "discover", "truth"],
    searchHint: "mystery story vocabulary beginner English clues adventure",
    draftGuidance: "Use suspense without violence or horror. Every sentence should map to a clear image."
  },
  {
    id: "science-technology",
    title: "Science And Technology",
    contentMode: "factual-documentary",
    summary: "A simple factual explainer about a technology, invention, mission, or scientific idea.",
    structureRules: "Explain the problem, the idea, the development path, the people or teams, real-world use, risks, and future direction.",
    visualStyle: "photorealistic science documentary stills, labs, devices, engineers, data screens without readable text, real environments",
    vocabularyFocus: ["research", "system", "energy", "signal", "device", "experiment", "future", "solution"],
    searchHint: "technology explainer timeline invention research official source recent development facts",
    draftGuidance: "Use factual explainer style. Keep concepts clear and avoid unsupported claims."
  },
  {
    id: "daily-life-drama",
    title: "Daily Life Drama",
    contentMode: "fictional-story",
    summary: "A realistic daily-life story about family, work, friendship, or a small personal choice.",
    structureRules: "Begin with an ordinary routine, add a misunderstanding or small pressure, show a thoughtful choice, and end calmly.",
    visualStyle: "naturalistic photo drama, apartments, kitchens, streets, offices, soft daylight, close human moments",
    vocabularyFocus: ["routine", "message", "neighbor", "promise", "late", "careful", "kind", "change"],
    searchHint: "daily life English story beginner vocabulary realistic drama",
    draftGuidance: "Keep the conflict small and relatable. Do not add teaching rounds or repeated exercises."
  },
  buildCountryHistoryTemplate(),
  {
    id: "historical-documentary",
    title: "Historical Event Documentary",
    contentMode: "factual-documentary",
    summary: "A factual timeline for a real historical event, movement, invention, or public moment.",
    structureRules: "Set the background, explain causes, key dates, main actors, turning points, outcomes, and meaning today.",
    visualStyle: "realistic historical documentary recreations, archival mood, public locations, period-accurate details, no fake captions",
    vocabularyFocus: ["event", "cause", "result", "leader", "public", "change", "record", "memory"],
    searchHint: "historical event timeline causes key dates sources documentary facts",
    draftGuidance: "Use only verifiable facts from search context. Avoid invented eyewitness scenes."
  },
  {
    id: "future-imagination",
    title: "Future Imagination Story",
    contentMode: "fictional-story",
    summary: "A hopeful near-future story that practices simple English around technology and daily choices.",
    structureRules: "Introduce a future setting, show one human problem, use technology carefully, and end with a human lesson.",
    visualStyle: "photorealistic near-future cinema, clean cities, soft screens, homes, transit, realistic people, optimistic lighting",
    vocabularyFocus: ["future", "machine", "choice", "signal", "safe", "question", "learn", "hope"],
    searchHint: "near future English story technology vocabulary beginner",
    draftGuidance: "Use imagination, but keep the human story simple, clear, and visually grounded."
  },
  {
    id: "podcast-dialogue",
    title: "Podcast Conversation",
    contentMode: "factual-documentary",
    summary: "A two-host educational podcast script that explains a topic through natural English conversation.",
    structureRules: "Use two speakers in natural dialogue turns. A host may say 1-3 short sentences before the other host asks, reacts, or adds a point. Start with a hook, explain background, clarify key facts, and end with a short learner recap.",
    visualStyle: "photorealistic podcast studio, two hosts at microphones, warm desk lights, topic-related background screens, natural cinematic close-ups",
    vocabularyFocus: ["explain", "question", "background", "detail", "evidence", "example", "meaning", "summary"],
    searchHint: "topic facts timeline official sources explainer interview podcast background",
    draftGuidance: "Write in a podcast-like two-host voice with real conversational flow. Avoid mechanical one-sentence alternation. Prefix every sentence with Host A or Host B so the TTS can choose the correct voice; do not invent unsupported claims."
  }
];

const DEFAULT_TEMPLATE_ID = "company-origin";

function listVideoTemplates() {
  return VIDEO_TEMPLATES.map((template) => ({ ...template }));
}

function getVideoTemplate(id) {
  return VIDEO_TEMPLATES.find((template) => template.id === id) || VIDEO_TEMPLATES.find((template) => template.id === DEFAULT_TEMPLATE_ID);
}

function buildCountryHistoryTemplate(topic = "") {
  const subject = String(topic || "").trim();
  return {
    id: "country-history",
    title: "Country History Documentary",
    contentMode: "factual-documentary",
    summary: subject
      ? `A soft ancient-to-modern overview of ${subject} for English shadowing learners.`
      : "A soft ancient-to-modern overview of a country's history for English shadowing learners.",
    structureRules: "Move from geography and ancient origins to early civilization, key kingdoms, dynasties, or periods, outside influences, independence or modern state formation, culture and economy today, and a peaceful recap.",
    visualStyle: "photorealistic cinematic documentary stills, maps without labels, landmarks, historic architecture, museums, artifacts, ports, city streets, public memorial spaces, soft educational tone",
    vocabularyFocus: ["civilization", "dynasty", "kingdom", "empire", "independence", "reform", "culture", "heritage", "border", "trade", "capital", "identity"],
    searchHint: "country history ancient origins geography civilization dynasties independence modern state culture economy official sources Britannica timeline",
    draftGuidance: "Use a soft factual documentary voice from ancient origins to modern life. Avoid fictional protagonists, invented dialogue, heavy war detail, patriotic slogans, and political judgment."
  };
}

function buildPublicFigureBiographyTemplate(topic = "") {
  const subject = String(topic || "").trim();
  return {
    id: "public-figure-biography",
    title: "Public Figure Biography",
    contentMode: "factual-documentary",
    summary: subject
      ? `A respectful factual biography of ${subject} for English shadowing learners.`
      : "A respectful factual biography of a public or historical figure for English shadowing learners.",
    structureRules: "Move from early life, education, and influences to a first turning point, main work and achievements, setbacks or challenges, public impact, legacy, and a calm recap.",
    visualStyle: "photorealistic biography documentary stills, public stages, schools, laboratories, studies, studios, city context, archival documents, tools, awards, memorial spaces, symbolic close-ups, restrained cinematic lighting",
    vocabularyFocus: ["ambition", "discipline", "breakthrough", "legacy", "contribution", "challenge", "influence", "achievement", "resilience", "mentor", "reform", "innovation"],
    searchHint: "public figure biography early life education career achievements awards legacy official profile Britannica timeline",
    draftGuidance: "Use only public biography facts. Do not invent private conversations, gossip, unsupported emotions, or fictional scenes."
  };
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

function isFounderBiographyTopic(topic) {
  return /\b(founder|co-founder|startup founder|entrepreneur|ceo|business leader|company founder)\b/i.test(String(topic || ""))
    || /(创始人|联合创始人|企业家|公司创办人|CEO|首席执行官)/i.test(String(topic || ""));
}

function isPublicFigureBiographyTopic(topic) {
  const text = String(topic || "").trim();
  return /\b(biography of|life of|profile of|biography|personal biography|public figure biography|historical figure biography)\b/i.test(text)
    || /(人物传记|人物纪录片|传记|生平|一生|个人传记|名人传记)/.test(text);
}

function generateTemplateFromTopic(topic, minutes = 15) {
  const topicLower = (topic || "").toLowerCase();

  // Detect content mode from topic
  const factualKeywords = /\b(history|development|timeline|startup|company|founder|founded|launch|launched|auto|automobile|car|ev|xiaomi|tesla|apple|microsoft|google|huawei|byd|nio|xpeng|biography|ceo|leader)\b/i;
  const isFactual = factualKeywords.test(topic);

  // Detect specific template type
  if (isCountryHistoryTopic(topic)) {
    return buildCountryHistoryTemplate(topic);
  }

  if (isFounderBiographyTopic(topic)) {
    return {
      id: "founder-biography",
      title: "Founder Biography",
      contentMode: "factual-documentary",
      summary: `A simple English biography about ${topic}.`,
      structureRules: "Move from early life and education to first work, founding moment, leadership style, major decisions, and legacy.",
      visualStyle: "realistic portrait documentary stills, schools, offices, stages, city streets, understated emotional lighting",
      vocabularyFocus: ["leader", "decision", "vision", "career", "risk", "team", "success", "legacy"],
      searchHint: "biography early life education career founder official profile interview timeline",
      draftGuidance: "Use only public biography facts. Do not invent private conversations or unsupported emotions."
    };
  }

  if (isPublicFigureBiographyTopic(topic)) {
    return buildPublicFigureBiographyTemplate(topic);
  }

  if (/\b(product|launch|phone|app|device|platform)\b/i.test(topic)) {
    return {
      id: "auto-product-launch",
      title: "Product Launch History",
      contentMode: "factual-documentary",
      summary: `A factual launch story for ${topic}.`,
      structureRules: "Explain the need, development period, announcement, launch event, first reactions, production, delivery, and later influence.",
      visualStyle: "cinematic product photography, launch stages, close-up product details, production lines, realistic press-event atmosphere",
      vocabularyFocus: ["prototype", "launch", "feature", "production", "delivery", "customer", "review", "upgrade"],
      searchHint: "product launch date announcement prototype production delivery reviews official press release",
      draftGuidance: "Keep the story factual and product-centered. Use dates and public milestones from search results."
    };
  }

  if (/\b(city|travel|trip|visit|tour)\b/i.test(topic)) {
    return {
      id: "auto-city-travel",
      title: "City Travel Story",
      contentMode: "fictional-story",
      summary: `A gentle travel story about ${topic} that teaches practical English.`,
      structureRules: "Follow one traveler through arrival, transport, food, landmarks, a small problem, help from locals, and a calm ending.",
      visualStyle: "photorealistic travel photography, streets, cafes, stations, rain or sunlight, human-scale city details",
      vocabularyFocus: ["station", "ticket", "corner", "museum", "weather", "ask for help", "map", "return"],
      searchHint: "city landmarks local culture neighborhoods travel guide simple facts",
      draftGuidance: "Use a fictional traveler, but keep the city details realistic and visually specific."
    };
  }

  if (/\b(school|student|class|university|education)\b/i.test(topic)) {
    return {
      id: "auto-school-life",
      title: "School Life Story",
      contentMode: "fictional-story",
      summary: `A beginner-friendly story about ${topic}.`,
      structureRules: "Start with a normal school day, introduce a small challenge, show classmates helping, and end with personal growth.",
      visualStyle: "bright realistic school photography, classrooms, hallways, notebooks, sports field, natural student moments",
      vocabularyFocus: ["classmate", "homework", "practice", "answer", "teacher", "promise", "mistake", "confidence"],
      searchHint: "school vocabulary daily routine classroom friendship beginner English story",
      draftGuidance: "Keep sentences simple, warm, and emotionally clear for beginner learners."
    };
  }

  if (/\b(science|technology|invention|research|space|energy)\b/i.test(topic)) {
    return {
      id: "auto-science-technology",
      title: "Science And Technology",
      contentMode: "factual-documentary",
      summary: `A simple factual explainer about ${topic}.`,
      structureRules: "Explain the problem, the idea, the development path, the people or teams, real-world use, risks, and future direction.",
      visualStyle: "photorealistic science documentary stills, labs, devices, engineers, data screens without readable text, real environments",
      vocabularyFocus: ["research", "system", "energy", "signal", "device", "experiment", "future", "solution"],
      searchHint: "technology explainer timeline invention research official source recent development facts",
      draftGuidance: "Use factual explainer style. Keep concepts clear and avoid unsupported claims."
    };
  }

  // Default: company origin story for factual topics, daily drama for fictional
  if (isFactual) {
    return {
      id: "auto-company-origin",
      title: "Company Origin Story",
      contentMode: "factual-documentary",
      summary: `A factual origin timeline for ${topic}.`,
      structureRules: "Open with the market context, then explain founding, early products, key decisions, growth, setbacks, and current impact.",
      visualStyle: "photorealistic documentary stills, offices, public events, product shots, factories, city context, realistic lighting",
      vocabularyFocus: ["founder", "launch", "market", "investment", "strategy", "growth", "challenge", "milestone"],
      searchHint: "official company timeline founders funding launch milestones products annual report documentary facts",
      draftGuidance: "Use public facts and a chronological documentary voice. Do not invent fictional employees, private scenes, or dialogue."
    };
  }

  return {
    id: "auto-daily-life",
    title: "Daily Life Drama",
    contentMode: "fictional-story",
    summary: `A realistic daily-life story about ${topic}.`,
    structureRules: "Begin with an ordinary routine, add a misunderstanding or small pressure, show a thoughtful choice, and end calmly.",
    visualStyle: "naturalistic photo drama, apartments, kitchens, streets, offices, soft daylight, close human moments",
    vocabularyFocus: ["routine", "message", "neighbor", "promise", "late", "careful", "kind", "change"],
    searchHint: "daily life English story beginner vocabulary realistic drama",
    draftGuidance: "Keep the conflict small and relatable. Do not add teaching rounds or repeated exercises."
  };
}

module.exports = {
  DEFAULT_TEMPLATE_ID,
  VIDEO_TEMPLATES,
  getVideoTemplate,
  listVideoTemplates,
  generateTemplateFromTopic,
  isCountryHistoryTopic,
  isPublicFigureBiographyTopic
};
