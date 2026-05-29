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

function generateTemplateFromTopic(topic, minutes = 15) {
  const topicLower = (topic || "").toLowerCase();

  // Detect content mode from topic
  const factualKeywords = /\b(history|development|timeline|startup|company|founder|founded|launch|launched|auto|automobile|car|ev|xiaomi|tesla|apple|microsoft|google|huawei|byd|nio|xpeng|biography|ceo|leader)\b/i;
  const isFactual = factualKeywords.test(topic);

  // Detect specific template type
  if (/\b(founder|biography|ceo|leader|life of)\b/i.test(topic)) {
    return {
      id: "auto-founder-biography",
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
  generateTemplateFromTopic
};
