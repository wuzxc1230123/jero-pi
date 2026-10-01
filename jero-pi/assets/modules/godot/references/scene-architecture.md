# 场景组织与 autoload 架构

Godot 的组织哲学是**组合优于继承**：小场景拼大场景，节点间用信号通信，
父子间才允许直接方法调用。

## 场景拆分原则

- 一个场景 = 一个可复用的功能单元（玩家、敌人、武器、UI 面板）。判断
  标准：你会不会在别处 instance 它？不会就并进父场景。
- 场景根节点承担"对外接口"职责：对外只暴露信号（事件上行）与方法
  （命令下行）；内部子节点是实现细节，外部不得触碰。
- 父到子可直接调用；子到父发信号；兄弟之间经共同父级或信号总线中转。
  跨层直接 `get_parent().get_parent()` 是结构债，评审拦截。
- 命名：场景根用 PascalCase 名词；实例节点在父场景里用小写角色名
  （`player`、`hud`）——读路径时角色即语义。
- 场景内跨层引用用唯一名（`%HealthBar`）；勾选 Access as Unique Name
  而不是深路径。

## autoload 分层（服务 / 状态 / 工具）

autoload 是全局单例，滥用会让一切依赖一切。按三类收敛，每类语义不同：

1. **服务层**（`EventBus`、`AudioManager`、`SceneManager`）：无状态或
   只持有会话状态，对外提供方法与信号。跨系统通信一律走这里的信号
   总线，例如 `EventBus.enemy_died.emit(enemy)`。
2. **状态层**（`GameState`、`SaveData`）：存档与运行时状态，可序列化。
   只放数据与读写方法，不放行为逻辑；变更对外发信号。
3. **工具层**（`GameMath`、`Constants`）：纯函数/常量，无状态。

NEVER：
- **绝不把玩家/敌人等场景实例放进 autoload**——autoload 生命周期跨
  场景切换，持有节点引用就是野指针工厂。
- **绝不让 autoload 依赖具体场景结构**（autoload 里 `get_node("/root/Main/Player")`
  是双向耦合：场景重排即断，且遮蔽真实的依赖方向）。
- **绝不用 autoload 替代参数传递**来"省事"——能走注入的依赖走注入，
  只有真正全局的（音频、事件、存档）才上 autoload。
- autoload 数量本身是架构信号：超过 ~7 个说明职责切分出了问题。

## 信号设计

- 信号名过去式事件（`died`、`collected`、`level_finished`），不发布
  命令（不叫 `please_die`）。
- 载荷带足上下文（谁、多少）：`signal damage_taken(amount: int, source: Node)`，
  让订阅者不必回查。
- 信号在状态变更**之后**发出；发两段式（`about_to_*` / `*`）给需要
  前置处理的场景。
- 事件总线信号带 `source` 参数，避免全局信号变成匿名广播深渊。

## 状态机

玩法实体（玩家/敌人/AI）用枚举状态机起步，不引框架：

```gdscript
enum State { IDLE, RUN, JUMP, HURT }
var state: State = State.IDLE

func _change_state(next: State) -> void:
	if state == next: return
	_exit_state(state)
	state = next
	_enter_state(next)
```

状态超过 ~8 个、或需要层级/并行状态时再评估 AnimationTree（见
audio-animation.md）或树形状态机插件——先付最简单的成本。
