# 基准测量方法论（benchmark-measurement）

> 来源：cc-skills-golang benchmark 篇（MIT，8 篇蒸馏）+ Go 官方 testing/benchstat 文档；权威级：建议
> 最低 Go 版本：1.26（B.Loop 不再阻内联）｜ 核验日期：2026-10 ｜ 授权账本：`_sources.md`

## 铁律

1. **单次基准运行不构成证据**——结论必须有 benchstat 统计支撑。
2. 微基准回答"这个函数谁快"，**不回答**"服务整体快了吗"——后者要
   pprof + 负载（见 performance-playbook）。
3. 被测结果必须被消费，防编译器优化掉。

## b.Loop（1.24+，默认形态）

```go
var sink int

func BenchmarkSum(b *testing.B) {
	data := make([]int, 1024)
	b.ResetTimer()                  // 排除构造
	for b.Loop() {                  // 1.24+：自动保活、防 DCE
		sink = sum(data)
	}
}
```

- **1.26 关键变化**：b.Loop 调用点不再阻止被测函数内联——基准内联
  语义与生产一致；存量 `for i := 0; i < b.N; i++` 的旧结论（尤其
  "内联后差异消失"类）建议迁移后重测。
- `b.N` 形态只存在量代码维护；新代码一律 b.Loop。
- 分配计数同屏：`go test -bench=. -benchmem`（ns/op 与 B/op、
  allocs/op 一起看）。

## benchstat 统计对比（结论的唯一形态）

```bash
go test -bench=. -count=10 > /tmp/old.txt
# ……改动……
go test -bench=. -count=10 > /tmp/new.txt
benchstat /tmp/old.txt /tmp/new.txt
```

```
          │   old.txt   │           new.txt           │
          │   sec/op    │   sec/op     vs base        │
Sum-8       1.234µ ± 2%   1.187µ ± 1%  -3.81% (p=0.001 n=10)
```

- 读法：delta 置信看 p-value（<0.05 显著）；± 列是离散度，±5% 以内
  的差异大概率是噪音。
- count ≥10；同机同环境；容器/CI 噪音大时提高 count 或放宽结论门槛。

## 陷阱清单

| 陷阱 | 后果 | 防法 |
|---|---|---|
| 结果未消费 | 编译器删除被测代码，测了空转 | b.Loop 自动保活 / sink 变量 |
| 计时含构造 | 冷启动污染 | b.ResetTimer() / b.Cleanup |
| 子测试共用状态 | 顺序耦合 | 每个 b.Run 自建数据 |
| -count=1 下结论 | 噪音当信号 | benchstat + ≥10 次 |
| 跨机比较 | 环境差异淹没差异 | 基线与对照同机 |

## CI 回归门禁（金样）

```bash
# bench-ci.sh：与检入基线对比，超阈值失败
go test -bench=. -count=10 > /tmp/current.txt
benchstat baseline.txt /tmp/current.txt | tee /tmp/report.txt
# 解析 geomean 或关键基准的 delta，>10% 且 p<0.05 则 exit 1
```

- 基线按平台分别存（`baseline.linux.txt` / `baseline.darwin-arm.txt`）。
- 门槛：微基准 5–10%（环境噪音决定），核心路径收紧。
- 基线更新是显式提交（带 benchstat 报告链接），不静默刷新。

## 运行时性能调查（衔接）

生产运行时指标（GC 频率/调度延迟/分配速率）与持续剖析是另一层证据，
见 pprof-profiling 与 performance-playbook；基准管对比，剖析管归因。
