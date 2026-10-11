---
name: golang-performance
description: 性能优化手册：先测量后优化、pprof 定位、分配与 GC（Green Tea）、热路径模式（strconv/Builder/池化/预分配）、串口化优化。当性能不达标、定位瓶颈或做优化时使用。触发词：性能、优化、瓶颈、内存分配、GC、pprof、火焰图、热路径。
---

# 性能（Go）

管"先给证据再动刀"：性能是测量驱动的工程，不是直觉驱动的艺术。

> **相关技能：** 基准测量与对比 → `golang-benchmark`；剖析全景 → 本技能深读；症状排查目录 → `golang-troubleshooting`；容器底层 → `golang-data-structures`。

## 何时使用

服务延迟/吞吐不达标、内存/分配异常、评审优化 PR 时使用；"感觉慢"先测再进。

## 核心要点

- **顺序不可逆**：① 定目标（延迟分布/分配预算）→ ② pprof/trace 找热点 → ③ 改一处 → ④ benchstat/负载验证 → 回到 ②。跳过 ② 的优化是盲改。
- **pprof 定位**：`go tool pprof`（CPU/heap/goroutine/mutex/block 五类）；火焰图找宽条；`-sample_index=alloc_space` 找分配大户；生产常驻 `net/http/pprof` 或持续剖析。
- **分配三板斧**：预分配（`make([]T, 0, n)`、`strings.Builder{}` + `Grow(n)`）；复用（`sync.Pool` 用于高分配率临时对象，注意池对象引用清空）；换零分配路径（`strconv` 代替 `fmt.Sprintf`、`[]byte` 代替反复 `[]byte(s)`）。
- **GC 面**：Go 1.26 起 Green Tea GC 默认开启（GC 开销普遍降 10–40%），升级本身可能就是优化；`GOGC`/`GOMEMLIMIT` 调优是部署参数不是代码改动；减少分配比调参优先。
- **热路径纪律**：接口装箱/反射/闭包捕获在纳秒级路径上换具体类型与直接调用；锁竞争换分片（shard）或 `atomic`；字符串拼接循环必 `strings.Builder`。
- **不要预防性优化**：非热点代码可读性优先；profile 显示 <5% 的函数不值得动。

## 红线

- 无 pprof/benchstat 证据的优化提交。
- 牺牲正确性换性能（未测的unsafe、去掉同步）。
- 微基准赢了、真实负载输了还合入（没有负载验证）。

## 深读指路（references/）

pprof 全景（五类剖析/火焰图/生产接线）：`references/pprof-profiling.md`；优化模式手册（分配/CPU/GC/池化/缓存）：`references/performance-playbook.md`。
