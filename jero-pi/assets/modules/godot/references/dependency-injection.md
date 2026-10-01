# 依赖注入（DI，可测性的底座）

目标只有一个：**依赖显式化**——模块需要什么，看签名就知道；测试时
塞什么，它就用什么。GDScript 没有 DI 框架也不需要：三条注入面 +
一条"autoload 收口"纪律就是全部。

## 三条注入面

### 1. 构造注入（`_init` 参数）——逻辑对象首选

```gdscript
class_name DamageCalculator
var _rng: RandomNumberGenerator
func _init(rng: RandomNumberGenerator) -> void:
	_rng = rng            # 依赖是参数：测试传定 seed 的 RNG，正式传注入的
```

- 纯逻辑类（伤害公式/背包规则/存档序列化，见 `testing.md`）全部走
  构造注入——`new` 时给依赖，对象不自取。
- 时间同此理：别在逻辑里直接 `Time.get_ticks_msec()`，包一个
  `Clock` 接口注入（测试里拨时钟，冷却/超时逻辑才能确定性断言）。

### 2. 资源注入（`@export var cfg: XConfig`）——数据依赖

- 配置/数值依赖用 `@export` Resource（`resources-data.md`）：Inspector
  可配、`.tres` 可换、测试可 new 一份定制值。
- 这是"数据版 DI"：换数值不动代码，换实现（测试桩）不动场景。

### 3. 属性注入（instantiate 后赋值）——场景对象

```gdscript
var enemy := enemy_scene.instantiate()
enemy.configure(brain, loot_table)   # 场景根的公开装配方法，而非满仓 get_node
add_child(enemy)
```

- 场景实例化的依赖经**根节点公开方法/导出属性**喂入
  （`component-system.md` 的装配纪律同源）；场景内部结构不对外。

## autoload 的位置（服务定位器 ≠ DI 容器）

- autoload 是**服务定位器**：全局取用点，适合跨场景服务（存档、音频
  总线、事件总线）。它不是 DI 容器——**逻辑代码不直接
  `get_node("/root/SaveManager")`**（`scene-architecture.md` autoload
  边界）。
- 分界线：可测逻辑（公式/规则/状态机）零 autoload 引用，依赖全注入；
  场景粘合层（UI/关卡通配）才允许碰服务，且经显式引用不散弹查找。
- 好处直接兑现在测试上：headless 单测不需要起场景树、不需要真存档
  ——桩对象注入即测（`testing.md` 的解耦主张由此落地）。

## 循环依赖（出现即设计警讯）

A 依赖 B、B 又依赖 A：说明两者该合并、或该抽出第三个（C 依赖
A/B，A/B 互不知晓），或改单向 + 信号回传。GDScript 预解析会咬人
（互相 class_name 引用偶发解析顺序问题），出现先改设计别绕语法。

## NEVER

- **NEVER 逻辑深处 `get_node("/root/AutoloadX")` 散弹查找**——依赖
  看不见、测试拆不动；依赖要么是参数/导出，要么收口在粘合层。
- **NEVER 用隐藏全局单例代替注入后宣称"可测"**：测试跑得起来 ≠
  依赖可替换；不可替换就测不了分支。
- **NEVER `_ready` 里一次性拉全部依赖存着永远不用**（懒加载伪需求）：
  依赖按构造/装配时序显式给，不用就不注入。
- **NEVER 绕过装配协议直接伸进场景内部喂依赖**（`enemy.get_node(
  "Health").max_hp = …`）——与封装纪律（`scene-architecture.md`）
  同一条红线。
