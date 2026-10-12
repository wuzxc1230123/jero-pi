---
name: dotnet-diagnostics
description: 运行时诊断工具链：dotnet-counters（GC/线程池/分配率）、dotnet-trace（CPU 采样）、dotnet-dump（事后剖析）、dotnet-gcdump（存活图）与事件计数器选型。当排查性能问题/内存泄漏/线程池饥饿时使用。触发词：诊断、dotnet-trace、dotnet-dump、counters、内存泄漏、CPU 高、线程池饥饿。
---

# 运行时诊断工具链

先观测后假设：选对工具 = 选对观测面——计数器看速率、trace 看时间线、dump 看尸检、gcdump 看存活。

> **相关技能：** 方法级基准 → `dotnet-benchmark`；进程外遥测（OTel） → `dotnet-observability`。

## 何时使用

生产/本地性能问题排查（高 CPU/内存增长/请求延迟/线程池饥饿）的工具选型与采集执行时使用。

## 核心要点

- **先看速率**：`dotnet-counters monitor -p <pid>`——GC 代际收集率、alloc-rate、threadpool-queue-length、CPU 使用；异常速率（如 gen2 频繁）直接指向问题族。
- **CPU 时间线**：`dotnet-trace collect -p <pid>` 采样剖面进 perfview/SpeedScope；高 CPU 看热点栈；`--profile gc-collect` 专看 GC 事件。
- **尸检**：`dotnet-gcdump collect` 轻量存活对象图（何者被何引用保活——泄漏定位）；`dotnet-dump collect` 完整转储（挂起/崩溃后 `dotnet-dump analyze` 走 SOS：`dumpheap -stat`/`gcroot`）。
- **崩溃面**：环境变量 `DOTNET_DbgEnableMiniDump` 让进程自采；容器内路径注意挂载。
- **超时/延迟面**：`Microsoft.Diagnostics.NETCore.Client`（DiagnosticsClient）程序内触发；事件计数器（`System.Runtime`）经 `dotnet-counters` 或 OTel 出栈。
- **采集纪律**：生产采集先评估开销（trace 采样率/dump 暂停）；采集期间记录负载与时间窗，结论只对窗口负责。

## 红线

- 无 pid/进程名确认就对错进程采集（容器内尤其）。
- 把一次性 dump 当趋势——泄漏要看两次 gcdump 的差集。
- 观测生产系统却不记录采集窗口与负载。

## 深读指路（references/）

工具选型矩阵与采集剧本（环境差异/容器/跨平台）：`references/diagnostics-tools.md`。
