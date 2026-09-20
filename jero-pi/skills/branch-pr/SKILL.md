---
name: jero-branch-pr
description: "创建带 issue 先行检查的 Jero 拉取请求。触发词：创建、打开或准备送审 PR。"
license: Apache-2.0
metadata:
  author: gentleman-programming
  version: "2.0"
---

## 何时使用

在以下情况使用本技能：
- 为任何变更创建拉取请求
- 准备提交一个分支
- 协助贡献者打开 PR

---

## 关键规则

1. **每个 PR 必须链接一个已批准的 issue** —— 没有例外
2. **每个 PR 必须有且仅有一个 `type:*` 标签**
3. **自动化检查必须通过**，否则无法合并
4. **未链接 issue 的空白 PR 会被 GitHub Actions 拦截**

---

## 工作流

```
1. Verify issue has `status:approved` label
2. Create branch: type/description (see Branch Naming below)
3. Implement changes with conventional commits
4. Run shellcheck on modified scripts
5. Open PR using the template
6. Add exactly one type:* label
7. Wait for automated checks to pass
```

---

## 分支命名

分支名必须匹配此正则：

```
^(feat|fix|chore|docs|style|refactor|perf|test|build|ci|revert)\/[a-z0-9._-]+$
```

**格式：** `type/description` —— 全小写、不含空格，描述部分仅可用 `a-z0-9._-`。

| 类型 | 分支模式 | 示例 |
|------|---------------|---------|
| 新功能 | `feat/<description>` | `feat/user-login` |
| 缺陷修复 | `fix/<description>` | `fix/zsh-glob-error` |
| 杂务 | `chore/<description>` | `chore/update-ci-actions` |
| 文档 | `docs/<description>` | `docs/installation-guide` |
| 格式 | `style/<description>` | `style/format-scripts` |
| 重构 | `refactor/<description>` | `refactor/extract-shared-logic` |
| 性能 | `perf/<description>` | `perf/reduce-startup-time` |
| 测试 | `test/<description>` | `test/add-setup-coverage` |
| 构建 | `build/<description>` | `build/update-shellcheck` |
| CI | `ci/<description>` | `ci/add-branch-validation` |
| 回退 | `revert/<description>` | `revert/broken-setup-change` |

---

## PR 正文格式

每个 PR 正文必须包含：

### 1. 关联 issue（必填）

```markdown
Closes #<issue-number>
```

合法关键字：`Closes #N`、`Fixes #N`、`Resolves #N`（大小写不敏感）。
被链接的 issue 必须带有 `status:approved` 标签。

### 2. PR 类型（必填）

在模板中恰好勾选一项并添加对应标签：

| 复选框 | 需添加的标签 |
|----------|-------------|
| 缺陷修复 | `type:bug` |
| 新功能 | `type:feature` |
| 仅文档 | `type:docs` |
| 代码重构 | `type:refactor` |
| 维护/工具 | `type:chore` |
| 破坏性变更 | `type:breaking-change` |

### 3. 摘要

用 1-3 个要点说明该 PR 做了什么。

### 4. 变更表

```markdown
| File | Change |
|------|--------|
| `path/to/file` | What changed |
```

### 5. 测试计划

```markdown
- [x] Scripts run without errors: `shellcheck scripts/*.sh`
- [x] Manually tested the affected functionality
- [x] Skills load correctly in target agent
```

### 6. 贡献者检查清单

必须勾选全部复选框：
- 链接了已批准的 issue
- 添加了恰好一个 `type:*` 标签
- 对改动的脚本运行过 shellcheck
- 技能已在至少一个 agent 中测试
- 行为变更时更新了文档
- 使用常规提交格式
- 不含 `Co-Authored-By` 尾注

---

## 自动化检查（必须全部通过）

jero-pi 仓库的 CI 会在每个 PR 上运行以下作业；其他目标仓库运行各自的检查——请查看那里的 `.github/workflows/`，不要想当然。

| 检查 | 作业名 | 验证内容 |
|-------|----------|-----------------|
| CI | `verify` | 测试（含离线门控）、类型检查、运行时模块、权威边界、包内容、packed 产物门控、依赖审计 |
| CI | `review-repository-windows` | Windows Git 权威探测与候选视图回归 |

---

## 常规提交

提交信息必须匹配此正则：

```
^(build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test)(\([a-z0-9\._-]+\))?!?: .+
```

**格式：** `type(scope): description` 或 `type: description`

- `type` —— 必填，取值之一：`build`、`chore`、`ci`、`docs`、`feat`、`fix`、`perf`、`refactor`、`revert`、`style`、`test`
- `(scope)` —— 可选，小写，可用 `a-z0-9._-`
- `!` —— 可选，表示破坏性变更
- `description` —— 必填，从 `: ` 之后开始

类型到标签的映射：

| 提交类型 | PR 标签 |
|-------------|----------|
| `feat` | `type:feature` |
| `fix` | `type:bug` |
| `docs` | `type:docs` |
| `refactor` | `type:refactor` |
| `chore` | `type:chore` |
| `style` | `type:chore` |
| `perf` | `type:feature` |
| `test` | `type:chore` |
| `build` | `type:chore` |
| `ci` | `type:chore` |
| `revert` | `type:bug` |
| `feat!` / `fix!` | `type:breaking-change` |

示例：
```
feat(scripts): add Codex support to setup.sh
fix(skills): correct topic key format in sdd-apply
docs(readme): update multi-model configuration guide
refactor(skills): extract shared persistence logic
chore(ci): add shellcheck to PR validation workflow
perf(scripts): reduce setup.sh execution time
style(skills): fix markdown formatting
test(scripts): add setup.sh integration tests
ci(workflows): add branch name validation
revert: undo broken setup change
feat!: redesign skill loading system
```

---

## 命令

```bash
# Create branch
git checkout -b feat/my-feature main

# Run shellcheck before pushing
shellcheck scripts/*.sh

# Push and create PR
git push -u origin feat/my-feature
gh pr create --title "feat(scope): description" --body "Closes #N"

# Add type label to PR
gh pr edit <pr-number> --add-label "type:feature"
```
