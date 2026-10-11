# 出处与授权账本（_sources）

> 本篇是 golang 模块的知识来源账本：逐篇登记派生源与授权。权威级分四级：
> **规范**（官方风格指南/语言规范级）· **建议**（工程最佳实践）·
> **历史语境**（旧版本背景）· **项目纪律**（本仓裁决）。

## 上游仓库

| 仓库 | 许可 | 用途 |
|---|---|---|
| github.com/samber/cc-skills-golang（快照于本仓 `cc-skills-golang-main/`） | MIT | 工程/性能/安全/CLI/现代化/工具面的结构与方法论蒸馏 |
| github.com/cxuu/golang-skills（快照于本仓 `golang-skills-main/`） | Apache-2.0 | 语言特性面（风格/命名/声明/错误/防御/接口/泛型/测试）的决策树与权威源快照（Google/Effective Go/Uber 风格指南、Go Wiki CodeReviewComments） |
| go.dev 官方文档（release notes 1.22–1.26、blog、标准库文档） | CC-BY 4.0 | 版本特性与 API 事实核对（2026-10 核验） |

两份快照的知识停驻在 Go 1.24/1.25 早期；本模块以 Go 1.25/1.26 为
锚点重蒸馏（wg.Go、b.Loop 内联语义、go fix 体系、Green Tea GC、
errors.AsType、slog.NewMultiHandler、os.Root、1.26 泄漏剖析等），
非逐句翻译。MIT/Apache-2.0 允许派生；此处登记出处即履行署名义务。

## 逐篇登记

| reference | 主要来源 | 权威级 |
|---|---|---|
| style-and-formatting | cxuu（Google/Effective Go 快照） | 规范 |
| naming | cxuu（Effective Go/Google/Uber 快照） | 规范 |
| declarations-scope | cxuu（Effective Go/CodeReviewComments 快照） | 规范 |
| error-handling | cxuu + samber error 篇 + Go Blog | 规范 |
| defensive-boundaries | cxuu defensive + samber safety 篇 | 规范 |
| concurrency-goroutines | samber concurrency 篇 + Go Blog | 规范 |
| concurrency-channels | samber channels-and-select 篇 + Go Blog | 规范 |
| sync-primitives | samber sync-primitives 篇 + 标准库文档 | 规范 |
| context-patterns | cxuu context + Go Blog Context 篇 | 规范 |
| interface-design | cxuu interfaces + Go Wiki | 规范 |
| generics-constraints | cxuu generics + Go Blog 泛型系列 + 1.26 release notes | 规范 |
| slices-maps-internals | cxuu data-structures + Go Blog 切片系列 | 规范 |
| testing-table-driven | cxuu testing + Go Wiki TableDrivenTests | 规范 |
| testing-advanced | samber testing 篇 + 官方 testing 文档 | 建议 |
| benchmark-measurement | samber benchmark 篇（8 文件）+ benchstat 文档 | 建议 |
| pprof-profiling | samber pprof/trace 篇 + 官方 pprof 文档 | 建议 |
| performance-playbook | samber performance 篇（6 文件） | 建议 |
| troubleshooting-bugs | samber troubleshooting 篇（common-bugs 目录重构） | 建议 |
| security-injection-crypto | samber security 篇（12 文件；Bearer SAST 谱系） | 规范 |
| security-architecture | samber security/architecture 篇 | 建议 |
| logging-slog | cxuu logging + samber slog 篇 + 官方 log/slog 文档 | 规范 |
| project-layout | samber project-layout 篇 + Go 官方模块组织文 | 建议 |
| dependency-management | samber dependency-management 篇 + 官方 modules 文档 | 规范 |
| cli-engineering | samber cli 篇（可编译示例工程蒸馏） | 建议 |
| modern-go-versions | samber modernize 篇 + go.dev 1.22–1.26 release notes | 规范 |
| verification-gates | 本仓原创（对齐 godot 模块 verification.md 协议） | 项目纪律 |
| tooling-guide | samber gopls/pkg-go-dev 篇 + gopls MCP 事实核验（见下） | 建议 |
| _sources | 本篇 | 项目纪律 |

## 引用上游时的红线

- **gopls MCP 事实核验（2026-10）**：官方 MCP 服务器（`gopls mcp`，
  2025 年内置，八工具 `go_workspace`/`go_search`/`go_file_context`/
  `go_package_api`/`go_symbol_references`/`go_rename_symbol`/
  `go_diagnostics`/`go_vulncheck`，stdio/SSE 传输）经 golang/tools
  源码直查确认（`gopls/internal/cmd/mcp.go` 与
  `gopls/internal/mcp/mcp.go`），成熟度注记与接线样例见
  `tooling-guide.md` 与束内 `golang-mcp` 技能。

- 上游的英文文案不是本模块内容——本模块全部中文重写；引用代码示例
  时按 MIT/Apache 惯例无需逐段标注，但结构性方法（如 benchstat 门禁
  剧本的骨架）来源于上表登记。
- 上游素材库的知识停驻版本（1.24/1.25 早期）低于本模块锚点
  （1.25/1.26）——从快照取材时必须过 1.26 勘误（modern-go-versions
  的逐版本表是勘误清单）。
- 本账本随内容演进同步更新：新增 reference 必登记，来源变更必记
  版本与日期。
