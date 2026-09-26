# PR 正文模板与自动化检查

`jero-branch-pr` 的 PR 正文六段格式、自动化检查表与常用命令。

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

## 自动化检查（必须全部通过）

jero-pi 仓库的 CI 会在每个 PR 上运行以下作业；其他目标仓库运行各自的检查——请查看那里的 `.github/workflows/`，不要想当然。

| 检查 | 作业名 | 验证内容 |
|-------|----------|-----------------|
| CI | `verify` | 测试（含离线门控）、类型检查、运行时模块、权威边界、包内容、packed 产物门控、依赖审计 |
| CI | `review-repository-windows` | Windows Git 权威探测与候选视图回归 |

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
