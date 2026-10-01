# 玩法类型组合配方（Genres）

每类 = 核心循环 + 最小系统清单 + Godot 落地选型 + 特有坑。**配方不复授原语**：引擎与学科技能（见知识入口目录）是前置件，本篇只讲怎么拼。

## 横版平台（Platformer）

- 循环：跑/跳/避障/收集 → 检查点 → 更难段落。
- 拼装：`godot-2d-movement`（手感三件套）+ `godot-tilemap`（关卡）+ `godot-camera`（跟随/死区）+ `godot-game-feel`（落地 squash/死亡震屏）。
- 选型：CharacterBody2D 玩家 + TileMapLayer 地形 + Area2D 检查点；单向平台与坡道参数开局钉。
- 坑：摄像机 y 轴疯跳（垂直死区）；难度靠数值堆不靠关卡语法（引入新机制→ teaching 关→组合关）。

## Roguelike / Roguelite

- 循环：进层 → 战斗/拾取 → 死亡 → 元进度 → 更强再进。
- 拼装：`godot-procgen`（地图+战利品表）+ `godot-save`（元进度单独档）+ `godot-resources`（词条/道具 Def）+ `godot-game-ai`（敌人 Brain）。
- 选型：生成器纯函数化（种子进档）；局内状态与元进度分档存。
- 坑：种子不可复现（全局 randi）；元进度与局内平衡互相打架（数值表统一管）。

## RPG

- 循环：探索 → 战斗/任务 → 成长（经验/装备）→ 叙事推进。
- 拼装：`godot-dialogue`（对话/任务旗标）+ `godot-save`（大状态集）+ `godot-resources`（物品/技能/敌人表）+ `godot-game-ai`（战斗 Brain）。
- 选型：任务系统 = 旗标黑板 + 事件总线订阅（`enemy_killed` 推进计数）；战斗（回合制状态机 / 即时 ARPG 视 `game-ai.md`）。
- 坑：任务状态散在 NPC 脚本（改任务全仓 grep）——集中旗标管理器；存档存活对象引用而非数据。

## FPS / 第三人称射击

- 循环：接敌 → 掩体/瞄准 → 击杀反馈 → 换场。
- 拼装：`godot-3d` + `godot-input`（鼠标注入 `rotate_y`/俯仰钳制）+ `godot-camera`（SpringArm3D + FOV 冲刺）+ `godot-game-feel`（命中停顿/准星脉冲）。
- 选型：`CharacterBody3D` + `RayCast3D`（hitscan）/ `Projectile` Area3D；后坐力=摄像机偏移+扩散锥。
- 坑：鼠标灵敏度不进设置；`_input` 里 `event.relative` 未乘 delta 语义统一的旋转。

## 塔防（Tower Defense）

- 循环：建塔 → 波次 → 经济 → 升级/扩建。
- 拼装：`godot-resources`（塔/敌人 Def）+ `godot-game-ai`（沿路径寻路 NavigationAgent/路径点）+ `godot-tilemap`（建造网格）。
- 选型：敌人走 `Path2D/PathFollow2D`（固定路线）或 NavAgent（绕行）；波次 = 预算制生成器（`procedural-gen.md` 内容节）；塔目标锁定 = Area2D 候选集 + 距离排序（节流 tick）。
- 坑：塔全量每帧扫描全场敌人（O(N·M) 卡顿——空间分桶）；卖塔不还建位状态。

## 卡牌（Card Game）

- 循环：抽牌 → 出牌（费用/规则）→ 结算 → 回合。
- 拼装：`godot-resources`（卡牌 Def：费用/效果键）+ `godot-ui`（手牌扇形/拖拽）+ 事件总线（效果结算管线）。
- 选型：规则引擎纯逻辑类（费用校验/目标合法性/结算顺序）可 headless 直测；效果 = 键 → Callable 注册表（同 `dialogue-narrative.md` 谓词思路），不用 eval。
- 坑：动画与结算状态竞速（结算完成事件驱动 UI，勿定时器猜）；叠放/目标的 z 序与输入冲突。

## 视觉小说（Visual Novel）

- 循环：阅读 → 选项 → 分支 → 结局解锁。
- 拼装：`godot-dialogue`（图/黑板/cue）+ `godot-ui`（对话框/历史/自动模式）+ 存档（章节+旗标快照）。
- 选型：`DialogueRunner`（`dialogue-narrative.md`）+ 舞台演出层（立绘状态机）。
- 坑：文案硬编码进场景（本地化即死——键化进数据）；快进/跳过已读破坏状态一致性。

## 生存建造（Survival / Crafting）

- 循环：采集 → 制作 → 建造/维护 → 威胁波 → 扩张。
- 拼装：`godot-save`（世界变更集+种子回放）+ `godot-tilemap`（地形采集）+ `godot-resources`（配方/物品表）+ `godot-game-ai`（威胁感知波次）。
- 选型：世界状态变更集（挖掉的格子/建筑位置）序列化，重进 = 种子重放 + 变更集 apply（`procedural-gen.md` 接口）。
- 坑：每格状态存 Dictionary 无上限（变更集压缩/分块）；配方图循环依赖（铜锭→铜镐→铜矿→铜锭）。

## 解谜（Puzzle）

- 循环：观察规则 → 试错 → 顿悟 → 验证。
- 拼装：`godot-resources`（关卡数据=谜面）+ 纯逻辑规则引擎（可 headless 全量解算验证）+ `godot-ui`（反馈层级 L0 即时正误）。
- 选型：规则引擎与呈现严格分离——**每关可机器验证有解**（求解器跑通才算关成立）；撤销栈 = 状态快照栈。
- 坑：只有设计者觉得直观的规则（首次失败必须归因到玩家可读信息）；无解关上线（求解器门）。

## 组合通则

- 类型混搭（Roguelike+卡牌=杀戮尖塔式）：先写两个母类型的系统清单，找**共享状态面**（回合系统/经济系统只有一个 owner）。
- 任何类型：核心循环先用灰盒可玩（`jam-prototyping.md`），美术后置。
- 系统清单里的每项指回对应技能深读——本篇永远不重复展开实现。
