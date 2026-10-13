# 工具选型指路（tooling-guide）

> 来源：cc-skills-golang gopls/pkg-go-dev 篇（MIT）蒸馏；权威级：建议
> 最低 Go 版本：1.24 ｜ 核验日期：2026-10 ｜ 授权账本：`_sources.md`

## 语义代码智能：gopls

- 三通道：编辑器 LSP（跳转/引用/重命名/内联提示/诊断）、CLI
  （`gopls definition`/`references`/`rename`——脚本化重构）、
  **官方 MCP 服务器**（2025 年起内置，`gopls mcp` 子命令，headless
  启动无需 LSP 客户端；stdio 默认，`-listen=localhost:3000` 走 SSE
  over HTTP；基于 MCP 官方 Go SDK 构建）。
- **gopls mcp 的八个工具**：`go_workspace`（工作区形态）、`go_search`
  （符号模糊搜索）、`go_file_context`（同包依赖摘要）、`go_package_api`
  （包公共 API）、`go_symbol_references`（符号引用）、`go_rename_symbol`
  （语义重命名）、`go_diagnostics`（诊断）、`go_vulncheck`（可达漏洞）。
  官方自带 instructions（Read/Edit 两条工作流：会话起手 workspace+
  vulncheck、读文件后 file_context、改符号前 references）；接线样例与
  消费纪律见束内 `golang-mcp` 技能。
- **成熟度**（2026-10 核验）：remote 模式未支持、settings 注入与多
  工作区端口管理仍在建（golang/go #77960/#75270）——可用，别当稳定
  契约；升级 gopls 时 `gopls mcp -instructions` 现查工具面。
- **本模块不声明该 MCP 档**：束内供应链门强制 command ∈ {uvx,npx} +
  钉版 token，gopls 的分发形态（本地二进制 / `go run`）不合规；
  用户手工接项目级 `.pi/mcp.json` 是契约显式豁免的路径（样例在
  `golang-mcp` 技能）。
- 大规模重构优先 gopls 语义操作（rename/extract），不是文本替换；
  `gopls check`/`gopls diff` 改前后对照。

## 包文档查询：pkg.go.dev

- 查包文档/版本/许可/importers：pkg.go.dev 站点或 `go doc <pkg>`
  （本地、离线）；`go doc -all` 全包符号。
- 选型对照先看 importers 数与最近发布（活跃度信号），再过依赖四问
  （dependency-management）。

## 静态分析矩阵

| 工具 | 定位 | 何时引入 |
|---|---|---|
| `go vet` | 官方标配，零配置 | 永远（门 2，verification-gates） |
| `golangci-lint` | 聚合器（errcheck/staticcheck/revive/shadow…） | 团队规模到"评审总吵同类问题"时 |
| `staticcheck` | 单独用（不引聚合器时） | 轻量替代 |
| `govulncheck` | 漏洞（符号级可达） | 有外部输入的服务即配 |
| `gosec` | 安全专项规则 | 安全敏感项目（规则噪音先试运行） |

- golangci-lint 配置最小集起步：errcheck（漏检错误）+ goimports +
  staticcheck +（视团队）revive；nolint 注释必须带原因。
- linter 是评审的减负器不是替代品——机械问题让工具报，人评审设计。

## 基准与剖析

- benchstat（对比统计）、pprof（内置）、trace（调度）——用法见
  benchmark-measurement 与 pprof-profiling。
- 采集命令统一进 Makefile/任务清单（一处定义，多处引用）。

## 生成与脚手架

- `go generate`：注释指令位（`//go:generate stringer -type=Kind`）；
  生成物提交与否项目内统一（提交 = CI 无生成依赖；不提交 = CI 必跑）。
- `stringer`/`enumer` 类生成器引入走依赖四问。

## 本模块的工具面立场

- 模块不携带脚本资产（契约布局的技能面只有知识文档）；确定性检查
  以"命令 + 退出码"形态内联在 verification-gates——CLI 本身就是
  契约，不需要包装脚本。
- 安装器不装工具链：`go`/gopls/golangci-lint 的可用性由 `/jero:doctor`
  类诊断显影，本模块的验证角色（golang-tester）在工具缺席时如实
  报 `NOT VERIFIED`。
