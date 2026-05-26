/**
 * ffmpegGateway.js
 *
 * Drop-in replacement for execFileAsync("ffmpeg", args, ...) that can route
 * ffmpeg calls to either the local binary or a remote Host FFmpeg Worker.
 *
 * Set these env vars to enable the gateway:
 *
 *   FFMPEG_GATEWAY_URL=http://host.docker.internal:4869/run-ffmpeg
 *   FFMPEG_GATEWAY_TOKEN=change-me   (must match HOST_FFMPEG_TOKEN)
 *
 * If FFMPEG_GATEWAY_URL is not set, falls back to the local ffmpeg binary.
 */

"use strict";

const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);

const GATEWAY_URL   = process.env.FFMPEG_GATEWAY_URL || "";
const GATEWAY_TOKEN = process.env.FFMPEG_GATEWAY_TOKEN || "";

/**
 * Run ffmpeg with the given args.
 * Automatically routes to the Host FFmpeg Worker when FFMPEG_GATEWAY_URL is set.
 *
 * @param {string[]} args
 * @param {{ maxBuffer?: number }} [options]
 * @returns {Promise<{ stdout: string; stderr: string }>}
 */
async function runFfmpeg(args, options = {}) {
  if (GATEWAY_URL) {
    return runViaGateway(args);
  }
  return execFileAsync("ffmpeg", args, {
    maxBuffer: options.maxBuffer || 1024 * 1024 * 16
  });
}

async function runViaGateway(args) {
  const headers = { "Content-Type": "application/json" };
  if (GATEWAY_TOKEN) headers["x-ffmpeg-worker-token"] = GATEWAY_TOKEN;

  const response = await fetch(GATEWAY_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({ args })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const msg = payload.error || `HTTP ${response.status}`;
    const err = new Error(`Host FFmpeg Worker error: ${msg}`);
    err.stderr = payload.stderr || "";
    err.stdout = payload.stdout || "";
    throw err;
  }
  return { stdout: payload.stdout || "", stderr: payload.stderr || "" };
}

module.exports = { runFfmpeg };
