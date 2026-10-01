# 游戏 AI（状态机 / 行为树 / Utility / 感知 / 寻路）

敌人 AI 的分层：**决策**（做什么）与**执行**（怎么动）分离，决策层零引擎依赖可 headless 测（见 `testing.md`）。

## 枚举状态机（默认起点）

```gdscript
class_name EnemyBrain
extends RefCounted        # 不是 Node——纯决策，可单测

enum State { PATROL, CHASE, ATTACK, FLEE }
var state: State = State.PATROL
var state_time := 0.0

func tick(delta: float, perception: PerceptionSnapshot) -> State:
	state_time += delta
	match state:
		State.PATROL:
			if perception.can_see_player: return _enter(State.CHASE)
		State.CHASE:
			if not perception.can_see_player and state_time > 3.0:
				return _enter(State.PATROL)
	return state
```

- 状态机先于行为树：状态 ≤7、转移 ≤15 时枚举 + match 最清晰；复杂度超限再升级。
- 决策输入打包成 `PerceptionSnapshot` 值对象（可见性/距离/自身血量），Brain 不持节点引用——纯函数式可测。
- 状态转移集中在 tick 出口，禁止散在各回调里隐式改状态。

## 行为树（复杂敌人/Boss）

- Godot 无内置 BT 节点：轻量自建（`BTNode` 抽象 + Sequence/Selector/Leaf 组合）或用 LimboAI 插件（第三方依赖——引入前需评审并备退出预案，别裸引）。
- 树每 tick（决策频率 5–10Hz 足够，别每帧）从根求值；节点返回 `SUCCESS/FAILURE/RUNNING`。
- 自建纪律：节点无副作用求值 + `activate()/halt()` 生命周期；黑板（Dictionary）传上下文，不做节点间直连。
- Boss 阶段切换 = 树上层 Selector 按阶段 Gate 分流，不塞进叶子节点。

## Utility AI（评估打分选行为）

```gdscript
func choose(scores: Dictionary[String, float]) -> String:
	var best := ""; var best_score := -INF
	for action in scores:
		if scores[action] > best_score: best_score = scores[action]; best = action
	return best
```

- 适合"有很多想做的事、优先级动态变化"（SIM/群体）；动作超过 ~6 个且带噪声选择时优于 BT。
- 分数函数纯可测；加随机扰动打破平局（RNG 注入）。

## 感知（Perception）

- 视野：距离圆 + 朝向锥（`dot` 判夹角）+ `RayCast2D`（多帧交替刷新目标，不是每帧全量）。
- 听觉/事件：订阅事件总线（`noise_emitted`，见 `signals-groups.md`）——玩家脚步广播噪声事件，AI 侧评估。
- 感知节流：`_physics_process` 里 0.1–0.2s 定时刷新，目标列表缓存；`Area2D` 进出维护候选集。
- 感知快照与决策解耦：感知收集（引擎重）→ 快照（值）→ Brain（纯）。

## 寻路（NavigationAgent2D/3D）

```gdscript
@onready var nav: NavigationAgent2D = $NavigationAgent2D
func _physics_process(delta: float) -> void:
	if nav.is_navigation_finished(): return
	var next := nav.get_next_path_position()
	velocity = (next - global_position).normalized() * speed
	move_and_slide()
	nav.target_position = _current_target   # 目标变更才重设
```

- 导航网格从 TileSet Navigation Layer 烘焙（见 `tilemap-levels.md`）；运行时改格子后导航区域自动更新（4.x 导航服务器增量）。
- `target_position` 别每帧重设（触发重寻路）；`path_desired_distance`/`path_max_distance` 调到达阈值。
- 动态障碍（门/箱子）：NavigationObstacle2D + 逃避，或改网格后 `set_navigation_map` 通知。

## 群体与性能

- 同类敌人共享 Brain 状态池 + 个体参数（Resource 差异化），决策错帧分摊（每帧只 tick 1/N）。
- 屏外敌人降频（决策 1Hz）或挂起；用 `VisibleOnScreenNotifier2D` 驱动。
- 寻路结果缓存共享（同目标的一队走同一路径 + local avoidance）。
