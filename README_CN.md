<p align="center">
  <img src="docs/screenshots/logo.svg" alt="EchoEnglish Logo" width="200">
</p>

<h1 align="center">EchoEnglish</h1>

<p align="center">
  <strong>AI驱动的英语跟读视频生成工具</strong>
</p>

<p align="center">
  <a href="#功能特点">功能特点</a> •
  <a href="#快速开始">快速开始</a> •
  <a href="#视频模板">视频模板</a> •
  <a href="#使用指南">使用指南</a> •
  <a href="#常见问题">常见问题</a>
</p>

---

## 简介

EchoEnglish 是一个本地AI工作流，可以从任何主题生成英语跟读视频。它创建完整的视频脚本、句子级配音、场景图片、双语字幕、词汇注释、背景音乐、YouTube发布文案和最终的MP4视频。

该工具专为15分钟的长学习视频设计，具有可恢复的生成阶段，即使API配额错误、网络故障或服务重启也不会浪费已完成的音频、图片或音乐。

## 功能特点

- 🎯 **AI智能生成** - 输入主题即可自动生成完整的视频模板和内容
- 🎬 **双格式输出** - 同时生成横屏(16:9)和竖屏(9:16)视频
- 🖼️ **智能图片** - 自动生成场景图片，支持批量生成和复用
- 🎙️ **高质量配音** - 支持MiniMax、Google、小米等多种TTS引擎
- 📝 **双语字幕** - 英中双语字幕，支持长句子自动换行
- 🎵 **背景音乐** - 自动生成3-4首背景音乐并混合
- 📱 **移动优化** - 竖屏模式专为TikTok、Instagram Reels、YouTube Shorts设计
- 🔄 **断点续传** - 失败后可从上次进度继续，无需重新开始

## 快速开始

### 安装

```bash
# 克隆仓库
git clone https://github.com/naecoyes/EchoEnglish.git
cd EchoEnglish

# 安装依赖
npm install

# 构建前端
npm run build
```

### 配置

在 Settings 页面中配置 API 密钥。它们将保存到 `settings.local.json`（在 Docker 中为 `data/settings.local.json`），并且可以在容器重启后持久化。无需手动创建或复制配置文件。

### 运行

```bash
# 启动Web服务
PORT=3002 npm run web

# 或者使用默认端口3001
npm run web
```

打开浏览器访问：
```
http://127.0.0.1:3002/generate
```

## 视频模板

EchoEnglish支持多种视频模板：

| 模板名称 | 模式 | 适用场景 |
| --- | --- | --- |
| 公司发展史 | 事实纪录片 | 公司历史和品牌起源视频 |
| 产品发布史 | 事实纪录片 | 产品、汽车、手机、应用发布故事 |
| 创始人传记 | 事实纪录片 | 创始人或公众人物传记 |
| 城市旅行故事 | 虚构故事 | 城市旅行英语学习 |
| 校园生活故事 | 虚构故事 | 初学者校园和友谊故事 |
| 神秘冒险 | 虚构故事 | 轻松的神秘和线索故事 |
| 科学与技术 | 事实纪录片 | 科学、技术、发明 |
| 日常生活剧 | 虚构故事 | 实用日常生活英语 |
| 历史事件纪录片 | 事实纪录片 | 真实事件和历史时间线 |
| 未来想象故事 | 虚构故事 | 近未来学习故事 |
| 播客对话 | 双主持人对话 | 双主持人解说视频 |

### AI模板生成

当未指定模板时，EchoEnglish会使用AI根据主题自动生成自定义视频模板。AI会分析主题并创建：

- **内容模式** - 事实纪录片或虚构故事
- **结构规则** - 叙事弧线和故事流程指导
- **视觉风格** - 图片生成风格和氛围
- **词汇重点** - 领域相关的B1级词汇
- **搜索关键词** - 用于事实内容检索
- **写作指导** - 针对英语学习者的写作说明

用户只需输入主题（如"谷歌公司发展史"），即可获得完整、定制的视频模板，无需手动配置。

## 使用指南

### 生成视频

1. 在"Generate"页面输入视频主题
2. （可选）选择视频模板或让AI自动生成
3. 点击"Generate Draft"生成草稿
4. 审查草稿，提供反馈进行修订
5. 确认后开始生成
6. 等待完成，可在"Status"页面查看进度

### 重新渲染

如需修改视频UI（封面、字幕样式等），可使用"Re-render Video UI"功能：
- 不会重新调用LLM、TTS、图片或音乐API
- 仅使用现有素材重新渲染幻灯片和MP4
- 节省API调用和时间

### 断点续传

如果生成失败（配额超限、网络错误等）：
1. 打开"Status"页面
2. 找到失败的任务
3. 点击"Continue Generation"
4. 已完成的TTS、图片和音乐会被复用

### 高可用与容错

- **敏感词重写兜底**：当 MiniMax 图片生成触发敏感词拦截时，系统会自动回退，调用大模型（LLM）对画面提示词进行重写和脱敏，确保视觉画面的连贯生成。
- **严格的并发与限流控制**：底层的任务队列系统会强制控制 API 请求频率（例如强制拉长 Google Imagen 的请求间隔至 4.2 秒，以严格遵守 Gemini Tier 1 的 15 RPM 限制），彻底杜绝 `429 TooManyRequests` 报错。一旦系统检测到账号内赠金/额度真正耗尽，则会瞬间熔断报错以避免无限死循环重试。
- **不可变的任务快照（断点续传）**：当点击 `Continue Generation` 恢复失败的生成任务时，系统会严格读取该任务在最初发起时的“快照配置”（例如当时的生图模型、配音角色等），以确保整个视频的画风和音色前后一致。如果需要为旧草稿应用新的系统设置，只需重新加载草稿并点击 `Confirm Generation` 即可发起一个采用最新配置的全新任务。
- **超长请求支持**：针对 15 分钟规格的长视频生成，大模型的请求超时时间上限已放宽至 10 分钟，能够安全、稳定地处理超大型文案生成任务。
- **网络穿透支持**：Docker 容器对外暴露的 3002 端口默认绑定 `0.0.0.0`，允许外部通过局域网 (LAN) 或虚拟子网 (如 Tailscale `100.x.x.x`) 跨设备访问。
## 输出文件夹结构

每个生成的视频都包含以下完整的文件结构：

```text
outputs/{slug}/
  draft.json                        # 视频草稿 (LLM 生成)
  draft.md                          # 草稿 Markdown 版本
  script.json                       # 完整视频脚本 (含时间轴与词汇)
  script.md                         # 脚本 Markdown 版本
  subtitles.srt                     # 字幕文件
  audio.wav                         # 合并后的配音音频
  image-prompts.md                  # 图片生成提示词
  youtube-copy.md                   # YouTube 发布文案 (中英标题、简介、时间戳章节等)
  youtube-copy.json                 # YouTube 文案 JSON 格式
  audio-manifest.json               # 音频缓存状态清单
  image-manifest.json               # 图片生成记录清单
  music-manifest.json               # 背景音乐生成清单
  timeline-manifest.json            # 横屏视频渲染时间轴清单
  timeline-manifest-portrait.json   # 竖屏视频渲染时间轴清单
  quality-report.json               # 质量检查报告 (包含时长对齐、图片数等警告)
  images/                           # 场景及封面图片文件夹
  music/                            # 背景音乐生成音轨文件夹
  slides/                           # 横屏幻灯片帧 PNG 文件夹
  slides-portrait/                  # 竖屏幻灯片帧 PNG 文件夹
  final.mp4                         # 最终横屏视频 (1920x1080, 16:9)
  final-portrait.mp4                # 最终竖屏视频 (1080x1920, 9:16)
  job-state.json                    # 任务状态记录 (用于断点续传)
```

## 竖屏视频模式 (9:16)

每次视频生成均会自动同时输出横屏和竖屏视频：

- `final.mp4` — 1920×1080 (16:9 横屏)
- `final-portrait.mp4` — 1080×1920 (9:16 竖屏)

竖屏模式下会自动复用相同的场景图片，通过对图片进行居中裁剪以填满竖屏画布。合成进度会针对两种尺寸独立追踪（横屏 60–78%，竖屏 78–96%）。

## 封面图图层

封面图的生成独立于故事场景图片的生成：

- `cover-prompts.md` 存储专用的封面提示词。
- `images/cover-youtube.png` 是已渲染好的 16:9 YouTube 风格封面，包含 EchoEnglish 标志、故事标题、简介、难度和 CTA（行为召唤）文本。
- `images/cover-vertical.png` 是已渲染好的 9:16 抖音/TikTok/Reels 风格封面，并适配了垂直布局。
- `images/cover-youtube-bg.*` 和 `images/cover-vertical-bg.*` 为当生成新封面时，由图像模型产出的原始背景图。
- 场景图提示词保留在 `image-prompts.md` 中，并独立于封面进行生成。

封面图图层独立于 MiniMax 和 Google Imagen 提供商。在 Settings -> Image 中，您可以选择故事场景的图片提供商，以及一个独立的封面图片提供商（“Inherit from Scenes” 将与故事场景图片提供商保持一致，您也可以单独禁用封面图生成）。

封面图提示词是根据主题、标题、概要、模板以及故事的视觉风格自动生成的，且已进行过提示词工程，避免生成包含 `Your Text`、破损字母或随机文字的背景。EchoEnglish 采用本地渲染器在生成的摄影背景上叠加文本，文字包含 `ECHOENGLISH`、`今天的故事`、视频标题、简短描述、美国年级难度估算值以及 `Listen & Shadow`。

在预览页（Preview）中包含：
- **Generate Covers**：仅重新生成封面背景图与合成图。
- **DL YouTube Cover**：下载横屏封面图。
- **DL Vertical Cover**：下载竖屏封面图。

## 视频 UI 渲染

MP4 视频的画面 UI 是由本地根据已有素材和数据直接渲染生成的：

- **封面/首页帧**：全屏摄影背景、影院级暗色遮罩、居中故事标题、大播放按钮、摘要和难度标识。
- **字幕**：英文为主字幕并居中显示；中文为副字幕。字号和行高经过精心优化（英文 1.45 倍行高，中文 1.55 倍行高），并带有个性化的段落间距。文字下方带有半透明深色高品质面板（`#000000`，0.72 不透明度，圆角设计）并附带 drop-shadow 阴影以确保在任何复杂背景下都拥有极致的清晰度。
- **关键词高亮**：对当前句中出现的重点英文单词，自动计算文字精确宽度并叠加高对比度的黄色背景（`#facc15`，圆角）和投影；对应的中文翻译也会在字幕中以高亮显示。
- **单词卡**：当当前字幕句中包含重点词汇时，会在屏幕上方角落（竖屏时为顶部居中）自动弹出扁平、深色的单词卡片（`#0f172a`，0.85 不透明度，圆角），展示该英文单词及中文翻译（去除了音标显示以保持界面视觉干净纯粹）。
- **播客对话模式**：左右两侧展示两位固定主持人的头像，以及角色对应的配音和对话字幕。

您可以在 Preview 页使用 **Re-render UI** 重新渲染，它会在不消耗 LLM、TTS、图片或音乐 API 额度的情况下，极速重建 `slides/`、`slides-portrait/`、`final.mp4` 和 `final-portrait.mp4`。

## 硬件视频编码

在 Settings → Video 中，您可以选择：

| 编码器 | 适用场景 |
| --- | --- |
| Auto | 推荐的默认值。自动检测并启用本地可用的硬件加速编码器。 |
| Apple VideoToolbox | macOS 硬件 H.264 编码。 |
| NVIDIA NVENC | NVIDIA GPU 硬件 H.264 编码。 |
| Intel Quick Sync | Intel 硬件 H.264 编码。 |
| CPU libx264 | 稳定可靠的 CPU 软件编码方案。 |

您可以使用以下命令检查本地 FFmpeg 支持的编码器：

```bash
ffmpeg -hide_banner -encoders | grep -E 'h264_videotoolbox|h264_nvenc|h264_qsv|libx264'
```

## 宿主 FFmpeg 网关

针对 Mac 上的 Docker 部署环境，提供了一个通用的 Host FFmpeg Worker，允许所有 Docker 容器直接调用 Apple VideoToolbox：

```text
Docker 容器应用
  -> http://host.docker.internal:4869/run-ffmpeg
  -> Mac 宿主机 FFmpeg Worker (tools/host-ffmpeg-worker.js)
  -> /opt/homebrew/bin/ffmpeg h264_videotoolbox
  -> 将渲染好的视频写回共享挂载卷
```

在 Mac 宿主机上启动 Worker：

```bash
HOST_FFMPEG_WORKER_HOST=0.0.0.0 \
HOST_FFMPEG_TOKEN=change-me \
HOST_FFMPEG_BIN=/opt/homebrew/bin/ffmpeg \
HOST_FFMPEG_PATH_MAPS="/app/outputs=$(pwd)/outputs" \
node tools/host-ffmpeg-worker.js
```

其他的 Docker 项目也可以通过在 `HOST_FFMPEG_PATH_MAPS` 中添加其路径映射来复用此 FFmpeg 加速服务。

## 技术栈

- **后端**: Node.js + 原生HTTP模块
- **前端**: 原生HTML/CSS/JavaScript
- **视频合成**: FFmpeg
- **图片处理**: Sharp
- **AI模型**: 
  - 文本: DashScope/Qwen、小米MiMo
  - TTS: MiniMax、Google Gemini、小米MiMo TTS
  - 图片: MiniMax image-01、Google Imagen
  - 音乐: MiniMax music-2.6

## 常见问题

### 图片生成失败

**问题**: MiniMax图片API超时或质量检查失败

**解决**: 
- 检查网络连接
- 减少同时生成的图片数量
- 使用"Continue Generation"重试

### 字幕显示不全

**问题**: 长句子字幕被截断

**解决**: 
- 系统已支持最多3行字幕
- 竖屏模式每行42字符，横屏模式每行52字符
- 使用"Re-render Video UI"重新渲染

### 内容重复

**问题**: 视频后半部分出现重复的里程碑内容

**解决**: 
- 系统已移除强制场景填充逻辑
- 使用AI生成的模板，内容更丰富
- 重新生成视频

### GitHub推送失败

**问题**: 无法推送到GitHub

**解决**: 
```bash
# 使用GitHub CLI认证
gh auth login -h github.com

# 配置git使用gh认证
gh auth setup-git

# 推送
git push origin main
```

## 开发

```bash
# 构建
npm run build

# 检查语法
node --check src/webServer.js

# 启动开发服务器
PORT=3002 npm run web
```

## 安全

- `settings.local.json` 是本地文件，已被git忽略
- 浏览器摘要会隐藏已保存的密钥
- 访问PIN可以保护本地/局域网使用
- 避免提交包含私人内容的生成输出
- 不要将API密钥粘贴到公开的issue、截图或README文件中

## 许可证

本项目采用 MIT 许可证 - 详见 [LICENSE](LICENSE) 文件

## 联系方式

- GitHub: [naecoyes](https://github.com/naecoyes)
- 项目链接: [https://github.com/naecoyes/EchoEnglish](https://github.com/naecoyes/EchoEnglish)

---

<p align="center">
  Made with ❤️ for English learners
</p>
