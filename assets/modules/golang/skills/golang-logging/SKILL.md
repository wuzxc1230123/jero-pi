---
name: golang-logging
description: 结构化日志：log/slog 为新代码默认、级别选择、logger 传递（注入 vs context）、结构化字段、脱敏、多目的地与采样。当写日志、选级别或迁移旧 log 时使用。触发词：日志、slog、log、级别、结构化、脱敏、多目的地。
---

# 日志（Go）

管"日志是给未来排障者的信"：结构化、有级别、带上下文、不含秘密。

> **相关技能：** 错误只处理一次（记日志即处理）→ `golang-errors`；context 传 logger 的边界 → `golang-context`；生产可观测全景 → `golang-troubleshooting`。

## 何时使用

写新日志、选择日志级别、设计 logger 传递方式、做脱敏或迁移 log/logrus 时使用。

## 核心要点

- **slog 是默认**（Go 1.21+）：新代码 `log/slog`；`slog.New(slog.NewJSONHandler(os.Stdout, opts))` 起步；旧 `log` 标准库只在极简场景。Go 1.26 起 `slog.NewMultiHandler` 原生多目的地（同事件写多 handler，替代手写 fan-out）。
- **logger 传递**：显式参数/结构体字段注入优先（依赖可见、类型安全）；`loggerFromCtx(ctx)` 模式仅限横切中间件（HTTP handler 装配处注入），业务函数不依赖从 ctx 里掏 logger。
- **级别纪律**：DEBUG 排障细节（默认关）/INFO 正常生命周期事件/WARN 可自动恢复的异常/ERROR 需要人看——ERROR 的判定标准是"发出即可能触发告警"，不是"这行代码不太确定"。
- **结构化字段**：`slog.String("order_id", id)` 代替 Sprintf 进消息；消息保持稳定短语（可索引），变量值全部进字段；字段名项目内统一（snake_case 或 kebab-case 选一）。
- **脱敏**：Authorization/Cookie/token/password 字段过敏感名单过滤；用户输入不直接进日志（注入面：日志里的伪造换行/控制字符）。
- **错误与日志的边界**：`slog.Error("...", "err", err)` 后不再 return err 给调用方再记一次——见 `golang-errors` 的只处理一次。

## 红线

- 密钥/token/密码明文入日志。
- Sprintf 拼消息代替结构化字段；ERROR 级刷屏（告警疲劳源头）。
- 库代码里直接用全局 logger（剥夺调用方配置权——库返回错误，应用层记日志）。

## 深读指路（references/）

日志全文（级别矩阵/传递模式/脱敏名单/多目的地与采样）：`references/logging-slog.md`。
