# EchoEnglish

Local Web workflow for creating English story narration videos. The current version focuses on beginner-friendly pure stories with scene images, MiniMax narration, quiet background music, bilingual captions, Chinese vocabulary notes, and a final MP4. The dashboard is a React/Vite PWA with liquid-glass navigation for desktop and mobile WebView use.

## Current Workflow

1. Enter any custom story topic. The 15 ready-made packages are only an inspiration library.
2. Generate a story overview first, then confirm it before video generation.
3. Generate a continuous beginner English story with no Part, Listen, Shadow, Review, or repeated teaching rounds.
4. Create narration audio and subtitle timings.
5. Generate one instrumental background track and loop it quietly under the narration.
6. Render cinematic scene frames with a compact bilingual caption panel and vocabulary overlays.
7. Export the final video plus sidecar files.

## Web Dashboard

Start the local dashboard:

```bash
npm run web
```

Open:

```text
http://127.0.0.1:3001
```

The Web dashboard is intentionally constrained to 15-20 minute videos. Build the React app before starting the local server:

```bash
npm run build
npm run web
```

It includes:

- a primary custom topic input
- a story overview confirmation step before full generation
- multi-page routes for Generate, Preview, Outputs, Recent, and Status
- desktop left liquid-glass navigation and mobile bottom tab navigation
- PWA manifest and service worker shell
- 15 optional story packages and storyboard directions for inspiration
- target duration control from 15 to 20 minutes
- global MiniMax API key and model settings
- pure story narration mode for Web jobs
- MiniMax English TTS, image generation, and background music for Web jobs
- a draggable video progress scrubber
- live job status
- output links
- embedded `final.mp4` preview

Open the local settings page to save your MiniMax key and model defaults:

```text
http://127.0.0.1:3001/settings
```

The settings page writes `settings.local.json`, which is gitignored. The full API key is never echoed back to the browser after saving.

Optional OpenAI-compatible text generation can be enabled before starting the Web server:

```bash
export LLM_API_BASE="https://coding.dashscope.aliyuncs.com/v1"
export STRIX_LLM="openai/qwen3.6-plus"
export LLM_API_KEY="your_llm_api_key_here"
npm run web
```

When `LLM_API_KEY` is present, story overview and pure story text generation use that model. Without it, the workflow falls back to the local story planner.

Default models:

- Text: `MiniMax-M2.7`
- TTS: `speech-2.8-hd`
- Image: `image-01`
- Music: `music-2.6`

## CLI Usage

Quick 3-minute draft:

```bash
npm run generate:sample
```

Custom topic and duration:

```bash
npm run generate -- --topic "The Lost Key" --minutes 3
npm run generate -- --topic "The Clockmaker's Secret" --minutes 15
npm run generate -- --topic "A rainy day in London" --minutes 15
```

Use MiniMax TTS from `settings.local.json` or `MINIMAX_API_KEY`:

```bash
export MINIMAX_API_KEY="your_api_key_here"
npm run generate -- --topic "A Rainy Day" --minutes 15 --tts-provider minimax
```

Skip audio when you only want text outputs:

```bash
npm run generate -- --topic "A Rainy Day" --minutes 3 --skip-audio
```

## Image Workflow

The generator writes `image-prompts.md` for every run. Use those prompts with Codex image generation, MiniMax `image-01`, or another image API.

For long 15-20 minute videos, repeated listen/shadow/review rounds reuse assets:

- TTS uses `outputs/.tts-cache/` and only calls MiniMax for unique speech text.
- MiniMax TTS requests are throttled by `MINIMAX_TTS_MIN_INTERVAL_MS`, default `3500`.
- Scene images are generated every two story sentences, with listen, shadow, and review variants.
- Background music is one `music-2.6` API call per video, saved as `music/background.mp3`, then looped during MP4 composition.
- Existing `outputs/{story-slug}/images/scene-###.png` files are reused without another image API call.

For real scene images, place files here before composing or re-running:

```text
outputs/{story-slug}/images/scene-001.png
outputs/{story-slug}/images/scene-002.png
outputs/{story-slug}/images/scene-003.png
outputs/{story-slug}/images/scene-004.png
```

For the richer 15-20 minute workflow, the generator also recognizes:

```text
outputs/{story-slug}/images/scene-001-a.png
outputs/{story-slug}/images/scene-001-b.png
outputs/{story-slug}/images/scene-001-c.png
outputs/{story-slug}/images/scene-001-a-01.png
outputs/{story-slug}/images/scene-001-a-02.png
```

Then choose `Use existing images` in the Web dashboard, or run:

```bash
npm run generate -- --topic "The Clockmaker's Secret" --minutes 15 --image-mode existing
```

MiniMax image generation:

```bash
export MINIMAX_API_KEY="your_api_key_here"
npm run generate -- --topic "The Clockmaker's Secret" --minutes 15 --image-mode minimax
```

## Output

Each run writes to:

```text
outputs/{story-slug}/
  script.json
  script.md
  image-prompts.md
  subtitles.srt
  audio.wav
  music/background.mp3
  slides/
  final.mp4
  audio-work/
```

`script.json` contains the structured story, translations, vocabulary notes, storyboard design, reading order, pauses, and generated output names.

## CLI Options

- `--topic` story topic, default: `A Rainy Day`
- `--minutes` target duration, default: `3`
- `--out` output root directory, default: `outputs`
- `--voice` English macOS voice, default: auto-picks `Samantha`
- `--cn-voice` Chinese macOS voice, default: auto-picks `Tingting`
- `--rate` speech rate for English, default: `150`
- `--tts-provider` `auto`, `minimax`, or `local`, default: `auto`
- `--minimax-model` MiniMax speech model, default: `speech-2.8-hd`
- `--minimax-voice` MiniMax English voice, default: `English_Graceful_Lady`
- `--minimax-cn-voice` MiniMax Chinese voice, default: `Chinese (Mandarin)_Sweet_Lady`
- `--speed` MiniMax voice speed, default: `0.92`
- `--image-mode` `local`, `existing`, or `minimax`, default: `local`
- `--music-mode` `none` or `minimax`, default: `none` for CLI, Web uses `minimax`
- `--music-model` MiniMax music model, default: `music-2.6`
- `--music-volume` final mix volume for background music, default: `0.12`
- `--story-mode` `lesson` or `pure-story`, default: `lesson`; Web uses `pure-story`
- `--skip-audio` generate only JSON, Markdown, and estimated SRT

## MiniMax Token Plan Defaults

- TTS: `speech-2.8-hd`
- Image: `image-01`
- Music: `music-2.6`

Text model configuration is stored in Settings as `MiniMax-M2.7`; the current story script generator still uses local templates until the API script-generation step is wired in.

## Xiaomi History Video

The older Xiaomi history workflow is still available:

```bash
npm run generate:xiaomi-history -- --tts-provider minimax --image-provider minimax --music-provider minimax
```
