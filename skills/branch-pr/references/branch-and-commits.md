# 分支命名与常规提交细则

`jero-branch-pr` 的命名/提交细则。正文只保留正则与硬规则。

## 分支命名表

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
