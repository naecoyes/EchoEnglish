const BOILERPLATE_PATTERNS = [
  /reached an important public milestone in this part of the timeline/i,
  /the milestone showed how a plan became more concrete and visible/i,
  /public reports connected this moment with a larger business decision/i,
  /the next step was also important/i,
  /this step was an important part of .* growth story/i,
  /the results showed that the company was moving in the right direction/i
];

function filterBoilerplateSections(sections = []) {
  return sections.filter((section) => !sectionHasBoilerplate(section));
}

function sectionHasBoilerplate(section) {
  return (section?.sentences || []).some(sentenceIsBoilerplate);
}

function sentenceIsBoilerplate(sentence) {
  const text = String(sentence || "");
  return BOILERPLATE_PATTERNS.some((pattern) => pattern.test(text));
}

function findStoryQualityIssues(story, options = {}) {
  return inspectStoryQuality(story, options).issues;
}

function inspectStoryQuality(story, options = {}) {
  const sections = Array.isArray(story?.sections) ? story.sections : [];
  const issues = [];
  const warnings = [];
  const minimumSections = Number(options.minimumSections || 0);
  const requireTranslations = options.requireTranslations !== false;
  const requireVocabulary = options.requireVocabulary !== false;
  const repeated = findRepeatedSentences(sections);
  const trailing = findTrailingRepeatedSections(sections);
  const missingTranslations = [];
  const missingVocabulary = [];
  const boilerplateSections = sections
    .map((section, index) => ({ section, index }))
    .filter(({ section }) => sectionHasBoilerplate(section));

  if (minimumSections > 0 && sections.length < minimumSections) {
    issues.push(`Draft has only ${sections.length} usable scenes; expected at least ${minimumSections}.`);
  }

  if (boilerplateSections.length) {
    const labels = boilerplateSections.slice(0, 5).map(({ section, index }) => section.title || `Scene ${index + 1}`);
    issues.push(`Draft contains repeated boilerplate filler scenes: ${labels.join(", ")}.`);
  }

  if (repeated.length) {
    const samples = repeated.slice(0, 3).map((item) => `"${item.sample}" (${item.count}x)`);
    issues.push(`Draft repeats full sentences: ${samples.join(", ")}.`);
  }

  if (trailing) {
    issues.push(`The final scenes repeat the same sentence pattern: ${trailing}.`);
  }

  sections.forEach((section, sectionIndex) => {
    const sentences = Array.isArray(section.sentences) ? section.sentences : [];
    const translations = Array.isArray(section.translations) ? section.translations : [];
    const vocabulary = Array.isArray(section.vocabulary) ? section.vocabulary : [];

    if (!sentences.length) {
      issues.push(`Scene ${sectionIndex + 1} has no English sentences.`);
      return;
    }

    if (requireTranslations) {
      sentences.forEach((sentence, sentenceIndex) => {
        const translation = translations[sentenceIndex];
        if (!hasMeaningfulChinese(translation)) {
          missingTranslations.push({
            scene: sectionIndex + 1,
            sentence: sentenceIndex + 1,
            english: String(sentence || "").trim().slice(0, 120)
          });
        }
      });
    }

    if (requireVocabulary) {
      const meaningfulVocabulary = vocabulary.filter(vocabularyEntryIsUseful);
      if (meaningfulVocabulary.length < 2) {
        missingVocabulary.push({
          scene: sectionIndex + 1,
          title: section.title || `Scene ${sectionIndex + 1}`,
          count: meaningfulVocabulary.length
        });
      }
    }
  });

  if (missingTranslations.length) {
    const sample = missingTranslations.slice(0, 5).map((item) => `Scene ${item.scene}.${item.sentence}`);
    issues.push(`Missing Chinese translations: ${sample.join(", ")}${missingTranslations.length > 5 ? ` and ${missingTranslations.length - 5} more` : ""}.`);
  }

  if (missingVocabulary.length) {
    const sample = missingVocabulary.slice(0, 5).map((item) => `${item.title} (${item.count})`);
    issues.push(`Scenes have too few useful vocabulary notes: ${sample.join(", ")}${missingVocabulary.length > 5 ? ` and ${missingVocabulary.length - 5} more` : ""}.`);
  }

  const sentenceCount = sections.reduce((total, section) => total + (section.sentences?.length || 0), 0);
  const vocabularyCount = sections.reduce((total, section) => total + (section.vocabulary?.length || 0), 0);
  if (sentenceCount > 0 && vocabularyCount > sentenceCount * 0.9) {
    warnings.push("Vocabulary count is very high; consider selecting fewer, harder words.");
  }

  return {
    ok: issues.length === 0,
    status: issues.length ? "failed-quality" : warnings.length ? "warning" : "ok",
    issues,
    warnings,
    counts: {
      sections: sections.length,
      sentences: sentenceCount,
      vocabulary: vocabularyCount,
      boilerplateSections: boilerplateSections.length,
      repeatedSentences: repeated.length,
      missingTranslations: missingTranslations.length,
      missingVocabularyScenes: missingVocabulary.length
    },
    details: {
      boilerplateSections: boilerplateSections.map(({ section, index }) => ({
        scene: index + 1,
        title: section.title || `Scene ${index + 1}`
      })),
      repeatedSentences: repeated.slice(0, 10),
      trailingRepeatedPattern: trailing || null,
      missingTranslations: missingTranslations.slice(0, 25),
      missingVocabulary: missingVocabulary.slice(0, 25)
    }
  };
}

function assertStoryQuality(story, options = {}) {
  const issues = findStoryQualityIssues(story, options);
  if (issues.length) {
    throw new Error(`Story draft quality check failed. ${issues.join(" ")}`);
  }
}

function findRepeatedSentences(sections) {
  const counts = new Map();
  sections.forEach((section) => {
    (section.sentences || []).forEach((sentence) => {
      const key = normalizeSentenceKey(sentence);
      if (key.length < 34) return;
      const current = counts.get(key) || { count: 0, sample: String(sentence || "").trim() };
      current.count += 1;
      counts.set(key, current);
    });
  });
  return [...counts.values()]
    .filter((item) => item.count >= 3)
    .sort((a, b) => b.count - a.count);
}

function findTrailingRepeatedSections(sections) {
  const tail = sections.slice(-5);
  if (tail.length < 3) return "";
  const repeatedInTail = findRepeatedSentences(tail).filter((item) => item.count >= 3);
  return repeatedInTail[0]?.sample || "";
}

function normalizeSentenceKey(sentence) {
  return String(sentence || "")
    .toLowerCase()
    .replace(/["'’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function hasMeaningfulChinese(value) {
  const text = String(value || "").trim();
  if (!text || /^(n\/a|none|null|undefined|todo|待补充)$/i.test(text)) return false;
  return /[\u3400-\u9fff]/.test(text);
}

function vocabularyEntryIsUseful(entry) {
  if (!Array.isArray(entry)) return false;
  const [word, second, third] = entry;
  const wordText = String(word || "").trim();
  const hasChinese = entry.slice(1).some((value) => hasMeaningfulChinese(value));
  if (!wordText || wordText.length < 3) return false;
  if (!hasChinese) return false;
  if (second !== undefined && third !== undefined && String(second || "").trim() === "" && String(third || "").trim() === "") return false;
  return true;
}

module.exports = {
  assertStoryQuality,
  filterBoilerplateSections,
  findStoryQualityIssues,
  inspectStoryQuality,
  sectionHasBoilerplate,
  sentenceIsBoilerplate
};
