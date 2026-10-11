---
name: golang-project
description: 项目布局与包组织：cmd 薄入口 + internal 私有域 + pkg 谨慎用、包尺寸与拆分、import 分组与别名、main/run 模式、monorepo 与 go.work。当新建项目、组织包结构或决定代码放哪时使用。触发词：项目结构、布局、包组织、internal、cmd、monorepo、go.work。
---

# 项目布局（Go）

管"目录即架构"：Go 没有强制布局，但 import 方向决定了维护性——结构服务于依赖清晰。

> **相关技能：** 接口边界设计 → `golang-interfaces`；多模块依赖与工具链 → `golang-deps`；命名（含包名）→ `golang-naming`。

## 何时使用

新建项目、决定新包放哪、拆分大包、组织 monorepo 时使用；先问架构需求再动手。

## 核心要点

- **默认骨架**：`cmd/<app>/main.go`（薄入口：装配依赖 + 调 `internal` 的 `Run(ctx)` 即退）+ `internal/`（私有实现，外部不可 import）+ 根 `go.mod`；`pkg/` 只在有真实外部消费者时才出现（不是默认目录）。
- **包是依赖单元**：包名说清职责、尺寸其次——"包多大"不如"谁依赖谁"重要；import 成环是拆分信号（Go 编译器禁止，设计上也不许暗中互相调用经第三方桥接）。
- **internal 的层级语义**：`internal/` 私有于其父目录树；多入口共享逻辑放浅层 `internal/`，单应用私有放 `internal/<app>/`。
- **run 模式**：`main.go` 只有 `main() { if err := run(ctx); err != nil { ... os.Exit(1) } }`——`defer` 在 main 里不执行的坑由此规避；退出码纪律见 `golang-cli`。
- **import 分组**：标准库 / 第三方 / 本项目 三组；别名只用于重名与必要性文档；不用点导入（测试的 `. ` 除外）。
- **monorepo**：多模块用 `go.work`（本地开发 replace 语义，不进发布）；模块边界沿"独立发布单元"切，不是沿目录美观切；`go.work.sum` 与各 `go.mod` 各管各的。

## 红线

- `util`/`common`/`helpers` 万能包。
- main.go 里堆业务逻辑（入口不薄）；cmd 下多个入口共享的代码放 cmd 外。
- `pkg/` 装的是其实没人 import 的"未来公共库"。

## 深读指路（references/）

布局全文（骨架样例/拆分判据/go.work/迁移路径）：`references/project-layout.md`。
