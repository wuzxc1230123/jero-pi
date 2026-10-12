# 出处与授权账本（_sources）

> 本篇是 godot 模块的知识来源账本：逐篇登记派生源与授权。权威级分四级：
> **规范**（官方指南/引擎规范级）· **建议**（工程最佳实践）·
> **历史语境**（旧版本背景）· **项目纪律**（本仓裁决）。
> **本账本为事后补录（2026-10）**：godot 束早于账本纪律（golang 批
> 引入）建立，本篇依 git 提交记录与 `docs/module-contract.md` 的骨架
> 对齐记载重建，逐篇精度为**域级**（来源归到素材族），非逐句级。

## 上游仓库

| 仓库 | 许可 | 用途 |
|---|---|---|
| github.com/awesome-gamedev-agent-skills（快照 `awesome-gamedev-agent-skills-main/`） | 快照内无许可文件 | **仅结构骨架对齐**（SKILL.md/代理档案的通用骨架——见 module-contract 契约文档记载），未复制其文本内容 |
| GD-Agentic-Skills（快照 `GD-Agentic-Skills-main/`） | 快照内无许可文件 | 同上：骨架与域方法参考（gamedev 实践谱系） |
| GodotPrompter（快照 `GodotPrompter-master/`） | 快照内无许可文件 | 同上：骨架对齐 |
| act-combat-design（快照 `act-combat-design-main/`，已清理） | MIT（记录于 dcc8708 提交） | combat-design/boss-design 两篇的全中文 ACT 战斗设计方法论知识库——精编吸收（内容级来源） |
| docs.godot引擎官方文档（Godot 4.x 手册/最佳实践/GDScript 参考/.NET 集成） | 按其文档许可（开放） | 语言/引擎/平台面的方法与事实核对 |
| godot-ai（MCP 服务器）官方仓库文档 | 按其仓库许可 | editor-live-session 活会话桥与模块 MCP 档（uvx 钉版 godot-ai@4.2.3）的接线依据 |

三份骨架对齐快照无许可文件且仅作结构参考（结构与思想不受版权保
护，实际骨架契约由本仓 module-contract 文档钉住）；内容级来源仅
act-combat-design（MIT，署名义务以本表登记履行）与官方文档。

## 逐篇登记（域级归组）

| reference | 主要来源 | 权威级 |
|---|---|---|
| combat-design | act-combat-design（MIT，dcc8708 精编吸收） | 规范+建议 |
| boss-design | act-combat-design（MIT，dcc8708 精编吸收） | 建议 |
| gdscript-style / common-pitfalls / signals-groups / scene-architecture / resources-data / math-essentials | Godot 4 官方文档（GDScript 参考/4.x 陷阱与改名） | 规范 |
| input-actions / performance / multithreading / testing / export-publishing / localization / asset-pipeline / addon-development | Godot 4 官方文档（对应手册章）+ gamedev 生态实践参考 | 规范+建议 |
| csharp-dotnet | Godot .NET/C# 集成文档 + Microsoft Learn | 规范 |
| editor-live-session | godot-ai 官方文档（MCP 活会话桥） | 建议 |
| component-system / dependency-injection / camera-systems / audio-animation | Godot 官方文档 + gamedev 生态模式实践 | 建议 |
| game-ai / game-feel / ability-system / physics-gameplay / procedural-gen / dialogue-narrative | Godot 官方文档 + 游戏设计方法论（gamedev 生态参考） | 建议 |
| multiplayer / save-systems | Godot 官方文档（高阶多玩家/序列化）+ 生态实践 | 规范+建议 |
| 3d-essentials / tilemap-levels / ui-theming / mobile-development / xr-development | Godot 官方文档（3D/瓦片/UI/平台导出章） | 建议 |
| genres-recipes / jam-prototyping | 本仓综合生态实践重蒸馏 | 建议 |
| verification | 本仓原创（模块族三道门协议） | 项目纪律 |
| _sources | 本篇 | 项目纪律 |

（斜杠归组的条目共享同一行——同源同权威级；逐文件计 39 篇。）

## 引用上游时的红线

- **MCP 档谱系**：godot-ai 档 3f159a8 引入（uvx --from 浮动）→
  a342a1c 钉版 `godot-ai@4.2.3`（供应链与可复现）→ 61b79c2 合并
  目标收口项目级 `.pi/mcp.json`——本束是四束中唯一**声明 MCP 档**
  的（uvx 白名单 + 钉版 + 禁 env 全合规）。
- 快照（三份骨架库）留在工作区根供查阅，不入库（.gitignore）；
  act-combat-design 快照已在内容吸收后清理，MIT 记录以提交信息
  为准。
- 上游知识锚定 Godot 4.x 当前稳定谱系；引擎版本特性引用以官方
  文档核验（common-pitfalls 的 4.x 改名表是勘误清单）。
- 本账本随内容演进同步更新：新增 reference 必登记，来源变更必记
  版本与日期。
