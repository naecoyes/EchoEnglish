const { createPresetStory } = require("./storyPresets");
const { createPureStory } = require("./llmStoryPlanner");

const STORY_BANK = {
  "a rainy day": {
    title: "A Rainy Day",
    summary: "Mia learns to enjoy a rainy morning on her way to the library.",
    sections: [
      {
        title: "Part 1: The Morning Rain",
        visual: "Mia in a cozy bedroom on a rainy morning, looking at raindrops on the window, blue raincoat nearby",
        sentences: [
          "Mia wakes up and hears rain at the window.",
          "The sky is gray, but her room feels warm.",
          "She puts on her blue raincoat.",
          "She takes a small umbrella from the door."
        ],
        vocabulary: [
          ["raincoat", "雨衣"],
          ["umbrella", "雨伞"],
          ["gray", "灰色的"],
          ["window", "窗户"]
        ]
      },
      {
        title: "Part 2: The Slow Walk",
        visual: "Mia walking slowly down a quiet rainy street with a small umbrella, gentle raindrops, warm storybook mood",
        sentences: [
          "Mia walks slowly down the street.",
          "Small drops fall on her umbrella.",
          "She sees a little dog under a tree.",
          "The dog looks cold, so Mia waits with it."
        ],
        vocabulary: [
          ["slowly", "慢慢地"],
          ["drop", "水滴"],
          ["under", "在下面"],
          ["cold", "冷的"]
        ]
      },
      {
        title: "Part 3: A Kind Choice",
        visual: "Mia sharing her umbrella near a tree while a woman happily finds her small dog, kind and gentle scene",
        sentences: [
          "A woman runs to the tree and smiles.",
          "She says the dog ran away from home.",
          "Mia gives the woman her umbrella for a moment.",
          "The woman says thank you again and again."
        ],
        vocabulary: [
          ["smile", "微笑"],
          ["run away", "跑走"],
          ["for a moment", "一会儿"],
          ["again", "再次"]
        ]
      },
      {
        title: "Part 4: The Library",
        visual: "Mia sitting in a calm library with wet shoes and an open book about sunny places, rain outside the window",
        sentences: [
          "Mia gets to the library a little late.",
          "Her shoes are wet, but she is happy.",
          "She finds a book about sunny places.",
          "The rain outside now sounds soft and friendly."
        ],
        vocabulary: [
          ["library", "图书馆"],
          ["wet", "湿的"],
          ["sunny", "晴朗的"],
          ["friendly", "友好的"]
        ]
      }
    ]
  },
  "the lost key": {
    title: "The Lost Key",
    summary: "Ben looks for his key and finds help from a neighbor.",
    sections: [
      {
        title: "Part 1: At the Door",
        visual: "Ben standing in front of a red door after school, checking his pocket with a worried face",
        sentences: [
          "Ben comes home after school.",
          "He stands in front of the red door.",
          "He puts his hand in his pocket.",
          "His key is not there."
        ],
        vocabulary: [
          ["after school", "放学后"],
          ["front", "前面"],
          ["pocket", "口袋"],
          ["key", "钥匙"]
        ]
      },
      {
        title: "Part 2: Looking Around",
        visual: "Ben searching inside his school bag near a small garden, books and lunch box visible",
        sentences: [
          "Ben looks inside his bag.",
          "He checks his books and his lunch box.",
          "He walks back to the garden.",
          "He feels worried, but he keeps looking."
        ],
        vocabulary: [
          ["inside", "在里面"],
          ["check", "检查"],
          ["garden", "花园"],
          ["worried", "担心的"]
        ]
      },
      {
        title: "Part 3: A Neighbor Helps",
        visual: "Mrs. Lee opening her window and talking kindly to Ben near a garden gate",
        sentences: [
          "Mrs. Lee opens her window.",
          "She asks Ben what happened.",
          "Ben tells her about the lost key.",
          "Mrs. Lee says she saw something near the gate."
        ],
        vocabulary: [
          ["neighbor", "邻居"],
          ["happen", "发生"],
          ["lost", "丢失的"],
          ["gate", "大门"]
        ]
      },
      {
        title: "Part 4: The Small Sound",
        visual: "Ben finding a small key under a yellow leaf near the gate, smiling with relief",
        sentences: [
          "Ben walks to the gate and looks down.",
          "The key is under a yellow leaf.",
          "He picks it up and laughs.",
          "He thanks Mrs. Lee and opens the door."
        ],
        vocabulary: [
          ["look down", "向下看"],
          ["leaf", "叶子"],
          ["pick up", "捡起"],
          ["laugh", "笑"]
        ]
      }
    ]
  },
  "my first day at school": {
    title: "My First Day at School",
    summary: "Lily feels nervous, then makes a new friend in class.",
    sections: [
      {
        title: "Part 1: A New Morning",
        visual: "Lily getting ready for her first day at a new school, clean white shirt, warm morning light",
        sentences: [
          "Lily wakes up early.",
          "Today is her first day at a new school.",
          "She wears a clean white shirt.",
          "Her mother gives her a small hug."
        ],
        vocabulary: [
          ["first day", "第一天"],
          ["new school", "新学校"],
          ["clean", "干净的"],
          ["hug", "拥抱"]
        ]
      },
      {
        title: "Part 2: In the Classroom",
        visual: "Lily sitting near a classroom window, bright busy classroom, feeling quiet and a little nervous",
        sentences: [
          "The classroom is bright and busy.",
          "Many students talk and laugh.",
          "Lily sits near the window.",
          "She feels quiet and a little nervous."
        ],
        vocabulary: [
          ["classroom", "教室"],
          ["bright", "明亮的"],
          ["near", "在附近"],
          ["nervous", "紧张的"]
        ]
      },
      {
        title: "Part 3: A New Friend",
        visual: "Sam sharing a red pencil with Lily at a classroom desk, both children smiling softly",
        sentences: [
          "A boy named Sam sits next to Lily.",
          "He shares his red pencil with her.",
          "Lily says thank you in a soft voice.",
          "Sam smiles and asks her to play at break."
        ],
        vocabulary: [
          ["next to", "在旁边"],
          ["share", "分享"],
          ["soft voice", "轻声"],
          ["break", "课间休息"]
        ]
      },
      {
        title: "Part 4: Going Home",
        visual: "Lily meeting her mother at the school gate after class, happy and relaxed",
        sentences: [
          "After school, Lily sees her mother at the gate.",
          "She tells her mother about Sam.",
          "She says the new school is not scary now.",
          "Tomorrow, she wants to go back again."
        ],
        vocabulary: [
          ["after school", "放学后"],
          ["scary", "可怕的"],
          ["tomorrow", "明天"],
          ["go back", "回去"]
        ]
      }
    ]
  }
};

async function generateStory({ topic, targetDurationMinutes, level, annotationStyle, mode = "lesson", outline = null }) {
  if (mode === "pure-story") {
    return createPureStory({
      topic,
      targetDurationMinutes,
      level,
      annotationStyle,
      outline
    });
  }

  const key = normalizeTopic(topic);
  const baseStory = STORY_BANK[key] || createPresetStory(topic) || createGenericStory(topic);
  const defaults = {
    sentencePauseSeconds: 2.2,
    sectionPauseSeconds: 1.2,
    vocabularyPauseSeconds: 1.5
  };
  const opening = [
    `Today we will read a short English story: ${baseStory.title}.`,
    "Listen first, then read aloud during the quiet pauses.",
    "After each part, you will see a few important words."
  ];
  const closing = [
    "Great work. Read the story one more time by yourself.",
    "Try to say each sentence clearly and slowly."
  ];
  let repetitions = Math.max(1, Math.ceil(targetDurationMinutes / 3));
  let targetSections = buildRepeatedSections(baseStory, repetitions);
  const targetSeconds = targetDurationMinutes * 60;

  // The rendered lesson includes deliberate quiet shadowing time. Local and cloud
  // voices often speak faster than the text estimate, so keep a content buffer.
  while (estimateStorySeconds(opening, targetSections, closing, defaults) < targetSeconds * 1.15 && repetitions < 12) {
    repetitions += 1;
    targetSections = buildRepeatedSections(baseStory, repetitions);
  }

  return {
    version: "0.1.0",
    title: baseStory.title,
    topic,
    level,
    annotationStyle,
    targetDurationMinutes,
    generatedAt: new Date().toISOString(),
    defaults,
    summary: baseStory.summary,
    storyboardDesign: baseStory.storyboardDesign || {
      visualStyle: "cinematic beginner storybook illustration",
      learningFocus: "common beginner words and useful phrases",
      framePattern: "Story scene frame, bilingual shadowing sentence frame, orange vocabulary annotation frame",
      targetLength: "15-20 minutes through listen, shadow, and review rounds"
    },
    opening,
    sections: targetSections,
    closing
  };
}

function buildRepeatedSections(baseStory, repetitions) {
  const targetSections = [];
  for (let round = 0; round < repetitions; round += 1) {
    const roundLabel = repetitions === 1
      ? ""
      : round === 0
        ? "Listen"
        : round === 1
          ? "Shadow"
          : `Review ${round}`;
    const imageVariantIndex = round === 0 ? 0 : round === 1 ? 1 : 2;

    baseStory.sections.forEach((section, baseSectionIndex) => {
      targetSections.push({
        ...section,
        baseSectionIndex,
        imageVariantIndex,
        imageBeatSize: section.sentences?.length || 4,
        imageBeatCount: 1,
        imageBeats: [{
          sentenceStart: 0,
          sentenceEnd: Math.max(0, (section.sentences?.length || 1) - 1),
          durationNote: "cover the full scene",
          imagePrompt: buildImagePrompt(baseStory.title, section.visual || section.sentences.join(" "), imageVariantIndex, 0, section.sentences)
        }],
        title: roundLabel ? `${section.title} - ${roundLabel}` : section.title,
        imagePrompt: buildImagePrompt(baseStory.title, section.visual || section.sentences.join(" "), imageVariantIndex, 0, section.sentences),
        mode: roundLabel || "Listen",
        sentences: section.sentences.map((sentence) => round === 0 ? sentence : makeRepeatPrompt(sentence, round))
      });
    });
  }
  return targetSections;
}

function estimateStorySeconds(opening, sections, closing, defaults) {
  let seconds = 0;
  opening.forEach((text) => {
    seconds += estimateSpeechSeconds(text, "en") + defaults.sectionPauseSeconds;
  });

  sections.forEach((section, sectionIndex) => {
    seconds += estimateSpeechSeconds(section.title, "en") + defaults.sectionPauseSeconds;
    section.sentences.forEach((sentence) => {
      seconds += estimateSpeechSeconds(sentence, "en") + defaults.sentencePauseSeconds;
    });
    if (sectionIndex < sections.length - 1) {
      seconds += estimateSpeechSeconds("Now, let us continue.", "en") + defaults.sectionPauseSeconds;
    }
  });

  closing.forEach((text) => {
    seconds += estimateSpeechSeconds(text, "en") + defaults.sectionPauseSeconds;
  });

  return seconds;
}

function estimateSpeechSeconds(text, language) {
  if (language === "zh") {
    return Math.max(2.2, String(text).length / 4.5);
  }

  const wordCount = String(text).split(/\s+/).filter(Boolean).length;
  return Math.max(2, (wordCount / 135) * 60);
}

function makeRepeatPrompt(sentence, round) {
  if (round === 1) {
    return sentence;
  }
  return sentence;
}

function createGenericStory(topic) {
  const cleanTopic = titleCase(topic || "A Simple Day");
  const mainName = "Emma";
  const place = choosePlace(cleanTopic);
  const object = chooseObject(cleanTopic);
  const problem = chooseProblem(cleanTopic);
  const zhTopic = `“${cleanTopic}”`;

  return {
    title: cleanTopic,
    summary: `${mainName} follows a simple story about ${cleanTopic.toLowerCase()} and learns a useful lesson.`,
    storyboardDesign: {
      visualStyle: `${chooseVisualStyle(cleanTopic)} story illustration`,
      learningFocus: "topic words, simple action verbs, and shadowing-ready sentences",
      framePattern: "Scene illustration, bilingual shadowing panel, compact vocabulary note frame",
      targetLength: "15-20 minutes through listen, shadow, and review rounds"
    },
    sections: [
      {
        title: "Part 1: The New Topic",
        visual: `${mainName} enters ${place} and notices ${object}, ${chooseVisualStyle(cleanTopic)} story illustration, clear main character and setting`,
        sentences: [
          `${mainName} hears a story called "${cleanTopic}" in the morning.`,
          `She wants to understand it in a simple way.`,
          "She puts a small notebook in her bag.",
          `Then she walks to the ${place} and looks around.`
        ],
        translations: [
          `${mainName}在早晨听说了${zhTopic}。`,
          `她想用简单的方式理解它。`,
          `她把一个小笔记本放进包里。`,
          `然后她走到${zhPlace(place)}，四处看看。`
        ],
        vocabulary: [
          ["understand", "理解"],
          ["simple", "简单的"],
          ["notebook", "笔记本"],
          [place, zhPlace(place)]
        ]
      },
      {
        title: "Part 2: The Small Problem",
        visual: `${mainName} faces ${problem} near ${object}, thoughtful expression, beginner-friendly story scene`,
        sentences: [
          "The day is quiet at first.",
          `${mainName} sees ${problem}.`,
          "She stops and thinks for a minute.",
          "She wants to make a good choice."
        ],
        translations: [
          `一开始，这一天很安静。`,
          `${mainName}看到了${zhProblem(problem)}。`,
          `她停下来，想了一分钟。`,
          `她想做一个好的选择。`
        ],
        vocabulary: [
          ["quiet", "安静的"],
          ["problem", "问题"],
          ["minute", "分钟"],
          ["choice", "选择"]
        ]
      },
      {
        title: "Part 3: A Helpful Step",
        visual: `${mainName} asks a kind person for help in ${place}, friendly faces, warm educational story scene`,
        sentences: [
          `${mainName} asks a kind person for help.`,
          "The person listens carefully.",
          "Together, they find an easy answer.",
          `${mainName} feels better and smiles.`
        ],
        translations: [
          `${mainName}向一个友善的人寻求帮助。`,
          `这个人认真地听她说。`,
          `他们一起找到了一个简单的答案。`,
          `${mainName}感觉好多了，并且笑了。`
        ],
        vocabulary: [
          ["ask for help", "寻求帮助"],
          ["carefully", "认真地"],
          ["together", "一起"],
          ["answer", "答案"]
        ]
      },
      {
        title: "Part 4: The Lesson",
        visual: `${mainName} writes a lesson about ${cleanTopic.toLowerCase()} in a notebook, calm ending scene, soft light`,
        sentences: [
          `At the end of the day, ${mainName} goes home.`,
          "She writes one sentence in her notebook.",
          `${cleanTopic} can teach a small but useful lesson.`,
          `${mainName} feels ready for tomorrow.`
        ],
        translations: [
          `一天结束时，${mainName}回家了。`,
          `她在笔记本里写下一句话。`,
          `${zhTopic}可以教会我们一个小而有用的道理。`,
          `${mainName}觉得自己已经准备好迎接明天。`
        ],
        vocabulary: [
          ["at the end", "在最后"],
          ["sentence", "句子"],
          ["lesson", "经验"],
          ["ready", "准备好的"]
        ]
      }
    ]
  };
}

function choosePlace(topic) {
  const lower = topic.toLowerCase();
  if (lower.includes("rain") || lower.includes("city")) return "city street";
  if (lower.includes("space") || lower.includes("moon") || lower.includes("star")) return "space station";
  if (lower.includes("sea") || lower.includes("ocean") || lower.includes("island")) return "small island";
  if (lower.includes("farm")) return "farm";
  if (lower.includes("castle") || lower.includes("king")) return "castle";
  if (lower.includes("school")) return "school";
  if (lower.includes("library") || lower.includes("book")) return "library";
  if (lower.includes("park")) return "park";
  if (lower.includes("shop") || lower.includes("store")) return "shop";
  return "street";
}

function chooseObject(topic) {
  const lower = topic.toLowerCase();
  if (lower.includes("key")) return "a small key";
  if (lower.includes("map")) return "a paper map";
  if (lower.includes("robot")) return "a tiny robot";
  if (lower.includes("moon") || lower.includes("space")) return "a silver star card";
  if (lower.includes("rain")) return "a yellow umbrella";
  if (lower.includes("book") || lower.includes("library")) return "an old book";
  if (lower.includes("school")) return "a red pencil";
  return "a small object";
}

function chooseProblem(topic) {
  const lower = topic.toLowerCase();
  if (lower.includes("rain") || lower.includes("storm")) return "a sudden change in the weather";
  if (lower.includes("lost") || lower.includes("key") || lower.includes("map")) return "a missing clue";
  if (lower.includes("robot") || lower.includes("space")) return "a quiet machine problem";
  if (lower.includes("school")) return "a confusing first question";
  return "a small problem";
}

function chooseVisualStyle(topic) {
  const lower = topic.toLowerCase();
  if (lower.includes("mystery") || lower.includes("secret") || lower.includes("lost")) return "soft mystery";
  if (lower.includes("space") || lower.includes("robot") || lower.includes("future")) return "gentle sci-fi";
  if (lower.includes("rain") || lower.includes("city") || lower.includes("train")) return "cinematic city";
  if (lower.includes("forest") || lower.includes("tree") || lower.includes("dragon")) return "storybook fantasy";
  if (lower.includes("school") || lower.includes("class")) return "warm school";
  return "cinematic beginner";
}

function zhPlace(place) {
  const terms = {
    "city street": "城市街道",
    "space station": "空间站",
    "small island": "小岛",
    farm: "农场",
    castle: "城堡",
    school: "学校",
    library: "图书馆",
    park: "公园",
    shop: "商店",
    street: "街道"
  };
  return terms[place] || place;
}

function zhProblem(problem) {
  const terms = {
    "a sudden change in the weather": "天气的突然变化",
    "a missing clue": "一条丢失的线索",
    "a quiet machine problem": "一个安静的机器问题",
    "a confusing first question": "一个令人困惑的第一个问题",
    "a small problem": "一个小问题"
  };
  return terms[problem] || problem;
}

function normalizeTopic(topic) {
  return String(topic || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function titleCase(value) {
  const smallWords = new Set(["a", "an", "and", "at", "by", "for", "from", "in", "of", "on", "the", "to", "with"]);
  const words = String(value || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return words
    .map((word, index) => {
      const lower = word.toLowerCase();
      if (index > 0 && smallWords.has(lower)) return lower;
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}

function buildImagePrompt(storyTitle, visual, variantIndex = 0, beatIndex = 0, sentences = []) {
  const variantDirectives = [
    "Wide establishing shot, clear location, main character visible in context.",
    "Medium shot, character action and important object visible, natural emotion.",
    "Closer detail shot, story object or facial expression emphasized, cinematic depth of field."
  ];
  const beatSentences = sentences.slice(beatIndex * 2, beatIndex * 2 + 2);
  return [
    "16:9 photorealistic cinematic still photo for an English learning video background.",
    `Story: ${storyTitle}.`,
    `Scene: ${visual}.`,
    beatSentences.length ? `Moment to depict: ${beatSentences.join(" ")}` : "",
    variantDirectives[variantIndex] || variantDirectives[0],
    "Natural light, real location, realistic people, clean composition, background image only.",
    "No text, no subtitles, no captions, no watermark, no logo, no UI elements."
  ].filter(Boolean).join(" ");
}

module.exports = {
  generateStory
};
