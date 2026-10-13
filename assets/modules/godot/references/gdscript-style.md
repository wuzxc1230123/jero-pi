# GDScript 规范与 NEVER 清单

静态类型 + 显式生命周期是底线。以下 NEVER 清单每条都是高频真实缺陷，
评审按此核查（godot-reviewer 的规则来源）。

## NEVER 清单（每条都带为什么）

- **绝不手动给 `move_and_slide()` 的位移乘 delta**。`move_and_slide()`
  内部已按物理帧处理 delta，再乘一次会造成帧率依赖的手感漂移；
  `move_and_collide()` 才需要手动乘。
- **绝不在 `_process` 里做 `_physics_process` 的活**。物理查询/移动放
  `_physics_process`（固定步长，确定性）；`_process` 只放纯视觉（相机
  平滑、UI）。同理，物理体内读 `Input` 用 `_physics_process`。
- **绝不用字符串 API 连接信号**（`connect(signal, self, "method")` 是
  3.x 写法，4.x 已移除；等价的字符串目标调用是运行时炸点）。一律
  `signal.connect(callable)`；Lambda 连接的生命周期见下条。
- **绝不连接了不拆**。Lambda `connect` 持有闭包引用：节点销毁前未
  `disconnect`，被连接方存活时就泄漏（ObjectDB 孤儿来源）。习惯：
  在 `_exit_tree`/`_notification(PREDELETE)` 成对拆除，或用
  `CONNECT_ONE_SHOT`。
- **绝不声明不类型的容器**。`var items = []` 在 4.x 类型推断缺失时是
  Array（无检查）；写 `var items: Array[Node2D] = []`。Dictionary 键值
  类型同理可注。未类型化容器的取值错误要到运行时很远的地方才炸。
- **绝不依赖 `@onready` 之间的顺序**。同节点多个 `@onready` 按声明序
  初始化，跨节点顺序不定；需要依赖别人的初始化结果时在 `_ready()`
  里显式拉取，或经信号通知。
- **绝不用 `get_node("../../x")` 深相对路径**。层级一改全断；用
  `@export var target: Node` 在检查器里接线，或 `%UniqueName`（场景内
  唯一名）。跨场景访问走 autoload 信号总线（见 scene-architecture.md）。
- **绝不每帧 `get_node`/`find_child`**。节点引用在 `_ready` 缓存成
  成员；`find_child` 是全树线性扫描。
- **绝不手写单例模式**。Godot 的 autoload 就是单例机制；手写 static
  instance 字典在场景重载后持有野指针。

## 风格基线

- 公共 API 显式类型（参数与返回值）；私有可推断。`-> void` 也写。
- 信号声明带类型参数：`signal health_changed(new_value: int, max_value: int)`。
- 常量用 `const`，枚举用 `enum`，不用大写变量伪装。
- 字符串格式化用 `"%s" % [value]` 或 `str()`，不用 `+` 拼接数字。
- `await` 只用于一次性异步（`await get_tree().create_timer(1.0).timeout`）；
  周期性行为用计时器节点或 `_process` 累加，避免协程堆积。
- 资源（PackedScene 实例化、纹理）在 `_ready` 预加载（`@preload`），
  不在热路径 `load()`。

## 4.x 常用易错点速查

- Tween：`create_tween()` 返回引用，链式 `tween_property`；节点销毁时
  tween 自动失效，勿跨节点持有。
- `randi()`/`randf()` 全局可用；要可复现（测试）用 `RandomNumberGenerator`
  实例并 `seed`。
- `is_instance_valid(x)` 先于访问；`queue_free()` 后本帧对象仍可访问，
  但不要再持有引用。
- `Callable(self, "method")` 与 `self.method` 等价，后者优先（可静态检查）。
