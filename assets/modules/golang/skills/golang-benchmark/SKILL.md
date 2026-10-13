---
name: golang-benchmark
description: 基准测量方法论：b.Loop（1.24+，1.26 起不阻内联）、benchstat 统计对比、基准组织、CI 回归门禁、避免测量陷阱。当写基准、对比性能或验证优化时使用。触发词：基准、benchmark、b.Loop、benchstat、性能对比、微基准。
---

# 基准测量（Go）

管"性能结论的证据等级"：单次基准运行不构成证据——一切优化结论都要 benchstat 级统计支撑。

> **相关技能：** 剖析定位瓶颈（基准管对比，剖析管归因）→ `golang-performance`；优化手法 → `golang-performance`；测试工程 → `golang-testing`。

## 何时使用

写 Go 基准、验证"更快"声明、建 CI 性能门禁时使用；评审优化 PR 必过本技能。

## 核心要点

- **`b.Loop()` 是默认**（Go 1.24+）：`for b.Loop() { ... }` 自动保活结果、防编译器优化掉被测代码；Go 1.26 起 b.Loop 调用点不再阻止内联——被测函数内联语义与生产一致，旧 `b.N` 基准结论可迁移重测。`b.N` 形态仅存于存量代码维护。
- **统计对比用 benchstat**：`go test -bench=. -count=10 > old.txt` → 改动 → `> new.txt` → `benchstat old.txt new.txt`；看 delta 与 p-value，"目测快了"不算数。geomean 变化 <~5% 且噪音大时结论是"无显著差异"。
- **基准质量**：被测函数结果必须被消费（赋给包级 sink 变量）；分配指标（allocs/op）与耗时同级重要；避免编译器死代码消除是第一陷阱。
- **环境纪律**：同机对比、关省电模式、多次 count、报告前重跑确认；容器/CI 环境噪音大时门限放宽（如 10%+）。
- **CI 门禁**：`go test -bench` + benchstat 与基线文件对比，超阈 fail；基线按平台分别存，避免跨机比较。
- **微基准 ≠ 生产**：微基准定向验证假设；生产结论还要 `pprof`（`golang-performance`）与真实负载。

## 红线

- 无 benchstat 对比的"优化了 X%"声明（评审直接打回）。
- 单次运行（count=1）下结论。
- 基准函数结果被编译器优化掉仍报数。

## 深读指路（references/）

基准全文（b.Loop 迁移/benchstat 用法/CI 门禁金样/陷阱清单）：`references/benchmark-measurement.md`。
