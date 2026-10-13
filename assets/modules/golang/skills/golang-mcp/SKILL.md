---
name: golang-mcp
description: gopls 官方 MCP 服务器（gopls mcp）的接线与工作流：项目级 .pi/mcp.json 两种形态、八个 go_* 工具的用途、官方 Read/Edit 工作流、工具缺席时的降级。当需要接入或使用 gopls 语义工具（go_workspace/go_search/go_symbol_references 等）时使用。触发词：gopls MCP、go_workspace、go_search、go_symbol_references、go_vulncheck、语义工具、MCP 接线。
---

# gopls MCP 接线与工作流（golang-mcp）

管"官方语义工具的接入与消费"：gopls 自带 MCP 服务器（Go 团队官方，`gopls mcp` 子命令），本模块不替用户声明它——接线是项目级手工动作，本技能管怎么接、接上后怎么用、没接怎么降级。

> **相关技能：** 验证三道门（go_diagnostics 不替代验证协议）→ `golang-testing`；漏洞扫描纪律（go_vulncheck 呼应）→ `golang-deps`；工具选型全景 → 本技能深读 `references/tooling-guide.md`。

## 何时使用

想把 gopls 语义工具接进会话（写 `.pi/mcp.json`）、会话里 `go_*` 工具已在位要按官方工作流消费、或排查"gopls mcp 起不来"时使用。

## 核心要点

- **接线（用户手工，Pi ≥0.99 项目作用域）**：项目 `.pi/mcp.json` 二选一——
  本地已装 gopls：`{"mcpServers": {"gopls": {"command": "gopls", "args": ["mcp"]}}}`；
  钉版形态（免预装）：`{"command": "go", "args": ["run", "golang.org/x/tools/gopls@v0.20.1", "mcp"]}`。
  stdio 默认；`-listen=localhost:3000` 走 SSE over HTTP（多客户端共享时）。
- **为什么模块不声明**：束内供应链门强制 command ∈ {uvx, npx} + 钉版 token，gopls 的分发形态（本地二进制 / go run）不在白名单——契约豁免的是项目内手工模块，正是上面手工接线的依据。
- **八个工具**：`go_workspace`（工作区形态）·`go_search`（符号模糊搜索）·`go_file_context`（同包依赖摘要）·`go_package_api`（包公共 API）·`go_symbol_references`（符号引用）·`go_rename_symbol`（语义重命名）·`go_diagnostics`（诊断）·`go_vulncheck`（可达漏洞）。
- **官方工作流**（gopls 自带 instructions 的骨架）：会话起手 `go_workspace` + `go_vulncheck`；首次读任何 Go 文件后 `go_file_context`；改符号定义前必 `go_symbol_references` 评估波及；编辑循环内用 `go_diagnostics` 复核。
- **降级**：工具不在位（未接线/宿主无 MCP 面）时照常干活——grep/find/`go vet`/三道门不依赖 MCP；绝不声称调用了不存在的工具，绝不因缺工具阻塞交付。
- **边界**：`go_diagnostics` 是增量语义诊断，不等于验证协议（退出码三道门仍是唯一验证结论）；`go_vulncheck` 结果仍按 `golang-deps` 的升级纪律处置。

## 红线

- 工具缺席时假装已用（编造工具调用输出）。
- 为绕供应链门把 `gopls mcp` 硬塞进包内束清单。
- 用语义工具结论替代退出码验证证据。

## 深读指路（references/）

工具选型与 gopls MCP 事实核验（命令/传输/成熟度）：`references/tooling-guide.md`。
