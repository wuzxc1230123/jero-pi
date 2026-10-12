---
name: dotnet
description: .NET/C# 工程领域知识入口：语言与异步纪律、构建与测试验证主干、领域评审关注点的指路与硬约束。当仓库含 .sln/.csproj/.cs 文件或 global.json、任务涉及 .NET/C#/ASP.NET/EF Core 开发时使用。触发词：dotnet、.NET、C#、csproj、sln、NuGet、EF Core、Blazor、xUnit。
---

# .NET 工程开发（模块知识入口，L1）

本文件是 dotnet 模块的知识入口：注册表与派发覆盖层消费的都是它。深度
知识一律住 references（L2，按需读），本入口只做指路与硬约束。

## 知识指路（L2，references/ 按需读）

- 语言与类型：`style-and-formatting`（风格与表达式体）、`naming-conventions`（命名决策树）、`modern-csharp`（C# 12–14 特性选型）、`nullable-reference-types`（可空引用标注与迁移）、`api-design`（面向领域的强类型 API）
- 并发与性能：`async-patterns`（async/await 纪律与取消传播）、`concurrency-primitives`（Channel/锁/并行选型）、`performance-engineering`（分配削减与 Span/Memory）、`benchmark-measurement`（BenchmarkDotNet 取证）、`diagnostics-tools`（dotnet-trace/dump/counters）
- 测试与构建：`testing-practices`（框架选型与反模式）、`verification-gates`（三道门协议）、`msbuild-fundamentals`（项目系统与属性）、`binlog-analysis`（二进制日志排障——binlog MCP 接线见 `dotnet-mcp` 技能）
- 数据与配置：`efcore-patterns`（查询/追踪/迁移）、`dependency-injection`（生命周期与注册纪律）、`configuration-options`（配置绑定与 Options）、`serialization-json`（System.Text.Json 契约）
- 应用与栈：`aspnet-webapi`（Minimal API/Web API 纪律）、`aspire-orchestration`（Aspire 编排与服务默认值）、`akka-patterns`（Akka.NET actor 模式）、`observability-opentelemetry`（OTel 接线）、`aot-trimming`（裁剪与 Native AOT 兼容）
- 工程面：`nuget-packaging`（包管理与 CPM）、`project-structure`（解决方案布局）、`upgrade-migrations`（版本升级与 NRT 迁移）、`_sources`（出处账本）

## 硬约束

- `bin/`、`obj/` 构建产物目录必须 gitignore（评审走 git 对象，忽略后天然干净）。
- 验证走 CLI 退出码：`dotnet build` 零警告为目标，"编译通过"不等于"测得过"；
  模块 `config.testCommand` 钉住的 `dotnet test` 是 SDD Strict TDD 转发的唯一来源。
- 工具链版本由 `global.json` 钉住；改动 TargetFramework 必须连带升级面
  （包引用/分析器/弃用 API 同步，见 `upgrade-migrations`）。

## 委派路由

- 评审 .NET/C# 变更：追加委派 `dotnet-reviewer`（只读，报告发现不修复）。
- 验证执行（build/test/脚手架）：委派 `dotnet-tester`（有界写者，产验证报告）。
- 解决方案结构/DI 生命周期/技术选型设计：建议 `dotnet-architect` 产出设计提案。
- 执行实现：直接使用 `jero-worker`——本入口注入的惯例随之生效，
  禁止另做与 `jero-worker` 同角色的语言执行代理（孤儿代理）。
