---
description: 创建或更新领域扩展模块（技能 + 子代理 + 命令钉住）
argument-hint: "<领域或模块名，如 godot 游戏开发>"
---
为以下领域创建或更新零代码扩展模块：$ARGUMENTS

模块创建流程的单一事实源是 `jero-module-creator` 技能：如果它可用则使用它；若未被自动加载，先阅读 `skills/jero-module-creator/SKILL.md` 并严格按其执行（含领域访谈、命名防撞、命令钉住与冒烟检查）。放置机制与错误避免见 `docs/extension-guide.md`。本提示不再复述流程步骤，防止与技能双源漂移。

## 汇报

返回生成的目录树与文件清单、门控词集合、钉住并跑通的命令、生成/省略的代理及理由、冒烟检查五步逐项结果。
