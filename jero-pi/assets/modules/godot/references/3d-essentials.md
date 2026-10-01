# 3D 基础（Godot 4.x 3D）

2D 团队进 3D 的最小面：变换/节点族、导入、光照、物理、性能。深度（渲染管线/着色器细节）见 `shaders-visuals.md` 与 `performance.md`。

## 节点族与变换

- 骨架：`Node3D`（变换容器）→ `MeshInstance3D`（渲染）→ `Light3D` 族 / `Camera3D` / `CollisionShape3D`（物理件挂在 body/area 下，不在 Node3D 上）。
- 变换三件：`position`（局部）、`global_position`、`transform`（完整基）；**不要**拆欧拉角拼变换——`look_at()`/`Transform3D` 直算，`rotation` 只做读展示。
- `queue_free` 之外的重置：`transform = transform.origin` 陷阱——用 `global_transform = Transform3D(Basis.IDENTITY, pos)` 显式整置。

## 模型导入（glTF 为主）

- glTF 2.0（`.glb`）是交换格式首选；FBX 走官方转换器，Blender 直出用 better-native 插件链。
- 导入即烘焙：导入面板的动画/网格选项属于**导入资产**（`.godot/imported/` 里，改了 `.import` 才生效，见 `asset-pipeline.md`）。
- 动画重定向：`Skeleton3D` + `BoneMap`（人形重定向到统一骨架），动画单独 `.tres` 复用。
- 单位与比例：glTF 米制，Godot 米制——模型 100 倍大 = 源文件单位错，回 DCC 修，不在场景里 `scale` 硬补。

## 光照与氛围

| 光源 | 用途 | 成本 |
|---|---|---|
| `DirectionalLight3D` | 太阳/月 | 全局阴影最贵 |
| `OmniLight3D` | 点光 | 距离衰减 |
| `SpotLight3D` | 手电/舞台 | 锥体 |
| Emission 材质 | 霓虹/屏幕 | 近似免费 |

- 全局光照：SDFGI（动态场景，中高端）/ VoxelGI（小场景）/ LightmapGI（静态烘焙，最便宜）——**移动端首选 LightmapGI + 少量实时光**。
- 环境：`WorldEnvironment`（天空/雾/色调映射/自动曝光）；雾统一氛围，别靠逐物体调色。
- 阴影预算：每 DirectionalLight 一张；点光阴影默认关，开了先测（`shadow` 项是性能悬崖）。

## 3D 物理

- `CharacterBody3D`（玩家/敌人）配方同 2D（`move_and_slide()`、`is_on_floor()`，见 `physics-gameplay.md` 的 3D 等价节）；`RigidBody3D` 信力不信位置。
- `CollisionShape3D`：胶囊（角色）/盒（静态）/凸包（复杂刚体）；**三角网格（ConcavePolygonShape3D）只能给 StaticBody3D**，给运动体 = 物理引擎地雷。
- 3D 碰撞层规划与 2D 同纪律（开局命名，见 `physics-gameplay.md`）；`Area3D` 做拾取/触发。
- `NavigationAgent3D` + NavigationRegion3D 烘焙导航（AI 见 `game-ai.md`）。

## 原型与灰盒

- CSG 节点（`CSGBox3D` 等）快速搭关卡灰盒，替换成品网格时逐个换 `MeshInstance3D`——CSG 不进量产（碰撞合并成本）。
- `MeshDataTool`/`ArrayMesh` 程序化网格只在确有需求时（程序化地形见 `procedural-gen.md` 的 3D 节）。

## 性能红线（详见 `performance.md`）

- 顶点预算与 draw call：合并静态网格（`MeshInstance3D` 的 `Cast Shadow` 关闭的遍地理由不存在——按需）。
- LOD（`LOD` 组或 `visibility_range`）给中远景；`OccluderInstance` 挡视锥外大宗。
- 每帧 `get_node`/动态 `instantiate`（对象池纪律同 2D）。
- 未设 `visibility_range` 的粒子/装饰铺满全图。
