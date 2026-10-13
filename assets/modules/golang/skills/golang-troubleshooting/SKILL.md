---
name: golang-troubleshooting
description: 系统化排障：症状→根因目录（死锁/泄漏/竞态/阻塞/内存暴涨）、race detector、delve、goroutine 泄漏剖析、GODEBUG、最小复现纪律。当 Go 程序出错、卡死、泄漏或行为怪异时使用。触发词：排障、调试、死锁、泄漏、卡死、panic、race、delve、GODEBUG。
---

# 排障（Go）

管"症状是线索不是结论"：先让 bug 可复现、再让工具说话，最后才动代码。

> **相关技能：** 并发正确性基线 → `golang-concurrency`；pprof 定位工具 → `golang-performance`；错误流语义 → `golang-errors`。

## 何时使用

程序 panic/挂起/泄漏/竞态/性能突刺，或行为与预期不符需要定位时使用。

## 核心要点

- **复现优先**：缩到最小可复现（单测/独立 main）；不可复现的 bug 先加观测（日志/pprof）不是先改代码。
- **症状速查**（详表在深读）：死锁（全停 + goroutine 转储显示互相等锁/等 channel）→ 锁顺序或 wg 计数；内存只涨不降 → `heap` profile 的 inuse 与 goroutine 数（泄漏的 goroutine 持内存）；偶发数据错乱 → `-race` 复测（数据竞争必是未定义行为）；`fatal: concurrent map read and map write` → map 并发（recover 不了，加锁）；确定性 panic 在启动期 → 依赖初始化顺序。
- **工具箱**：`go test -race`（竞态金标准）、`go run -gcflags` / `GODEBUG=gctrace=1`（GC 行为）、`GODEBUG=schedtrace=1000`（调度）、`dlv`（断点/goroutine 栈/核心转储）、`pprof` 的 goroutine/block/mutex 三件套（谁卡在哪）。Go 1.26 实验性 goroutine 泄漏 profile（`GOEXPERIMENT=goroutineleakprofile`）把"谁泄漏的"变成一等数据。
- **goroutine 转储阅读**：`SIGQUIT`/`debug.DumpGoroutines` 拿全量栈；看"等在哪"（chan send/recv、锁、IO）与数量分布——成百上千停在同一行就是泄漏点。
- **panic 三问**：转储栈哪层是自己代码（从上往下第一个非标准库帧）；nil 解引用还是越界还是断言失败；这个不变量该在谁那里保证。
- **改动纪律**：定位后先固化失败测试（RED）再修（`golang-testing`）；修完跑 `-race`。

## 红线

- 不可复现就"顺手重构"相关代码（把证据毁了）。
- 吞 panic 继续跑（recover 后不记录不留证）。
- 用 sleep 掩盖时序 bug。

## 深读指路（references/）

症状→根因目录（含转储阅读法/GODEBUG 全表）：`references/troubleshooting-bugs.md`。
