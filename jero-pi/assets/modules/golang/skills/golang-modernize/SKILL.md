---
name: golang-modernize
description: 版本现代化：go fix 现代化器（1.26 全面改版）、逐版本迁移要点（1.22 循环变量→1.25 wg.Go→1.26 new(expr)/Green Tea GC）、工具链与 go.mod 版本策略。当升级 Go 版本、迁移旧代码或评估新特性时使用。触发词：升级、迁移、现代化、go fix、新版本、1.25、1.26、循环变量。
---

# 版本现代化（Go）

管"版本升级是偿还技术债的窗口"：每个 Go 版本带来语言/工具链改进，存量代码的迁移是低成本高确定性的改进。

> **相关技能：** 基准方法论随 1.26 更新 → `golang-benchmark`；GC 变化的性能面 → `golang-performance`；依赖版本策略 → `golang-deps`。

## 何时使用

升级 go 版本/go.mod 声明、迁移旧代码形态、评估"这个特性我们该不该用上"时使用。

## 核心要点

- **`go fix` 是默认入口**（1.26 全面改版）：内置现代化器目录（如 `loopclosure`→1.22 语义适配、`waitgroup`→`wg.Go` 建议、`builders`/`efaceany`/`slicescontains` 等机械改进），`go fix ./...` 应用，改动走评审与测试；`//go:fix inline` 标记的可内联 API 会被就地展开。**迁移顺序：升工具链 → go fix → go vet → 全量测试 → 基准对比**。
- **1.22**：for 循环变量每轮独立（`tc := tc` 消亡）；`math/rand/v2`；range over int（`for i := range n`）。
- **1.23**：range over function（自定义迭代器）；`unique` 包（interning）；timer 语义变更（无引用可回收）。
- **1.24**：泛型别名；`b.Loop` 基准；`os.Root` 路径锚定；`testing.T.Context()`；weak pointer。
- **1.25**：`wg.Go`（启动即计数）；`(spec, err) := testing.Synthesize[T]()`；编码解码 textproto 进标准库。
- **1.26**：`new(expr)` 表达式形式；自引用类型约束解禁；Green Tea GC 默认；`errors.AsType[T]`；`slog.NewMultiHandler`；`go fix` 现代化器体系；`B.Loop` 不再阻内联（基准结论可迁移重验）。
- **go.mod 版本策略**：`go` 指令升到团队最低可接受版本；工具链 `toolchain` 指令与 CI 镜像同步升；升级批次小步走（一次一个 minor），每步全量测试 + 关键基准。
- **不追新面**：新特性进入代码的前提是解决真实问题（wg.Go 消灭配对失误是理由，"新"不是）。

## 红线

- 跳版本大跃进（跨多个 minor 一次升）且无全量验证。
- go fix 输出不评审直接合入。
- go.mod 版本与实际工具链漂移（local 更新 CI 不动 = 环境分裂）。

## 深读指路（references/）

版本迁移全文（逐版本特性表/go fix 现代化器清单/升级剧本）：`references/modern-go-versions.md`。
