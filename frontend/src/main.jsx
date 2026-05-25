import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Activity, Clock3, FolderOpen, PlayCircle, Settings, Wand2 } from "lucide-react";
import "./styles.css";

const NAV_ITEMS = [
  { path: "/generate", label: "Generate", helper: "Topic", icon: Wand2 },
  { path: "/status", label: "Status", helper: "Logs", icon: Activity },
  { path: "/preview", label: "Preview", helper: "Video", icon: PlayCircle },
  { path: "/outputs", label: "Outputs", helper: "Files", icon: FolderOpen },
  { path: "/recent", label: "Recent", helper: "Library", icon: Clock3 },
  { path: "/settings", label: "Settings", helper: "API", icon: Settings }
];

const PAGE_META = {
  "/generate": {
    title: "Generate AI Shadowing Videos",
    subtitle: "Turn any topic into a fixed 15-minute English story video with reviewed drafts, scene images, bilingual captions, and background music."
  },
  "/preview": {
    title: "Preview",
    subtitle: "Watch the real output video and scrub through the timeline."
  },
  "/outputs": {
    title: "Outputs",
    subtitle: "Open the generated video, audio, subtitles, prompts, and scripts."
  },
  "/recent": {
    title: "Recent",
    subtitle: "Browse completed story videos from this machine."
  },
  "/status": {
    title: "Status",
    subtitle: "Track generation progress, model calls, and export logs."
  },
  "/settings": {
    title: "Settings",
    subtitle: "Configure MiniMax media models, Tavily search, and the LLM script generator."
  }
};

const OUTPUT_LABELS = {
  video: "Final Video",
  script: "Readable Script",
  subtitles: "Subtitles",
  audio: "Narration",
  music: "Background Music",
  imagePrompts: "Scene Prompts",
  scriptJson: "Structured Data",
  jobState: "Job State",
  audioManifest: "Audio Manifest",
  imageManifest: "Image Manifest",
  musicManifest: "Music Manifest",
  qualityReport: "Quality Report"
};

const DEFAULT_TEMPLATE_ID = "company-origin";
const DRAFT_STORAGE_KEY = "echoenglish:lastDraft";

function App() {
  const [route, setRoute] = useState(() => normalizeRoute(window.location.pathname));
  const [query, setQuery] = useState(() => new URLSearchParams(window.location.search));
  const [config, setConfig] = useState(null);
  const [recent, setRecent] = useState([]);
  const [currentOutput, setCurrentOutput] = useState(null);
  const [outline, setOutline] = useState(null);
  const [outlineTopic, setOutlineTopic] = useState("");
  const [draft, setDraft] = useState(null);
  const [draftFeedback, setDraftFeedback] = useState("");
  const [draftMeta, setDraftMeta] = useState(null);
  const [job, setJob] = useState(null);
  const [logs, setLogs] = useState(["Waiting for a generation job."]);
  const [status, setStatus] = useState("idle");
  const [form, setForm] = useState({ topic: "A Rainy Day in London", minutes: "15", templateId: DEFAULT_TEMPLATE_ID });

  const outputSlug = query.get("output");
  const jobId = query.get("jobId");
  const providerReady = config?.provider === "xiaomi"
    ? Boolean(config?.hasXiaomiKey)
    : Boolean(config?.hasMiniMaxKey);
  const googleReady = (config?.media?.ttsProvider === "google" || config?.media?.imageProvider === "google")
    ? Boolean(config?.hasGoogleKey)
    : true;
  const apiReady = Boolean(providerReady && googleReady && config?.llm?.configured && config?.search?.configured);

  useEffect(() => {
    refreshConfig();
    loadRecentOutputs();
    restoreAutosavedDraft();
  }, []);

  function restoreAutosavedDraft() {
    try {
      const raw = window.localStorage.getItem(DRAFT_STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (!saved?.draft?.title) return;
      setForm((current) => ({
        ...current,
        topic: saved.topic || saved.draft.topic || current.topic,
        minutes: "15",
        templateId: saved.templateId || saved.draft.template?.id || current.templateId
      }));
      setOutline(saved.outline || saved.draft.outline || null);
      setDraft(saved.draft);
      setDraftMeta(saved.draftMeta || null);
      setDraftFeedback(saved.feedback || "");
      setOutlineTopic(saved.topic || saved.draft.topic || "");
      setLogs([`Loaded autosaved draft from ${formatSavedAt(saved.savedAt)}.`]);
    } catch {
      window.localStorage.removeItem(DRAFT_STORAGE_KEY);
    }
  }

  useEffect(() => {
    if (!draft?.title) return;
    const topic = form.topic.trim() || draft.topic || "Story Video";
    const saved = {
      savedAt: new Date().toISOString(),
      topic,
      templateId: form.templateId,
      outline,
      draft,
      draftMeta,
      feedback: draftFeedback
    };
    window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(saved));
  }, [draft, draftMeta, draftFeedback, form.topic, form.templateId, outline]);

  async function refreshConfig() {
    return fetchJson("/api/config")
      .then((next) => {
        setConfig(next);
        return next;
      })
      .catch(() => {
        const fallback = { hasMiniMaxKey: false, hasLlmKey: false, llm: { configured: false }, search: { configured: false } };
        setConfig(fallback);
        return fallback;
      });
  }

  useEffect(() => {
    const onPop = () => {
      setRoute(normalizeRoute(window.location.pathname));
      setQuery(new URLSearchParams(window.location.search));
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    if (!outputSlug || !recent.length) return;
    const found = recent.find((item) => item.slug === outputSlug);
    if (found) {
      setCurrentOutput(found);
      window.localStorage.setItem("echoenglish:lastOutput", found.slug);
    }
  }, [outputSlug, recent]);

  useEffect(() => {
    if (outputSlug || currentOutput || !recent.length) return;
    const lastSlug = window.localStorage.getItem("echoenglish:lastOutput");
    const found = recent.find((item) => item.slug === lastSlug) || recent[0];
    if (found) setCurrentOutput(found);
  }, [outputSlug, currentOutput, recent]);

  useEffect(() => {
    if (!jobId || job?.id === jobId) return;
    setJob({ id: jobId, status: "queued", topic: "Story Video", logs: ["Reconnecting to job..."] });
    setStatus("queued");
  }, [jobId]);

  useEffect(() => {
    if (route !== "/status" || jobId || job?.id) return;
    let cancelled = false;
    fetchJson("/api/jobs/latest")
      .then((latest) => {
        if (cancelled || latest.error) return;
        setJob(latest);
        setStatus(latest.status || "idle");
        setLogs(latest.logs?.length ? latest.logs : ["Loaded latest saved generation state."]);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [route, jobId, job?.id]);

  useEffect(() => {
    if (!job?.id || ["completed", "failed", "failed_recoverable", "idle"].includes(job.status)) return undefined;
    let cancelled = false;
    const tick = async () => {
      try {
        const next = await fetchJson(`/api/jobs/${encodeURIComponent(job.id)}`);
        if (cancelled) return;
        if (next.error === "Job not found") {
          setStatus("idle");
          setLogs(["This server restarted, so the old live job id is gone. Recent outputs are still available."]);
          setJob(null);
          return;
        }
        setJob(next);
        setStatus(next.status || "running");
        setLogs(next.logs?.length ? next.logs : ["Working..."]);
        if (next.status === "completed") {
          const completed = {
            slug: slugFromOutputs(next.outputs),
            title: next.topic || "Story Video",
            outputs: next.outputs
          };
          setCurrentOutput(completed);
          await loadRecentOutputs();
          navigate("/preview", { output: completed.slug });
        }
      } catch (error) {
        setStatus("failed");
        setLogs([error.message]);
      }
    };
    tick();
    const timer = setInterval(tick, 1600);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [job?.id, job?.status]);

  async function loadRecentOutputs() {
    try {
      const data = await fetchJson("/api/recent-outputs");
      setRecent(data.items || []);
      return data.items || [];
    } catch {
      setRecent([]);
      return [];
    }
  }

  function navigate(path, params = {}) {
    const search = new URLSearchParams(params).toString();
    const url = search ? `${path}?${search}` : path;
    window.history.pushState(null, "", url);
    setRoute(normalizeRoute(path));
    setQuery(new URLSearchParams(search));
  }

  async function handleGenerateSubmit(event) {
    event.preventDefault();
    if (!apiReady) {
      navigate("/settings");
      return;
    }
    const topic = form.topic.trim() || "A Rainy Day in London";
    const minutes = String(clampMinutes(form.minutes));

    if (!draft || outlineTopic !== topic) {
      try {
        setStatus("queued");
        setLogs([
          "Step 1/3: Searching topic context with Tavily.",
          "Step 2/3: Generating full review draft with the configured LLM.",
          "Step 3/3: Waiting for draft review."
        ]);
        const result = await fetchJson("/api/story-draft", {
          method: "POST",
          body: JSON.stringify({ topic, minutes, templateId: form.templateId })
        });
        setOutline(result.outline);
        setDraft(result.draft);
        setDraftMeta({ imageTarget: result.imageTarget, musicTarget: result.musicTarget, autosaved: result.autosaved });
        setOutlineTopic(topic);
        setStatus("idle");
        setLogs([
          "Step 1/3 complete: Tavily search context ready.",
          "Step 2/3 complete: Review draft generated.",
          `Step 3/3 active: Draft autosaved${result.autosaved?.draftJson ? ` to ${result.autosaved.draftJson}` : ""}. Review, revise, or confirm generation.`
        ]);
      } catch (error) {
        setStatus("failed");
        setLogs([error.message]);
      }
      return;
    }

    try {
      setStatus("queued");
      setLogs([
        "Step 1/6 queued: Preparing story package.",
        "Step 2/6 queued: Narration audio.",
        "Step 3/6 queued: Scene images.",
        "Step 4/6 queued: Background music.",
        "Step 5/6 queued: Compose final MP4.",
        "Step 6/6 queued: Quality report."
      ]);
      const started = await fetchJson("/api/generate-story-video", {
        method: "POST",
        body: JSON.stringify({ topic, minutes, templateId: form.templateId, outline, storyDraft: draft })
      });
      const nextJob = {
        id: started.id,
        status: started.status,
        topic,
        minutes,
        logs: ["Job submitted. Preparing the story package..."]
      };
      setJob(nextJob);
      navigate("/status", { jobId: started.id });
    } catch (error) {
      setStatus("failed");
      setLogs([error.message]);
    }
  }

  async function handleReviseDraft() {
    if (!draft) return;
    const topic = form.topic.trim() || draft.topic || "Story Video";
    try {
      setStatus("queued");
      setLogs([
        "Step 1/2 active: Sending revision notes to the LLM.",
        "Step 2/2 queued: Refreshing the review draft."
      ]);
      const result = await fetchJson("/api/revise-story-draft", {
        method: "POST",
        body: JSON.stringify({
          topic,
          minutes: "15",
          templateId: form.templateId,
          draft,
          feedback: draftFeedback
        })
      });
      setDraft(result.draft);
      setDraftMeta({ imageTarget: result.imageTarget, musicTarget: result.musicTarget, autosaved: result.autosaved });
      setStatus("idle");
      setLogs([
        "Step 1/2 complete: Draft revised with your notes.",
        `Step 2/2 active: Revised draft autosaved${result.autosaved?.draftJson ? ` to ${result.autosaved.draftJson}` : ""}. Review it again, then confirm generation.`
      ]);
    } catch (error) {
      setStatus("failed");
      setLogs([error.message]);
    }
  }

  async function handleContinueJob() {
    if (!job?.id) return;
    setStatus("queued");
    setLogs((current) => [
      ...(current?.length ? current : []),
      `[${new Date().toISOString()}] Continue requested from the dashboard.`
    ]);
    try {
      const next = await fetchJson(`/api/jobs/${encodeURIComponent(job.id)}/continue`, { method: "POST" });
      setJob(next);
      setStatus(next.status || "queued");
      setLogs(next.logs?.length ? next.logs : ["Continue generation queued."]);
      navigate("/status", { jobId: next.id });
    } catch (error) {
      setStatus("failed");
      setLogs((current) => [...(current || []), error.message]);
    }
  }

  async function handleRefreshJob() {
    const id = job?.id;
    if (!id) return;
    try {
      const next = await fetchJson(`/api/jobs/${encodeURIComponent(id)}`);
      setJob(next);
      setStatus(next.status || "idle");
      setLogs(next.logs?.length ? next.logs : ["Loaded saved generation state."]);
    } catch (error) {
      setLogs((current) => [...(current || []), error.message]);
    }
  }

  function openRecent(item, path = "/preview") {
    setCurrentOutput(item);
    window.localStorage.setItem("echoenglish:lastOutput", item.slug);
    navigate(path, { output: item.slug });
  }

  const progress = getProgress(logs, status);
  const activeOutput = currentOutput || (outputSlug ? recent.find((item) => item.slug === outputSlug) : null);

  return (
    <div className="app-shell">
      <BackgroundGlow />
      <GlassNavigation route={route} navigate={navigate} />
      <main className="page-shell">
        <AppHeader config={config} status={status} route={route} />
        {route === "/generate" && (
          <GeneratePage
            form={form}
            setForm={(next) => {
              setForm(next);
              setOutline(null);
              setOutlineTopic("");
              setDraft(null);
              setDraftFeedback("");
              setDraftMeta(null);
            }}
            outline={outline}
            draft={draft}
            draftFeedback={draftFeedback}
            setDraftFeedback={setDraftFeedback}
            draftMeta={draftMeta}
            apiReady={apiReady}
            config={config}
            logs={logs}
            status={status}
            onSubmit={handleGenerateSubmit}
            onRevise={handleReviseDraft}
          />
        )}
        {route === "/preview" && <PreviewPage output={activeOutput} />}
        {route === "/outputs" && <OutputsPage output={activeOutput} />}
        {route === "/recent" && <RecentPage items={recent} refresh={loadRecentOutputs} openRecent={openRecent} />}
        {route === "/status" && <StatusPage status={status} logs={logs} progress={progress} job={job} onContinue={handleContinueJob} onRefresh={handleRefreshJob} />}
        {route === "/settings" && <SettingsPage onSaved={refreshConfig} />}
      </main>
    </div>
  );
}

function AppHeader({ config, status, route }) {
  const meta = PAGE_META[route] || PAGE_META["/generate"];
  const badges = getActiveConfigBadges(config);
  return (
    <header className="app-header glass-card">
      <div>
        <div className="brand-row">
          <img className="brand-logo" src="/icons/icon.svg" alt="" />
          <p className="eyebrow">EchoEnglish</p>
        </div>
        <h1>{meta.title}</h1>
        <p className="header-copy">{meta.subtitle}</p>
      </div>
      <div className="header-badges">
        {badges.map((badge) => (
          <span className="state-pill config" key={badge}>{badge}</span>
        ))}
        <span className="state-pill">{status}</span>
      </div>
    </header>
  );
}

function getActiveConfigBadges(config) {
  const settings = config?.settings || {};
  const provider = config?.provider === "xiaomi" ? "xiaomi" : "minimax";
  if (provider === "xiaomi") {
    return [
      "Provider: Xiaomi MiMo",
      `Text: ${config?.xiaomi?.textModel || settings.xiaomi?.textModel || "MiMo-V2.5-Pro"}`,
      `TTS: ${formatTtsConfig(config, settings)}`,
      `Image: ${formatImageConfig(config, settings)}`,
      `Music: ${settings.models?.music || "music-2.6"}`,
      "Search: Tavily"
    ];
  }
  return [
    "Provider: MiniMax",
    `Text: ${config?.llm?.model || settings.llm?.model || settings.models?.text || "qwen3.6-plus"}`,
    `TTS: ${formatTtsConfig(config, settings)}`,
    `Image: ${formatImageConfig(config, settings)}`,
    `Music: ${settings.models?.music || "music-2.6"}`,
    "Search: Tavily"
  ];
}

function formatTtsConfig(config, settings) {
  const provider = settings.media?.ttsProvider || config?.media?.ttsProvider || "minimax";
  if (provider === "google") return `Google ${config?.google?.ttsModel || settings.google?.ttsModel || "gemini-2.5-flash-preview-tts"}`;
  if (provider === "xiaomi") return `Xiaomi ${config?.xiaomi?.ttsModel || settings.xiaomi?.ttsModel || "MiMo-V2.5-TTS"}`;
  return settings.models?.tts || "speech-2.8-hd";
}

function formatImageConfig(config, settings) {
  const provider = settings.media?.imageProvider || config?.media?.imageProvider || "minimax";
  if (provider === "google") return `Google ${config?.google?.imageModel || settings.google?.imageModel || "imagen-4.0-generate-001"}`;
  return settings.models?.image || "image-01";
}

function getProviderReady(summary, provider) {
  if (provider === "google") return Boolean(summary?.google?.hasApiKey);
  if (provider === "xiaomi") return Boolean(summary?.xiaomi?.hasApiKey);
  return Boolean(summary?.hasApiKey);
}

function GlassNavigation({ route, navigate }) {
  return (
    <nav className="glass-nav" aria-label="Main navigation">
      <div className="nav-brand">
        <span>SV</span>
      </div>
      <div className="nav-items">
        {NAV_ITEMS.map((item) => {
          const active = route === item.path;
          const Icon = item.icon;
          return (
            <button
              key={item.path}
              className={`nav-button ${active ? "active" : ""}`}
              type="button"
              onClick={() => navigate(item.path)}
            >
              <span className="nav-orb" aria-hidden="true">
                <Icon className="nav-icon" strokeWidth={2.25} />
              </span>
              <strong>{item.label}</strong>
              <small>{item.helper}</small>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

function GeneratePage({ form, setForm, outline, draft, draftFeedback, setDraftFeedback, draftMeta, apiReady, config, logs, status, onSubmit, onRevise }) {
  const confirmed = Boolean(draft && draft.title);
  const busy = status === "queued" || status === "running";
  const failed = status === "failed" || status === "failed_recoverable";
  const templates = config?.videoTemplates?.length ? config.videoTemplates : [];
  const activeTemplate = templates.find((template) => template.id === form.templateId) || templates[0];
  const missing = [
    config?.provider === "xiaomi" ? (!config?.hasXiaomiKey ? "Xiaomi API key" : "") : (!config?.hasMiniMaxKey ? "MiniMax API key" : ""),
    (config?.media?.ttsProvider === "google" || config?.media?.imageProvider === "google") && !config?.hasGoogleKey ? "Google API key" : "",
    !config?.llm?.configured ? "LLM API key" : "",
    !config?.search?.configured ? "Tavily search key" : ""
  ].filter(Boolean);
  return (
    <section className="page-grid">
      <div className="glass-card content-panel">
        <p className="section-kicker">Generate</p>
        <h2>Plan a story topic</h2>
        <form onSubmit={onSubmit} className="stack-form">
          <label>
            Story Topic
            <input
              value={form.topic}
              onChange={(event) => setForm({ ...form, topic: event.target.value })}
              placeholder="Example: A Rainy Day in London"
            />
          </label>
          <label>
            Video Template
            <select
              value={form.templateId || DEFAULT_TEMPLATE_ID}
              onChange={(event) => setForm({ ...form, templateId: event.target.value })}
            >
              {templates.map((template) => (
                <option key={template.id} value={template.id}>{template.title}</option>
              ))}
            </select>
          </label>
          {activeTemplate && (
            <div className="template-summary">
              <strong>{activeTemplate.contentMode === "factual-documentary" ? "Factual documentary" : "Story mode"}</strong>
              <span>{activeTemplate.summary}</span>
            </div>
          )}
          <label>
            Target Minutes
            <input
              value="15"
              min="15"
              max="15"
              step="1"
              type="number"
              disabled
            />
          </label>
          <button className="primary-action" type="submit" disabled={busy}>
            {!apiReady
              ? "Configure API Keys"
              : busy && !confirmed
                ? "Generating Draft..."
                : busy
                  ? "Submitting Video Job..."
                  : confirmed
                    ? "Confirm Draft And Generate Video"
                    : "Generate Review Draft"}
          </button>
          {missing.length > 0 && (
            <p className="form-hint">Required before generation: {missing.join(" and ")}.</p>
          )}
        </form>
      </div>
      <div className="glass-card content-panel">
        <p className="section-kicker">Draft Review</p>
        {draft ? (
          <DraftReview
            draft={draft}
            outline={outline}
            feedback={draftFeedback}
            setFeedback={setDraftFeedback}
            meta={draftMeta}
            onRevise={onRevise}
          />
        ) : busy || failed ? (
          <DraftProgress status={status} logs={logs} />
        ) : (
          <EmptyState title="No draft yet" text="Enter a topic to generate a complete 15-minute draft for review before video production." />
        )}
      </div>
      <PipelinePanel
        title="Generation Steps"
        steps={getPipelineSteps({ logs, status, hasDraft: Boolean(draft), mode: "generate" })}
      />
    </section>
  );
}

function DraftProgress({ status, logs = [] }) {
  const failed = status === "failed" || status === "failed_recoverable";
  const visibleLogs = logs.length ? logs : ["Preparing draft generation..."];
  return (
    <div className={`draft-progress ${failed ? "failed" : ""}`}>
      <div className="draft-progress-orb" aria-hidden="true" />
      <div>
        <h2>{failed ? "Draft generation failed" : "Generating review draft"}</h2>
        <p>
          {failed
            ? "The request stopped before a draft was created. Check the message below, adjust Settings if needed, then try again."
            : "EchoEnglish is searching facts and asking the configured LLM to write the full 15-minute draft. This can take one or two minutes."}
        </p>
      </div>
      <div className="draft-log-list">
        {visibleLogs.slice(-5).map((line, index) => (
          <span key={`${line}-${index}`}>{line}</span>
        ))}
      </div>
    </div>
  );
}

function DraftReview({ draft, outline, feedback, setFeedback, meta, onRevise }) {
  const scenes = draft.sections || [];
  const sentenceCount = scenes.reduce((total, section) => total + (section.sentences?.length || 0), 0);
  return (
    <div className="outline-card draft-review">
      <h2>{draft.title}</h2>
      <p>{draft.summary}</p>
      <div className="chip-row">
        {[draft.template?.title || outline?.template?.title, draft.contentMode || outline?.contentMode, `${scenes.length} scenes`, `${sentenceCount} sentences`, `${meta?.imageTarget || sentenceCount} images`, `${meta?.musicTarget || 3} music tracks`, meta?.autosaved ? "autosaved" : ""].filter(Boolean).map((item) => (
          <span key={item}>{item}</span>
        ))}
      </div>
      {meta?.autosaved?.draftJson && (
        <div className="autosave-note">
          <strong>Draft autosaved</strong>
          <a href={meta.autosaved.draftJson} target="_blank" rel="noreferrer">draft.json</a>
          <a href={meta.autosaved.draftMd} target="_blank" rel="noreferrer">draft.md</a>
        </div>
      )}
      <div className="draft-scenes">
        {scenes.slice(0, 10).map((section, index) => (
          <div className="draft-scene" key={`${section.title}-${index}`}>
            <strong>{String(index + 1).padStart(2, "0")} · {section.title}</strong>
            <span>{(section.sentences || []).join(" ")}</span>
          </div>
        ))}
      </div>
      <label className="revision-box">
        Revision Notes
        <textarea
          value={feedback}
          onChange={(event) => setFeedback(event.target.value)}
          placeholder="Example: Make it more factual, add the March 2024 SU7 launch, remove fictional characters, simplify vocabulary."
        />
      </label>
      <button className="ghost-action" type="button" onClick={onRevise} disabled={!feedback.trim()}>
        Revise Draft With Notes
      </button>
    </div>
  );
}

function OutlineCard({ outline }) {
  return (
    <div className="outline-card">
      <h2>{outline.title}</h2>
      <p>{outline.summary}</p>
      <div className="chip-row">
        {[outline.genre, outline.mainCharacter, outline.setting, outline.source].filter(Boolean).map((item) => (
          <span key={item}>{item}</span>
        ))}
      </div>
      <ol className="beat-list">
        {(outline.storyBeats || []).slice(0, 8).map((beat) => <li key={beat}>{beat}</li>)}
      </ol>
    </div>
  );
}

function PreviewPage({ output }) {
  const slug = slugFromOutputs(output?.outputs);
  const [videoVersion, setVideoVersion] = useState(0);
  const [rerenderState, setRerenderState] = useState("");
  const [stats, setStats] = useState(null);

  useEffect(() => {
    setVideoVersion(0);
    setRerenderState("");
    setStats(null);
    if (!output?.outputs?.scriptJson) return undefined;
    let cancelled = false;
    Promise.all([
      fetchJson(`/api/media-info?path=${encodeURIComponent(output.outputs.video)}`).catch(() => ({ durationSeconds: 0 })),
      fetchJson(output.outputs.scriptJson).catch(() => null)
    ]).then(([media, script]) => {
      if (cancelled) return;
      const sections = script?.sections || [];
      const sentenceCount = sections.reduce((total, section) => total + (section.sentences?.length || 0), 0);
      const vocabularyCount = Array.isArray(script?.vocabularyReview)
        ? script.vocabularyReview.length
        : sections.reduce((total, section) => total + (section.vocabulary?.length || 0), 0);
      setStats({
        duration: media.durationSeconds || 0,
        sentenceCount,
        vocabularyCount
      });
    });
    return () => {
      cancelled = true;
    };
  }, [output?.outputs?.scriptJson, output?.outputs?.video]);

  async function handleRerenderUi() {
    if (!slug) return;
    setRerenderState("Re-rendering slides and final MP4. No model APIs are called.");
    try {
      const result = await fetchJson(`/api/outputs/${encodeURIComponent(slug)}/rerender-ui`, { method: "POST" });
      setRerenderState(`Re-rendered ${result.frameCount || 0} frames. Video refreshed.`);
      setVideoVersion(Date.now());
    } catch (error) {
      setRerenderState(error.message);
    }
  }

  return (
    <section className="glass-card content-panel preview-panel">
      <div className="panel-title-row">
        <div>
          <p className="section-kicker">Preview</p>
          <h2>{output?.title || "No video selected"}</h2>
        </div>
        {output?.outputs?.video && (
          <button className="ghost-action" type="button" onClick={handleRerenderUi}>
            Re-render Video UI
          </button>
        )}
      </div>
      {output?.outputs?.video && (
        <div className="preview-stats">
          <span>Duration: {formatTime(stats?.duration || 0)}</span>
          <span>Sentences: {stats?.sentenceCount || 0}</span>
          <span>Vocabulary: {stats?.vocabularyCount || 0}</span>
        </div>
      )}
      {rerenderState && <p className="preview-message">{rerenderState}</p>}
      {output?.outputs?.video ? (
        <VideoPlayer src={output.outputs.video} cacheKey={videoVersion} title={output.title} />
      ) : (
        <EmptyState title="Select or generate a video" text="Open a recent output or generate a new story to preview final.mp4 here." />
      )}
    </section>
  );
}

function VideoPlayer({ src, title, cacheKey = 0 }) {
  const videoRef = useRef(null);
  const scrubberRef = useRef(null);
  const draggingRef = useRef(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    setTime(0);
    setDuration(0);
    const video = videoRef.current;
    if (video) {
      video.load();
    }
    let cancelled = false;
    fetchJson(`/api/media-info?path=${encodeURIComponent(src)}`)
      .then((info) => {
        if (!cancelled && info.durationSeconds) setDuration(info.durationSeconds);
      })
      .catch(() => null);
    return () => {
      cancelled = true;
    };
  }, [src, cacheKey]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return undefined;
    const syncDuration = () => {
      if (Number.isFinite(video.duration) && video.duration > 0) {
        setDuration(video.duration);
      }
    };
    const syncTime = () => setTime(video.currentTime || 0);
    video.addEventListener("loadedmetadata", syncDuration);
    video.addEventListener("durationchange", syncDuration);
    video.addEventListener("canplay", syncDuration);
    video.addEventListener("timeupdate", syncTime);
    syncDuration();
    return () => {
      video.removeEventListener("loadedmetadata", syncDuration);
      video.removeEventListener("durationchange", syncDuration);
      video.removeEventListener("canplay", syncDuration);
      video.removeEventListener("timeupdate", syncTime);
    };
  }, [src, cacheKey]);

  function seekTo(nextTime) {
    const video = videoRef.current;
    if (!video) return;
    const safeTime = Math.min(duration || 0, Math.max(0, Number(nextTime) || 0));
    video.currentTime = safeTime;
    setTime(safeTime);
  }

  function seekFromClientX(clientX) {
    const node = scrubberRef.current;
    if (!node || !duration) return;
    const rect = node.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    seekTo(ratio * duration);
  }

  function handleScrubberPointerDown(event) {
    if (!duration) return;
    draggingRef.current = true;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    seekFromClientX(event.clientX);
  }

  function handleScrubberPointerMove(event) {
    if (!draggingRef.current) return;
    seekFromClientX(event.clientX);
  }

  function stopScrubberDrag(event) {
    draggingRef.current = false;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  }

  function handleScrubberKeyDown(event) {
    if (!duration) return;
    const step = event.shiftKey ? 10 : 5;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      seekTo(time - step);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      seekTo(time + step);
    } else if (event.key === "Home") {
      event.preventDefault();
      seekTo(0);
    } else if (event.key === "End") {
      event.preventDefault();
      seekTo(duration);
    }
  }

  const ratio = duration ? (time / duration) * 100 : 0;

  return (
    <div className="video-stage">
      <video
        ref={videoRef}
        src={cacheKey ? `${src}?ui=${cacheKey}` : src}
        controls
        playsInline
        onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)}
        onLoadedMetadata={(event) => setDuration(event.currentTarget.duration || 0)}
        onDurationChange={(event) => setDuration(event.currentTarget.duration || duration || 0)}
      />
      <div className="scrubber-shell">
        <div
          ref={scrubberRef}
          className="scrubber"
          role="slider"
          tabIndex={0}
          aria-valuemin={0}
          aria-valuemax={Math.round(duration || 0)}
          aria-valuenow={Math.round(time || 0)}
          aria-label="Video progress"
          onPointerDown={handleScrubberPointerDown}
          onPointerMove={handleScrubberPointerMove}
          onPointerUp={stopScrubberDrag}
          onPointerCancel={stopScrubberDrag}
          onKeyDown={handleScrubberKeyDown}
          style={{ "--progress": `${ratio}%` }}
        >
          <span className="scrubber-fill" />
          <span className="scrubber-thumb" />
        </div>
        <div className="time-row">
          <span>{formatTime(time)}</span>
          <span>{formatTime(duration)}</span>
        </div>
      </div>
    </div>
  );
}

function OutputsPage({ output }) {
  return (
    <section className="glass-card content-panel">
      <p className="section-kicker">Outputs</p>
      <h2>{output?.title || "No output selected"}</h2>
      {output?.outputs ? (
        <div className="output-grid">
          {Object.entries(OUTPUT_LABELS).map(([key, label]) => output.outputs[key] && (
            <a key={key} className="output-link" href={output.outputs[key]} target="_blank" rel="noreferrer">
              <strong>{label}</strong>
              <span>{fileName(output.outputs[key])}</span>
            </a>
          ))}
        </div>
      ) : (
        <EmptyState title="No files yet" text="Generate a new video or choose a recent output." />
      )}
    </section>
  );
}

function RecentPage({ items, refresh, openRecent }) {
  async function renameOutput(item) {
    const title = window.prompt("Rename output", item.title || "");
    if (title === null) return;
    const nextTitle = title.trim();
    if (!nextTitle || nextTitle === item.title) return;
    try {
      await fetchJson(`/api/outputs/${encodeURIComponent(item.slug)}`, {
        method: "PATCH",
        body: JSON.stringify({ title: nextTitle })
      });
      await refresh();
    } catch (error) {
      window.alert(error.message);
    }
  }

  async function deleteOutput(item) {
    const ok = window.confirm(`Delete "${item.title}" and all generated files in outputs/${item.slug}?`);
    if (!ok) return;
    try {
      await fetchJson(`/api/outputs/${encodeURIComponent(item.slug)}`, { method: "DELETE" });
      const nextItems = await refresh();
      const first = nextItems?.[0];
      if (first) {
        window.localStorage.setItem("echoenglish:lastOutput", first.slug);
      } else {
        window.localStorage.removeItem("echoenglish:lastOutput");
      }
    } catch (error) {
      window.alert(error.message);
    }
  }

  return (
    <section className="glass-card content-panel">
      <div className="panel-title-row">
        <div>
          <p className="section-kicker">Recent</p>
          <h2>Recent outputs</h2>
        </div>
        <button className="ghost-action" type="button" onClick={refresh}>Refresh</button>
      </div>
      <div className="recent-list">
        {items.length ? items.map((item) => (
          <article key={item.slug} className="recent-row">
            <button className="recent-main" type="button" onClick={() => openRecent(item)}>
              <strong>{item.title}</strong>
              <span>{item.slug}</span>
            </button>
            <div className="recent-meta">
              <span className={`status-dot ${item.status || "completed"}`}>{item.status || "completed"}</span>
              <span>{new Date(item.updatedAt).toLocaleString()}</span>
            </div>
            <div className="recent-actions">
              <button type="button" onClick={() => openRecent(item, "/preview")} disabled={!item.outputs?.video}>Preview</button>
              <button type="button" onClick={() => openRecent(item, "/outputs")}>Outputs</button>
              <button type="button" onClick={() => renameOutput(item)}>Rename</button>
              <button className="danger-action" type="button" onClick={() => deleteOutput(item)}>Delete</button>
            </div>
          </article>
        )) : <EmptyState title="No completed videos" text="Generated videos will appear here." />}
      </div>
    </section>
  );
}

function StatusPage({ status, logs, progress, job, onContinue, onRefresh }) {
  const canContinue = Boolean(job?.id && (status === "failed" || status === "failed_recoverable" || job?.recoverable));
  const failedStage = job?.failedStage ? job.stages?.[job.failedStage]?.label || job.failedStage : null;
  return (
    <section className="glass-card content-panel">
      <p className="section-kicker">Status</p>
      <div className="status-title-row">
        <div>
          <h2>{job?.topic || "Live job status"}</h2>
          {job?.updatedAt && <p>Saved progress: {new Date(job.updatedAt).toLocaleString()}</p>}
          {failedStage && <p>Failed stage: {failedStage}{job?.errorType ? ` · ${job.errorType}` : ""}</p>}
        </div>
        <div className="status-actions">
          {job?.slug && <a className="ghost-action compact-action" href={`/outputs?output=${encodeURIComponent(job.slug)}`}>Open Outputs</a>}
          {job?.outputs?.jobState && <a className="ghost-action compact-action" href={job.outputs.jobState}>Open State JSON</a>}
          {job?.id && <button className="ghost-action compact-action" type="button" onClick={onRefresh}>Refresh State</button>}
          {canContinue && (
            <button className="primary-action compact-action" type="button" onClick={onContinue}>
              Continue Generation
            </button>
          )}
        </div>
      </div>
      <PipelinePanel
        title="Live Generation Steps"
        steps={getPipelineSteps({ logs, status, hasDraft: true, mode: "job", stages: job?.stages })}
      />
      <div className="progress-panel">
        <div className="progress-track"><span style={{ width: `${progress}%` }} /></div>
        <strong>{status} · {progress}%</strong>
      </div>
      {job?.outputs?.jobState && (
        <div className="saved-state-row">
          <span>{job?.recoverable ? "Recoverable failure. Wait for quota/API recovery, then continue generation." : "Progress is saved locally for quota recovery."}</span>
          <a href={job.outputs.jobState}>Open job-state.json</a>
        </div>
      )}
      <pre className="log-box">{logs.join("\n")}</pre>
    </section>
  );
}

function PipelinePanel({ title, steps }) {
  return (
    <div className="pipeline-panel">
      <div className="panel-title-row">
        <div>
          <p className="section-kicker">Pipeline</p>
          <h2>{title}</h2>
        </div>
      </div>
      <div className="pipeline-grid">
        {steps.map((step, index) => (
          <div key={step.id} className={`pipeline-step ${step.state}`}>
            <span>{index + 1}</span>
            <div>
              <strong>{step.label}</strong>
              <small>{step.detail}</small>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SettingsPage({ onSaved }) {
  const [summary, setSummary] = useState(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [settingsType, setSettingsType] = useState("tts");
  const [form, setForm] = useState({
    activeProfile: "balanced",
    provider: "minimax",
    minimaxApiKey: "",
    llmApiKey: "",
    tavilyApiKey: "",
    llmBaseUrl: "",
    llmModel: "",
    models: {
      text: "",
      tts: "",
      image: "",
      music: ""
    },
    minimax: {
      englishVoice: "",
      chineseVoice: "",
      podcastHostAVoice: "",
      podcastHostBVoice: "",
      musicTrackCount: 3
    },
    media: {
      ttsProvider: "minimax",
      imageProvider: "minimax"
    },
    xiaomiApiKey: "",
    xiaomiBaseUrl: "https://token-plan-sgp.xiaomimimo.com/v1",
    xiaomiTextModel: "MiMo-V2.5-Pro",
    xiaomiTtsModel: "MiMo-V2.5-TTS",
    googleApiKey: "",
    googleBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
    googleImageModel: "imagen-4.0-generate-001",
    googleTtsModel: "gemini-2.5-flash-preview-tts",
    googleVoice: "Kore",
    googlePodcastHostAVoice: "Kore",
    googlePodcastHostBVoice: "Puck"
  });

  useEffect(() => {
    loadSettings().catch((error) => setMessage(error.message));
  }, []);

  async function loadSettings() {
    const next = await fetchJson("/api/settings");
    setSummary(next);
    setForm((current) => ({
      ...current,
      activeProfile: next.activeProfile || "balanced",
      provider: next.provider || "minimax",
      llmBaseUrl: next.llm?.baseUrl || "",
      llmModel: next.llm?.model || "",
      models: {
        text: next.models?.text || "",
        tts: next.models?.tts || "",
        image: next.models?.image || "",
        music: next.models?.music || ""
      },
      minimax: {
        englishVoice: next.minimax?.englishVoice || "",
        chineseVoice: next.minimax?.chineseVoice || "",
        podcastHostAVoice: next.minimax?.podcastHostAVoice || next.minimax?.englishVoice || "",
        podcastHostBVoice: next.minimax?.podcastHostBVoice || "",
        musicTrackCount: next.minimax?.musicTrackCount || 3
      },
      media: {
        ttsProvider: next.media?.ttsProvider || "minimax",
        imageProvider: next.media?.imageProvider || "minimax"
      },
      xiaomiBaseUrl: next.xiaomi?.baseUrl || "https://token-plan-sgp.xiaomimimo.com/v1",
      xiaomiTextModel: next.xiaomi?.textModel || "MiMo-V2.5-Pro",
      xiaomiTtsModel: next.xiaomi?.ttsModel || "MiMo-V2.5-TTS",
      googleBaseUrl: next.google?.baseUrl || "https://generativelanguage.googleapis.com/v1beta",
      googleImageModel: next.google?.imageModel || "imagen-4.0-generate-001",
      googleTtsModel: next.google?.ttsModel || "gemini-2.5-flash-preview-tts",
      googleVoice: next.google?.voice || "Kore",
      googlePodcastHostAVoice: next.google?.podcastHostAVoice || next.google?.voice || "Kore",
      googlePodcastHostBVoice: next.google?.podcastHostBVoice || "Puck"
    }));
  }

  function updateModel(key, value) {
    setForm((current) => ({
      ...current,
      models: {
        ...current.models,
        [key]: value
      }
    }));
  }

  function updateMiniMax(key, value) {
    setForm((current) => ({
      ...current,
      minimax: {
        ...current.minimax,
        [key]: key === "musicTrackCount" ? Number(value) : value
      }
    }));
  }

  function applyProfile(profileId) {
    const profile = summary?.profiles?.[profileId];
    setForm((current) => ({
      ...current,
      activeProfile: profileId,
      ...(profile ? {
        llmBaseUrl: profile.llm?.baseUrl || current.llmBaseUrl,
        llmModel: profile.llm?.model || current.llmModel,
        models: {
          text: profile.llm?.model || current.models.text,
          tts: profile.minimax?.tts || current.models.tts,
          image: profile.minimax?.image || current.models.image,
          music: profile.minimax?.music || current.models.music
        },
        minimax: {
          englishVoice: profile.minimax?.englishVoice || current.minimax.englishVoice,
          chineseVoice: profile.minimax?.chineseVoice || current.minimax.chineseVoice,
          podcastHostAVoice: profile.minimax?.podcastHostAVoice || current.minimax.podcastHostAVoice,
          podcastHostBVoice: profile.minimax?.podcastHostBVoice || current.minimax.podcastHostBVoice,
          musicTrackCount: profile.minimax?.musicTrackCount || current.minimax.musicTrackCount
        }
      } : {})
    }));
  }

  async function save(event) {
    event.preventDefault();
    setSaving(true);
    setMessage("Saving local settings...");
    try {
      const next = await fetchJson("/api/settings", {
        method: "POST",
        body: JSON.stringify({
          minimaxApiKey: form.minimaxApiKey,
          provider: form.provider,
          activeProfile: form.activeProfile,
          models: form.models,
          minimax: form.minimax,
          llm: {
            apiKey: form.llmApiKey,
            baseUrl: form.llmBaseUrl,
            model: form.llmModel
          },
          xiaomi: {
            apiKey: form.xiaomiApiKey,
            baseUrl: form.xiaomiBaseUrl,
            textModel: form.xiaomiTextModel,
            ttsModel: form.xiaomiTtsModel
          },
          google: {
            apiKey: form.googleApiKey,
            baseUrl: form.googleBaseUrl,
            imageModel: form.googleImageModel,
            ttsModel: form.googleTtsModel,
            voice: form.googleVoice,
            podcastHostAVoice: form.googlePodcastHostAVoice,
            podcastHostBVoice: form.googlePodcastHostBVoice
          },
          media: form.media,
          search: {
            tavilyApiKey: form.tavilyApiKey
          }
        })
      });
      setSummary(next);
      setForm((current) => ({ ...current, minimaxApiKey: "", llmApiKey: "", tavilyApiKey: "", xiaomiApiKey: "", googleApiKey: "" }));
      setMessage("Settings saved. Story planning now searches with Tavily before the LLM writes the overview and script.");
      await onSaved?.();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setSaving(false);
    }
  }

  async function runTest(kind) {
    setSaving(true);
    const labels = { minimax: "MiniMax", llm: "LLM", tavily: "Tavily search", xiaomi: "Xiaomi", google: "Google" };
    const endpoints = {
      minimax: "/api/settings/test",
      llm: "/api/settings/llm-test",
      tavily: "/api/settings/tavily-test",
      xiaomi: "/api/settings/xiaomi-test",
      google: "/api/settings/google-test"
    };
    setMessage(`Testing ${labels[kind] || "API"} connection...`);
    try {
      const result = await fetchJson(endpoints[kind] || endpoints.minimax, {
        method: "POST",
        body: JSON.stringify({
          minimaxApiKey: form.minimaxApiKey,
          llm: {
            apiKey: form.llmApiKey,
            baseUrl: form.llmBaseUrl,
            model: form.llmModel
          },
          xiaomi: {
            apiKey: form.xiaomiApiKey,
            baseUrl: form.xiaomiBaseUrl,
            textModel: form.xiaomiTextModel
          },
          google: {
            apiKey: form.googleApiKey,
            baseUrl: form.googleBaseUrl,
            imageModel: form.googleImageModel,
            ttsModel: form.googleTtsModel,
            voice: form.googleVoice
          },
          search: {
            tavilyApiKey: form.tavilyApiKey
          }
        })
      });
      setMessage(result.message || "Connection OK.");
    } catch (error) {
      setMessage(error.message);
    } finally {
      setSaving(false);
    }
  }

  async function clearKey(kind) {
    setSaving(true);
    const labels = { minimax: "MiniMax", llm: "LLM", tavily: "Tavily", xiaomi: "Xiaomi", google: "Google" };
    const endpoints = {
      minimax: "/api/settings/key",
      llm: "/api/settings/llm-key",
      tavily: "/api/settings/tavily-key",
      xiaomi: "/api/settings/xiaomi-key",
      google: "/api/settings/google-key"
    };
    setMessage(`Clearing saved ${labels[kind] || "API"} key...`);
    try {
      const next = await fetchJson(endpoints[kind] || endpoints.minimax, {
        method: "DELETE"
      });
      setSummary(next);
      setMessage(`Saved ${labels[kind] || "API"} key cleared.`);
      await onSaved?.();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setSaving(false);
    }
  }

  const modelTypeTabs = [
    { id: "text", label: "Text", helper: "LLM and script", ready: summary?.llm?.hasApiKey },
    { id: "tts", label: "TTS", helper: "Voice engines", ready: getProviderReady(summary, form.media.ttsProvider) },
    { id: "image", label: "Image", helper: "Scene backgrounds", ready: getProviderReady(summary, form.media.imageProvider) },
    { id: "music", label: "Music", helper: "Background music", ready: summary?.hasApiKey },
    { id: "search", label: "Search", helper: "Tavily facts", ready: summary?.search?.hasTavilyKey }
  ];
  const showMiniMax = settingsType === "tts" || settingsType === "image" || settingsType === "music";
  const showXiaomi = settingsType === "text" || settingsType === "tts";
  const showGoogle = settingsType === "tts" || settingsType === "image";
  const showPlanning = settingsType === "text" || settingsType === "search";

  return (
    <form className="settings-layout" onSubmit={save}>
      <section className="glass-card content-panel settings-hero">
        <div>
          <p className="section-kicker">Settings</p>
          <h2>Model type</h2>
          <p>Choose one model type first. The settings below only show the providers and defaults for that type.</p>
        </div>
        <div className="provider-switch">
          {modelTypeTabs.map((provider) => (
            <button
              key={provider.id}
              className={`provider-option ${settingsType === provider.id ? "active" : ""}`}
              type="button"
              onClick={() => setSettingsType(provider.id)}
            >
              <strong>{provider.label}</strong>
              <span>{provider.helper}</span>
              <em>{provider.ready ? "configured" : "key required"}</em>
            </button>
          ))}
        </div>
      </section>

      <section className="settings-grid settings-main-grid">
        <div className="settings-panel">
          <div className="glass-card content-panel settings-panel-group">
            <div className="panel-title-row">
              <div>
                <p className="section-kicker">Provider Keys</p>
                <h2>Media and voice</h2>
              </div>
              <span className="state-pill">settings.local.json</span>
            </div>
            {showMiniMax && (
            <div className={`settings-card ${form.provider === "minimax" || form.media.ttsProvider === "minimax" || form.media.imageProvider === "minimax" ? "provider-active" : ""}`}>
              <div>
                <strong>{settingsType === "music" ? "MiniMax Music" : settingsType === "image" ? "MiniMax Image" : "MiniMax TTS"}</strong>
                <span>{summary?.hasApiKey ? `Saved: ${summary.maskedApiKey}` : "Required for MiniMax media."}</span>
              </div>
              <input
                value={form.minimaxApiKey}
                onChange={(event) => setForm({ ...form, minimaxApiKey: event.target.value })}
                placeholder={summary?.hasApiKey ? "Leave blank to keep saved MiniMax key" : "Paste MiniMax API key"}
                type="password"
              />
              <div className="action-row">
                <button className="ghost-action" type="button" disabled={saving} onClick={() => runTest("minimax")}>Test MiniMax</button>
                <button className="ghost-action danger" type="button" disabled={saving} onClick={() => clearKey("minimax")}>Clear Key</button>
              </div>
            </div>
            )}
            {showXiaomi && (
            <div className={`settings-card ${form.provider === "xiaomi" || form.media.ttsProvider === "xiaomi" ? "provider-active" : ""}`}>
              <div>
                <strong>Xiaomi MiMo</strong>
                <span>{summary?.xiaomi?.hasApiKey ? `Saved: ${summary.xiaomi.maskedApiKey}` : "Optional for text and Xiaomi TTS."}</span>
              </div>
              <input
                value={form.xiaomiApiKey}
                onChange={(event) => setForm({ ...form, xiaomiApiKey: event.target.value })}
                placeholder={summary?.xiaomi?.hasApiKey ? "Leave blank to keep saved Xiaomi key" : "Paste Xiaomi API key"}
                type="password"
              />
              <div className="compact-grid">
                <label>
                  API Base
                  <input
                    value={form.xiaomiBaseUrl}
                    onChange={(event) => setForm({ ...form, xiaomiBaseUrl: event.target.value })}
                    placeholder="https://token-plan-sgp.xiaomimimo.com/v1"
                  />
                </label>
                <label>
                  Text Model
                  <select value={form.xiaomiTextModel} onChange={(event) => setForm({ ...form, xiaomiTextModel: event.target.value })}>
                    {(summary?.xiaomi?.textModels || ["MiMo-V2.5-Pro", "MiMo-V2.5", "MiMo-V2-Pro", "MiMo-V2-Omni"]).map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </label>
                <label>
                  TTS Model
                  <select value={form.xiaomiTtsModel} onChange={(event) => setForm({ ...form, xiaomiTtsModel: event.target.value })}>
                    {(summary?.xiaomi?.ttsModels || ["MiMo-V2.5-TTS-VoiceClone", "MiMo-V2.5-TTS-VoiceDesign", "MiMo-V2.5-TTS", "MiMo-V2-TTS"]).map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="action-row">
                <button className="ghost-action" type="button" disabled={saving} onClick={() => runTest("xiaomi")}>Test Xiaomi</button>
                <button className="ghost-action danger" type="button" disabled={saving} onClick={() => clearKey("xiaomi")}>Clear Key</button>
              </div>
            </div>
            )}
            {showGoogle && (
            <div className={`settings-card ${form.media.ttsProvider === "google" || form.media.imageProvider === "google" ? "provider-active" : ""}`}>
              <div>
                <strong>{settingsType === "image" ? "Google Imagen" : "Google Gemini TTS"}</strong>
                <span>{summary?.google?.hasApiKey ? `Saved: ${summary.google.maskedApiKey}` : "Optional for Google TTS and Imagen backgrounds."}</span>
              </div>
              <input
                value={form.googleApiKey}
                onChange={(event) => setForm({ ...form, googleApiKey: event.target.value })}
                placeholder={summary?.google?.hasApiKey ? "Leave blank to keep saved Google key" : "Paste Google API key"}
                type="password"
              />
              <div className="compact-grid">
                <label>
                  API Base
                  <input
                    value={form.googleBaseUrl}
                    onChange={(event) => setForm({ ...form, googleBaseUrl: event.target.value })}
                    placeholder="https://generativelanguage.googleapis.com/v1beta"
                  />
                </label>
                <label>
                  Imagen Model
                  <input value={form.googleImageModel} onChange={(event) => setForm({ ...form, googleImageModel: event.target.value })} />
                </label>
                <label>
                  TTS Model
                  <input value={form.googleTtsModel} onChange={(event) => setForm({ ...form, googleTtsModel: event.target.value })} />
                </label>
                <label>
                  Voice
                  <select value={form.googleVoice} onChange={(event) => setForm({ ...form, googleVoice: event.target.value })}>
                    {(summary?.google?.voices || ["Kore", "Puck", "Zephyr", "Aoede"]).map((voice) => (
                      <option key={voice} value={voice}>{voice}</option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="action-row">
                <button className="ghost-action" type="button" disabled={saving} onClick={() => runTest("google")}>Test Google</button>
                <button className="ghost-action danger" type="button" disabled={saving} onClick={() => clearKey("google")}>Clear Key</button>
              </div>
            </div>
            )}
          </div>

          {showPlanning && (
          <div className="glass-card content-panel settings-panel-group">
            <p className="section-kicker">Planning Services</p>
            <h2>{settingsType === "search" ? "Search provider" : "Text planning"}</h2>
            {settingsType === "search" && (
            <div className="settings-card">
              <div>
                <strong>Tavily Search</strong>
                <span>{summary?.search?.hasTavilyKey ? `Saved: ${summary.search.maskedTavilyKey}` : "Required before story planning."}</span>
              </div>
              <input
                value={form.tavilyApiKey}
                onChange={(event) => setForm({ ...form, tavilyApiKey: event.target.value })}
                placeholder={summary?.search?.hasTavilyKey ? "Leave blank to keep saved Tavily key" : "Paste Tavily API key"}
                type="password"
              />
              <div className="action-row">
                <button className="ghost-action" type="button" disabled={saving} onClick={() => runTest("tavily")}>Test Tavily</button>
                <button className="ghost-action danger" type="button" disabled={saving} onClick={() => clearKey("tavily")}>Clear Key</button>
              </div>
            </div>
            )}
            {settingsType === "text" && (
            <div className="settings-card">
              <div>
                <strong>Fallback LLM</strong>
                <span>{summary?.llm?.hasApiKey ? `Saved: ${summary.llm.maskedApiKey}` : "Used when MiniMax provider is active."}</span>
              </div>
              <input
                value={form.llmApiKey}
                onChange={(event) => setForm({ ...form, llmApiKey: event.target.value })}
                placeholder={summary?.llm?.hasApiKey ? "Leave blank to keep saved LLM key" : "Paste LLM API key"}
                type="password"
              />
              <div className="compact-grid">
                <label>
                  API Base
                  <input value={form.llmBaseUrl} onChange={(event) => setForm({ ...form, llmBaseUrl: event.target.value })} />
                </label>
                <label>
                  Model
                  <input value={form.llmModel} onChange={(event) => setForm({ ...form, llmModel: event.target.value })} />
                </label>
              </div>
              <div className="action-row">
                <button className="ghost-action" type="button" disabled={saving} onClick={() => runTest("llm")}>Test LLM</button>
                <button className="ghost-action danger" type="button" disabled={saving} onClick={() => clearKey("llm")}>Clear Key</button>
              </div>
            </div>
            )}
          </div>
          )}
        </div>

        <aside className="glass-card content-panel settings-panel settings-sidebar">
          <div>
            <p className="section-kicker">Profiles</p>
            <h2>Generation defaults</h2>
          </div>
          <label>
            Model Profile
            <select value={form.activeProfile} onChange={(event) => applyProfile(event.target.value)}>
              {Object.entries(summary?.profiles || {}).map(([id, profile]) => (
                <option key={id} value={id}>{profile.label}</option>
              ))}
            </select>
          </label>
          <div className="settings-note">
            <strong>{modelTypeTabs.find((item) => item.id === settingsType)?.label} defaults</strong>
            <span>
              {settingsType === "text" && `Script engine: ${form.provider === "xiaomi" ? "Xiaomi MiMo" : "Fallback LLM"}.`}
              {settingsType === "tts" && `Voice engine: ${form.media.ttsProvider}.`}
              {settingsType === "image" && `Scene image engine: ${form.media.imageProvider}.`}
              {settingsType === "music" && "Background music currently uses MiniMax."}
              {settingsType === "search" && "Search grounding currently uses Tavily."}
            </span>
          </div>
          <div className="model-grid">
            {settingsType === "text" && (
              <>
                <label>
                  Text Engine
                  <select value={form.provider} onChange={(event) => setForm({ ...form, provider: event.target.value })}>
                    <option value="minimax">Fallback LLM</option>
                    <option value="xiaomi">Xiaomi MiMo</option>
                  </select>
                </label>
                <label>
                  Fallback Text Model
                  <input value={form.models.text} onChange={(event) => updateModel("text", event.target.value)} />
                </label>
                <label>
                  Xiaomi Text Model
                  <select value={form.xiaomiTextModel} onChange={(event) => setForm({ ...form, xiaomiTextModel: event.target.value })}>
                    {(summary?.xiaomi?.textModels || ["MiMo-V2.5-Pro", "MiMo-V2.5", "MiMo-V2-Pro", "MiMo-V2-Omni"]).map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </label>
              </>
            )}

            {settingsType === "tts" && (
              <>
                <label>
                  TTS Provider
                  <select value={form.media.ttsProvider} onChange={(event) => setForm({ ...form, media: { ...form.media, ttsProvider: event.target.value } })}>
                    <option value="minimax">MiniMax TTS</option>
                    <option value="xiaomi">Xiaomi TTS</option>
                    <option value="google">Google Gemini TTS</option>
                  </select>
                </label>
                <label>
                  MiniMax TTS Model
                  <input value={form.models.tts} onChange={(event) => updateModel("tts", event.target.value)} />
                </label>
                <label>
                  Xiaomi TTS Model
                  <select value={form.xiaomiTtsModel} onChange={(event) => setForm({ ...form, xiaomiTtsModel: event.target.value })}>
                    {(summary?.xiaomi?.ttsModels || ["MiMo-V2.5-TTS-VoiceClone", "MiMo-V2.5-TTS-VoiceDesign", "MiMo-V2.5-TTS", "MiMo-V2-TTS"]).map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Google TTS Model
                  <input value={form.googleTtsModel} onChange={(event) => setForm({ ...form, googleTtsModel: event.target.value })} />
                </label>
                <label>
                  English Voice
                  <input value={form.minimax.englishVoice} onChange={(event) => updateMiniMax("englishVoice", event.target.value)} />
                </label>
                <label>
                  Podcast Host A Voice
                  <input value={form.minimax.podcastHostAVoice} onChange={(event) => updateMiniMax("podcastHostAVoice", event.target.value)} />
                </label>
                <label>
                  Podcast Host B Voice
                  <input value={form.minimax.podcastHostBVoice} onChange={(event) => updateMiniMax("podcastHostBVoice", event.target.value)} />
                </label>
                <label>
                  Google Voice
                  <select value={form.googleVoice} onChange={(event) => setForm({ ...form, googleVoice: event.target.value })}>
                    {(summary?.google?.voices || ["Kore", "Puck", "Zephyr", "Aoede"]).map((voice) => (
                      <option key={voice} value={voice}>{voice}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Google Podcast Host A
                  <select value={form.googlePodcastHostAVoice} onChange={(event) => setForm({ ...form, googlePodcastHostAVoice: event.target.value })}>
                    {(summary?.google?.voices || ["Kore", "Puck", "Zephyr", "Aoede"]).map((voice) => (
                      <option key={voice} value={voice}>{voice}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Google Podcast Host B
                  <select value={form.googlePodcastHostBVoice} onChange={(event) => setForm({ ...form, googlePodcastHostBVoice: event.target.value })}>
                    {(summary?.google?.voices || ["Kore", "Puck", "Zephyr", "Aoede"]).map((voice) => (
                      <option key={voice} value={voice}>{voice}</option>
                    ))}
                  </select>
                </label>
              </>
            )}

            {settingsType === "image" && (
              <>
                <label>
                  Image Provider
                  <select value={form.media.imageProvider} onChange={(event) => setForm({ ...form, media: { ...form.media, imageProvider: event.target.value } })}>
                    <option value="minimax">MiniMax Image</option>
                    <option value="google">Google Imagen</option>
                  </select>
                </label>
                <label>
                  MiniMax Image Model
                  <input value={form.models.image} onChange={(event) => updateModel("image", event.target.value)} />
                </label>
                <label>
                  Google Imagen Model
                  <input value={form.googleImageModel} onChange={(event) => setForm({ ...form, googleImageModel: event.target.value })} />
                </label>
              </>
            )}

            {settingsType === "music" && (
              <>
                <label>
                  Music Provider
                  <input value="MiniMax Music" readOnly />
                </label>
                <label>
                  Music Model
                  <input value={form.models.music} onChange={(event) => updateModel("music", event.target.value)} />
                </label>
                <label>
                  Music Tracks
                  <select value={form.minimax.musicTrackCount} onChange={(event) => updateMiniMax("musicTrackCount", event.target.value)}>
                    <option value="3">3 tracks</option>
                    <option value="4">4 tracks</option>
                  </select>
                </label>
              </>
            )}

            {settingsType === "search" && (
              <>
                <label>
                  Search Provider
                  <input value="Tavily" readOnly />
                </label>
                <label>
                  Search Usage
                  <input value="Story overview and factual draft grounding" readOnly />
                </label>
              </>
            )}
          </div>
        </aside>
      </section>

      <div className="settings-save-bar glass-card">
        <div>
          <strong>Local settings</strong>
          <span>Saved to settings.local.json. Keys are masked after saving.</span>
        </div>
        <button className="primary-action" type="submit" disabled={saving}>Save Settings</button>
      </div>
      {message && <p className="settings-message">{message}</p>}
    </form>
  );
}

function EmptyState({ title, text }) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      <span>{text}</span>
    </div>
  );
}

function BackgroundGlow() {
  return (
    <div className="background-glow" aria-hidden="true">
      <span />
      <span />
    </div>
  );
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) throw new Error(data.error || `Request failed: ${response.status}`);
  return data;
}

function normalizeRoute(pathname) {
  if (["/generate", "/preview", "/outputs", "/recent", "/status", "/settings"].includes(pathname)) return pathname;
  return "/generate";
}

function slugFromOutputs(outputs) {
  const match = outputs?.video?.match(/\/outputs\/([^/]+)\//);
  return match ? decodeURIComponent(match[1]) : "";
}

function getProgress(logs, status) {
  if (status === "completed") return 100;
  if (status === "failed") return 100;
  let progress = 8;
  for (let i = (logs || []).length - 1; i >= 0; i -= 1) {
    const text = logs[i];
    const audioMatch = text.match(/Audio (\d+)\/(\d+)/);
    const frameMatch = text.match(/Rendering frame (\d+)\/(\d+)/);
    if (text.includes("Encoding final MP4")) return 96;
    if (text.includes("background music") || text.includes("Background music ready")) return 58;
    if (frameMatch) return 62 + Math.floor((Number(frameMatch[1]) / Number(frameMatch[2])) * 32);
    if (text.includes("Generating scene images")) return 54;
    if (audioMatch) return 12 + Math.floor((Number(audioMatch[1]) / Number(audioMatch[2])) * 42);
  }
  return progress;
}

function getPipelineSteps({ logs = [], status = "idle", hasDraft = false, mode = "generate", stages = null }) {
  if (mode === "job" && stages) {
    const ordered = ["draft", "script-assets", "tts", "images", "music", "compose", "quality"];
    return ordered.map((id) => {
      const stage = stages[id] || {};
      return makeStep(
        id,
        stage.label || id,
        formatStageDetail(stage),
        normalizeStageState(stage.status, status)
      );
    });
  }

  const text = (logs || []).join("\n").toLowerCase();
  const failed = status === "failed" || status === "failed_recoverable";
  if (mode === "generate" && !text.includes("audio") && !text.includes("image") && !text.includes("music") && !text.includes("mp4")) {
    return [
      makeStep("search", "Tavily Search", "Collect topic context and factual sources.", stepState({ failed, active: status === "queued" && text.includes("search"), complete: hasDraft || text.includes("search context ready") })),
      makeStep("draft", "LLM Draft", "Write the full 15-minute review draft.", stepState({ failed, active: status === "queued" && text.includes("draft"), complete: hasDraft || text.includes("draft generated") })),
      makeStep("review", "Draft Review", "Revise or confirm before video rendering.", stepState({ failed, active: hasDraft && status !== "queued", complete: text.includes("confirmed") }))
    ];
  }

  return [
    makeStep("prepare", "Prepare", "Load confirmed draft and output folder.", stepState({ failed, active: text.includes("preparing") || status === "queued", complete: text.includes("generating audio") || text.includes("audio ") })),
    makeStep("narration", "Narration", "Generate sentence-level TTS and timings.", stepState({ failed, active: text.includes("generating audio") || /audio \d+\/\d+/.test(text), complete: text.includes("tts api requests") || text.includes("merging") })),
    makeStep("images", "Scene Images", "Generate one background per sentence.", stepState({ failed, active: text.includes("generating scene images") || text.includes("image api requests") || text.includes("rendering frame"), complete: text.includes("generating background music") || text.includes("background music") || text.includes("composing final mp4") })),
    makeStep("music", "Music", "Create and merge 3-4 background tracks.", stepState({ failed, active: text.includes("background music"), complete: text.includes("background music ready") || text.includes("composing final mp4") })),
    makeStep("compose", "Compose MP4", "Mix audio, captions, images, and music.", stepState({ failed, active: text.includes("composing final mp4") || text.includes("encoding final mp4"), complete: text.includes("quality report") || status === "completed" })),
    makeStep("quality", "Quality Report", "Check duration, image count, music, and warnings.", stepState({ failed, active: text.includes("quality report"), complete: status === "completed" }))
  ];
}

function makeStep(id, label, detail, state) {
  return { id, label, detail, state };
}

function formatStageDetail(stage = {}) {
  const counts = stage.counts;
  const countText = counts && Number.isFinite(Number(counts.total))
    ? ` · ${Number(counts.completed || 0)}/${Number(counts.total || 0)}`
    : counts && Number.isFinite(Number(counts.sentences))
      ? ` · ${Number(counts.sentences)} sentences`
      : "";
  const errorText = stage.error ? ` · ${stage.errorType || "error"}` : "";
  return `${stage.detail || "Generation stage."}${countText}${errorText}`;
}

function normalizeStageState(stageStatus, jobStatus) {
  if (stageStatus === "completed" || stageStatus === "skipped") return "complete";
  if (stageStatus === "running") return "active";
  if (stageStatus === "failed") return "failed";
  if (jobStatus === "failed" || jobStatus === "failed_recoverable") return "pending";
  return "pending";
}

function stepState({ failed, active, complete }) {
  if (failed) return "failed";
  if (complete) return "complete";
  if (active) return "active";
  return "queued";
}

function clampMinutes(value) {
  return 15;
}

function formatTime(seconds) {
  const total = Math.max(0, Math.floor(seconds || 0));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

function fileName(url) {
  return decodeURIComponent(String(url).split("/").pop() || url);
}

function formatSavedAt(value) {
  try {
    return new Date(value).toLocaleString();
  } catch {
    return "the last browser session";
  }
}

createRoot(document.getElementById("root")).render(<App />);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => null);
  });
}
