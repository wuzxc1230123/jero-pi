# 诊断工具链（diagnostics-tools）

> 来源：dotnet-skills 仓库 dotnet-diag 插件（dotnet-trace-collect/dump-collect/analyzing-dotnet-performance，经 skills-main 快照派生）/ Microsoft .NET 诊断文档；权威级：建议
> 锚定运行时：.NET 10 ｜ 核验日期：2026-10 ｜ 授权账本：`_sources.md`

## 选型矩阵

| 症状 | 首选工具 | 观测面 |
|---|---|---|
| CPU 高 | `dotnet-trace`（采样剖面） | 热点栈、时间线 |
| 内存持续增长 | `dotnet-gcdump` ×2 差集 | 存活对象图、保活链 |
| 请求延迟/吞吐跌 | `dotnet-counters` + trace | 队列长、GC 率、锁争抢 |
| 线程池饥饿 | `dotnet-counters` | threadpool-queue-length、线程注入率 |
| 崩溃/挂死 | `dotnet-dump` / minidump | 尸检：全部线程栈 + 堆 |
| GC 停顿 | `dotnet-trace --profile gc-collect` | GC 事件时间线 |
| 快速分诊 | `dotnet-counters monitor` | 速率指标 30 秒内上手 |

工具是 dotnet 全局工具（`dotnet tool install -g dotnet-counters` 谱
系）或 .NET 10 起的 `dotnet monitor`/诊断包内建。

## dotnet-counters（先看速率）

```bash
dotnet-counters monitor -p <pid> --counters System.Runtime,Microsoft.AspNetCore.Hosting
```

关键指标：cpu-usage、alloc-rate、gen-0/1/2-gc-count、
threadpool-queue-length、threadpool-thread-count、monitor-lock-
contention-rate。异常形态直指问题族（gen2 频繁→大对象/中期存活；
队列长持续涨→饥饿/阻塞）。

## dotnet-trace（时间线）

```bash
dotnet-trace collect -p <pid> --profile cpu-sampling --duration 00:00:30
```

- 产物 `.nettrace`（perfview/Visual Studio/SpeedScope 可开）；
  `--format speedscope` 直接转。
- 采样率默认够用；窗口期记录负载（结论只对窗口负责）。
- 专项 profile：`gc-collect`（GC 事件）、`gc-heap`（分配栈采样）。
- 开销可控但非零：生产采集选低峰 + 短窗。

## dotnet-gcdump（存活图）

```bash
dotnet-gcdump collect -p <pid>    # 第一次
# …等待泄漏窗口…
dotnet-gcdump collect -p <pid>    # 第二次
dotnet-gcdump report xxx.gcdump   # 类型/数量/引用链
```

两次差集看增长类型，沿引用链找保活者（缓存未清/事件订阅泄漏/
静态根）。轻量（GC 暂停级开销），生产可用。

## dotnet-dump（尸检）

```bash
dotnet-dump collect -p <pid>
dotnet-dump analyze core_xxx
# SOS 命令面：
#   dumpheap -stat          按类型统计堆
#   dumpheap -mt <MT>       列实例
#   gcroot <address>        引用链到根
#   threads / clrstack      全部托管栈
#   threadpool              线程池状态（饥饿证据）
```

- 挂死进程先 `threads` 看哪条线程在等什么（`syncblk` 看锁持有）。
- 崩溃自采：env `DOTNET_DbgEnableMiniDump=1`（+
  `DOTNET_DbgMiniDumpType`）进程退出前落盘。
- 容器内：工具进同镜像或挂 diagnostics 卷；`pid 1` 语义注意
  entrypoint 包装。

## 事件计数器与自观测

- `System.Diagnostics.Metrics`/EventCounters 的信号经 OTel 出栈
  （observability-opentelemetry）——工具观测与持续遥测共用一套
  语义。
- `Microsoft.Diagnostics.NETCore.Client`（DiagnosticsClient）程序
  内触发采集（限流/条件采集自动化的地基）。

## 采集纪律

- 先确认 pid/进程名（容器/多实例环境错目标是经典事故）。
- 生产采集评估开销与窗口；记录时间/负载/版本三要素，结论可复
  现。
- 观测不代替修复：诊断输出转成假设 → 代码面验证 → 修复后复测
  （verification-gates）。

## 红线

- 单次 dump 当趋势（泄漏看 gcdump 差集）。
- 生产高峰期无预算地连开 trace。
- 只看工具不看代码：`gcroot` 给的是链，"为什么还引用着"要回
  代码答。
