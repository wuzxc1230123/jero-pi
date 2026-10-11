---
name: golang-cli
description: CLI 应用工程：Unix 退出码纪律、stdout/stderr 分离、flag 分层与子命令、信号处理与优雅关闭、输出可组合性。当写命令行工具或 daemon 入口时使用。触发词：CLI、命令行、flag、子命令、退出码、信号、SIGINT、优雅关闭、cobra。
---

# CLI 工程（Go）

管"CLI 是协议"：退出码、流、信号是与调用方（shell/CI/编排器）的契约。

> **相关技能：** 入口结构（main/run 模式）→ `golang-project`；context 取消驱动关闭 → `golang-context`；配置分层属部署面 → 本技能要点。

## 何时使用

写新的命令行工具、daemon 入口、处理信号与优雅关闭、设计输出格式时使用。

## 核心要点

- **退出码纪律**：0 = 成功；非 0 = 失败且**按失败类分码**（约定俗成：1 通用失败、2 用法错误）；`main` 里 `os.Exit` 只在最后调用一次（`defer` 在 os.Exit 后不执行——run 模式先返回错误再退出，见 `golang-project`）。
- **流分离**：结果（被管道消费的）→ stdout；诊断（人读的进度/错误）→ stderr；绝不把提示语混进 stdout 破坏管道（`tool | jq` 必须能工作）。
- **信号与优雅关闭**：`signal.NotifyContext(ctx, os.Interrupt, syscall.SIGTERM)`（Go 1.21+；1.26 起取消携带 cause=sIGNAL）→ 停止接收新请求 → 处理完在途（带超时，`context.WithTimeout`）→ 关资源 → 退出；SIGTERM 语义是"请退出"不是"立刻崩"。
- **flag 分层**：命令行 flag > 环境变量 > 配置文件 > 默认值，显式覆盖隐式；子命令场景标准库 `flag` 子集 + 手写 dispatch 可胜任，命令树复杂再上 cobra 类（引入成本见 `golang-deps` 四问）。
- **输出可组合**：默认给人读（简洁），`-json` 给机器（稳定 schema，字段只加不改）；进度信息进 stderr；颜色/TTY 检测（非 TTY 自动禁用，管道安全）。
- **测试**：CLI 的 run 逻辑做成 `Run(args []string, stdout, stderr io.Writer) error` 可测函数——main 只剩装配；子命令 dispatch 表可表驱动测试。

## 红线

- 错误信息打 stdout、退出码永远 0（CI 检测不到失败）。
- 收到 SIGTERM 立即丢在途请求退出。
- `defer` 依赖能执行的代码放在 os.Exit 之后的路径上。

## 深读指路（references/）

CLI 全文（退出码表/信号金样/flag 分层样例/JSON 输出契约）：`references/cli-engineering.md`。
