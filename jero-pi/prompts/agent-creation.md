---
description: 创建或更新单个项目级子代理
argument-hint: "<角色与领域，如 godot 领域评审代理>"
---
为以下需求创建或更新单个项目级子代理：$ARGUMENTS

子代理创建契约的单一事实源是 `jero-agent-creator` 技能：如果它可用则使用它；若未被自动加载，先阅读 `skills/jero-agent-creator/SKILL.md` 并严格按其执行（含角色判断、权限面选择、命名防撞与委派接线）。扩展机制见 `docs/extension-guide.md`。本提示不再复述流程步骤，防止与技能双源漂移。

## 汇报

返回创建/修改的文件、选定名与碰撞检查结果、权限面选择及理由、委派接线位置、冒烟检查结果。
