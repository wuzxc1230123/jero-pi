# 程序化生成（ProcGen）

铁律：**生成 = 纯函数（种子 → 数据）**，引擎侧只消费数据渲染。全局 `randi()/randf()` 在 procgen 里禁用——一律注入 `RandomNumberGenerator`。

## 种子纪律

```gdscript
class_name LevelGen
extends RefCounted

var rng := RandomNumberGenerator.new()

func generate(seed_value: int) -> LevelData:
	rng.seed = seed_value            # 同种子必产同世界——回归测试的基础
	var data := LevelData.new()
	# … 纯数据生成，不碰节点 …
	return data
```

- 种子来自存档/服务器/分享码；生成参数（密度/尺寸/难度曲线）打包成 `GenParams` Resource。
- 每个子系统**各持一个 RNG 派生流**（`rng.randi()` 再播种子生成器），改餐厅布局不破坏房间序列的稳定性。
- 版本化：`gen_version` 存进产物数据——生成算法升级后旧种子重放需迁移或钉版本。

## 2D 地图生成谱系（选型）

| 方法 | 形态 | 适合 |
|---|---|---|
| 元胞自动机 | 有机洞穴 | 洞穴探索/生存 |
| BSP 二叉分割 | 矩形房间+走廊 | 地牢/据点 |
| Wang/边缘匹配瓦片 | 平滑连接的地形 | 开放地形（配 TileSet Terrain） |
| 波函数坍缩（WFC） | 约束满足拼合 | 结构化地牢/谜题 |
| 随机游走 | 蜿蜒通道 | 快速原型/河流 |

- 先写"生成器 → 调试导出 PNG"的可视化工具（`Image.fill_rect` 逐格着色），肉眼验收先于玩法验收。
- 生成结果必须过**可玩性校验**（连通性：入口到出口可达——flood fill 断言；密度/宝箱分布阈值），失败重roll（上限次数后回退种子链）。

## 接入 TileMapLayer

```gdscript
func apply(map: TileMapLayer, data: LevelData) -> void:
	for coords in data.cells:
		map.set_cell(coords, data.source_of(coords), data.atlas_of(coords))
```

- 生成器产出 `Dictionary[Vector2i, TileSpec]` 级数据；`apply` 是唯一碰节点的环节，可整体重放（重roll = clear + apply）。
- 大图分块：`TileMapLayer` 自带剔除，数据层按 chunk（32×32）组织是给**校验与序列化**的，不是渲染优化。

## 内容生成（名字/战利品/遭遇）

- 表驱动：词表 + 语法模板（`"{adj}之{noun}"`）全部 Resource 化（见 `resources-data.md`）。
- 战利品：加权表（`weight → 累积区间二分`）+ 保底计数器（pity）——概率配置可热调。
- 遭遇波次：预算制（每波点数池买怪），不是硬编码波次表。

## 测试与回归（见 `testing.md`）

- 快照测试：固定种子跑生成，对输出数据哈希/关键指标（房间数/连通图直径）断言——算法改动立即显影。
- 性能预算：单次生成 < 50ms（关卡级）；超了先查算法复杂度，别急着上线程。
- WorkerThreadPool 只用于独立大生成（世界种子），增量生成留在主线程避免接缝竞态。

## 红线

- 生成代码里出现 `randf()`（全局随机源）——不可复现，BLOCKER。
- 生成器直接 instantiate 场景节点——生成层与呈现层耦合，重roll/测试全坏。
- 无连通性校验就放玩家进去（不可通关的地图）。
