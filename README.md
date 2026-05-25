# EchoEnglish

EchoEnglish is a local AI workflow for generating English shadowing videos from any topic. It creates a reviewed script, sentence-level narration, 100+ scene images, bilingual captions, vocabulary notes, background music, and a final MP4.

The dashboard is designed for long 15-minute learning videos, with recoverable generation stages so API quota errors, network failures, or service restarts do not waste completed audio, images, or music.

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

Each output folder can include:

```text
outputs/{slug}/
  draft.json
  draft.md
  script.json
  script.md
  subtitles.srt
  audio.wav
  image-prompts.md
  audio-manifest.json
  image-manifest.json
  music-manifest.json
  quality-report.json
  images/
  music/
  slides/
  final.mp4
  job-state.json
```

## Video Types

EchoEnglish supports multiple video modes through templates:

| Template | Mode | Best for |
| --- | --- | --- |
| Company Origin Story | factual documentary | Company history and brand origin videos |
| Product Launch History | factual documentary | Product, car, phone, app, or platform launch stories |
| Founder Biography | factual documentary | Founder or public figure biographies |
| City Travel Story | fictional story | Travel English with real city details |
| School Life Story | fictional story | Beginner school and friendship stories |
| Mystery Adventure | fictional story | Soft mystery and clue-based stories |
| Science And Technology | factual documentary | Science, technology, missions, inventions |
| Daily Life Drama | fictional story | Practical daily-life English |
| Historical Event Documentary | factual documentary | Real events and historical timelines |
| Future Imagination Story | fictional story | Near-future learning stories |
| Podcast Conversation | two-host dialogue | Two-host explainer videos with role-based voices |

Factual templates use search-backed context and are instructed not to invent fictional protagonists, employees, private scenes, or unsupported claims.

## Model Support

Configure models from the Settings page. Keys are saved only in `settings.local.json`, which is gitignored.

| Capability | Supported providers | Notes |
| --- | --- | --- |
| Script LLM | DashScope/Qwen compatible API, Xiaomi MiMo | Xiaomi requests use MiMo-specific chat parameters |
| Search | Tavily | Used before draft generation |
| TTS | MiniMax, Google Gemini TTS, Xiaomi MiMo TTS | Podcast mode supports two host voices |
| Image | MiniMax image-01, Google Imagen | MiniMax prompts are compressed under API length limits |
| Music | MiniMax music-2.6 | Generates 3-4 background tracks and merges them |

Recommended stable setup:

- Text: DashScope/Qwen for long drafts
- TTS: MiniMax `speech-2.8-hd`
- Image: MiniMax `image-01`
- Music: MiniMax `music-2.6`
- Search: Tavily

Xiaomi MiMo can be configured for text or TTS experiments. For long 15-minute drafts, Qwen is currently the more reliable default.

## Quick Start

```bash
npm install
npm run build
PORT=3002 npm run web
```

Open the dashboard:

```text
http://127.0.0.1:3002/generate
```

The server binds to `0.0.0.0`, so LAN URLs are printed at startup. Configure a PIN in Settings before exposing it outside your machine.

## Settings

Open:

```text
http://127.0.0.1:3002/settings
```

Configure:

- MiniMax API key
- Tavily API key
- LLM API base, model, and key
- Xiaomi MiMo key, base URL, text model, and TTS model
- Google API key, Imagen model, Gemini TTS model, and voice
- TTS provider and image provider
- Podcast host A/B voices
- Music track count
- Access PIN

Fallback environment variables are also supported:

```bash
export MINIMAX_API_KEY="your_key"
export TAVILY_API_KEY="your_key"
export LLM_API_KEY="your_key"
export LLM_API_BASE="https://coding.dashscope.aliyuncs.com/v1"
export STRIX_LLM="qwen3.6-plus"
export GOOGLE_API_KEY="your_key"
export ACCESS_PIN="159951"
npm run web
```

Never commit `settings.local.json` or real API keys.

## Recovery And Continue

Long video generation can take time and uses many API calls. EchoEnglish writes progress continuously:

- `audio-manifest.json` records sentence audio cache state.
- `image-manifest.json` records every scene image.
- `music-manifest.json` records generated background tracks.
- `job-state.json` records stage state, counts, errors, and recoverability.

When a job fails because of rate limits, quota, timeouts, or service restart, open Status and click Continue Generation. Completed TTS, images, and music are reused.

If a server restart leaves a job marked as `running`, EchoEnglish converts it to a recoverable interrupted job on the next load.

## Recent Outputs

The Recent page is a local output manager:

- Preview completed videos.
- Open sidecar files.
- Rename output metadata.
- Delete an output folder.
- See completed, failed, running, and draft directories.

## Video UI

Generated videos include:

- YouTube-style title cover.
- Intro narration describing the topic, practice goal, and level.
- Bilingual captions with English emphasized and Chinese smaller.
- Current-sentence vocabulary card.
- Orange highlight for matching keywords.
- Final vocabulary review table with word, phonetic spelling, and Chinese meaning.
- Podcast mode with two-host visual layout, two voice roles, and dialogue captions.

Use Preview -> Re-render Video UI to regenerate only slides and MP4 from existing script/audio/images/music. This does not call LLM, TTS, image, or music APIs.

## CLI

The web dashboard is the primary workflow, but CLI generation remains available:

```bash
npm run generate:sample
npm run generate -- --topic "The Lost Key" --minutes 3
npm run generate -- --topic "A Rainy Day in London" --minutes 15
```

## Troubleshooting

### MiniMax image prompt length error

MiniMax image prompts must be shorter than 1500 characters. EchoEnglish now compresses prompts before sending them to MiniMax while preserving the original script and prompt files for review.

### Status appears stuck in Scene Images

Image generation may be slow because a 15-minute video can request 110-120 images. The Status page reads `image-manifest.json` and shows counts such as `Images 14/116`. If a request times out or the server restarts, the job becomes recoverable.

### Draft quality is repetitive

Use the draft review step and revise with feedback before confirming. For factual topics, prefer documentary templates and keep Tavily configured. If Xiaomi text generation is slow or incomplete, switch text generation back to the Qwen-compatible LLM profile.

### Video UI changes needed

Use Re-render Video UI from Preview. It reuses existing assets and avoids extra API cost.

## Development

```bash
npm run build
node --check src/webServer.js
PORT=3002 npm run web
```

This project intentionally keeps the backend on Node built-in `http` instead of Express.

## Security

- `settings.local.json` is local and gitignored.
- Browser summaries mask saved keys.
- Access PIN can protect local/LAN use.
- Avoid committing generated outputs that include private content.
- Do not paste API keys into public issues, screenshots, or README files.
