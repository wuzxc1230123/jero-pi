---
name: dotnet-observability
description: 可观测性接线：OpenTelemetry 三信号（traces/metrics/logs）、ActivitySource 与 Meter 定义、OTLP 导出与 Aspire 仪表盘、采样与高基数（cardinality）纪律。当接遥测或评审观测面时使用。触发词：OpenTelemetry、OTel、traces、metrics、logs、ActivitySource、OTLP、遥测、可观测。
---

# 可观测性（OpenTelemetry）

遥测是代码的一部分：信号在源头定义（ActivitySource/Meter），导出是配置决策——散装的 `Console.WriteLine` 与手工计时不是可观测性。

> **相关技能：** 运行时诊断（进程内剖析） → `dotnet-diagnostics`；Aspire 统一装配 → `dotnet-aspire`；结构化日志面 → `dotnet-di`。

## 何时使用

接入/评审 OTel 三信号、定义业务指标与 span、配置导出与采样时使用。

## 核心要点

- **三信号一体**：traces（`ActivitySource.StartActivity` 跨进程因果）、metrics（`Meter` + `Counter<T>`/`Histogram<T>`）、logs（`ILogger` 桥接 OTel）；一个 `AddOpenTelemetry()` 装配三出口。
- **源头定义**：`ActivitySource("Company.Product.Feature")` 与 `Meter` 命名带命名空间防撞；tag 键名稳定（`peer.service` 等语义约定优先——可检索性的根基）；库代码发信号，宿主决定导出。
- **导出配置**：OTLP 标准出口（`AddOtlpExporter`）对接收集器（OTel Collector）与 Aspire 仪表盘；环境变量（`OTEL_EXPORTER_OTLP_ENDPOINT` 等）驱动，不编译期绑死后端。
- **采样纪律**：头部采样（`TraceIdRatioBased`）控制成本；错误路径 alwaysOn 采样规则先于比例规则；span 内不放敏感值（密钥/PII）。
- **高基是账单炸弹**：指标标签（tag）的取值空间受控（userId 不进标签，分桶处理）；histogram 的边界显式定；调试期标签再全，生产收敛。
- **日志桥接**：`ILogger` 经 OTel 出口带 trace 上下文自动关联（`IncludeScopes`）；结构化模板参数不预插值——消费者按属性检索。
- **ASP.NET Core 自动仪表**：`AddAspNetCoreInstrumentation()` 免手写请求 span；只过滤噪音路径（健康检查）。

## 红线

- span/指标标签放密钥或无界标识符（userId/请求体）。
- 每请求全采样进生产（成本与基数失控）。
- 手工 Stopwatch 日志冒充 trace（无因果链、无传播）。

## 深读指路（references/）

信号定义/导出/采样与 Aspire 接线：`references/observability-opentelemetry.md`。
