# 信号、组与事件总线

节点间通信的纪律：父子直调、子父信号、兄弟走总线。信号是**过去式的事实广播**，不是命令通道。

## 信号连接规范（4.x）

```gdscript
# 首选：编辑器连接（场景面板）或 callable 连接，禁止字符串方法名连接
button.pressed.connect(_on_start_pressed)
hitbox.area_entered.connect(_on_hitbox_entered.bind(hitbox))

# 带 bind 的附加上下文：bind 的参数接在信号参数之后
enemy.died.connect(_on_enemy_died.bind(enemy.id))

# 一次性 / 延迟 / 常驻
timer.timeout.connect(_on_timeout, CONNECT_ONE_SHOT)
door.body_entered.connect(_on_enter, CONNECT_DEFERRED)  # 物理回调里改树必须 DEFERRED
```

要点：
- 信号在**状态变更完成之后**发出——监听者读到的发送者状态必须是已一致的。
- 自定义信号带类型与足量上下文：`signal health_changed(current: int, max: int)`，让监听者无需回查发送者。
- `await some_signal` 只用于真正的顺序流程（过场、回合切换）；游戏循环逻辑里 await 是隐藏的控制流耦合。

## lambda 连接的泄漏账

```gdscript
# 每次 lambda 都是新 Callable——disconnect 不可能与 connect 对上
signal_source.hit.connect(func(): take_damage(1))
```

规则：
- 生命周期不一致的连接（监听者比发送者活得短，或反过来）一律存 `Callable` 成员变量，`_exit_tree()` 里显式 `disconnect`。
- 发送者短命、监听者长命：用 `CONNECT_ONE_SHOT` 或在发送者 `_exit_tree` 断开。
- `queue_free()` 后信号仍可能触发一轮（ deferred 调用排队中）——监听者入口先 `is_instance_valid(sender)` 防御或保证断开先于释放。
- ObjectDB 泄漏的排查面：编辑器"孤立节点"报告 + monotonic 断言（测试里 `assert_int(Object.get_instance_count())`）。

## 事件总线 autoload（跨系统通信的唯一通道）

```gdscript
# events.gd —— 全局事件总线 autoload
extends Node
signal enemy_killed(enemy_id: int, position: Vector2)
signal level_completed(level_id: String)
signal save_requested(slot: int)
```

- 总线只广播**事实**，不携带命令语义（`save_requested` 是请求事实，处理者自取）。
- 兄弟节点/跨场景通信一律走总线；`get_parent().get_parent()` 深链直调是架构债，评审 BLOCKER。
- 总线信号数超过 ~15 个时按域拆分（combat_events / meta_events），防单个 autoload 变垃圾场。
- 存档/成就等系统只订阅总线，绝不反向依赖 gameplay 场景。

## 组（Group）：批量寻址与类型标记

```gdscript
add_to_group("enemies")
get_tree().call_group("enemies", "on_alert", player_position)
var count := get_tree().get_nodes_in_group("enemies").size()
```

- 组是**动态集合**（成员随树进出），不是类型系统——判断类型用 `is Enemy`，组只做"对这批节点做事"。
- `call_group` 没有顺序保证；需要顺序就先 `get_nodes_in_group` 排序再遍历。
- 编辑器里预置的组（Node 面板）适合静态标记（`"persist"`、`"reset_on_death"`），运行时 add_to_group 适合状态切换（`"stunned"`）。
- `call_group` 在物理回调里改树同样要 `call_deferred` 语义（group 名加 `"_deferred"` 不是机制——改为成员方法内部 call_deferred）。

## 组合模式速查

| 场景 | 机制 |
|---|---|
| UI 按钮响应 | 编辑器 connect 到本场景脚本 |
| 子场景通知父级 | 自定义信号，父级在实例化处 connect |
| 玩家死亡 → UI/音频/存档 | 事件总线广播 `player_died` |
| 回合系统顺序流转 | 状态机 + await 信号（仅回合制） |
| 全场敌人受波及 | `call_group` + 状态自检 |
