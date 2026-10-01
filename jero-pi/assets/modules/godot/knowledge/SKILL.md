---
name: godot
description: Godot 4 游戏开发领域知识入口：引擎惯例、headless 验证主干与领域评审关注点的指路与硬约束。当仓库含 project.godot 或 .tscn/.tres/.gd 文件、任务涉及 Godot 游戏开发时使用。触发词：Godot、GDScript、场景、节点、信号、project.godot、tscn、tres、gdshader。
---

# Godot 游戏开发（模块知识入口，L1）

本文件是 godot 模块的知识入口：注册表与派发覆盖层消费的都是它。深度
知识一律住 references（L2，按需读），本入口只做指路与硬约束。

## 知识指路（L2，references/ 按需读）

- 语言与数据：`gdscript-style`（规范与 NEVER 清单）、`csharp-dotnet`（C#/.NET 侧纪律）、`resources-data`（Resource 数据层）、`save-systems`（存档与持久化）、`math-essentials`（向量/插值/角度/变换）、`dependency-injection`（依赖显式化，可测性底座）
- 架构与通信：`scene-architecture`（场景组织与 autoload）、`component-system`（组件模式实操）、`signals-groups`（信号/组/事件总线）、`common-pitfalls`（4.x API 陷阱与改名）
- 玩法与内容：`physics-gameplay`（物理/碰撞/手感机制）、`game-feel`（Juice 与反馈层级）、`game-ai`（决策与执行分层）、`ability-system`（技能/冷却/状态效果）、`procedural-gen`（种子纯函数生成）、`dialogue-narrative`（对话即数据）、`multiplayer`（权威服务器模型）
- 视听与呈现：`shaders-visuals`（着色器与后处理）、`audio-animation`（音频/动画）、`camera-systems`（跟随/震动/构图）、`ui-theming`（布局/主题/适配）、`tilemap-levels`（瓦片与关卡组织）、`3d-essentials`（3D 基础）
- 工程与验证：`verification`（三道门协议）、`testing`（gdUnit4 与逻辑解耦）、`export-publishing`（导出即最后一道门）、`performance`（预算与反模式）、`editor-live-session`（编辑器活会话桥，godot-ai 对接见 `godot-live` 技能）、`addon-development`（EditorPlugin/gdextension）、`asset-pipeline`（导入管线与 .import 伴生）、`input-actions`（输入动作映射）
- 拓展配方：`genres-recipes`（品类组合配方）、`jam-prototyping`（时间盒原型工作流）
- 平台与专题：`mobile-development`（触屏/适配/生命周期/发布链）、`xr-development`（OpenXR/舒适度/双目预算）、`multithreading`（线程边界与 WorkerThreadPool）、`localization`（tr/翻译/locale）

## 硬约束

- `.godot/` 缓存目录必须 gitignore（评审走 git 对象，忽略后天然干净）。
- 验证走 CLI 退出码：`godot --headless --path . --import` 是最低门槛；
  "解析通过"不等于"跑得起来"，玩家可见变更必须启动观察并留证。
- 游戏逻辑与引擎解耦为可测单元；模块 `config.testCommand` 钉住的命令
  是 SDD Strict TDD 转发的唯一来源。

## 委派路由

- 评审 Godot/场景/信号/GDScript 变更：追加委派 `godot-reviewer`（只读，报告发现不修复）。
- 验证执行（headless 检查、测试脚手架）：委派 `godot-tester`（有界写者，产验证报告）。
- 玩法/关卡/架构设计：建议 `godot-designer` 产出设计提案。
- 执行实现：直接使用 `jero-worker`——本入口注入的惯例随之生效，
  禁止另做与 `jero-worker` 同角色的语言执行代理（孤儿代理）。
