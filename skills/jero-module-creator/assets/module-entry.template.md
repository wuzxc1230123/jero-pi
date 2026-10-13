---
name: godot
description: 引擎惯例、解耦测试策略与领域评审关注点的知识入口。当仓库含 project.godot、.tscn/.tres 场景资源，或任务涉及 Godot、节点、信号、横版平台跳跃时使用。
---

# Godot 游戏开发（entry 金样：≤60 行含 frontmatter，深度知识一律住 references）

本文件是模块知识入口（L1）：注册表与派发覆盖层消费的都是它。渐进披露
是契约门（`MAX_ENTRY_LINES`），不是写作纪律——超行直接过不了安装验证。

## 知识指路（L2，按需读 references/）

- 引擎惯例（节点/场景/信号/生命周期）→ `references/godot-conventions.md`
- 2D 横版专项（平台物理、TileMap、状态机、敌人 AI）→ `references/side-scroller-2d.md`
- 测试策略（逻辑与引擎解耦、headless 集成测试）→ `references/testing-strategy.md`

## 硬约束

- `.godot/` 缓存目录必须 gitignore（评审走 git 对象，忽略后天然干净）。
- 游戏逻辑与引擎解耦为可测单元；模块 `config.testCommand` 钉住的命令
  是 SDD Strict TDD 转发的唯一来源。

## 委派路由

- 评审 Godot/场景/信号变更：追加委派 `godot-reviewer`（只读，报告发现不修复）。
- 玩法/关卡/敌人行为设计：建议 `godot-designer` 产出设计提案。
- 执行实现：直接使用 `jero-worker`——本入口注入的惯例随之生效，
  禁止另做与 `jero-worker` 同角色的语言执行代理（孤儿代理）。
