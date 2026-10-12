---
name: dotnet-benchmark
description: 基准取证：BenchmarkDotNet 方法论（Release/JIT 预热/多次迭代）、内存诊断与分配率判读、统计严谨性（误差与分布）、微基准与宏观测量。当声称性能变化或评审优化声明时使用。触发词：基准、benchmark、BenchmarkDotNet、性能对比、优化证据。
---

# 基准取证（BenchmarkDotNet）

性能声明的证据等级：单次跑表 ≈ 无证据；`dotnet run -c Release` 的 BenchmarkDotNet 报告（含分布与分配）才是可引用结论。

> **相关技能：** 性能反模式与手法 → `dotnet-performance`；运行时观测工具 → `dotnet-diagnostics`。

## 何时使用

声称"更快/省内存"之前取基线；评审带数字的性能声明；对比实现方案时使用。

## 核心要点

- **Release 是底线**：`[MemoryDiagnoser]` 开分配列；`dotnet run -c Release --project Benchmarks`；Debug/JIT 差异让结论失效。
- **方法论内建于工具**：预热、多轮迭代、分布统计（Mean/Median/误差区间）由 BenchmarkDotNet 承担——手写 Stopwatch 循环测不出 JIT/GC 噪声里的真差异。
- **分配列判读**：Gen0/1/2/Allocated；分配率差异比时间差异更稳定可复现——优先引用。
- **参数化形状**：`[Params]` 覆盖大小/长度档位；微基准只测微小面，量级敏感的算法要跨尺寸扫描。
- **宏微分层**：微基准（方法级）定位机制；端到端（`dotnet-trace`/负载压测）确认用户可见收益——两个都要才算闭环。
- **基线可比**：改动对比要同机同负载同分支基线；`.results` 目录随 PR 归档供复查。

## 红线

- Debug 配置或 `dotnet run`（默认 Debug）的数字进结论。
- 未预热首跑/含 `Console.WriteLine` 的被测路径。
- 时间改善在误差区间内却宣布胜利（看 Mean 差与误差的重叠）。

## 深读指路（references/）

基准剧本、参数化与结果判读：`references/benchmark-measurement.md`。
