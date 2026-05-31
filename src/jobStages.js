const STAGE_DEFINITIONS = [
  { id: "draft", label: "Draft Quality", detail: "Confirmed review draft, search context, and quality gate." },
  { id: "script-assets", label: "Script Assets", detail: "script.json, script.md, subtitles, and image prompts." },
  { id: "tts", label: "Narration", detail: "Sentence-level TTS and timing manifest." },
  { id: "images", label: "Images", detail: "Story beat backgrounds and image manifest." },
  { id: "music", label: "Music", detail: "Background music tracks and merged bed." },
  { id: "compose", label: "Compose MP4", detail: "Final video render with captions and audio." },
  { id: "quality", label: "Quality Report", detail: "Duration, count, and warning checks." }
];

const STAGE_IDS = STAGE_DEFINITIONS.map((stage) => stage.id);

function createStages(existing = {}) {
  const stages = {};
  STAGE_DEFINITIONS.forEach((definition) => {
    const current = existing[definition.id] || {};
    stages[definition.id] = {
      id: definition.id,
      label: definition.label,
      detail: definition.detail,
      status: current.status || "pending",
      startedAt: current.startedAt || null,
      completedAt: current.completedAt || null,
      error: current.error || null,
      errorType: current.errorType || null,
      recoverable: Boolean(current.recoverable),
      counts: current.counts || null
    };
  });
  return stages;
}

function markStage(stages, id, status, patch = {}) {
  if (!stages[id]) stages[id] = createStages()[id] || { id, label: id, detail: "" };
  const stage = stages[id];
  stage.status = status;
  if (status === "running") {
    stage.startedAt = stage.startedAt || new Date().toISOString();
    stage.completedAt = null;
    stage.error = null;
    stage.errorType = null;
    stage.recoverable = false;
  }
  if (status === "completed" || status === "skipped") {
    stage.completedAt = new Date().toISOString();
    stage.error = null;
    stage.errorType = null;
    stage.recoverable = false;
  }
  if (status === "failed") {
    stage.completedAt = null;
  }
  Object.assign(stage, patch);
  return stage;
}

function firstFailedStage(stages = {}) {
  return STAGE_IDS.find((id) => stages[id]?.status === "failed") || null;
}

function summarizeStageCounts(stages = {}) {
  return STAGE_IDS.reduce((summary, id) => {
    if (stages[id]?.counts) summary[id] = stages[id].counts;
    return summary;
  }, {});
}

module.exports = {
  STAGE_DEFINITIONS,
  STAGE_IDS,
  createStages,
  firstFailedStage,
  markStage,
  summarizeStageCounts
};
