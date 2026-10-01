# 测试策略：逻辑解耦 + gdUnit4 headless

原则：**引擎薄的逻辑直接测，引擎重的行为走场景树测试**。两层都用
headless CLI 跑，结论带退出码（见 verification.md）。

## 第一层：纯逻辑单元（零引擎依赖）

把可判定逻辑抽成纯 GDScript（静态函数或 RefCounted 类）：伤害公式、
背包规则、升级曲线、存档序列化。它们不 import 场景、不碰节点，测试
就是断言输入输出——这一层覆盖越多，回归越便宜。

```gdscript
# res://tests/test_damage.gd
class_name TestDamage
extends GdUnitTestSuite

func test_weakpoint_doubles() -> void:
	assert_that(Damage.compute(10, Damage.Type.WEAKPOINT)).is_equal(20)

func test_floor_at_zero() -> void:
	assert_that(Damage.compute(-5, Damage.Type.NORMAL)).is_equal(0)
```

## 第二层：场景树/集成（gdUnit4 场景模式）

- gdUnit4（`addons/gdUnit4`）：测试套件 `extends GdUnitTestSuite`，
  场景测试用 `auto_free(load("res://scenes/enemy.tscn").instantiate())`
  挂进 `add_child_autofree()`——框架自动清理，避免孤儿节点跨用例污染。
- 测信号：`await assert_signal(enemy).is_emitted("died")`；测物理步进
  用 `await get_tree().physics_frame`（固定步推进）。
- headless 运行（CI 与本地同一条命令，钉进 openspec/config.yaml 与
  模块 testCommand 语义一致）：

```bash
godot --headless --path . -s addons/gdUnit4/bin/GdUnitCmdTool.gd \
	--res://tests -a   # 或 -atest 测试名；退出码 0=全绿
```

- gdUnit4 的运行器脚本路径随版本变（`.sh` 包装与 `.gd` 直跑在不同
  版本间有过迁移）——钉命令前实测一次，别抄旧教程（这正是"先跑通
  再钉"的由来）。

## 解耦手法（让第一层变大）

- 依赖注入：`@export var stats: CharacterStats`（Resource），测试塞
  假数据；不要在逻辑里 `load("res://...")` 写死资源。
- 时间注入：逻辑收 `delta` 参数而不是自己 `get_process_delta_time()`，
  测试就能快进。
- 随机注入：`RandomNumberGenerator` 实例传入，seed 固定 → 可复现。
- 信号是接缝：断言信号而非断言 UI——UI 表现留给"跑起来看一眼"。

## 何时 NOT VERIFIED 而不是硬写测试

- 纯视觉/手感（粒子是否好看、操作是否跟手）：不上自动化，走人工
  观察 + 截图留证；报告如实写 NOT VERIFIED（人工项）。
- 平台相关（手柄震动、多点触控）：桌面 headless 测不了，标注平台
  与未覆盖原因——静默跳过即违规。

## 测试纪律（与包内 Strict TDD 对齐）

- 逻辑改动先写失败测试（RED）再实现（GREEN）——模块钉住的
  testCommand 是 SDD Strict TDD 转发的数据源，跑不过就不算完成。
- 测试文件与被测模块同名前缀（`test_damage.gd` ↔ `damage.gd`），
  放 `res://tests/`，禁随源码散放。
- 每个缺陷先固化成失败测试再修（回归钉）。
