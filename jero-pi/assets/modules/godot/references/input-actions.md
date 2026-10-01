# 输入系统（InputMap 与事件流）

铁律：**代码只认动作（action），永不认按键**。按键 → 动作的映射全部住在 InputMap（项目设置或运行时重映射）。

## InputMap 组织

- 项目设置里预定义全部动作：`move_left/move_right/jump/attack/interact/pause…`，同时绑键盘与手柄。
- 动作命名按**意图**（`attack`），不按物理键（`space_pressed`）——重映射、手柄、本地化全部免费获得。
- UI 动作族（`ui_accept/ui_cancel/ui_left…`）可复用；自定义 UI 导航另建 `nav_up` 等并映射到焦点邻居。

## 轮询 vs 事件（选对的通道）

```gdscript
# 游戏循环持续状态：_physics_process 里轮询
var axis := Input.get_axis("move_left", "move_right")
if Input.is_action_just_pressed("jump"): _buffer_jump()
Input.is_action_pressed("attack")      # 持续
Input.get_vector("mv_left", "mv_right", "mv_up", "mv_down")  # 归一化摇杆向量

# 单发离散事件：_unhandled_input（UI 拿剩的才到这）
func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("interact"):
		interact()
		get_viewport().set_input_as_handled()
```

- 事件传播顺序：`_input` → UI（Control）→ `shortcut_input` → `_unhandled_key_input`/`_unhandled_input`。游戏输入默认写 `_unhandled_input`/`_unhandled_key_input`，UI 打开时不误触。
- `is_action_just_pressed` 在 `_physics_process` 里以物理帧语义工作；混用 `_process`（渲染帧）会造成手感抖动——同类判定固定在同一个循环里。
- `echo`（按键重复）事件：`event.is_echo()` 过滤，文本输入除外。

## 手柄与多设备

- InputMap 一动作多事件（键盘 + 手柄按钮 + 手柄轴），检测 `Input.get_joy_axis` 只用于震动/检测，不用于玩法。
- 检测最近使用设备以切 UI 图标：监听 `Input.joy_connection_changed` + 在 `_unhandled_input` 里判 `event is InputEventJoypadButton/Motion` 记 `last_device`。
- 轴 deadzone 在**动作事件**上配（InputMap 的 deadzone 属性），全局默认 0.5；射击瞄准类另设 0.2。

## 运行时重映射（设置界面）

```gdscript
func remap_action(action: String, event: InputEvent) -> void:
	for old in InputMap.action_get_events(action):
		InputMap.action_erase_event(action, old)
	InputMap.action_add_event(action, event)
	InputEventMapPersistence.save()   # user:// 落盘，键位持久化
```

- 重映射界面监听"下一个输入事件"用 `_unhandled_input` + `set_input_as_handled`，并在等待态吞掉 `ui_cancel` 以外的取消逻辑。
- 键位持久化存 `user://`（JSON 键值：action → event 序列化），加载在 autoload `_ready`，早于任何场景读输入。

## 红线与常见坑

- 物理键 `KEY_SPACE` 判断出现在玩法代码 = BLOCKER（键盘布局/手柄全坏）。
- `_input` 里处理玩法（暂停菜单开着也能开枪）。
- 键鼠同时按住的动作冲突：以 InputMap 顺序为准，`get_axis` 自动取赢者，自写 `if pressed A else if pressed B` 会双轴打架。
- 触屏/虚拟摇杆：`TouchScreenButton` 只做 UI 面姿态，逻辑仍走动作（`Input.action_press/action_release` 注入）。
