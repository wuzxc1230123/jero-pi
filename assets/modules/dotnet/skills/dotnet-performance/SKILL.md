---
name: dotnet-performance
description: 性能工程：分配削减（stackalloc/ArrayPool/string.Create）、Span/Memory 零拷贝切片、LINQ 热路径取舍、池化与大对象阈值、结构体布局。当优化分配/GC 压力或评审热路径时使用。触发词：性能、优化、分配、GC、Span、ArrayPool、热路径、装箱。
---

# 性能工程（分配与内存）

先测量后优化（基准纪律见 `dotnet-benchmark`）；确认热点后，本技能管"让分配消失与让拷贝消失"的手法谱系。

> **相关技能：** 基准取证 → `dotnet-benchmark`；运行时观测（GC/分配率） → `dotnet-diagnostics`；API 形状 → `dotnet-api-design`。

## 何时使用

优化热路径分配/GC 压力/拷贝成本；评审性能敏感代码的内存形状时使用。

## 核心要点

- **分配是主要成本面**：GC 压力 = 分配率 × 存活形状；gen0 便宜但不是免费——每 `new` 都是可审计项。
- **Span/Memory 切片不拷贝**：`ReadOnlySpan<char>` 解析零分配；`Memory<T>` 才能跨 await/存字段；`stackalloc` 小缓冲（无 `unsafe` 也可用）；`string.Create` 直接构造目标长度。
- **ArrayPool 池化**：≥1KB 的临时缓冲 `ArrayPool<T>.Shared.Rent/Return`（rent 返回可能更大——记实际长度）；频繁中大型临时数组是池化信号。
- **LINQ 分层**：冷路径可读性优先；热路径手写循环/`CollectionsMarshal.AsSpan`；多次枚举必须物化一次（`ToList`）或改单遍。
- **装箱三源**：值类型进接口/`object`、非泛型集合、`string.Format` 值类型——泛型与 `Generic Math`（`ISpanParsable` 等）是解药。
- **结构体纪律**：`readonly struct` 防御性拷贝免疫；超过两个引用字段慎改 struct（拷贝成本反超）；`in` 参数只配大 readonly struct。
- **字符串成本**：插值 `$"{a}:{b}"` 在 .NET 10 走 `DefaultInterpolatedStringHandler` 零中间串；`StringBuilder` 留给循环累积；比较用 `string.Compare(…, StringComparison.Ordinal)`。

## 红线

- 无基准证据的"更快"重写（微优化改坏可读性又不偿失）。
- 热路径 `IDictionary` 弱类型集合与 `ArrayList` 时代的装箱。
- `List<T>` 容量不设的反复扩容（可预估时传 capacity）。

## 深读指路（references/）

分配/池化/Span 谱系与 GC 形状（代际/LOH 阈值/pinning）：`references/performance-engineering.md`。
