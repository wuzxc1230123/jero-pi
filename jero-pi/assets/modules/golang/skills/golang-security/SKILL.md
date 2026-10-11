---
name: golang-security
description: 安全红线：注入防护（SQL/命令/路径穿越）、密码学选型、密钥管理、SSRF、输入校验、日志脱敏、依赖漏洞扫描。当写涉及外部输入、加密、文件路径或网络的代码时使用。触发词：安全、注入、SQL、密码学、加密、密钥、路径穿越、SSRF、脱敏、govulncheck。
---

# 安全（Go）

管"默认不信任"：外部输入（用户/网络/文件）进边界前都是攻击面，标准库的坑点要背下来。

> **相关技能：** 边界防御纪律 → `golang-defensive`；依赖面与漏洞扫描 → `golang-deps`；日志脱敏细节 → `golang-logging`。

## 何时使用

处理外部输入、用密码学 API、操作文件路径、发起网络请求、管理密钥/凭证时使用；评审安全敏感变更必过。

## 核心要点

- **注入三防**：SQL 一律参数化（`db.QueryContext(ctx, "... WHERE id = ?", id)`，绝不 Sprintf 拼 SQL）；shell 命令避免拼参数（`exec.CommandContext(ctx, "git", arg)` 参数化传递，不经 shell）；路径清洗用 `filepath.Clean` + 前缀校验 + `os.Root`（Go 1.24+）锚定根目录防穿越。
- **crypto/rand vs math/rand**：安全敏感（token/会话/盐/密钥）只 `crypto/rand`；密码哈希用 `golang.org/x/crypto/bcrypt`/`argon2` + 每次新盐，绝 MD5/SHA1 明文存密码。
- **TLS**：默认 `crypto/tls` 现代默认（Go 1.22+ 默认最低 TLS 1.2）；不 `InsecureSkipVerify: true`（测试外的出现即漏洞）；证书钉扎是例外要注释说明。
- **SSRF**：用户提供的 URL 抓取前校验 scheme（http/https）与解析 IP（拒绝内网段/环回/link-local）；重定向逐跳复检。
- **secrets 纪律**：密钥不进源码/日志/错误信息/环境 echo；`.env` 与密钥文件 gitignore；轮换流程先于算法选型。
- **日志脱敏**：Authorization/Cookie/token/密码字段结构化脱敏（`golang-logging` 的脱敏模式）；错误响应不回传内部栈/SQL。
- **依赖漏洞**：`govulncheck ./...`（按调用路径分级，符号级误报少）进 CI；升级策略见 `golang-deps`。

## 红线

- `InsecureSkipVerify: true`、MD5/SHA1 存密码、math/rand 生成凭证。
- 拼接 SQL/shell、未校验的用户路径直接开文件。
- 密钥硬编码与 secrets 入日志。

## 深读指路（references/）

注入与密码学红线（逐项样例）：`references/security-injection-crypto.md`；威胁建模与依赖面：`references/security-architecture.md`。
