# 摄像机系统

摄像机是手感的一半：跟随、构图、震动、聚焦各有独立状态，禁止一个脚本糅在一起。

## Camera2D 跟随配方

```gdscript
# camera_rig.gd —— 跟随 + 死区 + 前视偏移
extends Camera2D

@export var target: Node2D
@export var look_ahead: float = 48.0
@export var deadzone_height: float = 32.0
var _offset_x := 0.0

func _process(delta: float) -> void:
	if target == null: return
	_offset_x = lerp(_offset_x, signf(target.velocity.x) * look_ahead, 5.0 * delta)
	var goal := target.global_position + Vector2(_offset_x, 0.0)
	global_position = global_position.lerp(goal, 8.0 * delta)
```

- `position_smoothing`（内置平滑）与手写 lerp 二选一；手写才能做死区/前视，内置只做纯延迟跟随。
- 垂直死区：跳跃时摄像机别跟着疯跳——y 轴用更慢的 lerp 或 `limit_` + 平台钳制。
- `limit_left/right/top/bottom` 钉关卡边界（从关卡数据 Resource 读，不手填每关数字）。
- `drag_horizontal_enabled`（拖拽窗口）适合大角色/载具，平台跳跃通常关闭。

## 屏震（trauma 模型）

```gdscript
var _trauma := 0.0
func add_trauma(amount: float) -> void:
	_trauma = clampf(_trauma + amount, 0.0, 1.0)

func _process(delta: float) -> void:
	_trauma = maxf(0.0, _trauma - 1.5 * delta)
	var shake := _trauma * _trauma          # 平方衰减：小创伤几乎不可见
	offset = Vector2(randf_range(-1, 1), randf_range(-1, 1)) * 16.0 * shake
```

- 震动是**加性请求**：任何系统 `add_trauma(0.3)`，摄像机自己衰减——禁止各处直接改 `offset`。
- trauma 系统的随机源注入 RNG 成员（可测，见 `testing.md`）。
- 命中停顿（hit-stop）与屏震配合使用，参数见 `game-feel.md` 反馈层级。

## 摄像机状态与切换

- 构图状态机：`follow / focus_point / cutscene_lock / shake_override`——过场锁定用 `make_current()` + 补间，结束回 follow。
- 多摄像机切换用 `Camera2D.make_current()` 平滑过渡（`position_smoothing` 保留速度）；硬切（关卡门）直接 `enabled` 翻转。
- SubViewport 画中画（小地图/后视镜）：主场景 + SubViewportContainer + 独立 Camera3D/2D，注意 `own_world_3d` 隔离渲染。

## Camera3D 要点

- 平滑跟随用 `Camera3D` 挂在弹簧臂（SpringArm3D）末端：SpringArm3D 处理碰撞回缩（镜头不穿墙）。
- FOV 动态（冲刺扩 FOV）是廉价速度感；`fov` lerp 系数独立于位置跟随。
- 第三人称：SpringArm3D + 鼠标/右摇杆输入改 `rotation`，输入累积灵敏度 `@export` 可调。

## 红线

- 每帧 `global_position = target.global_position` 硬锁（无平滑、无死区）——手感粗糙且放大像素抖动。
- 震动直接写 `offset` 不衰减（永久偏移漂移）。
- 2D 项目用 `zoom` 做震动（破坏像素网格对齐）——用 `offset`。
- 摄像机逻辑写在玩家脚本里（换角色/过场全要改玩家）——独立 rig 节点。
