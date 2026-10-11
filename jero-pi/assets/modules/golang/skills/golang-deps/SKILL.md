---
name: golang-deps
description: 依赖管理：go.mod/go.sum 纪律、MVS 语义、版本选择与 replace/exclude、govulncheck 漏洞扫描、vendoring、go.work。当增删依赖、处理版本冲突或跑漏洞扫描时使用。触发词：依赖、go.mod、go.sum、replace、MVS、版本冲突、vendoring、govulncheck。
---

# 依赖管理（Go）

管"依赖是资产负债表"：每个 import 是负债（安全面/升级面/许可面），最小化是默认策略。

> **相关技能：** 标准库优先选型 → `golang-generics`；多模块布局 → `golang-project`；漏洞与供应链红线 → `golang-security`。

## 何时使用

引入新第三方库、处理版本冲突、审阅 go.mod 变更、跑漏洞扫描时使用。

## 核心要点

- **go.mod/go.sum 纪律**：go.sum 是锁定的校验和（防篡改），绝不手编、绝不 gitignore；升级用 `go get module@version` 而不是手改 go.mod 行；`go mod tidy` 收尾清孤儿需求。
- **MVS 语义**：Go 用最小版本选择——选所有需求里**最高的那个声明版本**（不是 npm 式最近发布）；"为什么是这版"的答案在依赖图里，`go mod graph` / `go why <pkg>` 可查。
- **主版本是路径的一部分**：`/v2` 后缀是不同模块；不兼容升级是 import 路径改写，不是版本号魔法。
- **replace 纪律**：本地调试 `replace => ../local` 可用但**绝不提交**（发布面灾难）；fork 替换要注释原因与退出条件；`exclude` 只为绕过已知坏版本且留注释。
- **go.work**：monorepo 本地开发的 replace 层（`go work use ./xxx`），不随发布生效；CI 与发布路径必须验证过无 go.work 也能构建（`GOWORK=off go build ./...`）。
- **漏洞扫描**：`govulncheck ./...` 只报真实可达的调用路径（符号级），进 CI 定期跑；升级是第一修复路径，绕过要有记录。
- **引入前四问**：标准库/slices/maps 能不能替代？维护活跃吗（最近 release/issue 响应）？传递依赖面多大（`go mod graph`）？许可兼容吗（MIT/BSD/Apache 友好；GPL 类进库要法务）。

## 红线

- 手编 go.sum、提交本地 replace、go.sum 进 .gitignore。
- 引入依赖只因"GitHub 星多"。
- 漏洞报告长期搁置不升级不记录。

## 深读指路（references/）

依赖全文（MVS 案例/replace 矩阵/vendoring/go.work 细则）：`references/dependency-management.md`。
