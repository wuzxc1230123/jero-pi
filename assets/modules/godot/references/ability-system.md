# 能力/技能系统（Ability System）

把"技能、冷却、消耗、buff/状态效果"从散落在各脚本的 `if` 拼凑升级为
**数据驱动的组件**：技能是数据（Resource），施放是流程，效果是可堆叠的
独立对象。技能数 ≥ 3 且会成长（加技能只加数据不改代码）时才值得上；
两个技能的原型直接写状态机，别过度设计。设计层（招式集分类学/元规则/
打击感参数基线）另见 `combat-design.md`。

## 数据模型（全部 Resource 化）

```gdscript
# ability_definition.gd —— 技能定义：纯数据，策划可改 .tres
class_name AbilityDefinition extends Resource
@export var display_name: String
@export var tags: Array[StringName] = [&"attack", &"melee"]   # 分类/互斥/克制判定
@export var cooldown_ms: int = 500
@export var cost: Dictionary[String, int] = {&"stamina": 10}   # 资源消耗（键为资源名；类型化 Dictionary 需 4.4+）
@export var cast_time_ms: int = 0                              # 前摇
@export var effects: Array[AbilityEffect]                      # 命中时应用的效果列表
```

- **效果（Effect）是独立对象**：`AbilityEffect` 基类 + `DamageEffect`、
  `ApplyStatusEffect`、`SpawnSceneEffect` 等子类——加新效果 = 加一个 Resource
  类，不改施放流程。
- **状态效果（Status/Buff）**：`id + 剩余时长 + 堆叠策略（refresh | stack |
  independent）+ tick 间隔`；持有者只维护一张 `Array[ActiveStatus]` 台账，
  由状态效果自己声明到期/移除条件。

## 运行时纪律

- **冷却用单调时钟**：`Time.get_ticks_msec()` 记上次施放时刻，比对差值；
  每个技能一条记录（`Dictionary[StringName, int]`），**不用 Timer 节点**、
  **绝不每帧轮询**剩余 CD。
- **施放管线固定**：检查（冷却/消耗/施放条件/GCD）→ 扣费 → 记冷却 →
  前摇（可打断）→ 判定帧（命中盒/射线，见 `physics-gameplay.md`）→ 应用
  效果列表 → 进入后摇/动画回调。判定与效果应用分离，重放/测试才可能。
- **标签做互斥与免疫**："带 `&"silence"` 标签时禁施 `&"spell"` 类"、
  "免疫 `&"poison"`"——全部走标签集合判定，不写技能名硬编码。
- **与动画/状态机单向驱动**：施放请求改逻辑态 → 逻辑态驱动 AnimationTree
  参数（见 `audio-animation.md`）；动画事件只回报"到判定帧了"，不在动画
  回调里重复扣费/判冷却。
- **联机裁定在权威端**：客户端发施放请求，冷却/消耗/命中裁定都在 server
  （见 `multiplayer.md`）——客户端的冷却 UI 只是预测显示。

## 可测性

- 技能定义、冷却账本、效果应用全部零场景依赖：直接 new Resource + 调
  施放管线断言（`Time`/`RNG` 注入，见 `testing.md`）——GDD 数值平衡可以
  headless 跑批量模拟。

## NEVER

- **NEVER 把冷却/伤害数值写死在按钮或角色脚本里**——数值进
  `AbilityDefinition`（.tres），代码只消费。
- **NEVER 用 Timer 节点管冷却**：技能数量 × Timer 节点 = 场景树垃圾与
  生命周期坑；单调时钟 + 字典是全部所需。
- **NEVER 效果直接改目标内部字段**（`target.health -= x` 散落各处）：走
  目标的公开受击接口/信号，伤害汇总与抗性计算单点收口。
- **NEVER 每帧轮询"CD 好了吗"**：施放请求时惰性判定；UI 刷新用信号或
  低频节流。
- **NEVER 动画回调里做裁定**（重复扣费/重复判定的温床）——裁定只走
  施放管线，动画只是表现层回报。
