# pprof 剖析（pprof-profiling）

> 来源：cc-skills-golang benchmark/troubleshooting 篇（MIT）蒸馏 + Go 官方 pprof 文档；权威级：建议
> 最低 Go 版本：1.25 ｜ 核验日期：2026-10 ｜ 授权账本：`_sources.md`

## 五类 profile 各管什么

| profile | 采集 | 回答 |
|---|---|---|
| CPU | `-cpuprofile` / `runtime/pprof` / 默认 endpoint | 时间花在哪些函数 |
| heap | `-memprofile` / alloc_space vs inuse_space | 谁在分配/谁占着 |
| goroutine | `/debug/pprof/goroutine?debug=1` | 有多少 goroutine、卡在哪 |
| mutex | `-mutexprofile` | 锁竞争在哪对 |
| block | `-blockprofile` | 阻塞在哪个调用（chan/锁/IO） |

## 采集三通道

```bash
# ① 基准/单测内嵌
go test -cpuprofile=cpu.out -memprofile=mem.out ./...

# ② 进程常驻（expvar 或 net/http/pprof）
import _ "net/http/pprof"
go func() { http.ListenAndServe("localhost:6060", nil) }()
go tool pprof http://localhost:6060/debug/pprof/profile?seconds=30

# ③ 独立采样（已挂进程，1.19+）
go tool pprof -http=: http://<host>:6060/debug/pprof/heap
```

生产常驻只绑 localhost 或加鉴权（endpoint 暴露栈与符号——攻击面）。

## go tool pprof 阅读法

```bash
go tool pprof -http=:8080 cpu.out     # Web 界面（火焰图/调用图）
go tool pprof -top cpu.out            # 累计 Top
go tool pprof -cum -top cpu.out       # 按累计排序
go tool pprof -list=FuncName cpu.out  # 行级热点
```

- **火焰图**找宽条（宽 = 占比高）；点开看栈路径"谁把热点叫起来的"。
- `-sample_index=alloc_space`（分配总量）vs `inuse_space`（当前驻留）
  ——泄漏看 inuse 趋势，分配优化看 alloc。
- 采样 bias：默认 CPU 采样 100Hz，短函数低估；加 `-seconds` 拉长窗口。

## 典型读法对照

| 症状 | profile | 特征 | 去向 |
|---|---|---|---|
| CPU 打满 | cpu | 单函数宽条 | 算法/序列化热点 → performance-playbook |
| 内存涨不降 | heap inuse + goroutine | goroutine 数持续涨、各持有 buffer | 泄漏 → concurrency-goroutines |
| 延迟高但 CPU 闲 | block/mutex | 等 chan/锁 | 串行化瓶颈 → sync-primitives |
| GC 开销高 | cpu（Runtime 部分）/ `GODEBUG=gctrace=1` | GC 占比 >10% | 分配削减 → performance-playbook |

## trace 与 GODEBUG（互补工具）

- `go test -trace=out.trace` + `go tool trace out.trace`：调度延迟、
  GC 停顿、P 利用率——"goroutine 很多但 CPU 空转"的排队问题用它。
- `GODEBUG=gctrace=1`：GC 周期与暂停日志；`GODEBUG=schedtrace=1000`
  调度快照；1.26 `GOEXPERIMENT=goroutineleakprofile` 泄漏归因
  （排障全景见 troubleshooting-bugs）。

## 持续剖析（生产）

Parca/Pyroscope 类持续剖析器按比例采样常驻采集——秒级回看任意时刻
的火焰图；与告警联动（内存/延迟突增时先看当时的 profile 而不是先
重启）。引入属部署决策，先问依赖四问（dependency-management）。
