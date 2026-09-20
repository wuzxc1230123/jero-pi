---
description: 创建或更新 LLM 优先的技能
argument-hint: "<技能想法或名称>"
---
为以下目标创建或更新 LLM 优先的技能：$ARGUMENTS

如果 `jero-skill-creator` 技能可用则使用它。若该技能未被自动加载，编辑前先阅读 `skills/skill-creator/SKILL.md`，以及存在时的 `docs/skill-style-guide.md`。

## 流程

1. 若不显而易见，先澄清可复用行为、目标运行时、触发短语与非目标。
2. 先检视既有技能；更新现有技能，而不是创建重复项。
3. 创建或更新 `skills/{kebab-name}/SKILL.md`，带合法的单行 frontmatter description 和简洁的运行时指令。
4. 模板、schema 或示例放入 `assets/`；较长的支撑文档放入 `references/`。
5. 若该技能属于 `jero-pi`，更新 `scripts/verify-package-files.mjs`。
6. 可用时用 `/skill-registry:refresh` 刷新注册表，否则告知用户刷新/重载。

## 汇报

返回改动的文件、选定的触发短语、所有支撑文件，以及注册表/包验证是否仍待运行。
