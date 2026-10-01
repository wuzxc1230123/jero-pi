# 验证主干：headless CLI、退出码与"跑起来看一眼"

Godot 侧一切可回归的验证结论都必须能从**退出码与磁盘产物**还原——不依赖
开着编辑器、不依赖肉眼盯着、不依赖任何活连接。三道门按序执行，上一道
不过不进下一道。

## 第一道门：headless import（类缓存 + 工程完整性）

```bash
godot --headless --path . --import
```

- 退出码 0 = 工程可导入（资源、类缓存、autoload 声明全部可解析）。
- 这一步会重建 `.godot/` 类缓存——`class_name` 与 autoload 符号在后续
  parse 检查里能解析，全靠它。**先 import 再 parse，顺序不可反**。
- 模块 `config.testCommand` 钉的就是这条命令：它是任何 Godot 项目的
  最低可验证门槛，SDD Strict TDD 转发以此兜底。

## 第二道门：parse 检查（按游戏真实加载方式校验脚本）

`--check-only` 编译时不注册 autoload，引用 autoload 名的合法代码会误报
`Identifier not found`。正确做法是用 `SceneTree` 脚本在 `_initialize()`
（启动完成后执行）里逐个 `load()`：

```gdscript
# res://tests/parse_check.gd
extends SceneTree

func _initialize() -> void:
	var failed := 0
	for path in OS.get_cmdline_user_args():
		var script := load(path) as Script
		if script == null or not script.can_instantiate():
			printerr("PARSE FAIL: ", path)
			failed += 1
		else:
			print("ok: ", path)
	quit(1 if failed > 0 else 0)
```

```bash
godot --headless --path . --import
godot --headless --path . -s res://tests/parse_check.gd -- res://src/a.gd res://src/b.gd
```

退出码：0 全部可加载 / 1 有失败 / 2 没传文件。错误行会打印在每条
PARSE FAIL 上方。

## 第三道门：跑起来看一眼（解析通过 ≠ 跑得起来）

- parse 检查只证明"脚本能编译加载"，不证明"游戏能启动、场景能实例化、
  信号接得对"。
- 玩家可见的变更（场景结构、autoload、输入映射、视觉/玩法行为）必须
  启动一次并观察结果；截图/输出留证到任务工作区，验证报告引用证据。
- headless 下可跑：`godot --headless --path .`（主场景启动，stdout 报错
  可捕获）；需要看画面时去掉 `--headless`，截图取证。
- 没跑就报"验证通过"是造假：宁可回报 `NOT VERIFIED`（未验证）也不
  伪装通过——静默跳过与从未检查不可区分，都是违规。

## 引擎二进制解析顺序

`godot` 不在 PATH 时按序找：项目本地约定命令 → `engine.path` 记录 →
系统包管理器安装。验证报告必须写明实际调用的可执行文件路径与版本
（`godot --version`），否则结论不可复现。

## 与测试的关系

parse/import 是**门槛**不是**测试**：行为断言用 gdUnit4 headless 跑
（见 `testing.md`）。本模块的验证顺序：import → parse → （有测试套件时）
gdUnit → 跑起来看一眼。每道门都要在报告里留退出码证据。
