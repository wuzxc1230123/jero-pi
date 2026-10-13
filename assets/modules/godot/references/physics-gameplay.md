# 2D 物理与玩法机制

以 CharacterBody2D + 手感三件套（重力/土狼时间/跳跃缓冲）为主轴；
物理系统是**手感工具**，不是真实感模拟器。

## CharacterBody2D 正确配方

```gdscript
@export var speed: float = 300.0
@export var jump_velocity: float = -400.0
@export var coyote_time: float = 0.1
@export var jump_buffer: float = 0.15

@onready var _coyote_timer := coyote_time
@onready var _buffer_timer := 0.0

func _physics_process(delta: float) -> void:
	# 计时器（秒）在固定步长里累加是安全的
	_coyote_timer = -delta if is_on_floor() else _coyote_timer - delta
	_buffer_timer -= delta
	if Input.is_action_just_pressed("jump"):
		_buffer_timer = jump_buffer
	if _buffer_timer > 0.0 and _coyote_timer > 0.0:
		velocity.y = jump_velocity
		_buffer_timer = 0.0
		_coyote_timer = 0.0

	var direction := Input.get_axis("move_left", "move_right")
	velocity.x = direction * speed
	if not is_on_floor():
		velocity += get_gravity() * delta
	move_and_slide()   # 内部已处理 delta——外部不要再乘
```

要点：
- `move_and_slide()` 前直接赋 `velocity`；4.x 用 `get_gravity()`
  （项目设置里的重力向量），不自造常量。
- 地面检测 `is_on_floor()` 依赖上一帧 `move_and_slide()` 的碰撞结果，
  在它**之后**读才有效。
- 斜坡/墙：`floor_snap_length`、`floor_max_angle` 调爬坡；`slide_on_ceiling`
  控制顶头行为。
- 可变跳高：松开跳跃键时若仍在上升，`velocity.y *= 0.5` 截断。

## RigidBody2D：让物理管它

- **绝不每帧 set `position`/`linear_velocity` 以外的运动学量**——要么
  纯 CharacterBody，要么信刚体：施力/冲量（`apply_impulse`）、约束
  （关节）。
- 玩家推箱子：给箱子 `move_and_slide()` 碰撞后施加冲量，而不是直接
  改箱子位置。
- 刚体睡眠（`sleeping`）让静止堆叠零成本；唤醒由碰撞自动处理。

## TileMap（4.x 拆成 TileMapLayer）

- 4.3+ 一个 TileMap 节点只有一层：多图层 = 多个 `TileMapLayer` 子节点
  （地形/装饰/碰撞分层的物理层也从这里配）。老教程里单 TileMap 多
  layer 的 API 已废。
- 碰撞：TileSet 的 Physics Layer + Physics Layer 值分层（与角色
  `collision_layer/mask` 对齐，见下）。
- 单向平台：TileSet physics 形状勾 One-way Collision；配合
  `floor_block_on_wall` 类属性调下穿。
- 运行时改格子：`set_cell(coords, source_id, atlas_coords)`；程序化
  生成用 `Terrain`/`Scattering` 或自定义填充循环。

## 碰撞层规划（开局就定，后补是灾难）

项目设置里把 1~10 层命名（world/player/enemy/hazard/projectile/trigger…），
代码与场景统一引用层名。惯例：
- `collision_layer` = 我是什么（别人检测我）；`collision_mask` = 我
  检测什么。
- 玩家 mask 通常不含玩家（不做玩家互撞）；投射物 mask 含敌人和 world。
- 感应（AI 视野、触发器）用 `Area2D`，物理主体用 body——Area 不参与
  重量/反弹，只发 overlap 信号。
- 信号对：`body_entered` 里先判 `is_in_group()` 或层掩码再处理，别把
  信号处理写成万事都响应。

## 常见手感机制速查

- 击中停顿（hit-stop）：命中时 `Engine.time_scale = 0.05` 若干毫秒后
  还原，或对 `get_tree().create_timer(t, true, false, true)` 计真实时间。
- 屏震：`Camera2D` 偏移噪声（`offset` 随机衰减）或 `apply_shake` 私有
  实现；幅值/时长常量化。
- 传送门/重生：改 `global_position` 后调 `reset_physics_interaction`？
  不存在——CharacterBody 直接挪即可；RigidBody 挪后要 `sleeping = false`。
