# 链式 PR 细节

## 策略说明

| | 堆叠 PR 到 main | 功能分支链 |
|---|---|---|
| 速度 | 每个切片可按序发布 | 完整功能需等追踪 PR 合并 |
| 回滚 | 回退单个 main PR | 回退/搁置整个功能分支 |
| 风险 | 可能先合入部分行为 | 链完成前什么都不合入 |
| 复杂度 | 重定目标/rebase 流程更简单 | 需要追踪 PR 与严格的 diff 卫生 |

## 功能分支链

当功能分支承接最终集成、而子 PR 作为聚焦切片接受评审时使用。

```text
main
 └── feat/my-feature              ← tracker/final integration branch
      ↑ PR #1 base: feat/my-feature
      └── feat/my-feature-01-core
           ↑ PR #2 base: feat/my-feature-01-core
           └── feat/my-feature-02-shared
                ↑ PR #3 base: feat/my-feature-02-shared
                └── feat/my-feature-03-slice
```

步骤：

1. 从 `main` 创建功能/追踪分支。
2. 向 `main` 打开追踪 PR；标记为 draft/禁合并。
3. 从子分支创建 PR #1，目标为追踪分支。
4. 每个后续子分支从上一个 PR 分支创建，并以该父分支为目标。
5. 按序合并/集成分支；链完成后再合并追踪分支。

## 堆叠 PR 到 main

当每个切片都能按序落到 `main` 时使用。

```text
main <- PR 1: foundation
          └── PR 2: feature slice built on PR 1
                └── PR 3: docs/tests built on PR 2
```

父 PR 合并后，对下一个 PR rebase/重定目标，使 GitHub 只显示当前切片。

## Chain Context 小节

把此小节附加到仓库 PR 模板之后；不要替换必需的 issue/检查单小节。

```markdown
## Chain Context

| Field | Value |
|-------|-------|
| Chain | <feature or stack name> |
| Tracker PR | <#NNN or "Not needed"> |
| Position | <N of total> |
| Base | `<target branch>` |
| Depends on | <PR/issue/link or "None"> |
| Follow-up | <next PR or "None"> |
| Review budget | <changed lines> / 400 |
| Starts at | <branch, PR, or state this builds on> |
| Ends with | <standalone result delivered by this PR> |

### Chain Overview

```text
main
 └── #NNN Previous PR
      └── 📍 #NNN This PR
           └── #NNN Next PR
```

### Scope
- Includes: <focused unit>
- Excludes: <deferred work>

### Autonomy
- [ ] CI is expected to pass for this PR branch
- [ ] This PR has one deliverable scope
- [ ] This PR can be rolled back without unrelated changes
- [ ] Tests, docs, or manual verification cover this unit
```

## 命令

```bash
gh pr view <PR_NUMBER> --json additions,deletions,changedFiles,title,url
gh pr create --base feat/my-feature --title "feat(scope): focused slice" --body-file pr-body.md
gh pr create --base feat/my-feature-01-core --title "feat(scope): next focused slice" --body-file pr-body.md
```

## 评审者指引

- PR 超过 400 行改动且无 `size:exception` 时，要求拆分。
- 工作必须先于 `main` 集成时，推荐功能分支链。
- 每个切片可独立合并时，推荐堆叠 PR。
- 对照直接父分支评审子 PR；受污染的 diff 属于分支缺陷。
