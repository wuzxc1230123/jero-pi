# TileMap 关卡与关卡设计

4.3+ 的瓦片地图是 `TileMapLayer` 节点一族；关卡 = 多个 TileMapLayer + 数据驱动的内容层。

## TileMapLayer 组织

```
Level01 (Node2D)
├─ Ground          (TileMapLayer)   # 地形瓦片，含碰撞
├─ Decoration      (TileMapLayer)   # 无碰撞装饰，y-sort 或后景
├─ Hazards         (TileMapLayer)   # 伤害层：瓦片自定义数据标伤害值
├─ Triggers        (Node2D)         # Area2D 关卡事件，非瓦片
└─ Spawns          (Marker2D 组)    # 生成点，命名标记
```

- 一个 TileMapLayer 一个 TileSet 或共享一个；**碰撞配置在 TileSet 的 Physics Layer**，不在图层节点上。
- 图层顺序 = 绘制顺序；用 `y_sort_enabled`（角色与前景柱子遮挡）时把可遮挡层与角色放同一 y-sort 父级下。
- 瓦片自定义数据（Custom Data Layers）放伤害值/摩擦系数/音效类型——玩法数值不硬编码在脚本里逐格判断。

## TileSet 配置要点

- Physics Layer：层值对齐全局碰撞层规划（见 `physics-gameplay.md` 碰撞层节）；单向平台勾 One-way Collision。
- Terrain/Scattering：手绘地形用 Terrain 画笔自动补边；程序化生成走自定义填充循环，不用 Scattering。
- Navigation Layer：瓦片烘焙导航网格供 NavigationAgent2D 使用（见 `game-ai.md`）。
- Occlusion Layer：2D 光照（PointLight2D + 遮挡）需要，纯装饰项目跳过。

## 运行时改格子

```gdscript
@onready var ground: TileMapLayer = $Ground

func dig(coords: Vector2i) -> void:
	if ground.get_cell_source_id(coords) == -1: return  # 空格防重
	ground.set_cell(coords, SOURCE_ID, ATLAS_EMPTY)

func coords_of(pos: Vector2) -> Vector2i:
	return ground.local_to_map(ground.to_local(pos))
```

- 坐标三段转换（global → local → map）不可省略；TileMapLayer 自带变换（缩放/偏移）时直接 `floori(pos / tile_size)` 是错的。
- 批量改动（爆炸开洞）收集后一次 set，别在遍历中查询刚改过的格子。

## 关卡设计纪律（工程面）

- 块尺寸开局钉死（16/24/32/48 px），项目设置里像素 snapping 与缩放模式（canvas_items/stretch）同步钉——后改是全量返工。
- 关卡序列化：结构层（TileMap）留在场景里，内容层（敌人/宝箱/触发器）用 Resource 数据（见 `resources-data.md`）驱动，便于程序化与校验。
- 关卡入口统一 `enter_level(id)` autoload 接口：切换场景 → 重置状态 → 发 `level_entered` 事件（总线见 `signals-groups.md`）。
- 每关一个场景文件 + 一个数据 Resource；禁止"万能关卡场景 + 巨型 if 关卡号"。

## 性能红线

- 视口外瓦片默认剔除，无需手动分块——**不要**为"优化"把地图拆成手动物理区块（引入接缝 bug）。
- 大量动态光照（PointLight2D）+ 瓦片阴影是 2D 最贵的组合，移动端先测再上。
- `set_cell` 每帧调用上千次时改为批量 Command 模式（攒一帧一次 apply）。
