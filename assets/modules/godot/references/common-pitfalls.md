# 4.x 常见陷阱与 API 改名精选

从 3.x 教程/记忆抄代码是本领域最大的缺陷来源。以下是高频踩雷点与
改名对照——**遇到"教程 API 不存在/行为不对"先查这里**。

## 3.x → 4.x 高频改名

| 3.x | 4.x | 备注 |
| --- | --- | --- |
| `Tween` 节点 | `create_tween()` | 节点形式已废；链式 API |
| `GIProbe` | `VoxelGI` | 3D 全局光照 |
| `TileMap` 多 layer | 多个 `TileMapLayer` 子节点 | 4.3+ 拆层 |
| `OS.window_*` | `DisplayServer.window_*` | 窗口操作搬家 |
| `OS.get_ticks_*` | `Time.get_ticks_*` | 时间 API 搬家 |
| `Input.is_key_pressed(KEY_*)` | 物理键用 `Input.is_physical_key_pressed` | 布局无关 |
| `Instance.from` / 信号字符串 | `signal.connect(callable)` | 见 gdscript-style.md |
| `PoolStringArray` 等 | `PackedStringArray` 等 | 容器更名 |
| `tool` 关键字 | `@tool` 注解 | 注解化 |
| `export var` | `@export var` | 同上 |
| `KinematicBody2D` | `CharacterBody2D` | 连 `move_and_slide` 语义一起变 |
| `Spatial` | `Node3D` | 3D 基类 |
| `ArvrServer` 等 ARVR 名 | `XRServer`/`XROrigin3D` | XR 更名 |

## 4.x 内部小版本注意（4.0→4.7）

- 4.4：Shader 默认纹理方法签名 `Texture`（非 `Texture2D`）——GDScript
  侧 shader 参数代码注意。
- 4.4：类型化 Dictionary（`Dictionary[K, V]`）落地——4.0–4.3 项目里写它
  直接语法错误，跨版本代码用 `Dictionary` + 显式键值类型注释过渡。
- 4.6：Windows 默认渲染后端从 Vulkan 改为 D3D12——平台差异问题先查
  渲染后端（`--rendering-driver` 可钉）。
- `RandomNumberGenerator`/`get_gravity()` 等在 4.0→4.3 间有签名微调；
  升级引擎后全量跑验证三道门（verification.md）再动手写新代码。

## 高频语义陷阱（不是改名，是行为）

- **`queue_free()` 是延迟的**：本帧对象仍有效，但别再存引用；children
  随父一起释放，不需要手动递归。
- **`PackedScene.instantiate()` 返回的节点资源共享**：Resource 默认
  共享（改一个实例的资源，同源全变）。要独立副本在资源上
  `duplicate()`，或勾 `Local to Scene`。
- **`@export var x := 1` 的默认值活在场景文件里**：改脚本默认值对已
  保存场景不生效（场景里存了旧值）——调试"改了没反应"先查场景序列化。
- **`call_deferred` 的时序**：在帧末空闲期执行；依赖"这帧内完成"的
  逻辑会错位。物理回调里改物理状态（加/删碰撞体）必须 deferred。
- **信号 connect 的 `CONNECT_PERSIST`/默认旗标**：默认跨场景重载保留，
  手动 `get_node` 目标销毁时自动断——Lambda 目标不自动断（见
  gdscript-style.md 泄漏条）。
- **`await` 不等于协程安全**：场景切换后 `await` 恢复时 `self` 可能
  已出树——恢复点首行守卫 `if not is_inside_tree(): return`。
- **`.tscn` 手改是允许的但要小心**：UID（`uid://`）别重排；冲突的
  UID 在 4.x 会静默改引用。尽量让编辑器写场景文件。
- **`OS.get_cmdline_user_args()` 只收 `--` 之后**：写 CLI 工具脚本
  （如 parse_check）时参数放在 `--` 后（见 verification.md）。

## 输入映射

- 项目输入动作（Input Map）优先于裸键码：`Input.is_action_pressed
  ("jump")` 可重绑定、可本地化；`KEY_*` 判断留在调试工具里。
- `is_action_just_pressed` 在 `_physics_process` 里以物理帧粒度生效，
  高频输入（连打）可能吞——这类读 `_process`/`_unhandled_input`。
