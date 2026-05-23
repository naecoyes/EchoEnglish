# EchoEnglish

Local Web workflow for creating English story narration videos. The current version focuses on beginner-friendly pure stories with scene images, MiniMax narration, quiet background music, bilingual captions, Chinese vocabulary notes, and a final MP4. The dashboard is a React/Vite PWA with liquid-glass navigation for desktop and mobile WebView use.

## Current Workflow

1. Enter any custom story topic and choose one of the 10 built-in video type templates.
2. Search with Tavily, generate a complete 15-minute draft with the LLM, then review it.
3. Revise the draft from feedback as many times as needed, then confirm generation.
4. Create narration audio and subtitle timings.
5. Generate 112-120 sentence-level scene images and 3-4 instrumental background music tracks.
6. Render cinematic scene frames with a compact bilingual caption panel and vocabulary overlays.
7. Export the final video plus sidecar files and `quality-report.json`.

## Web Dashboard

Start the local dashboard:

```bash
npm run web
```

Open:

```text
http://127.0.0.1:3001
```

The Web server listens on `0.0.0.0` by default, so devices on the same LAN can open the printed `LAN access` URL. When `access.pin` is configured in `settings.local.json`, visitors must enter the PIN before using the dashboard, API, or generated outputs. You can also set it with `ACCESS_PIN` before starting the server.

The Web dashboard is intentionally constrained to fixed 15-minute videos. Build the React app before starting the local server:

```bash
npm run build
npm run web
```

It includes:

- a primary custom topic input
- a draft review and revision step before full generation
- multi-page routes for Generate, Preview, Outputs, Recent, and Status
- desktop left liquid-glass navigation and mobile bottom tab navigation
- PWA manifest and service worker shell
- 10 built-in video type templates for factual documentaries and fictional stories
- fixed 15-minute Web generation
- global MiniMax, Tavily search, LLM keys, and model profile settings
- pure story narration mode for Web jobs
- MiniMax English TTS, image generation, and background music for Web jobs
- a draggable video progress scrubber
- automatic `quality-report.json` with duration, image, music, and factual-mode checks
- live job status
- output links
- embedded `final.mp4` preview

Open the local settings page to save your MiniMax key, Tavily key, LLM key, and model defaults:

```text
http://127.0.0.1:3001/settings
```

The settings page writes `settings.local.json`, which is gitignored. Full API keys are never echoed back to the browser after saving.

Draft planning and script writing require Tavily search plus an OpenAI-compatible LLM API. The Settings page stores:

- Tavily API key, masked after saving
- LLM API base, default `https://coding.dashscope.aliyuncs.com/v1`
- LLM model, default `qwen3.6-plus`
- LLM API key, masked after saving
- model profile, default `balanced`
- MiniMax English and Chinese voices
- MiniMax music track count, default `3`

Environment variables are still supported as a fallback before starting the Web server:

```bash
export TAVILY_API_KEY="your_tavily_api_key_here"
export LLM_API_BASE="https://coding.dashscope.aliyuncs.com/v1"
export STRIX_LLM="qwen3.6-plus"
export LLM_API_KEY="your_llm_api_key_here"
npm run web
```

When the Tavily key or LLM key is missing, draft generation and video generation are blocked with a clear error. The Web workflow searches topic context first, then uses the LLM to write the full review draft; it no longer silently falls back to local template text.

Default balanced profile:

- LLM: `qwen3.6-plus`
- TTS: `speech-2.8-hd`
- Image: `image-01`
- Music: `music-2.6`
- Music tracks: `3`

Built-in video templates:

1. Company Origin Story
2. Product Launch History
3. Founder Biography
4. City Travel Story
5. School Life Story
6. Mystery Adventure
7. Science And Technology
8. Daily Life Drama
9. Historical Event Documentary
10. Future Imagination Story

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

For Web-generated 15-minute videos:

- TTS uses `outputs/.tts-cache/` and only calls MiniMax for unique speech text.
- MiniMax TTS requests are throttled by `MINIMAX_TTS_MIN_INTERVAL_MS`, default `3500`.
- Scene images are generated per English sentence, usually 112-120 image API calls per 15-minute draft.
- Background music uses `music-2.6`, defaults to 3 segments, writes `music/background-01.mp3` etc., then joins them into `music/background.mp3`.
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
  quality-report.json
  music/background-01.mp3
  music/background-02.mp3
  music/background-03.mp3
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

Text generation is configured in Settings through model profiles. The default Web profile uses Tavily search plus the configured OpenAI-compatible LLM (`qwen3.6-plus` by default) for draft and script generation.

## Xiaomi History Video

The older Xiaomi history workflow is still available:

```bash
npm run generate:xiaomi-history -- --tts-provider minimax --image-provider minimax --music-provider minimax
```
