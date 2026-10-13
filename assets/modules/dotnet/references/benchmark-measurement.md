# 基准取证（benchmark-measurement）

> 来源：BenchmarkDotNet 文档 / dotnet-skills 仓库 microbenchmarking 与 dotnet-benchmark-designer（经 skills-main 快照派生）；权威级：建议
> 锚定运行时：.NET 10 ｜ 核验日期：2026-10 ｜ 授权账本：`_sources.md`

## 证据等级

| 做法 | 等级 |
|---|---|
| `Stopwatch` 手掐首跑 | 无证据（JIT/GC/预热全污染） |
| Debug 配置跑 | 无效（JIT 优化缺席） |
| BenchmarkDotNet 单机单次 | 弱（看分布与误差） |
| BDN 多轮 + `[MemoryDiagnoser]` + 基线对比 | 可引用 |
| 微基准 + 端到端（trace/压测）双确认 | 完整结论 |

## 最小骨架

```csharp
[MemoryDiagnoser]
public class ParserBench
{
    [Params(10, 100, 10_000)]          // 量级扫描——算法结论跨尺寸成立才算数
    public int N;

    private string _payload = default!;

    [GlobalSetup]                       // 一次性构造，不计时
    public void Setup() => _payload = MakePayload(N);

    [Benchmark(Baseline = true)]
    public int SplitParse() => SplitParseCore(_payload);

    [Benchmark]
    public int SpanParse() => SpanParseCore(_payload);
}
```

```bash
dotnet run -c Release --project benchmarks/ParserBench.csproj
```

- `--filter '*ParserBench*'` 收窄跑面；`.results/` 每基准一份报告，
  随 PR 归档。

## 判读

- 看 Mean 与 Error 列：差异小于误差区间重叠即"无显著差异"——
  宣布胜利前看数字。
- 分配列（Allocated/Gen0/Gen1/Gen2）：分配率差异通常比时间差异更
  稳定可复现，优先引用为证据。
- 多模分布（Median 偏离 Mean、Outlier 列异常）：查后台干扰（电源
  策略/杀毒/同机负载）后重跑。

## 方法论要点

- **迭代由工具承担**：预热、 pilot、实际多轮、统计（百分位/误差）
  是 BDN 的内建协议——自写循环测不出这些。
- **被测方法纯**：无 IO/日志/随机无 seed；返回值消费（`Consumer`
  或返回字段）防死代码消除。
- **GlobalSetup/IterationSetup 分层**：构造进 Setup，被测只含目标
  路径；IterationSetup 会显著拖慢基准（BDN 会警告）。
- **参数化形状**：`[Params]` 扫尺寸/分支；分支预测敏感的算法对
  有序/乱序输入表现不同（`[ArgumentsSource]` 喂随机化数据）。
- **进程外噪音**：笔记本省电模式、容器 CPU 限额、同宿主批任务都
  会写进误差列——生产结论用服务器复测。

## 微基准之外

- 微基准定位机制（某方法分配消除）；端到端确认用户可见收益：
  `dotnet-trace` 剖面（diagnostics-tools）或负载压测（请求延迟
  P99 对比）。
- 启动性能（AOT 场景尤甚）：`dotnet-trace collect --profile startup`
  或_events 看启动时间线，微基准管不到冷启动。
- 内存趋势（泄漏嫌疑）不是基准的活：gcdump 差集（diagnostics-tools）。

## 门槛化（性能回归门）

- CI 定期跑基准基线（夜间/发版前），diff 超阈值（如 +10% Mean）
  阻断——阈值松紧看指标方差历史。
- 基线报告入库（`BenchmarkDotNet.Artifacts` 归档），对比要同机
  同配置——跨机对比只做方向参考。

## 红线

- Debug/JIT 关闭的数字进结论；被测路径带 `Console.WriteLine`。
- 把 BDN 的均值当点估计忽略误差列。
- 优化后不跑端到端就宣布"快了 x%"（微基准收益可能被 IO 淹没）。
