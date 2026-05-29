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

1. 复制设置文件：
```bash
cp settings.example.json settings.local.json
```

2. 编辑 `settings.local.json`，配置以下API密钥：
   - **LLM API** - 用于生成视频脚本（推荐：DashScope/Qwen或小米MiMo）
   - **TTS API** - 用于生成配音（推荐：MiniMax或小米MiMo TTS）
   - **图片API** - 用于生成场景图片（推荐：MiniMax image-01）
   - **音乐API** - 用于生成背景音乐（推荐：MiniMax music-2.6）
   - **搜索API** - 用于获取事实内容（推荐：Tavily）

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

## 输出文件

每个生成的视频包含以下文件：

```
outputs/{slug}/
  draft.json              # 视频草稿
  draft.md                # 草稿Markdown版本
  script.json             # 完整视频脚本
  script.md               # 脚本Markdown版本
  subtitles.srt           # 字幕文件
  audio.wav               # 合并后的音频
  image-prompts.md        # 图片生成提示词
  youtube-copy.md         # YouTube发布文案
  youtube-copy.json       # YouTube文案JSON格式
  audio-manifest.json     # 音频缓存状态
  image-manifest.json     # 图片生成记录
  music-manifest.json     # 音乐生成记录
  quality-report.json     # 质量检查报告
  images/                 # 场景图片文件夹
  music/                  # 背景音乐文件夹
  slides/                 # 幻灯片文件夹
  final.mp4               # 横屏视频(1920x1080)
  final-portrait.mp4      # 竖屏视频(1080x1920)
  job-state.json          # 任务状态记录
```

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
