# EchoEnglish

<p align="center">
  <img src="logo/logoyoutubo2.png" alt="EchoEnglish Logo" width="200">
</p>

<p align="center">
  <a href="README_CN.md">中文文档</a>
</p>

EchoEnglish is a local AI workflow for generating English shadowing videos from any topic. It creates a reviewed script, sentence-level narration, story-beat scene images, bilingual captions, vocabulary notes, background music, YouTube publishing copy, and a final MP4 (landscape + portrait).

**Check out our generated videos:**
- [YouTube: @NowEchoEnglish](https://www.youtube.com/@NowEchoEnglish)
- [Bilibili: 影子英语](https://space.bilibili.com/353706495)

The dashboard is designed for long 15-minute learning videos, with recoverable generation stages so API quota errors, network failures, or service restarts do not waste completed audio, images, or music.

## Demo Video

https://github.com/naecoyes/EchoEnglish/raw/main/docs/videos/Marie_Curie_landscape_edited.mp4

## Screenshots

### Generate Dashboard

![Generate dashboard](docs/screenshots/generate-dashboard.png)

### Video Preview

![Video preview](docs/screenshots/preview-video.png)

### Model Settings

![Model settings](docs/screenshots/settings-models.png)

### Mobile Layout

![Mobile generate layout](docs/screenshots/mobile-generate.png)

## Core Workflow

1. Enter a topic.
2. Choose a video type template.
3. Tavily searches for topic context and factual sources.
4. The LLM creates a complete 15-minute draft.
5. Review the draft, revise with feedback, then confirm generation.
6. EchoEnglish generates narration, scene images, background music, captions, and final MP4.
7. If a stage fails, click Continue Generation to resume from saved manifests.

Generation is tracked as a seven-stage state machine:

```text
draft -> script-assets -> tts -> images -> music -> compose -> quality
```

## Quick Start

### Option A — Docker (recommended)

```bash
# 1. Clone
git clone <repo-url> && cd ShadowingEnglishVideo

# 2. Create data directory for settings persistence
mkdir -p data outputs

# 3. Start
docker compose up -d

# 4. Open
open http://127.0.0.1:3002/generate
```

Configure API keys in the Settings page. They are saved to `data/settings.local.json` and persist across container restarts.

> **Port**: Docker runs on `3002` by default (configured in `docker-compose.yml`) to avoid conflicts with other local services.

### Option B — Local Node.js

```bash
npm install
npm run build
PORT=3002 npm run web
```

Open:
```text
http://127.0.0.1:3002/generate
```

> **Port note**: OrbStack on macOS may intercept port 3001. Use `PORT=3002` to avoid conflicts.

## Docker

### Running

```bash
# Build and start
docker compose up -d --build

# View logs
docker compose logs -f

# Stop
docker compose down
```

### Persistent Storage

```text
ShadowingEnglishVideo/
  outputs/    ← generated videos, audio, images, scripts (bind-mounted)
  data/       ← settings.local.json with API keys (bind-mounted)
```

Both directories are created automatically on first run.

### Environment Variables

All API keys can be set in `docker-compose.yml` or via the Settings UI. Environment variables override UI settings:

```bash
MINIMAX_API_KEY=sk-...         # MiniMax (TTS, Image, Music)
LLM_API_KEY=sk-...             # LLM (story generation)
LLM_API_BASE=https://...       # LLM API base URL
STRIX_LLM=qwen3.6-plus         # LLM model name
TAVILY_API_KEY=tvly-...        # Web search context
GOOGLE_API_KEY=...             # Google Gemini TTS / Imagen
XIAOMI_API_KEY=tp-...          # Xiaomi MiMo TTS / LLM
ACCESS_PIN=1234                # Optional UI access PIN
```

### Apple VideoToolbox GPU Acceleration (Mac)

Docker containers on macOS cannot access Apple Silicon GPU directly. Use the **Host FFmpeg Gateway** to route video encoding to the Mac host:

**1. Start the host worker** (once, on Mac):

```bash
HOST_FFMPEG_TOKEN=change-me bash tools/start-ffmpeg-worker.sh
```

**2. Uncomment in `docker-compose.yml`**:

```yaml
FFMPEG_GATEWAY_URL: http://host.docker.internal:4869/run-ffmpeg
FFMPEG_GATEWAY_TOKEN: change-me
```

**3. Restart**:

```bash
docker compose up -d
```

This routes ffmpeg through `/opt/homebrew/bin/ffmpeg` on the Mac host, enabling `h264_videotoolbox` hardware encoding (3–5× faster than CPU `libx264`).

## Stability

EchoEnglish blocks weak scripts before expensive media APIs run:

- Repeated boilerplate scenes, repeated full sentences, repeated endings, missing Chinese translations, and missing vocabulary notes fail the draft quality gate.
- Each scene requires exactly 3 vocabulary notes with the format `["word", "中文释义", "/IPA/"]` — all fields must be non-empty. Country history and public figure biography templates enforce a stricter minimum of 3 meaningful notes per scene.
- The vocabulary bank is enriched with domain words for biographies (achievement, legacy, resilience, discipline, breakthrough, etc.) and science (radiation, experiment, physics, chemistry, etc.). A fallback pool ensures every scene reaches 3 notes even when the LLM omits them.
- Draft generation uses the local quality gate by default. Set `ECHOENGLISH_LLM_DRAFT_VALIDATION=1` for a second LLM judge pass (slower).
- Confirmed drafts are checked again before TTS, images, music, and video composition.
- TTS manifests, image manifests, music manifests, and timeline manifests are saved for recovery and debugging.
- The final video timeline is aligned to the real `audio.wav` duration.
- Existing outputs can be analyzed from Preview with **Analyze Quality** and repaired with **Create Repair Draft**.

### Output Folder

```text
outputs/{slug}/
  draft.json
  draft.md
  script.json
  script.md
  subtitles.srt
  audio.wav
  image-prompts.md
  youtube-copy.md
  youtube-copy.json
  audio-manifest.json
  image-manifest.json
  music-manifest.json
  timeline-manifest.json
  timeline-manifest-portrait.json
  quality-report.json
  images/
  music/
  slides/           ← landscape frame PNGs
  slides-portrait/  ← portrait frame PNGs
  final.mp4
  final-portrait.mp4
  job-state.json
```

## Video Types

| Template | Mode | Best for |
| --- | --- | --- |
| Company Origin Story | factual documentary | Company history and brand origin videos |
| Product Launch History | factual documentary | Product, car, phone, app, or platform launch stories |
| Founder Biography | factual documentary | Founder or public figure biographies |
| Public Figure Biography | factual documentary | Scientists, artists, athletes, writers, historical figures, and public leaders |
| City Travel Story | fictional story | Travel English with real city details |
| School Life Story | fictional story | Beginner school and friendship stories |
| Mystery Adventure | fictional story | Soft mystery and clue-based stories |
| Science And Technology | factual documentary | Science, technology, missions, inventions |
| Daily Life Drama | fictional story | Practical daily-life English |
| Country History Documentary | factual documentary | Ancient-to-modern country history overviews |
| Historical Event Documentary | factual documentary | Real events and historical timelines |
| Future Imagination Story | fictional story | Near-future learning stories |
| Podcast Conversation | two-host dialogue | Two-host explainer videos with role-based voices |

### Country History Documentary

Use this template for topics such as `The History of Japan`, `Egypt country history`, `Brazil history`, `中国历史`, or `某国发展史`. EchoEnglish keeps this mode factual and calm: geography and ancient origins, early civilization, major kingdoms or periods, outside influences, independence or modern state formation, culture and economy today, then a peaceful recap.

Country history videos avoid fictional protagonists, invented dialogue, heavy conflict detail, political judgment, patriotic slogans, and private imagined scenes. Image prompts favor cinematic documentary backgrounds: maps without labels, landmarks, historic architecture, museums, artifacts, ports, city streets, public memorial spaces, and soft historical reconstruction. They explicitly avoid podcast hosts, studio microphones, embedded text, readable signs, logos, watermarks, `Your Text`, and unreliable flag details. Background music uses a restrained documentary style with no vocals, lyrics, anthem, or patriotic march.

### Public Figure Biography

Use this template for topics such as `Biography of Marie Curie`, `Life of Nelson Mandela`, `Leonardo da Vinci biography`, `Serena Williams biography`, or `苏轼人物传记`. EchoEnglish keeps this mode factual and respectful: early life, education or influences, first turning point, main work and achievements, setbacks or challenges, public impact, legacy, and a calm recap.

Public figure biographies use only public facts from search context. They avoid fictional dialogue, private family drama, gossip, unsupported emotions, hero worship, and political judgment. Image prompts favor public stages, schools, laboratories, studies, studios, city context, archival documents, tools, awards, memorial spaces, silhouettes, side views, and symbolic close-ups. They explicitly avoid podcast hosts, microphones, embedded text, readable names, logos, watermarks, `Your Text`, paparazzi style, and exact-face demands without a verified reference.

### Auto Template Detection

When you type a topic in the Generate page, EchoEnglish automatically detects and selects the matching template:

- **Country History** — keywords like `history of Japan`, `Egypt country history`, `中国历史`, `某国发展史`
- **Public Figure Biography** — keywords like `biography of Marie Curie`, `life of Nelson Mandela`, `人物传记`, `苏轼人物传记`
- **Founder Biography** — keywords like `founder`, `CEO`, `创始人`

Auto-detection works in both English and Chinese. You can still manually override the template selection.

### AI Template Generation

When no template is specified, EchoEnglish automatically generates a custom video template using AI based on the topic.

## Model Support

Configure models from the Settings page. Keys are saved only in `settings.local.json` (or `data/settings.local.json` in Docker), which is gitignored.

| Capability | Supported providers | Notes |
| --- | --- | --- |
| Script LLM | DashScope/Qwen compatible API, Xiaomi MiMo | Xiaomi requests use MiMo-specific chat parameters |
| Search | Tavily | Used before draft generation |
| TTS | MiniMax, Google Gemini TTS, Xiaomi MiMo TTS | Podcast mode supports two host voices |
| Image | MiniMax image-01, Google Imagen | MiniMax prompts are compressed under API length limits |
| Music | MiniMax music-2.6 | Generates 3-4 background tracks and merges them |
| Video encode | FFmpeg CPU/GPU encoders | Auto-detects hardware encoder when available |

### Recommended Setup

MiniMax stack (stable default):

- Text: DashScope/Qwen for long drafts
- TTS: MiniMax `speech-2.8-hd`
- Image: MiniMax `image-01`
- Music: MiniMax `music-2.6`
- Search: Tavily

Xiaomi MiMo stack (proven alternative):

- Text: Xiaomi `mimo-v2.5-pro`
- TTS: Xiaomi `mimo-v2.5-tts`
- Voice: `mimo_default`, or podcast hosts `Mia` / `Milo`
- Image: MiniMax `image-01`
- Music: MiniMax `music-2.6`

### Xiaomi MiMo TTS Details

The working Token Plan setup:

| Field | Recommended value |
| --- | --- |
| Main API base | `https://token-plan-sgp.xiaomimimo.com/v1` |
| Text model | `mimo-v2.5-pro` |
| TTS base | `https://token-plan-sgp.xiaomimimo.com/v1` |
| TTS model | `mimo-v2.5-tts` |
| Narration voice | `mimo_default` |

## Settings

Open `http://127.0.0.1:3002/settings` to configure:

- MiniMax API key
- Tavily API key
- LLM API base, model, and key
- Xiaomi MiMo key, TTS key, base URLs, models, and voices
- Google API key, Imagen model, Gemini TTS model, and voice
- TTS provider and image provider
- Separate cover image provider: MiniMax, Google Imagen, inherit scene image provider, or disabled
- Music track count
- Access PIN
- Video encoder: `auto`, `cpu-libx264`, `apple-videotoolbox`, `nvidia-nvenc`, or `intel-qsv`

Fallback environment variables:

```bash
export MINIMAX_API_KEY="your_key"
export TAVILY_API_KEY="your_key"
export LLM_API_KEY="your_key"
export LLM_API_BASE="https://coding.dashscope.aliyuncs.com/v1"
export STRIX_LLM="qwen3.6-plus"
export GOOGLE_API_KEY="your_key"
export ACCESS_PIN="159951"
```

Never commit `settings.local.json` or real API keys.

## Recovery And Continue

Long video generation can take time and uses many API calls. EchoEnglish writes progress continuously:

- `audio-manifest.json` records sentence audio cache state.
- `image-manifest.json` records every scene image.
- `music-manifest.json` records generated background tracks.
- `job-state.json` records stage state, counts, errors, and recoverability.

When a job fails, open Status and click Continue Generation. Completed TTS, images, and music are reused.

## Portrait Video Mode (9:16)

Every generation automatically produces both landscape and portrait videos:

- `final.mp4` — 1920×1080 (16:9 landscape)
- `final-portrait.mp4` — 1080×1920 (9:16 portrait)

Portrait mode reuses the same scene images — center-cropped to fill the portrait canvas. Compose progress is tracked separately for each orientation (landscape 60–78%, portrait 78–96%).

## Cover Image Layer

Cover generation is separate from story scene image generation:

- `cover-prompts.md` stores the dedicated cover prompts.
- `images/cover-youtube.png` is a finished 16:9 YouTube-style cover with EchoEnglish title, description, difficulty, and CTA text.
- `images/cover-vertical.png` is a finished 9:16 Douyin/TikTok/Reels-style cover with the same metadata adapted for vertical viewing.
- `images/cover-youtube-bg.*` and `images/cover-vertical-bg.*` are raw model-generated backgrounds when a new background is needed.
- Scene prompts stay in `image-prompts.md` and are generated independently from cover prompts.

The cover layer sits above the MiniMax and Google Imagen providers. In Settings -> Image, choose a scene image provider and a separate cover image provider. `Inherit from Scenes` uses the same provider as scene backgrounds.

Cover prompts are generated from the topic, title, summary, template, and story visual style, then wrapped into universal provider-safe prompts. They intentionally avoid embedded text, logos, subtitles, and placeholder words because EchoEnglish renders the text layer locally. The overlay includes `ECHOENGLISH`, `今天的故事`, the video title, a short description, the estimated U.S. grade difficulty, and `Listen & Shadow`. The YouTube cover favors a high-contrast 16:9 thumbnail; the vertical cover favors a mobile-first 9:16 first frame.

The video first frame uses the same local cover renderer as the downloadable covers. Image models only create the photographic background; EchoEnglish always overlays the title and learning text locally so generated covers do not contain `Your Text`, broken letters, or random captions.

Preview includes:

- `Generate Covers` to regenerate only the two cover images.
- `DL YouTube Cover` to download the landscape cover.
- `DL Vertical Cover` to download the short-video cover.

## Video UI Rendering

The MP4 UI is rendered locally from existing assets:

- Cover/homepage: full-screen photo background, cinematic dark overlay, centered title, large play button, summary, and difficulty.
- Captions: English is primary and centered; Chinese is smaller with optimized line heights (1.45x for English, 1.55x for Chinese) and custom spacing. Text is layered over a modern dark panel (`#000000` with 0.72 opacity and rounded corners) with drop shadows for maximum readability.
- Keyword highlights: high-contrast yellow background (`#facc15`) with precise width estimation and rounded corners for active English vocabulary, and matching inline translation highlight in Chinese.
- Vocabulary card: flat, sleek deep-dark card (`#0f172a` with 0.85 opacity, rounded corners) placed in the upper corner (or center top in portrait), showing the word and its Chinese translation (phonetics omitted for visual cleanliness).
- Podcast mode: two fixed host images and role-based captions/voices.

Use **Re-render UI** from Preview to rebuild `slides/`, `slides-portrait/`, `final.mp4`, and `final-portrait.mp4` without calling LLM, TTS, image, or music APIs.

## Hardware Video Encoding

In Settings → Video, choose:

| Encoder | Best for |
| --- | --- |
| Auto | Recommended default. Detects available hardware encoder. |
| Apple VideoToolbox | macOS hardware H.264 encoding. |
| NVIDIA NVENC | NVIDIA GPU H.264 encoding. |
| Intel Quick Sync | Intel hardware H.264 encoding. |
| CPU libx264 | Reliable software fallback. |

Check local FFmpeg support:

```bash
ffmpeg -hide_banner -encoders | grep -E 'h264_videotoolbox|h264_nvenc|h264_qsv|libx264'
```

## Host FFmpeg Gateway

For Docker deployments on Mac, a generic Host FFmpeg Worker allows all Docker projects to use Apple VideoToolbox:

```text
Docker App
  -> http://host.docker.internal:4869/run-ffmpeg
  -> Mac Host FFmpeg Worker (tools/host-ffmpeg-worker.js)
  -> /opt/homebrew/bin/ffmpeg h264_videotoolbox
  -> writes back to shared volume
```

Start the worker on the Mac host:

```bash
HOST_FFMPEG_WORKER_HOST=0.0.0.0 \
HOST_FFMPEG_TOKEN=change-me \
HOST_FFMPEG_BIN=/opt/homebrew/bin/ffmpeg \
HOST_FFMPEG_PATH_MAPS="/app/outputs=$(pwd)/outputs" \
node tools/host-ffmpeg-worker.js
```

Other Docker projects can reuse the same worker by adding their own path mapping to `HOST_FFMPEG_PATH_MAPS`.

## YouTube Copy

Each generated video includes `youtube-copy.json` and `youtube-copy.md` with:

- Title (prefixed with "英语口语练习-")
- Description in English and Chinese
- Chapters with timestamps
- Tags
- Pinned comment
- Thumbnail text suggestions

## Regression Samples

Use these samples when checking a release:

| Template | Topic | Checks |
| --- | --- | --- |
| Company Origin Story | `Apple company development history` | factual timeline, no fictional characters, YouTube/vertical covers, no repeated ending |
| Country History Documentary | `The History of Japan` / `Egypt country history` / `Brazil history` | ancient-to-modern soft overview, 18-24 scenes, 30-40 image beats, landmarks/artifacts, no fictional protagonist |
| Public Figure Biography | `Biography of Marie Curie` / `Life of Nelson Mandela` / `Leonardo da Vinci biography` / `Serena Williams biography` / `苏轼人物传记` | public facts only, 18-22 scenes, 30-40 image beats, respectful tone, no invented private dialogue |
| Daily Life Story | `The Morning Rush` | story pacing, 2-3 image beats per minute, clear bilingual captions |
| Podcast Conversation | `How to avoid mental exhaustion` | two host images only, Mia/Milo-style voices, dialogue captions aligned by speaker |

For each sample, verify `quality-report.json`, `timeline-manifest.json`, subtitle/audio/video duration alignment, and the last two minutes of the MP4.

## CLI

```bash
npm run generate:sample
npm run generate -- --topic "The Lost Key" --minutes 3
npm run generate -- --topic "A Rainy Day in London" --minutes 15
```

## Troubleshooting

### Status appears stuck in Scene Images

Image generation for a 15-minute video requests 30–45 story-beat images. The Status page shows counts such as `Images 14/36`. If a request times out or quota is exhausted, the job becomes recoverable. Click Continue Generation.

### Draft generation is slow

The Generate page shows live draft progress. LLM draft requests time out after 180 seconds by default; override with `LLM_REQUEST_TIMEOUT_MS=240000`. For the optional second LLM judge pass, set `ECHOENGLISH_LLM_DRAFT_VALIDATION=1`.

### Video UI changes needed

Use Re-render Video UI from Preview. It reuses existing assets and avoids extra API cost.

### Docker port 3001 conflict

By default `docker-compose.yml` binds to host port `3002`. Change `127.0.0.1:3002:3001` in `docker-compose.yml` to use a different host port.

### Xiaomi MiMo TTS 404

MiMo Token Plan TTS does not use `/audio/speech`. It uses `/chat/completions`. Keep `ttsBaseUrl` as a base URL such as `https://token-plan-sgp.xiaomimimo.com/v1`; the backend appends `/chat/completions`.

### MiniMax image prompt length error

EchoEnglish compresses prompts before sending to MiniMax (max 1500 characters).

## Development

```bash
npm run build
node --check src/webServer.js
PORT=3002 npm run web
```

The backend uses Node built-in `http` instead of Express.

## Security

- `settings.local.json` is local and gitignored.
- `data/` (Docker) is gitignored.
- Browser summaries mask saved keys.
- Access PIN can protect local/LAN use.
- Avoid committing generated outputs that include private content.
- Do not paste API keys into public issues, screenshots, or README files.
