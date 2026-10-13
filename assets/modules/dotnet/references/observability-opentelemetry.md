# 可观测性（observability-opentelemetry）

> 来源：dotnet-skills opentelemetry-dotnet-instrumentation 快照（含 traces-and-propagation 派生）/ OpenTelemetry .NET 文档 / Aspire ServiceDefaults 联动；权威级：建议
> 锚定运行时：.NET 10（OTel .NET 1.11+） ｜ 核验日期：2026-10 ｜ 授权账本：`_sources.md`

## 三信号一体

```csharp
builder.Services.AddOpenTelemetry()
    .ConfigureResource(r => r.AddService("orders-api", serviceInstanceId: env))
    .WithTracing(t => t
        .AddAspNetCoreInstrumentation(o => o.Filter = ctx =>
            !ctx.Request.Path.StartsWithSegments("/health"))   // 噪音过滤
        .AddHttpClientInstrumentation()
        .AddSource("Contoso.Shipping.Orders"))                 // 自定义源
    .WithMetrics(m => m
        .AddAspNetCoreInstrumentation()
        .AddRuntimeInstrumentation()
        .AddMeter("Contoso.Shipping.Orders"))
    .WithLogging(l => l.AddOtlpExporter());
builder.Services.AddOpenTelemetry()
    .UseOtlpExporter();                                        // 三信号同出口
```

- **traces**（因果链）、**metrics**（聚合速率）、**logs**（事件
  详情）互补不互替：trace 定位"哪条链"，metric 定位"何时开始变
  坏"，log 定位"当时发生了什么"。
- Aspire 的 ServiceDefaults 装的就是上述（aspire-orchestration）——
  手接与 ServiceDefaults 二选一。

## 信号源头定义

```csharp
public static class OrdersInstrumentation
{
    public const string MeterName = "Contoso.Shipping.Orders";
    private static readonly Meter Meter = new(MeterName);
    public static readonly Counter<long> OrdersCreated =
        Meter.CreateCounter<long>("orders.created", unit: "{order}");
    public static readonly Histogram<double> FulfillDuration =
        Meter.CreateHistogram<double>("orders.fulfill_duration", unit: "s");
}

public static class OrdersTracing
{
    public const string SourceName = "Contoso.Shipping.Orders";
    private static readonly ActivitySource Source = new(SourceName);
    public static Activity? StartFulfill(string orderId)
        => Source.StartActivity("orders.fulfill", ActivityKind.Internal)?
                 .SetTag("order.id", orderId);   // tag 受控（见下）
}
```

- `ActivitySource`/`Meter` 命名带命名空间（`公司.产品.特性`）防
  撞；库代码发信号、宿主决定导出（分离定义与配置）。
- 语义约定（Semantic Conventions）优先：`http.request.method`/
  `db.system`/`peer.service`——生态聚合/检索的通用键，自造键前先
  查约定。

## tag 纪律（基数与敏感）

- **高基是账单炸弹**：指标标签（tag）的取值空间必须有限——`orderId`/
  `userId`/URL 全路径不进指标标签（进 trace 的 span 属性）；
  要分布用 histogram 的显式 bucket。
- 敏感值禁入：密钥/令牌/PII 不进 span 属性与日志属性（脱敏中间
  件统一处理入站头）。
- span 名稳定模板（`orders.fulfill`）+ 变量进 tag——低基 span 名
  才可聚合。

## 采样与成本

```csharp
.WithTracing(t => t.SetSampler(new TraceIdRatioBasedSampler(0.05)))  // 5% 尾采样比例
```

- 头部采样按 trace 比例控成本；错误路径采样规则先于比例（`AlwaysOn`
  的 parent-based + 错误增强）。
- 高价值低频（支付链）AlwaysOn、高频低值（健康检查/列表查询）
  低比例——分层采样策略。
- collector 前置（OTLP → OTel Collector → 后端）：采样/脱敏/路由
  集中在 collector，应用保持简单导出。

## 日志桥接

- `ILogger<T>` 结构化模板：`_logger.LogInformation("Order {OrderId}
  fulfilled in {Duration:F2}s", id, secs)`——属性化参数不预插值
  （消费端按属性检索/聚合）。
- OTel 日志出口自动带 trace 上下文（span 关联 log 行——三信号
  联动的价值面）；`IncludeScopes` 保留 scope 上下文。
- 级别纪律：生产 Information 起步、Warning = 该被看见的异常、
  Error = 该被处理——`Console.WriteLine` 谱系不进服务代码。

## ASP.NET Core 自动仪表

- `AddAspNetCoreInstrumentation()`/`AddHttpClientInstrumentation()`
  免手写请求 span；`Filter` 过滤噪音路径（/health /alive）。
- `AddRuntimeInstrumentation()`（GC/线程池/JIT 计数）=
  `dotnet-counters` 观测面的常驻版（diagnostics-tools 的持续化）。

## 仪表盘与告警接线

- 指标进后端（Prometheus/Grafana 谱系）先定 SLI（延迟 P99/错误
  率/吞吐）再定仪表盘——从用户可见指标倒推，不从"有什么指标"
  正推。
- 告警可行动性：每条告警对应动作手册；基线告警（环比突变）优于
  静态阈值一刀切。

## 红线

- tag/日志属性放密钥与无界标识符；指标标签放 orderId。
- 生产全量采样 + 全属性收集（成本失控）。
- 手工 Stopwatch 日志冒充 trace（无因果传播、无跨进程关联）；
  硬编码后端地址（env `OTEL_EXPORTER_OTLP_ENDPOINT` 驱动，
  configuration-options）。
