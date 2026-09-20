---
name: jero-skill-creator
description: "触发词：/skill-creation、技能创建、skill creator、create skill、新技能。创建带合法 frontmatter 的 LLM 优先技能。"
license: Apache-2.0
metadata:
  author: gentleman-programming
  version: "1.0"
---

## 激活契约

为 Pi 或其他 agent 运行时创建或更新可复用 AI 技能时，使用本技能。

在以下情况创建技能：
- 某个工作流或惯例跨会话复用；
- 泛用 agent 行为需要项目特定的约束；
- 一棵决策树能帮助 agent 安全选择；
- 示例、模板或参考能让未来执行更可靠。

不要为一次性任务、泛用文档或属于代码/测试的规则创建技能。

## 硬性规则

- 遵循 `docs/skill-style-guide.md`，把它作为技能结构与风格的规范来源。
- 技能是 LLM 运行时契约，不是面向人的文档。
- 保持 `SKILL.md` 简洁：目标 180–450 token，上限 1000。
- 使用祈使句指令与具体的门控；避免教程式与背景散文。
- frontmatter 的 `description` 必须是单行、YAML 安全的物理行，并把触发词放在最前。
- 不要添加 `Keywords` 小节；把关键触发词放进 `description`。
- 模板、schema 与生成示例放入 `assets/`。
- 较长的理由或本地文档链接放入 `references/`。
- 修改项目技能后，可用时用 `/skill-registry:refresh` 刷新注册表。

## 决策门

| 需求 | 动作 |
| --- | --- |
| 小的可复用行为 | 只创建 `skills/{skill-name}/SKILL.md` |
| 模板、schema、fixture | 添加 `skills/{skill-name}/assets/` |
| 较长的解释或边界情况 | 添加 `skills/{skill-name}/references/` |
| 既有技能已覆盖 | 改为更新既有技能 |
| 技能影响委托发现 | 确保触发词出现在 `description` 中 |

## 执行步骤

1. 创建或更新技能前，先读 `docs/skill-style-guide.md`。
2. 检视既有技能，确认新技能不与之重复。
3. 选择与用户面触发词匹配的 kebab-case 技能名。
4. 创建或更新此结构：

```text
skills/{skill-name}/
├── SKILL.md
├── assets/       # optional
└── references/   # optional
```

5. 使用此 frontmatter 形态：

```yaml
---
name: {skill-name}
description: "Trigger: {phrases users or agents will say}. {What this skill does}."
license: Apache-2.0
metadata:
  author: gentleman-programming
  version: "1.0"
---
```

6. 按此顺序撰写小节：Activation Contract、Hard Rules、Decision Gates、Execution Steps、Output Contract、References。
7. 若这是打包的 `jero-pi` 技能，把它加入 `scripts/verify-package-files.mjs`。
8. 刷新技能注册表，或记录其更新路径。

## 输出契约

返回：
- 创建或修改的文件。
- 本次是新建技能还是更新既有技能。
- 添加的任何 `assets/` 或 `references/` 支撑文件。
- 是否需要包验证或技能注册表刷新。

## 参考

- `docs/skill-style-guide.md` —— 规范的 LLM 优先技能风格指南。
- `skills/skill-registry/SKILL.md` —— 注册表刷新与索引契约。
