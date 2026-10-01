# 组件模式（Component，组合的实操篇）

`scene-architecture.md` 说了"组合优于继承"；本篇讲**怎么落地**：把
行为拆成可挂载的子节点组件（Health/Hitbox/Movement/Inventory…），
同一角色按需组合，多态靠"换组件实现"而不是"加深继承链"。

## 组件契约（每个组件遵守）

1. **只管自己的事**：HealthComponent 管血量与死亡信号，不管谁打的我、
   死了播放什么动画。
2. **上行靠信号，下行靠方法**：组件向宿主/兄弟发信号（`died`、
   `damaged`）；外部对组件的调用走其公开方法（`take_damage()`）。
3. **不横向直连兄弟组件**：HitboxComponent 不直接改 HealthComponent
   ——它发 `hit_landed` 信号，宿主（或监听者）决定调谁的
   `take_damage`。横向直连 = 组件网状耦合，换一个全炸。

## 装配与发现

- 宿主场景根脚本负责**装配**：`@export var health: HealthComponent`
  （4.1+ 节点引用可 `@export`）或 `_ready` 里 `get_node` 取一次缓存；
  装配只发生在根脚本，组件互不知道装配细节。
- 引用方向单调：根 → 组件（知道全部），组件 → 谁（只知道信号出口）；
  组件要宿主数据时，宿主在装配时喂给它（参数/回调），组件不回查。
- `get_component` 没有内置等价物：约定"组件挂在谁身上、叫什么名"，
  或用类型扫描子节点一次性装配；**别用 group 做组件查找**（group 是
  全局广播面，见 `signals-groups.md`）。

## 组件 vs 继承的取舍线

- 行为**可独立存在且多种组合** → 组件（有血量的不止敌人：木箱、载具）。
- 行为**全体共享且永不变化** → 基类可以（`CharacterBody2D` 这种引擎
  基类天然如此）；项目里自建继承链超过一层就要警惕。
- "敌人组件""玩家组件"差异大时，差异部分做成不同组件实现
  （`EnemyBrain`/`PlayerBrain` 同接口），共享部分（Health/Hitbox）不动
  ——这就是多态的组件化形态。

## 数据与测试

- 组件参数 `@export` 化（数值住 Resource，`resources-data.md`）；
  组件间无共享可变状态时，单个组件 headless 直测（new 节点 + 断言
  信号，`testing.md`）——组件化的可测性红利就在这。

## NEVER

- **NEVER 组件 `get_parent()` 干涉宿主**（改宿主字段/调宿主私有方法）
  ——上行只有信号。
- **NEVER 万能组件**（一个 "CharacterComponent" 管血量+移动+背包）：
  职责膨胀 = 换汤不换药的巨型脚本，失去组合意义。
- **NEVER 组件间互相 get_node 横连**：一切横向交互经信号或经宿主装配
  时显式接线。
- **NEVER 用深层继承链代替组件**：第三层继承（敌人→飞行敌人→会
  开枪的飞行敌人）就是该拆组件的时刻。
