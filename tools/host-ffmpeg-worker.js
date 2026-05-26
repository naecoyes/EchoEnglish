#!/usr/bin/env node
/**
 * Host FFmpeg Worker
 *
 * Runs on the Mac host (NOT inside Docker). Docker containers send ffmpeg
 * commands here via HTTP, and this worker executes them using the host's
 * ffmpeg (with VideoToolbox / Apple Silicon GPU support).
 *
 * Usage:
 *   HOST_FFMPEG_WORKER_HOST=0.0.0.0 \
 *   HOST_FFMPEG_TOKEN=change-me \
 *   HOST_FFMPEG_BIN=/opt/homebrew/bin/ffmpeg \
 *   HOST_FFMPEG_PATH_MAPS="/app/outputs=/Users/Mac/Downloads/ShadowingEnglishVideo/outputs" \
 *   node tools/host-ffmpeg-worker.js
 *
 * Docker containers call:
 *   POST http://host.docker.internal:4869/run-ffmpeg
 *   Header: x-ffmpeg-worker-token: change-me
 *   Body:   { "args": ["-y", "-i", "/app/outputs/slides/concat.txt", ...] }
 */

"use strict";

const http = require("node:http");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);

// ── Configuration ────────────────────────────────────────────────────────────
const PORT     = Number(process.env.HOST_FFMPEG_WORKER_PORT || 4869);
const HOST     = process.env.HOST_FFMPEG_WORKER_HOST || "127.0.0.1";
const TOKEN    = process.env.HOST_FFMPEG_TOKEN || "";
const FFMPEG   = process.env.HOST_FFMPEG_BIN || "/opt/homebrew/bin/ffmpeg";

/**
 * PATH_MAPS: semicolon-separated pairs of "container_path=host_path"
 * Example:
 *   /app/outputs=/Users/Mac/Downloads/ShadowingEnglishVideo/outputs;/data/media=/Users/Mac/Projects/OtherApp/media
 */
const PATH_MAPS = parseMaps(process.env.HOST_FFMPEG_PATH_MAPS || "");

// ── Helpers ──────────────────────────────────────────────────────────────────
function parseMaps(raw) {
  if (!raw.trim()) return [];
  return raw
    .split(";")
    .map((pair) => pair.trim())
    .filter(Boolean)
    .map((pair) => {
      const eq = pair.indexOf("=");
      if (eq < 0) throw new Error(`Invalid PATH_MAP entry: "${pair}". Expected "container_path=host_path".`);
      return {
        container: pair.slice(0, eq).trimEnd(),
        host: pair.slice(eq + 1).trimStart()
      };
    });
}

/**
 * Translate a container-side absolute path to its host equivalent.
 * If no mapping matches, the path is returned unchanged (handles host paths passed directly).
 */
function translatePath(arg) {
  if (typeof arg !== "string" || !arg.startsWith("/")) return arg;
  for (const { container, host } of PATH_MAPS) {
    if (arg === container || arg.startsWith(container + "/")) {
      return host + arg.slice(container.length);
    }
  }
  return arg; // no mapping - pass through (host-native paths work as-is)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function send(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(json)
  });
  res.end(json);
}

// ── Request handler ──────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  // Auth
  if (TOKEN) {
    const provided = req.headers["x-ffmpeg-worker-token"] || "";
    if (provided !== TOKEN) {
      return send(res, 401, { error: "Unauthorized: invalid or missing x-ffmpeg-worker-token" });
    }
  }

  const url = new URL(req.url, `http://${req.headers.host}`);

  // Health check
  if (req.method === "GET" && url.pathname === "/health") {
    return send(res, 200, { ok: true, ffmpeg: FFMPEG, maps: PATH_MAPS });
  }

  // FFmpeg test
  if (req.method === "GET" && url.pathname === "/ffmpeg-version") {
    try {
      const { stdout } = await execFileAsync(FFMPEG, ["-version"], { maxBuffer: 1024 * 512 });
      return send(res, 200, { ok: true, version: stdout.split("\n")[0] });
    } catch (err) {
      return send(res, 500, { error: err.message });
    }
  }

  // Run FFmpeg
  if (req.method === "POST" && url.pathname === "/run-ffmpeg") {
    let body;
    try {
      body = await readBody(req);
    } catch (err) {
      return send(res, 400, { error: err.message });
    }

    if (!Array.isArray(body.args) || body.args.length === 0) {
      return send(res, 400, { error: "\"args\" must be a non-empty array of ffmpeg arguments." });
    }

    // Translate all path-like arguments
    const translatedArgs = body.args.map(translatePath);
    const started = Date.now();

    console.log(`[${new Date().toISOString()}] ffmpeg ${translatedArgs.join(" ")}`);

    try {
      const { stdout, stderr } = await execFileAsync(FFMPEG, translatedArgs, {
        maxBuffer: 1024 * 1024 * 32
      });
      const elapsed = ((Date.now() - started) / 1000).toFixed(1);
      console.log(`[${new Date().toISOString()}] ✓ done in ${elapsed}s`);
      return send(res, 200, { ok: true, elapsedSeconds: Number(elapsed), stdout, stderr });
    } catch (err) {
      const elapsed = ((Date.now() - started) / 1000).toFixed(1);
      console.error(`[${new Date().toISOString()}] ✗ failed in ${elapsed}s — ${err.message}`);
      return send(res, 500, {
        error: err.message,
        stderr: err.stderr || "",
        stdout: err.stdout || "",
        elapsedSeconds: Number(elapsed)
      });
    }
  }

  return send(res, 404, { error: `Unknown endpoint: ${req.method} ${url.pathname}` });
});

// ── Boot ─────────────────────────────────────────────────────────────────────
server.listen(PORT, HOST, () => {
  console.log(`Host FFmpeg Worker running on http://${HOST}:${PORT}`);
  console.log(`  ffmpeg binary : ${FFMPEG}`);
  console.log(`  auth token    : ${TOKEN ? "set ✓" : "NONE (open — set HOST_FFMPEG_TOKEN!)"}`);
  if (PATH_MAPS.length === 0) {
    console.log("  path maps     : none (args passed as-is)");
  } else {
    PATH_MAPS.forEach(({ container, host }) =>
      console.log(`  path map      : ${container}  →  ${host}`)
    );
  }
});

server.on("error", (err) => {
  console.error("Server error:", err.message);
  process.exit(1);
});
