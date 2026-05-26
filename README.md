# EchoEnglish

EchoEnglish is a local AI workflow for generating English shadowing videos from any topic. It creates a reviewed script, sentence-level narration, story-beat scene images, bilingual captions, vocabulary notes, background music, YouTube publishing copy, and a final MP4.

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
  youtube-copy.md
  youtube-copy.json
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
- TTS: Xiaomi `mimo-v2.5-tts` (endpoint: `/chat/completions`, not `/audio/speech`)
- Voice: `mimo_default`, or podcast hosts `Mia` / `Milo`
- Image: MiniMax `image-01` (Xiaomi does not provide an image API)
- Music: MiniMax `music-2.6`

### Xiaomi MiMo TTS Details

MiMo TTS uses a chat-completions style API, not the OpenAI-compatible `/audio/speech` endpoint:

```text
POST {ttsBaseUrl}/chat/completions
Authorization: Bearer {apiKey}
{
  "model": "mimo-v2.5-tts",
  "messages": [{ "role": "assistant", "content": "Text to speak" }],
  "voice": "mimo_default"
}
```

Response returns base64 audio at `choices[0].message.audio.data`.

Available voices:

| Voice | Use case |
| --- | --- |
| `mimo_default` | General narration |
| `Mia` | Podcast host A (female) |
| `Milo` | Podcast host B (male) |
| `Chloe`, `Dean` | English voices |
| `冰糖`, `茉莉`, `苏打`, `白桦` | Chinese voices |

Model names must be lowercase (e.g. `mimo-v2.5-tts`, not `MiMo-V2.5-TTS`). The API rejects uppercase model identifiers.

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

> **Port note**: OrbStack on macOS may intercept port 3001. Use `PORT=3002` to avoid conflicts.

## Settings

Open:

```text
http://127.0.0.1:3002/settings
```

Configure:

- MiniMax API key
- Tavily API key
- LLM API base, model, and key
- Xiaomi MiMo key, base URL, text model, TTS model, TTS base URL, TTS API key, default voice, and podcast host voices
- Google API key, Imagen model, Gemini TTS model, and voice
- TTS provider and image provider
- Podcast host A/B voices
- Music track count
- Access PIN
- Video encoder: `auto`, `cpu-libx264`, `apple-videotoolbox`, `nvidia-nvenc`, or `intel-qsv`

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

## Hardware Video Encoding

Video composition uses FFmpeg. In Settings -> Video, choose:

| Encoder | Best for |
| --- | --- |
| Auto | Recommended default. Detects available hardware encoder. |
| Apple VideoToolbox | macOS hardware H.264 encoding. |
| NVIDIA NVENC | NVIDIA GPU H.264 encoding. |
| Intel Quick Sync | Intel hardware H.264 encoding. |
| CPU libx264 | Reliable software fallback. |

Hardware encoding only speeds up the `compose` stage. It does not speed up LLM, TTS, image generation, or music generation.

Check local FFmpeg support:

```bash
ffmpeg -hide_banner -encoders | grep -E 'h264_videotoolbox|h264_nvenc|h264_qsv|libx264'
```

If a selected hardware encoder fails during export, EchoEnglish automatically retries with CPU `libx264`.

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

Image generation may be slow because a 15-minute video requests about 30-45 story-beat images, normally 2-3 images per minute. The Status page reads `image-manifest.json` and shows counts such as `Images 14/36`. If a request times out, quota is exhausted, or the server restarts, the job becomes recoverable.

### Regenerate only images

Use `POST /api/outputs/{slug}/regenerate-images` to regenerate the current script's story-beat images and re-render MP4 without calling the LLM, TTS, or music APIs. The endpoint backs up existing images first and restores them automatically if the image API fails.

### Draft quality is repetitive

Use the draft review step and revise with feedback before confirming. For factual topics, prefer documentary templates and keep Tavily configured. If Xiaomi text generation is slow or incomplete, switch text generation back to the Qwen-compatible LLM profile.

### Video UI changes needed

Use Re-render Video UI from Preview. It reuses existing assets and avoids extra API cost.

### Xiaomi MiMo TTS errors

**404 Not Found**: MiMo TTS does not use the OpenAI-compatible `/audio/speech` endpoint. It uses `/chat/completions` with a messages-based payload. Ensure `ttsBaseUrl` points to the correct base (e.g. `https://token-plan-sgp.xiaomimimo.com/v1`), and the code appends `/chat/completions`.

**401 Unauthorized**: The dedicated TTS API key may not work. Use the main Xiaomi API key for both text and TTS.

**"Not supported model"**: Model names must be lowercase. `MiMo-V2.5-TTS` will be rejected; use `mimo-v2.5-tts`. The code normalizes this automatically.

**Voice "alloy" not found**: MiMo does not have an `alloy` voice. Use `mimo_default` for narration, or `Mia`/`Milo` for podcast hosts.

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
