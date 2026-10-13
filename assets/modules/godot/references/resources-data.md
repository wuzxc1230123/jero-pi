# Resource 与数据驱动设计

Godot 的数据 spine：玩法数值/内容表全部 `Resource` 化，代码只消费类型，数值住在 `.tres`。

## 自定义 Resource

```gdscript
class_name WeaponDef
extends Resource

@export var display_key: String
@export var damage := 10
@export var fire_rate := 0.5
@export_range(0.0, 1.0) var crit_chance := 0.05
@export var projectile: PackedScene
@export var upgrades: Array[WeaponUpgrade]     # 组合优于深继承
```

- `class_name` + `extends Resource` + `@export` = 编辑器 Inspector 免费获得可视化编辑与 `.tres` 实例化。
- 数值继承用**组合**（`upgrades` 数组、`parent_def` 引用链），不用 Resource 类继承树——继承树在 Inspector 里编辑体验差且重命名即断。
- 类型化数组（`Array[WeaponUpgrade]`）让编辑器强约束元素类型。

## 数据驱动纪律

| 内容 | 载体 |
|---|---|
| 武器/敌人/物品数值 | `*Def` Resource（`res://data/entities/`） |
| 关卡内容（波次/宝箱/触发） | `LevelData` Resource（结构层在场景，见 `tilemap-levels.md`） |
| 手感参数 | `PlayerTuning` Resource（见 `game-feel.md`） |
| 生成参数 | `GenParams` Resource（见 `procedural-gen.md`） |
| 本地化 | CSV/ gettext（键进数据，不进代码） |

- 代码里出现魔法数字两处以上 → 抽成 Resource 字段；`@export` 参数面向**设计可调**，Resource 面向**内容量产**（同一脚本 × N 份数据）。
- 共享实例陷阱：两处 `preload` 同一 `.tres` 得到同一对象，运行时改字段互相污染——可变状态用 `duplicate()` 后再改（`resource_local_to_scene` 只管场景内复制）。

## 加载时机

```gdscript
const BOSS_SCENE := preload("res://enemies/boss.tscn")   # 编译期，路径错 = 启动即报
var weapon := load(weapon_def_path) as WeaponDef          # 运行期，动态内容
```

- 启动必用 → `preload`（路径错编译期显形）；玩家可选内容（DLC/模组/海量图鉴）→ `load` + 缓存字典。
- 大图集用 `AtlasTexture`（region 切片）而非独立 PNG；纹理选项见 `asset-pipeline.md`。
- `ResourceLoader.load_threaded_request` 只在确证卡顿后引入（加载屏场景），默认主线程同步——简单正确优先。

## Resource 与场景（.tscn/.tres 同族）

- `.tscn` 就是 Resource：`PackedScene.instantiate()`；子场景的可导出面 = 根脚本 `@export`，父场景 Inspector 直接配——**接口 = @export 面 + 信号**，内部节点不外露。
- 场景做"工厂与结构"，Resource 做"数值与内容"；判断标准：有节点树/子节点行为 → 场景，纯数据 → Resource。
- 存档序列化引用内容资源存 `resource_path`（见 `save-systems.md`）。

## 模组与外部数据（进阶）

- 导入用户 `.tres`：`ResourceLoader.load(user_path)` 前先过 schema 校验（字段类型/范围），坏数据拒载并指名字段——外部输入不可信。
- JSON 表 → Resource 的离线转换脚本（编辑器插件或 headless 命令行跑），运行时读原始 JSON 表是反模式（丢类型与 Inspector）。

## 测试面（见 `testing.md`）

- Def 资源静态校验：全量扫描 `res://data/**/*.tres`，断言必填字段/引用存在（`fire_rate > 0`、`projectile != null`）——内容错误在测试期显形，不等到玩法里。
- 数值平衡表（全武器 DPS 表）由测试从 Resource 集计算导出——平衡改动即 diff 显影。
