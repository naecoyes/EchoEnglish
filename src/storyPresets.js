const STORY_PRESETS = [
  ["The Clockmaker's Secret", "mystery", "Eli", "an old clock shop", "a silver pocket watch", "a hidden note", "truth"],
  ["A Night at the Museum", "adventure", "Nora", "a city museum", "a golden key", "a moving statue", "courage"],
  ["The Lighthouse Keeper", "coastal drama", "Leo", "a lonely lighthouse", "a broken lantern", "a stormy signal", "responsibility"],
  ["The Girl Who Followed the Map", "treasure adventure", "Maya", "a quiet village", "a torn map", "a secret path", "curiosity"],
  ["The Robot in the Garden", "gentle sci-fi", "Sam", "a small garden", "a tiny robot", "a strange seed", "kindness"],
  ["The Last Train Home", "urban journey", "Anna", "a rainy train station", "a lost ticket", "a delayed train", "patience"],
  ["The Talking Tree", "fantasy", "Milo", "an ancient forest", "a blue leaf", "a whispering tree", "listening"],
  ["A Letter from the Future", "sci-fi mystery", "Ivy", "a bright classroom", "a sealed letter", "a warning from tomorrow", "choice"],
  ["The Smallest Bakery in Town", "slice of life", "Grace", "a warm bakery", "a missing recipe", "a busy morning", "teamwork"],
  ["The Mountain Rescue", "survival", "Jack", "a snowy mountain", "a red scarf", "a dangerous trail", "bravery"],
  ["The Shadow in the Library", "soft mystery", "Luna", "an old library", "a dusty book", "a moving shadow", "focus"],
  ["The Dragon's Lost Song", "fantasy", "Aria", "a hidden valley", "a silver flute", "a silent dragon", "empathy"],
  ["The Storm on Maple Street", "community story", "Ben", "a small neighborhood", "a fallen tree", "a dark evening", "helpfulness"],
  ["The Boy Who Fixed the Moon", "magical realism", "Noah", "a rooftop at night", "a glass ladder", "a cracked moon", "hope"],
  ["The Secret Door Under the School", "school adventure", "Tara", "a quiet school hallway", "a brass handle", "a hidden room", "friendship"]
].map(([title, genre, hero, setting, object, problem, lesson]) => ({
  title,
  genre,
  hero,
  setting,
  object,
  problem,
  lesson,
  summary: `${hero} finds ${object} in ${setting} and learns about ${lesson}.`
}));

function listStoryPresets() {
  return STORY_PRESETS.map((preset) => {
    const design = makeStoryboardDesign(preset);
    return {
      title: preset.title,
      genre: preset.genre,
      summary: preset.summary,
      visualStyle: design.visualStyle,
      learningFocus: design.learningFocus
    };
  });
}

function getStoryPreset(topic) {
  const normalized = normalize(topic);
  return STORY_PRESETS.find((preset) => normalize(preset.title) === normalized);
}

function createPresetStory(topic) {
  const preset = getStoryPreset(topic);
  if (!preset) return null;

  const { title, hero, setting, object, problem, lesson } = preset;
  const zhSetting = zhTerm(setting);
  const zhObject = zhTerm(object);
  const zhLesson = zhTerm(lesson);
  const storyboardDesign = makeStoryboardDesign(preset);
  return {
    title,
    summary: preset.summary,
    storyboardDesign,
    sections: [
      {
        title: "Part 1: A Quiet Beginning",
        visual: `${hero} enters ${setting}, ${storyboardDesign.visualStyle}, the important object visible in the foreground`,
        sentences: [
          `${hero} walked into ${setting} before sunset.`,
          `The place was quiet, but it did not feel empty.`,
          `${hero} saw ${object} near the door.`,
          `At first, it looked simple and ordinary.`
        ],
        translations: [
          `${hero}在日落前走进了${zhSetting}。`,
          `这个地方很安静，但并不让人觉得空荡。`,
          `${hero}在门附近看到了${zhObject}。`,
          `起初，它看起来简单又普通。`
        ],
        vocabulary: [
          ["before sunset", "日落前"],
          ["quiet", "安静的"],
          ["ordinary", "普通的"],
          ["foreground", "前景"]
        ]
      },
      {
        title: "Part 2: The First Problem",
        visual: `${hero} studies ${object} closely while ${problem} begins to appear, ${storyboardDesign.visualStyle}, tense but beginner-friendly adventure scene`,
        sentences: [
          `${hero} picked it up carefully.`,
          `Then the first sign of trouble appeared.`,
          `The problem was small, but it grew quickly.`,
          `${hero} knew there was no time to waste.`
        ],
        translations: [
          `${hero}小心地把它拿了起来。`,
          `然后，第一个麻烦的迹象出现了。`,
          `问题一开始很小，但很快变大了。`,
          `${hero}知道不能浪费时间。`
        ],
        vocabulary: [
          ["carefully", "小心地"],
          ["trouble", "麻烦"],
          ["appear", "出现"],
          ["waste time", "浪费时间"]
        ]
      },
      {
        title: "Part 3: A Brave Choice",
        visual: `${hero} makes a brave choice in ${setting}, ${storyboardDesign.visualStyle}, dramatic light, clear emotional focus`,
        sentences: [
          `${hero} took a deep breath and stepped forward.`,
          `A voice inside said, "You can try."`,
          `${hero} used the clue in a new way.`,
          `Slowly, the answer became clear.`
        ],
        translations: [
          `${hero}深吸一口气，向前走去。`,
          `心里的一个声音说：“你可以试试。”`,
          `${hero}用一种新方法使用了线索。`,
          `慢慢地，答案变得清楚了。`
        ],
        vocabulary: [
          ["take a deep breath", "深吸一口气"],
          ["step forward", "向前走"],
          ["clue", "线索"],
          ["clear", "清楚的"]
        ]
      },
      {
        title: "Part 4: The Lesson",
        visual: `${hero} smiles as the scene becomes peaceful again, ${object} glowing softly, ${storyboardDesign.visualStyle}, warm ending frame`,
        sentences: [
          `In the end, the danger passed.`,
          `${hero} held ${object} and smiled.`,
          `The adventure taught an important lesson.`,
          `${lesson.charAt(0).toUpperCase() + lesson.slice(1)} can change a difficult day.`
        ],
        translations: [
          `最后，危险过去了。`,
          `${hero}拿着${zhObject}，微笑了。`,
          `这次冒险教会了一个重要的道理。`,
          `${zhLesson}可以改变艰难的一天。`
        ],
        vocabulary: [
          ["in the end", "最后"],
          ["danger", "危险"],
          ["adventure", "冒险"],
          ["lesson", "经验；教训"]
        ]
      }
    ]
  };
}

function zhTerm(value) {
  const terms = {
    "an old clock shop": "一家老钟表店",
    "a city museum": "一座城市博物馆",
    "a lonely lighthouse": "一座孤独的灯塔",
    "a quiet village": "一个安静的村庄",
    "a small garden": "一个小花园",
    "a rainy train station": "一个下雨的火车站",
    "an ancient forest": "一片古老的森林",
    "a bright classroom": "一间明亮的教室",
    "a warm bakery": "一家温暖的面包店",
    "a snowy mountain": "一座雪山",
    "an old library": "一座老图书馆",
    "a hidden valley": "一条隐秘的山谷",
    "a small neighborhood": "一个小社区",
    "a rooftop at night": "夜晚的屋顶",
    "a quiet school hallway": "一条安静的学校走廊",
    "a silver pocket watch": "一块银色怀表",
    "a golden key": "一把金色钥匙",
    "a broken lantern": "一盏坏掉的灯",
    "a torn map": "一张撕破的地图",
    "a tiny robot": "一个小机器人",
    "a lost ticket": "一张丢失的票",
    "a blue leaf": "一片蓝色叶子",
    "a sealed letter": "一封密封的信",
    "a missing recipe": "一份丢失的食谱",
    "a red scarf": "一条红围巾",
    "a dusty book": "一本满是灰尘的书",
    "a silver flute": "一支银色长笛",
    "a fallen tree": "一棵倒下的树",
    "a glass ladder": "一把玻璃梯子",
    "a brass handle": "一个黄铜把手",
    truth: "真相",
    courage: "勇气",
    responsibility: "责任感",
    curiosity: "好奇心",
    kindness: "善良",
    patience: "耐心",
    listening: "倾听",
    choice: "选择",
    teamwork: "合作",
    bravery: "勇敢",
    focus: "专注",
    empathy: "共情",
    helpfulness: "乐于助人",
    hope: "希望",
    friendship: "友谊"
  };
  return terms[value] || value;
}

function makeStoryboardDesign(preset) {
  const styles = {
    mystery: ["warm candlelit mystery illustration", "objects, clues, quiet suspense"],
    adventure: ["wide storybook adventure illustration", "action verbs and location words"],
    "coastal drama": ["windy coastal storybook illustration", "weather, signals, responsibility words"],
    "treasure adventure": ["bright map-and-trail adventure illustration", "directions and discovery words"],
    "gentle sci-fi": ["soft garden sci-fi illustration", "technology words in simple sentences"],
    "urban journey": ["rainy cinematic city illustration", "travel, time, and patience words"],
    fantasy: ["magical storybook fantasy illustration", "emotion, nature, and courage words"],
    "sci-fi mystery": ["clean classroom sci-fi mystery illustration", "time words and choice phrases"],
    "slice of life": ["warm bakery slice-of-life illustration", "daily work and teamwork words"],
    survival: ["snowy mountain rescue illustration", "safety, weather, and bravery words"],
    "soft mystery": ["quiet library mystery illustration", "reading, focus, and clue words"],
    "magical realism": ["moonlit magical realism illustration", "hopeful action phrases"],
    "community story": ["stormy neighborhood community illustration", "helping and repair words"],
    "school adventure": ["secret school hallway adventure illustration", "friendship and discovery words"]
  };
  const [visualStyle, learningFocus] = styles[preset.genre] || ["cinematic storybook illustration", "beginner verbs and useful phrases"];
  return {
    visualStyle,
    learningFocus,
    framePattern: "Story scene frame, bilingual shadowing sentence frame, orange vocabulary annotation frame",
    targetLength: "15-20 minutes through listen, shadow, and review rounds"
  };
}

function normalize(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

module.exports = {
  createPresetStory,
  getStoryPreset,
  listStoryPresets
};
