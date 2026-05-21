import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import LiquidGlass from "liquid-glass-react";
import "./styles.css";

const NAV_ITEMS = [
  { path: "/generate", label: "Generate", helper: "Plan" },
  { path: "/preview", label: "Preview", helper: "Video" },
  { path: "/outputs", label: "Outputs", helper: "Files" },
  { path: "/recent", label: "Recent", helper: "Library" },
  { path: "/status", label: "Status", helper: "Logs" },
  { path: "/settings", label: "Settings", helper: "API", external: true }
];

const OUTPUT_LABELS = {
  video: "Final Video",
  script: "Readable Script",
  subtitles: "Subtitles",
  audio: "Narration",
  music: "Background Music",
  imagePrompts: "Scene Prompts",
  scriptJson: "Structured Data"
};

function App() {
  const [route, setRoute] = useState(() => normalizeRoute(window.location.pathname));
  const [query, setQuery] = useState(() => new URLSearchParams(window.location.search));
  const [config, setConfig] = useState(null);
  const [recent, setRecent] = useState([]);
  const [currentOutput, setCurrentOutput] = useState(null);
  const [outline, setOutline] = useState(null);
  const [outlineTopic, setOutlineTopic] = useState("");
  const [job, setJob] = useState(null);
  const [logs, setLogs] = useState(["Waiting for a generation job."]);
  const [status, setStatus] = useState("idle");
  const [form, setForm] = useState({ topic: "A Rainy Day in London", minutes: "15" });

  const outputSlug = query.get("output");
  const jobId = query.get("jobId");
  const apiReady = Boolean(config?.hasMiniMaxKey);

  useEffect(() => {
    fetchJson("/api/config").then(setConfig).catch(() => setConfig({ hasMiniMaxKey: false }));
    loadRecentOutputs();
  }, []);

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
    if (found) setCurrentOutput(found);
  }, [outputSlug, recent]);

  useEffect(() => {
    if (!jobId || job?.id === jobId) return;
    setJob({ id: jobId, status: "queued", topic: "Story Video", logs: ["Reconnecting to job..."] });
    setStatus("queued");
  }, [jobId]);

  useEffect(() => {
    if (!job?.id || ["completed", "failed", "idle"].includes(job.status)) return undefined;
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
    if (path === "/settings") {
      window.location.href = "/settings";
      return;
    }
    const search = new URLSearchParams(params).toString();
    const url = search ? `${path}?${search}` : path;
    window.history.pushState(null, "", url);
    setRoute(normalizeRoute(path));
    setQuery(new URLSearchParams(search));
  }

  async function handleGenerateSubmit(event) {
    event.preventDefault();
    if (!apiReady) {
      window.location.href = "/settings";
      return;
    }
    const topic = form.topic.trim() || "A Rainy Day in London";
    const minutes = String(clampMinutes(form.minutes));

    if (!outline || outlineTopic !== topic) {
      setStatus("queued");
      setLogs(["Generating story overview for confirmation..."]);
      const result = await fetchJson("/api/story-outline", {
        method: "POST",
        body: JSON.stringify({ topic, minutes })
      });
      setOutline(result.outline);
      setOutlineTopic(topic);
      setStatus("idle");
      setLogs(["Review the story overview, then confirm to generate the video."]);
      return;
    }

    setStatus("queued");
    setLogs(["Confirmed. Generating pure story video..."]);
    const started = await fetchJson("/api/generate-story-video", {
      method: "POST",
      body: JSON.stringify({ topic, minutes, outline })
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
  }

  function openRecent(item, path = "/preview") {
    setCurrentOutput(item);
    navigate(path, { output: item.slug });
  }

  const progress = getProgress(logs, status);
  const activeOutput = currentOutput || (outputSlug ? recent.find((item) => item.slug === outputSlug) : null);

  return (
    <div className="app-shell">
      <BackgroundGlow />
      <GlassNavigation route={route} navigate={navigate} />
      <main className="page-shell">
        <AppHeader config={config} status={status} />
        {route === "/generate" && (
          <GeneratePage
            form={form}
            setForm={(next) => {
              setForm(next);
              setOutline(null);
              setOutlineTopic("");
            }}
            outline={outline}
            apiReady={apiReady}
            onSubmit={handleGenerateSubmit}
          />
        )}
        {route === "/preview" && <PreviewPage output={activeOutput} />}
        {route === "/outputs" && <OutputsPage output={activeOutput} />}
        {route === "/recent" && <RecentPage items={recent} refresh={loadRecentOutputs} openRecent={openRecent} />}
        {route === "/status" && <StatusPage status={status} logs={logs} progress={progress} job={job} />}
      </main>
    </div>
  );
}

function AppHeader({ config, status }) {
  return (
    <header className="app-header glass-card">
      <div>
        <p className="eyebrow">English Story Video Generator</p>
        <h1>Pure story videos, generated locally.</h1>
      </div>
      <div className="header-badges">
        <span className={`state-pill ${config?.hasMiniMaxKey ? "ok" : "warn"}`}>
          {config?.hasMiniMaxKey ? "API configured" : "API key required"}
        </span>
        <span className="state-pill">{status}</span>
      </div>
    </header>
  );
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
          const button = (
            <button
              className={`nav-button ${active ? "active" : ""}`}
              type="button"
              onClick={() => navigate(item.path)}
            >
              <strong>{item.label}</strong>
              <small>{item.helper}</small>
            </button>
          );
          return (
            <LiquidGlass
              key={item.path}
              className={`liquid-wrap ${active ? "active" : ""}`}
              displacementScale={active ? 80 : 54}
              blurAmount={0.12}
              saturation={145}
              aberrationIntensity={active ? 2.2 : 1.2}
              elasticity={0.18}
              cornerRadius={26}
              padding="0"
              mode="prominent"
            >
              {button}
            </LiquidGlass>
          );
        })}
      </div>
    </nav>
  );
}

function GeneratePage({ form, setForm, outline, apiReady, onSubmit }) {
  const confirmed = Boolean(outline && outline.title);
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
            Target Minutes
            <input
              value={form.minutes}
              min="15"
              max="20"
              step="1"
              type="number"
              onChange={(event) => setForm({ ...form, minutes: event.target.value })}
            />
          </label>
          <button className="primary-action" type="submit">
            {!apiReady ? "Configure API Key" : confirmed ? "Confirm Overview And Generate Video" : "Generate Story Overview"}
          </button>
        </form>
      </div>
      <div className="glass-card content-panel">
        <p className="section-kicker">Overview</p>
        {outline ? <OutlineCard outline={outline} /> : <EmptyState title="No overview yet" text="Enter any topic, then generate a story overview for confirmation." />}
      </div>
    </section>
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
  return (
    <section className="glass-card content-panel preview-panel">
      <p className="section-kicker">Preview</p>
      <h2>{output?.title || "No video selected"}</h2>
      {output?.outputs?.video ? (
        <VideoPlayer src={output.outputs.video} title={output.title} />
      ) : (
        <EmptyState title="Select or generate a video" text="Open a recent output or generate a new story to preview final.mp4 here." />
      )}
    </section>
  );
}

function VideoPlayer({ src, title }) {
  const videoRef = useRef(null);
  const trackRef = useRef(null);
  const wasPlaying = useRef(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    setTime(0);
    setDuration(0);
  }, [src]);

  function seekFromPointer(event) {
    const video = videoRef.current;
    const track = trackRef.current;
    if (!video || !track || !duration) return;
    const rect = track.getBoundingClientRect();
    const clientX = event.touches?.[0]?.clientX ?? event.clientX;
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    video.currentTime = ratio * duration;
    setTime(video.currentTime);
  }

  function startDrag(event) {
    const video = videoRef.current;
    if (!video) return;
    wasPlaying.current = !video.paused;
    setDragging(true);
    video.pause();
    seekFromPointer(event);
  }

  function moveDrag(event) {
    if (!dragging) return;
    seekFromPointer(event);
  }

  function endDrag() {
    const video = videoRef.current;
    setDragging(false);
    if (wasPlaying.current && video) video.play().catch(() => null);
  }

  const ratio = duration ? (time / duration) * 100 : 0;

  return (
    <div className="video-stage">
      <video
        ref={videoRef}
        src={src}
        controls
        playsInline
        title={title}
        onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)}
        onLoadedMetadata={(event) => setDuration(event.currentTarget.duration || 0)}
      />
      <div className="scrubber-shell">
        <div
          className="scrubber"
          ref={trackRef}
          onMouseDown={startDrag}
          onMouseMove={moveDrag}
          onMouseUp={endDrag}
          onMouseLeave={endDrag}
          onTouchStart={startDrag}
          onTouchMove={moveDrag}
          onTouchEnd={endDrag}
          role="slider"
          aria-label="Video progress"
          aria-valuemin="0"
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(time)}
        >
          <span className="scrubber-fill" style={{ width: `${ratio}%` }} />
          <span className="scrubber-thumb" style={{ left: `${ratio}%` }} />
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
  return (
    <section className="glass-card content-panel">
      <div className="panel-title-row">
        <div>
          <p className="section-kicker">Recent</p>
          <h2>Recent outputs</h2>
        </div>
        <button className="ghost-action" type="button" onClick={refresh}>Refresh</button>
      </div>
      <div className="recent-grid">
        {items.length ? items.map((item) => (
          <button key={item.slug} className="recent-card" type="button" onClick={() => openRecent(item)}>
            <strong>{item.title}</strong>
            <span>{new Date(item.updatedAt).toLocaleString()}</span>
          </button>
        )) : <EmptyState title="No completed videos" text="Generated videos will appear here." />}
      </div>
    </section>
  );
}

function StatusPage({ status, logs, progress, job }) {
  return (
    <section className="glass-card content-panel">
      <p className="section-kicker">Status</p>
      <h2>{job?.topic || "Live job status"}</h2>
      <div className="progress-panel">
        <div className="progress-track"><span style={{ width: `${progress}%` }} /></div>
        <strong>{status} · {progress}%</strong>
      </div>
      <pre className="log-box">{logs.join("\n")}</pre>
    </section>
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
  if (["/generate", "/preview", "/outputs", "/recent", "/status"].includes(pathname)) return pathname;
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
    if (text.includes("Generating background music") || text.includes("Background music ready")) return 58;
    if (frameMatch) return 62 + Math.floor((Number(frameMatch[1]) / Number(frameMatch[2])) * 32);
    if (text.includes("Generating scene images")) return 54;
    if (audioMatch) return 12 + Math.floor((Number(audioMatch[1]) / Number(audioMatch[2])) * 42);
  }
  return progress;
}

function clampMinutes(value) {
  const minutes = Number(value || 15);
  if (!Number.isFinite(minutes)) return 15;
  return Math.min(20, Math.max(15, Math.round(minutes)));
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

createRoot(document.getElementById("root")).render(<App />);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => null);
  });
}
