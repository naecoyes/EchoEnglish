const TOO_SIMPLE_WORDS = new Set([
  "able", "about", "after", "again", "also", "away", "back", "been", "before", "began", "begin", "better",
  "came", "come", "could", "did", "does", "done", "down", "each", "early", "even", "every", "feel",
  "felt", "first", "from", "gave", "give", "goes", "going", "good", "great", "have", "help", "into",
  "just", "keep", "kind", "know", "large", "later", "left", "life", "like", "little", "long", "look",
  "made", "make", "many", "more", "most", "much", "next", "once", "only", "open", "over", "part",
  "place", "ready", "right", "said", "same", "saw", "seen", "show", "small", "soon", "still", "take",
  "than", "that", "their", "them", "then", "there", "these", "they", "this", "time", "told", "took",
  "turn", "very", "want", "water", "went", "were", "what", "when", "where", "with", "work", "year"
]);

const VOCAB_BANK = {
  achievement: ["成就", "/əˈtʃiːvmənt/"],
  aerospace: ["航空航天", "/ˈeəroʊspeɪs/"],
  ambition: ["雄心", "/æmˈbɪʃən/"],
  announcement: ["公告；发布", "/əˈnaʊnsmənt/"],
  booster: ["助推器", "/ˈbuːstər/"],
  breakthrough: ["突破", "/ˈbreɪkθruː/"],
  certification: ["认证", "/ˌsɜːrtɪfɪˈkeɪʃən/"],
  challenge: ["挑战", "/ˈtʃælɪndʒ/"],
  commercial: ["商业的", "/kəˈmɜːrʃəl/"],
  competitor: ["竞争者", "/kəmˈpetɪtər/"],
  contract: ["合同", "/ˈkɑːntrækt/"],
  delivery: ["交付", "/dɪˈlɪvəri/"],
  development: ["发展；开发", "/dɪˈveləpmənt/"],
  engineer: ["工程师", "/ˌendʒɪˈnɪr/"],
  expansion: ["扩张", "/ɪkˈspænʃən/"],
  facility: ["设施", "/fəˈsɪləti/"],
  factory: ["工厂", "/ˈfæktəri/"],
  founder: ["创始人", "/ˈfaʊndər/"],
  funding: ["资金", "/ˈfʌndɪŋ/"],
  growth: ["增长", "/ɡroʊθ/"],
  impact: ["影响", "/ˈɪmpækt/"],
  innovation: ["创新", "/ˌɪnəˈveɪʃən/"],
  investment: ["投资", "/ɪnˈvestmənt/"],
  launch: ["发射；发布", "/lɔːntʃ/"],
  manufacturing: ["制造业", "/ˌmænjəˈfæktʃərɪŋ/"],
  market: ["市场", "/ˈmɑːrkɪt/"],
  milestone: ["里程碑", "/ˈmaɪlstoʊn/"],
  mission: ["任务", "/ˈmɪʃən/"],
  orbit: ["轨道", "/ˈɔːrbɪt/"],
  partnership: ["合作关系", "/ˈpɑːrtnərʃɪp/"],
  payload: ["有效载荷", "/ˈpeɪloʊd/"],
  production: ["生产", "/prəˈdʌkʃən/"],
  prototype: ["原型", "/ˈproʊtətaɪp/"],
  recovery: ["回收；恢复", "/rɪˈkʌvəri/"],
  regulation: ["监管；规定", "/ˌreɡjəˈleɪʃən/"],
  reusable: ["可重复使用的", "/ˌriːˈjuːzəbəl/"],
  reusability: ["可重复使用性", "/ˌriːjuːzəˈbɪləti/"],
  revenue: ["收入", "/ˈrevənuː/"],
  rocket: ["火箭", "/ˈrɑːkɪt/"],
  satellite: ["卫星", "/ˈsætəlaɪt/"],
  spacecraft: ["航天器", "/ˈspeɪskræft/"],
  strategy: ["策略", "/ˈstrætədʒi/"],
  supplier: ["供应商", "/səˈplaɪər/"],
  technology: ["技术", "/tekˈnɑːlədʒi/"],
  timeline: ["时间线", "/ˈtaɪmlaɪn/"],
  vehicle: ["交通工具；飞行器", "/ˈviːəkəl/"],
  vision: ["愿景", "/ˈvɪʒən/"]
};

const PHRASE_BANK = {
  "commercial spaceflight": ["商业太空飞行", "/kəˈmɜːrʃəl ˈspeɪsflaɪt/"],
  "crew dragon": ["龙飞船载人版", "/kruː ˈdræɡən/"],
  "falcon heavy": ["猎鹰重型火箭", "/ˈfælkən ˈhevi/"],
  "falcon nine": ["猎鹰9号", "/ˈfælkən naɪn/"],
  "launch vehicle": ["运载火箭", "/lɔːntʃ ˈviːəkəl/"],
  "private company": ["私营公司", "/ˈpraɪvət ˈkʌmpəni/"],
  "rocket booster": ["火箭助推器", "/ˈrɑːkɪt ˈbuːstər/"],
  "space exploration": ["太空探索", "/speɪs ˌekspləˈreɪʃən/"],
  "supply mission": ["补给任务", "/səˈplaɪ ˈmɪʃən/"],
  "test flight": ["试飞", "/test flaɪt/"]
};

function enrichStoryVocabulary(story) {
  if (!story || !Array.isArray(story.sections)) return story;
  const used = new Set();
  const review = [];

  story.sections = story.sections.map((section) => {
    const candidates = collectSectionCandidates(section);
    const next = [];

    for (const candidate of candidates) {
      const key = normalizeTerm(candidate.word);
      if (!key || used.has(key) || isTooSimple(key)) continue;
      used.add(key);
      const item = [candidate.word, candidate.translation, candidate.phonetic];
      next.push(item);
      review.push({ word: candidate.word, translation: candidate.translation, phonetic: candidate.phonetic });
      if (next.length >= 3) break;
    }

    return {
      ...section,
      vocabulary: next
    };
  });

  story.vocabularyReview = review;
  return story;
}

function collectSectionCandidates(section) {
  const generated = Array.isArray(section?.vocabulary)
    ? section.vocabulary.map(normalizeVocabularyEntry).filter(Boolean)
    : [];
  const extracted = extractVocabularyCandidates([section?.title, ...(section?.sentences || [])].join(" "));
  return [...generated, ...extracted];
}

function normalizeVocabularyEntry(entry) {
  const values = Array.isArray(entry) ? entry : [];
  const word = cleanWord(values[0]);
  if (!word) return null;
  const bank = lookupBank(word);
  const second = cleanText(values[1]);
  const third = cleanText(values[2]);
  const looksLikePhonetic = second.startsWith("/") && second.endsWith("/");
  return {
    word,
    translation: looksLikePhonetic ? third || bank.translation : second && second !== "重点词" ? second : bank.translation,
    phonetic: looksLikePhonetic ? second : third.startsWith("/") ? third : bank.phonetic
  };
}

function extractVocabularyCandidates(text) {
  const lower = String(text || "").toLowerCase().replace(/falcon 9/g, "falcon nine");
  const candidates = [];

  Object.keys(PHRASE_BANK).forEach((phrase) => {
    if (lower.includes(phrase)) {
      const [translation, phonetic] = PHRASE_BANK[phrase];
      candidates.push({ word: titleCasePhrase(phrase), translation, phonetic });
    }
  });

  const words = lower.match(/[a-z][a-z'-]{4,}/g) || [];
  words.forEach((word) => {
    const key = normalizeTerm(word);
    if (VOCAB_BANK[key]) {
      const [translation, phonetic] = VOCAB_BANK[key];
      candidates.push({ word: key, translation, phonetic });
    }
  });

  return dedupeCandidates(candidates);
}

function lookupBank(word) {
  const key = normalizeTerm(word);
  const phrase = PHRASE_BANK[key];
  if (phrase) return { translation: phrase[0], phonetic: phrase[1] };
  const single = VOCAB_BANK[key];
  if (single) return { translation: single[0], phonetic: single[1] };
  return { translation: "重点词", phonetic: buildFallbackPhonetic(word) };
}

function dedupeCandidates(candidates) {
  const seen = new Set();
  return candidates.filter((candidate) => {
    const key = normalizeTerm(candidate.word);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isTooSimple(key) {
  return key.length < 5 || TOO_SIMPLE_WORDS.has(key);
}

function buildFallbackPhonetic(word) {
  const parts = String(word || "")
    .toLowerCase()
    .split(/\s+/)
    .map((part) => {
      const found = lookupSinglePhonetic(part);
      return found ? found.replace(/^\/|\/$/g, "") : part;
    })
    .filter(Boolean);
  return parts.length ? `/${parts.join(" ")}/` : "/-/";
}

function lookupSinglePhonetic(word) {
  return VOCAB_BANK[normalizeTerm(word)]?.[1] || null;
}

function normalizeTerm(word) {
  return String(word || "")
    .toLowerCase()
    .replace(/[“”"'.:,;!?()[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanWord(value) {
  return cleanText(value).replace(/\s+/g, " ").trim();
}

function cleanText(value) {
  return String(value || "").trim();
}

function titleCasePhrase(value) {
  return String(value)
    .split(" ")
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join(" ");
}

module.exports = {
  enrichStoryVocabulary
};
