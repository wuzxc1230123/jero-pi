# 音频与动画

## 音频：总线思维

- 三类播放器各司其职：`AudioStreamPlayer`（全局/2D 非定位）、
  `AudioStreamPlayer2D/3D`（空间衰减）。**绝不**用 2D 播 UI 音、用全局
  播脚步声——混音与衰减都会错。
- 总线（Audio Bus）开局就分：Master / Music / SFX / UI。音量、静音、
  压缩器挂总线上，不在每个播放器上各自调 dB。
- BGM 循环：导入面板勾 Loop；切歌用两播放器交叉淡入
  （`tween_property("volume_db", ...)`）。
- 音效池：同帧同音效叠加会叠响变刺——高频音效（射击/命中）限并发
  （自计数或队列）。
- 静音状态持久化走设置存档；`AudioServer.set_bus_mute` 是运行时开关。

```gdscript
# 播放一次性音效的标准姿势（挂在触发方，不建临时节点）
@onready var sfx: AudioStreamPlayer = $HitSfx
func _on_hit() -> void:
	sfx.play()
```

## AnimationPlayer（4.x）

- 属性轨道直接插值；调用轨（Call Method Track）放关键帧事件（"此时
  判定框生效"），比在代码里对表强。
- 动画状态：`play("name")` / `queue("next")` / `seek(t)`；`current_animation`
  读态。切动画用 `play` 即可打断——需要保护用 `assignment` 模式自查
  当前是否已在播。
- 动画完成回调：`animation_finished` 信号（配合 `assign_next` 链）；
  **不要**猜时长 `await timer`——动画改帧，代码就错位。
- 帧数据玩法（攻击 startup/active/recovery）：时间轴上用 Call Track
  开关 `hitbox_active`，或 AnimationTree 状态 + 代码开关；数值收进
  `@export` 常量便于调手感。

## AnimationTree：超过 ~8 状态再上

- `StateMachineAnimationNode` 做状态迁移（Idle/Run/Jump/Air）；blend
  走 `BlendSpace1D/2D`（按速度/朝向混）。
- 迁移条件用参数（`travel("run")` 或条件自动迁移）；**状态机是动画层
  的**——游戏逻辑状态（受击、死亡）别塞进 AnimationTree，两台状态机
  会打架。逻辑态驱动动画态，单向。
- `advance_mode` 自动/手动按需；帧率敏感的迁移用 `Reset` 节点归一。
- 状态机调试开编辑器 Live Debug；代码侧断言
  `tree.get("parameters/playback").get_current_node()`。

## NEVER

- **绝不用 `await get_tree().create_timer(x)` 同步动画时长**（见上）。
- **绝不每帧 `play()` 同一动画**——`play` 重置到头；已在播就别再叫。
  需要重启效果用 `stop(); play()` 显式表达。
- **绝不让音频播放器成为逻辑依赖**——BGM 是否在播不是游戏状态的
  来源；状态在 GameState，音乐只是它的表现。
- 音频/动画改动属"玩家可见"，验证必须过第三道门（跑起来看一眼 +
  截图/听感留证，见 verification.md）。
