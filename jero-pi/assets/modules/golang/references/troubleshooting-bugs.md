# 症状→根因目录（troubleshooting-bugs）

> 来源：cc-skills-golang troubleshooting 篇（MIT，10 篇蒸馏）；权威级：建议
> 最低 Go 版本：1.26 ｜ 核验日期：2026-10 ｜ 授权账本：`_sources.md`

## 方法论

1. **复现优先**：缩到最小可复现（单测/独立 main）；不可复现先加观测
   （日志/pprof），不先改代码——改了就毁证据。
2. **让工具说话**：症状对应工具（下表）先跑一轮再动脑。
3. **改前固化**：定位后写失败测试（RED）再修；修完 `-race` + 全量。

## 症状速查表

| 症状 | 第一工具 | 高频根因 | 深读 |
|---|---|---|---|
| `fatal: concurrent map read and map write` | 代码审查 | map 并发（recover 不了） | slices-maps-internals |
| 偶发数据错乱/结果漂移 | `go test -race` | 数据竞争（未定义行为） | sync-primitives |
| 全部 goroutine 卡死（hang） | goroutine dump（SIGQUIT） | 锁顺序死锁 / wg 计数错 / chan 双向等待 | concurrency-channels |
| 内存只涨不降 | heap inuse + goroutine 数 | goroutine 泄漏持内存；map 只增不删 | concurrency-goroutines |
| goroutine 数持续增长 | goroutine profile | 无退出路径 / 发送端等不到接收 | concurrency-goroutines |
| CPU 打满 | cpu profile | 序列化热点/算法复杂度/正则回溯 | performance-playbook |
| 延迟高 CPU 闲 | trace / block profile | 排队（串行锁、IO 等待、连接池耗尽） | sync-primitives |
| GC 频繁/暂停尖刺 | gctrace=1 + heap alloc | 分配风暴 | performance-playbook |
| 启动即 panic | 栈转储 | 初始化顺序依赖、nil Must 结果 | defensive-boundaries |
| `nil pointer dereference` | 栈定位第一自有帧 | typed-nil 接口 / map 返回零值指针直接用 | error-handling |
| 时好时坏的定时任务 | 逻辑审查 | time.After 循环泄漏（<1.23）/时钟回拨 | defensive-boundaries |
| JSON 解析行为变了 | 版本对照 | `encoding/json` 行为变更（1.24 转义修复类） | modern-go-versions |

## goroutine 转储阅读法

```bash
kill -QUIT <pid>                    # 全量栈打 stderr
curl :6060/debug/pprof/goroutine?debug=2   # 每 goroutine 详情
```

- 看分布：`N goroutines blocked on chan send` 一行结论——几百个
  停在同一 send = 接收方没消费（泄漏点）。
- 看单帧：从上往下第一个非标准库帧是"你家的哪行代码在等谁"。
- 计数对照启动/负载：平稳 = 设计内波动；单调涨 = 泄漏。

## panic 三问

1. 栈上第一个自有帧是谁（从上往下跳过 runtime/标准库）？
2. panic 类型：nil 解引用（谁该保证非 nil）/ index 越界（len 哪算的）
   / 断言失败（ok 判了吗）/ 接口方法调用（装箱了 nil 具体）？
3. 该不变量的责任人是谁——修复点在保证处，不在崩处（崩处加 nil 判
   是止痛不是治病）。

## 竞态（race）调查

- `-race` 报告三段式：读位置/写位置/创建栈——两侧都是你要改的。
- 修复选型：改锁（mutex）、改通道（单写者原则）、改不可变（拷贝
  交接）、改 atomic（单变量）；**修复后 `-race -count=25` 复测**。
- "加个 sleep 就好了" = 竞态被藏起来，必复发。

## GODEBUG 工具箱

| 变量 | 用途 |
|---|---|
| `gctrace=1` | GC 周期/堆/暂停日志 |
| `schedtrace=1000` | 每 1s 调度快照（P/G 数） |
| `madvdontneed=1` |（Linux）内存归还行为对齐 |
| `http2debug=2` | HTTP/2 帧级日志 |
| `GOEXPERIMENT=goroutineleakprofile`（1.26） | 泄漏归因剖析 |

## delve 断点调查

```bash
dlv test ./pkg -- -test.run TestXxx
(dlv) break pkg.go:42
(dlv) continue
(dlv) goroutines        # 切 goroutine 看栈
```

适合确定性逻辑死循环/状态机走偏；竞态类 hang 别用断点（改变时序），
用 dump 侧观察。
