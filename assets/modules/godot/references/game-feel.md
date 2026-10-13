# 游戏手感（Juice 与反馈层级）

手感 = 输入响应 + 反馈层级 + 时间 manipulated。所有手感参数 `@export` 化，集中可调，禁止散落硬编码。

## 反馈层级（每档比上档强、成本递增）

| 层级 | 手段 | 时机 |
|---|---|---|
| L0 即时 | 精灵切换/闪白（`modulate`） | 命中帧（≤1 帧延迟） |
| L1 微缩放 | squash & stretch、微位移 | 命中/落地/起跳 |
| L2 时间 | 命中停顿（hit-stop）、慢动作 | 重击/处决 |
| L3 空间 | 屏震（trauma 模型，见 `camera-systems.md`） | 受击/爆炸 |
| L4 综合 | 粒子 + 音效 + UI 脉冲同帧齐发 | 击杀/破坏 |

- **同帧齐发原则**：一次命中的视觉/听觉/触觉反馈在同一帧发出——分帧发出的反馈读起来像"卡了"。
- 反馈是可关的（无障碍/性能档）：`juice_level: int` 全局档位，L2+ 按档降级。

## squash & stretch（2D 通用配方）

```gdscript
@export var squash_amount := Vector2(1.25, 0.75)
@export var recover_time := 0.12

func squash() -> void:
	scale = squash_amount
	var tween := create_tween().set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	tween.tween_property(self, "scale", Vector2.ONE, recover_time)
```

- 落地压扁、起跳拉长方向与速度方向一致；`TRANS_BACK/EASE_OUT` 组合自带过冲弹性。
- 动画状态与缩放叠加会打架——squash 用 `scale`，Sprite2D 动画只换帧，两者正交。

## 命中停顿（hit-stop）

```gdscript
func hit_stop(duration_ms: int, time_scale: float = 0.05) -> void:
	Engine.time_scale = time_scale
	await get_tree().create_timer(duration_ms / 1000.0, true, false, true).timeout
	Engine.time_scale = 1.0
```

- `create_timer` 第 4 参 `ignore_time_scale = true` 是还原的关键——用受缩放的计时器会停在里面。
- 停顿时长 40–120ms 起步（重击 120–200ms）；超过 250ms 用户感知为"故障"。
- `Engine.time_scale` 是全局的：UI/音效走不受缩放的处理（音频不受影响，粒子会）——上线前做无障碍开关。

## 输入响应三件（所有动作游戏）

1. **缓冲（buffer）**：输入提前 ~0.12s 记忆，状态就绪即消费（跳跃缓冲，配方见 `physics-gameplay.md`）。
2. **土狼时间（coyote）**：离地后 ~0.1s 内跳跃仍有效。
3. **取消窗口**：攻击后摇可被翻滚/跳跃取消——用帧数据表（`can_cancel_from_ms`）而非 if 链。

## 加速度与摩擦曲线

- 立即启动 + 缓慢停止（玩家直觉）：加速系数高、摩擦系数低。
- `velocity.x = move_toward(velocity.x, target, accel * delta)`；加速度/减速度分开暴露。
- 空中操控度（air_control 0–1）单独参数——"空中像冰"与"空中全控"都是设计选择，不是默认。

## 数值管理纪律

- 手感参数表集中一处（`PlayerTuning` Resource，见 `resources-data.md`），运行时可热调（dev 面板）。
- 参数默认值先抄成熟平台跳跃基准，再调——不要从 0 发明。
- 每次调参后录 10s 对照（或截图差分）；"感觉好点了"不是证据。
