#!/bin/bash
# start-ffmpeg-worker.sh
# 启动 Host FFmpeg Worker，供 Docker 容器调用
# 
# 用法：bash tools/start-ffmpeg-worker.sh

set -euo pipefail

HOST_FFMPEG_WORKER_HOST="${HOST_FFMPEG_WORKER_HOST:-0.0.0.0}" \
HOST_FFMPEG_WORKER_PORT="${HOST_FFMPEG_WORKER_PORT:-4869}" \
HOST_FFMPEG_TOKEN="${HOST_FFMPEG_TOKEN:-change-me}" \
HOST_FFMPEG_BIN="${HOST_FFMPEG_BIN:-/opt/homebrew/bin/ffmpeg}" \
HOST_FFMPEG_PATH_MAPS="${HOST_FFMPEG_PATH_MAPS:-/app/outputs=$(pwd)/outputs}" \
  node "$(dirname "$0")/host-ffmpeg-worker.js"
