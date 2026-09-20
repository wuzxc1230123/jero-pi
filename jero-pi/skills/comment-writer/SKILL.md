---
name: jero-comment-writer
description: "撰写温暖、直接的协作评论。触发词：PR 反馈、issue 回复、评审、Slack 消息或 GitHub 评论。"
license: Apache-2.0
metadata:
  author: gentleman-programming
  version: "1.0"
---

## 何时使用

每当撰写会被另一个人阅读的评论时，加载本技能。

适用于：

- GitHub PR 或 issue 评论。
- 评审反馈与修改要求。
- 维护者回复。
- Slack、Discord 或异步项目动态。

## 语气规则

| 规则 | 要求 |
|------|-------------|
| 快速给出有用信息 | 从可操作的要点开始。反馈前不要先复述整个 PR。 |
| 温暖而直接 | 听起来像一个体贴的队友，而不是官腔机器人。 |
| 保持简短 | 优先 1 到 3 个短段落，或一份紧凑的要点列表。 |
| 解释原因 | 要求变更时给出技术理由。 |
| 避免堆叠批评 | 只评论价值最高的问题，不纠缠每个细小偏好。 |
| 匹配目标上下文语言（Match target context language） | 技术产物默认使用简体中文；当下游目标上下文明显为英文时（英文仓库既有惯例、英文 issue/PR 线程）使用英文，即遵循目标上下文语言（target context language）。若用户明确指定语言（explicitly requests a language）或语气，遵循该要求。公开评论不要以当前激活人设作为语言依据。中文评论默认使用中性、专业的简体中文（neutral/professional Simplified Chinese by default），除非用户或目标上下文明确需要地域语气。 |
| 不用长破折号 | 用逗号、句号或括号代替。 |

## 评论公式

```text
<Direct observation or request>

<Why it matters, only if needed>

<Concrete next action>
```

## 示例

### 要求修改

```markdown
Good approach overall. I'd split this into a separate commit because it mixes validation logic with UI wiring.

That keeps the reviewer's focus narrower and makes rollback cleaner if the integration fails.
```

### 批准并附注

```markdown
Approved. The scope is clear and the change is well-contained.

For the next PR, add links to the previous and following PRs so the chain stays navigable.
```

### 要求拆分

```markdown
This PR exceeds the 400-line budget, so we need to split it or justify `size:exception`.

Suggested order: foundation + tests first, then integration, then docs. That gives each review a clear start and end.
```

## 命令

```bash
# Inspect a PR before writing review feedback
gh pr view <PR_NUMBER> --json title,body,additions,deletions,changedFiles
```
