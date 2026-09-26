---
name: release
description: "通过 GitHub 与 npm 发布 jero-pi。触发词：release、publish、npm publish、GitHub release、版本号提升。"
license: Apache-2.0
metadata:
  author: jero-pi
  version: "1.3"
---

## 何时使用

在准备、发布或验证 `jero-pi` 版本时，使用本技能。

## 硬性规则

- 不要从本地机器把 `jero-pi` 发布到 npm。
- npm 发布必须走 GitHub Actions 工作流 `.github/workflows/publish.yml`，让溯源、环境保护与注册表凭据都由 GitHub 掌控。
- 从受保护的默认 `main` 派发受信任的工作流定义，绝不从发布标签派发。它唯一的调用方输入是精确的附注版本标签。
- 发布提交使用干净的工作树。不要打包无关的本地文件或草稿产物。
- 评审结果是信息性的。版本交付遵循普通仓库策略，不得被 RDD 阻塞、授权或改写。
- 绝不从本地 `HEAD` 推断发布标签目标；使用新拉取的 `origin/main` 提交与仓库正常的发布保险。
- 绝不跳过包验证。发布工作流会再次运行验证，但打标签前本地验证仍应通过。

## 发布流程

按 `references/runbook.md` 的逐步命令执行（含幂等校验）：

1. 检查状态（干净工作树 + 最新 `origin/main`）。
2. 准备发布提交（提升 `package.json` 版本，不夹带无关 lockfile 变更）。
3. 本地验证（`pnpm test` + `verify-package-files` + `npm pack --dry-run`）。
4. 提交并推送 `main`。
5. 对新拉取的 `origin/main` 提交创建并验证精确的附注版本标签，创建 GitHub release。
6. 从受保护的 `main` 派发 `publish.yml` 工作流（唯一输入：精确 `vSemVer` 标签），观察运行。
7. 验证 npm 精确版本与 dist-tag。

失败处理纪律（不移动/重建既有标签、绝不在本地重试 `npm publish`）见 runbook 末节。

## 输出契约

报告：

- 推送到 `main` 的提交 SHA。
- 精确版本标签及其剥离后的提交 SHA。
- GitHub release URL。
- 发布工作流运行 URL 与结论。
- npm 精确版本与工作流推导的 dist-tag（`latest`、`beta` 或 `next`）。
- 任何剩余的后续事项或警告。
