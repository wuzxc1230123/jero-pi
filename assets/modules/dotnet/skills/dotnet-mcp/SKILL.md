---
name: dotnet-mcp
description: binlog MCP 服务器（Microsoft.AITools.BinlogMcp，.NET 团队官方）的接线与工作流：项目级 .pi/mcp.json 手工形态、结构化查询工具面、GUI 回放降级。当需要把 binlog 结构化查询接进会话或代理级排障构建失败时使用。触发词：binlog MCP、Microsoft.AITools.BinlogMcp、构建排障、MCP 接线。
---

# binlog MCP 接线与工作流（dotnet-mcp）

管"官方构建排障工具的接入与消费"：.NET 团队技能库内嵌 binlog MCP 服务器（`Microsoft.AITools.BinlogMcp`，stdio），本模块不替用户声明它——接线是项目级手工动作，本技能管怎么接、接上后怎么用、没接怎么降级。

> **相关技能：** 构建排障本体（binlog 采集与判读、慢构建专项） → `dotnet-msbuild`；验证三道门（MCP 查询不替代退出码） → `dotnet-testing`。

## 何时使用

想把 binlog 结构化查询接进会话（写 `.pi/mcp.json`）、会话里 `binlog` 工具已在位要消费、或构建失败需要代理级排障时使用。

## 核心要点

- **接线（用户手工，Pi ≥0.99 项目作用域）**：项目 `.pi/mcp.json` 写 `{"mcpServers": {"binlog": {"command": "dotnet", "args": ["dnx", "Microsoft.AITools.BinlogMcp", "--yes", "--prerelease"]}}}`——`dnx`（.NET 10 即跑命令）按需拉取；`--prerelease` 浮动不钉版，是用户自己的供应链决策。
- **为什么模块不声明**：束内供应链门强制 command ∈ {uvx, npx} + 钉版 token，binlog MCP 的分发形态（`dotnet dnx` + 浮动 prerelease）不在白名单——契约豁免的正是项目内手工接线。
- **工具面**：结构化查询 `.binlog`（目标/任务/属性/消息），先 `tools/list` 探明再调用——代理不必人工回放成文本再检索。
- **降级**：工具不在位（未接线/宿主无 MCP 面/离线）时照常干活——`dotnet build -bl` + MSBuild Structured Log Viewer 的回放工作流是完整替代；绝不声称调用了不存在的工具，绝不因缺工具阻塞交付。
- **边界**：MCP 查询是排障辅助，不等于验证协议（退出码三道门仍是唯一验证结论，`references/verification-gates.md`）。

## 红线

- 工具缺席时假装已用（编造工具调用输出）。
- 为绕供应链门把 `dnx` 形态硬塞进包内束清单。
- 用 MCP 查询结论替代退出码验证证据。

## 深读指路（references/）

binlog 采集/判读/慢构建专项：`references/binlog-analysis.md`。
