# EchoEnglish

English story narration video generator with cinematic scene images, bilingual captions, and vocabulary notes. Uses AI services (MiniMax, Google Gemini, Xiaomi) for TTS, image generation, and background music.

## Features

- Custom topic input with 10 built-in video templates
- Tavily web search for topic research
- LLM-powered story planning and script generation (Qwen, MiMo, etc.)
- Multi-provider TTS: MiniMax, Google Gemini, Xiaomi
- Multi-provider image generation: MiniMax, Google Imagen
- Background music generation (MiniMax)
- React/Vite PWA dashboard with liquid-glass navigation
- PIN-based access protection
- Quality report generation

## Quick Start

```bash
# Install dependencies
npm install

# Build frontend
npm run build

# Start server (default: http://0.0.0.0:3001)
npm run web
```

Open Settings to configure API keys:

```
http://127.0.0.1:3001/settings
```

## Configuration

API keys are stored in `settings.local.json` (gitignored) and never exposed to the browser after saving.

### Required API Keys

| Key | Purpose | Where to get |
|-----|---------|--------------|
| MiniMax API Key | TTS, image, music generation | [MiniMax](https://platform.minimaxi.com/) |
| Tavily API Key | Web search for topic research | [Tavily](https://tavily.com/) |
| LLM API Key | Story planning and script writing | [DashScope](https://dashscope.aliyun.com/) or compatible |
| Google API Key | Gemini TTS and Imagen (optional) | [Google AI](https://ai.google.dev/) |

### Environment Variables (fallback)

```bash
export MINIMAX_API_KEY="your_key"
export TAVILY_API_KEY="your_key"
export LLM_API_KEY="your_key"
export LLM_API_BASE="https://coding.dashscope.aliyuncs.com/v1"
export STRIX_LLM="qwen3.6-plus"
export GOOGLE_API_KEY="your_key"
npm run web
```

### Default Profiles

| Profile | TTS Model | Image Model | Music Model |
|---------|-----------|-------------|-------------|
| Balanced | speech-2.8-hd | image-01 | music-2.6 |
| Google | gemini-2.5-flash-preview-tts | imagen-4.0-generate-001 | music-2.6 |

## Video Templates

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

```bash
# Quick 3-minute draft
npm run generate:sample

# Custom topic
npm run generate -- --topic "The Lost Key" --minutes 3
npm run generate -- --topic "A rainy day in London" --minutes 15

# Skip audio (text only)
npm run generate -- --topic "A Rainy Day" --minutes 3 --skip-audio

# Use specific TTS provider
npm run generate -- --topic "A Rainy Day" --minutes 15 --tts-provider minimax
```

### CLI Options

| Option | Default | Description |
|--------|---------|-------------|
| `--topic` | A Rainy Day | Story topic |
| `--minutes` | 3 | Target duration |
| `--out` | outputs | Output directory |
| `--tts-provider` | auto | TTS: auto, minimax, local |
| `--image-mode` | local | Image: local, existing, minimax |
| `--music-mode` | none | Music: none, minimax |
| `--skip-audio` | false | Generate text only |

## Output Structure

```
outputs/{story-slug}/
  script.json          # Structured story with translations and vocabulary
  script.md            # Human-readable script
  image-prompts.md     # Image generation prompts
  subtitles.srt        # Subtitle file
  audio.wav            # Narration audio
  quality-report.json  # Quality metrics
  music/               # Background music tracks
  slides/              # Scene frames with captions
  final.mp4            # Final video
```

## Network Access

The server binds to `0.0.0.0` by default. Devices on the same LAN can access via the printed LAN URL.

For external access:
- **LAN**: Use the printed `http://<LAN_IP>:3001` URL
- **Internet**: Configure router port forwarding or use ngrok

### PIN Protection

Set a PIN in Settings or via environment variable:

```bash
export ACCESS_PIN="your_pin"
npm run web
```

Visitors must enter the PIN before using the dashboard.

## Security

- API keys are stored in `settings.local.json` (gitignored)
- `.env` file is gitignored
- Keys are masked in the browser after saving
- No hardcoded secrets in source code
