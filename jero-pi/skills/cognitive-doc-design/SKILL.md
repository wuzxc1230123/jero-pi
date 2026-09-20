---
name: jero-cognitive-doc-design
description: "设计降低认知负荷的文档。触发词：撰写指南、README、RFC、入职文档、架构文档或面向评审的文档。"
license: Apache-2.0
metadata:
  author: gentleman-programming
  version: "1.0"
---

## 何时使用

在创建或编辑人们需要快速理解、记住或在评审中使用的文档时，加载本技能。

尤其适用于：

- PR 描述与评审备注。
- 贡献者或维护者指南。
- 架构、工作流或入职文档。
- 任何目前显得冗长、密集或难以浏览的文档。

## 关键模式

| 模式 | 规则 |
|---------|------|
| 结论先行 | 把决策、行动或结果放在最前，背景随后。 |
| 渐进披露 | 从正常路径开始，再补充细节、边界情况与参考资料。 |
| 分块 | 把相关信息组成小节，保持平铺列表简短。 |
| 路标 | 用标题、标签、提示框和摘要让读者随时知道自己在哪。 |
| 识别优于回忆 | 优先使用表格、检查单、示例和模板，而非需要记忆的散文。 |
| 评审共情 | 让评审者无需重建整个故事即可核验意图。 |

## 文档形态

除非仓库已提供更强的模板，否则使用此默认结构：

```markdown
# <Outcome-oriented title>

<One paragraph: what changed, who it helps, and why it matters.>

## Quick path

1. <First action>
2. <Second action>
3. <Verification or expected result>

## Details

| Topic | Decision |
|-------|----------|
| <area> | <concise explanation> |

## Checklist

- [ ] <Reader can confirm this>
- [ ] <Reader can confirm that>

## Next step

<Link or action that continues the workflow.>
```

## PR 与评审文档

为 PR 写文档时，让评审路径显式，以减少评审者疲劳：

- 说明先评审什么。
- 说明哪些是有意排除在范围外的。
- 工作成链时，链接前一个与下一个 PR。
- 每个小节聚焦一个决策或一个工作单元。
- 用检查单承载验收标准与验证。

## 命令

```bash
# Check markdown files changed in the current branch
git diff --name-only -- '*.md'

# Inspect PR changed-line count for cognitive load
gh pr view <PR_NUMBER> --json additions,deletions,changedFiles
```
