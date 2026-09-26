---
name: jero-branch-pr
description: "创建带 issue 先行检查的 Jero 拉取请求。触发词：创建、打开或准备送审 PR。"
license: Apache-2.0
metadata:
  author: gentleman-programming
  version: "2.1"
---

## 何时使用

- 为任何变更创建拉取请求
- 准备提交一个分支
- 协助贡献者打开 PR

## 关键规则

1. **每个 PR 必须链接一个已批准的 issue**（`status:approved`）—— 没有例外
2. **每个 PR 必须有且仅有一个 `type:*` 标签**
3. **自动化检查必须通过**，否则无法合并
4. **未链接 issue 的空白 PR 会被 GitHub Actions 拦截**

## 工作流

```
1. Verify issue has `status:approved` label
2. Create branch: type/description (see references/branch-and-commits.md)
3. Implement changes with conventional commits
4. Run shellcheck on modified scripts
5. Open PR using the template (see references/pr-template.md)
6. Add exactly one type:* label
7. Wait for automated checks to pass
```

## 硬格式

分支名必须匹配 `^(feat|fix|chore|docs|style|refactor|perf|test|build|ci|revert)\/[a-z0-9._-]+$`（`type/description`，全小写、不含空格）。

提交信息必须匹配 `^(build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test)(\([a-z0-9\._-]+\))?!?: .+`。

分支模式表、提交类型 → PR 标签映射与示例见 `references/branch-and-commits.md`；PR 正文六段模板、贡献者检查清单、CI 检查表与命令见 `references/pr-template.md`。
