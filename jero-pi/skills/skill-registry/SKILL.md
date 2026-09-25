---
name: jero-skill-registry
description: "触发词：更新技能、技能注册表、actualizar skills、技能变更之后。按触发词与路径索引可用技能。"
license: MIT
metadata:
  author: gentleman-programming
  version: "1.0"
---

## 激活契约

在安装、删除、创建、移动或重命名技能之后，或委托者需要最新技能索引时，使用本技能。

## 硬性规则

- 注册表是索引，不是编译器或摘要。`SKILL.md` 仍是事实来源。
- 默认不生成或注入紧凑规则；通过把精确技能路径传给子代理来保留作者意图。
- 无论 SDD 持久化模式如何，始终写 `.atl/skill-registry.md`。
- 可用时，把注册表以 `topic_key: skill-registry` 保存到 Engram，并设 `capture_prompt: false`。
- 跳过 `sdd-*`、`_shared` 与 `skill-registry`；按技能名去重，项目级技能优先于用户级技能。
- 可能时把 `.atl/` 加入 `.gitignore`，除非被显式禁用。

## 决策门

| 情形 | 动作 |
| --- | --- |
| 同一技能同时存在于全局与项目 | 保留项目级技能 |
| 同一技能存在于多个全局位置 | 保留扫描顺序中的第一个来源 |
| 未找到任何技能 | 写入空注册表，让 agent 停止盲目搜索 |
| agent 将要委托工作 | 选择匹配的注册表行并传入其 `SKILL.md` 路径 |

## 执行步骤

1. 扫描所有已知的用户与项目技能目录中的 `*/SKILL.md`。
2. 只按需读取 frontmatter，以提取 `name` 与 `description` 触发文本。
3. 渲染 `.atl/skill-registry.md`，包含扫描来源、注册表契约、技能名、触发词/描述、范围与精确路径。
4. 可用时持久化到 Engram，使用 `title: skill-registry`、`topic_key: skill-registry`、`type: config` 与 `capture_prompt: false`。
5. 返回注册表路径、技能数量、缓存状态以及 Engram 是否已更新。

## 输出契约

返回：
- 项目名与 `.atl/skill-registry.md` 路径。
- 已索引技能的数量。
- 缓存是命中还是重新生成。
- 相关时，被跳过或重复的技能。

## 参考

- `skills/_shared/skill-resolver.md` —— 委托者如何使用该索引。
