# EchoEnglish TODO

## P0 可用性修复

- [x] `/preview` 无 query 时自动使用最近完成的视频。
- [x] 自定义进度条使用真实 media duration，并保留原生 video controls。
- [x] 访问 PIN 保护 `/outputs/...`、API 和前端页面。

## P1 草稿审核闭环

- [x] Generate 页改为“生成草稿 -> 审核/修改 -> 确认生成”。
- [x] 新增 `/api/story-draft` 和 `/api/revise-story-draft`。
- [x] 草稿固定 15 分钟、28-30 场、每场 4 句。
- [x] 事实型模板强制 Tavily + LLM factual documentary。

## P2 模板与模型配置

- [x] 内置 10 套视频类型模板。
- [x] Settings 增加 model profile：balanced、fast-draft、high-quality-media、manual。
- [x] Settings 支持 LLM base/model、TTS/Image/Music 模型、English/Chinese voice、music track count。

## P3 代码整理

- [x] 模板规则抽出到 `src/videoTemplates.js`。
- [x] 模型 Profile 和本地配置逻辑集中在 `src/settingsStore.js`。
- [ ] 继续拆分 `src/webServer.js` 的旧 HTML fallback 和 API 路由。
- [ ] 继续拆分 `frontend/src/main.jsx` 的页面组件。

## P4 质量报告与回归测试

- [x] 每次生成写入 `quality-report.json`。
- [x] 报告包含 video/audio/subtitle duration、image count、music track count、factual mode、warnings。
- [ ] 完成一次新的 15 分钟端到端生成，确认 112-120 张图片、3 段音乐和字幕对齐。
- [ ] 手机 390px 宽度人工复测 Generate、Draft Review、Preview、Settings。
