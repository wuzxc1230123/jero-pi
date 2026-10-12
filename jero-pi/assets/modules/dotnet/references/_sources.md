# 出处与授权账本（_sources）

> 本篇是 dotnet 模块的知识来源账本：逐篇登记派生源与授权。权威级分四级：
> **规范**（官方指南/语言规范级）· **建议**（工程最佳实践）·
> **历史语境**（旧版本背景）· **项目纪律**（本仓裁决）。

## 上游仓库

| 仓库 | 许可 | 用途 |
|---|---|---|
| github.com/Aaronontheweb/dotnet-skills（快照于本仓 `dotnet-skills-master/`） | MIT（© 2025 Aaron Stannard） | C# 语言面（风格/命名/现代特性/NRT/API 设计/性能/并发/Akka/Aspire/EF Core/DI/配置/序列化/AOT/测试）的结构与方法论蒸馏 |
| github.com/dotnet/skills（.NET 团队技能库，快照于本仓 `skills-main/`） | MIT（© .NET Foundation and Contributors） | 工程面（MSBuild/binlog/诊断/测试质量/升级迁移/NuGet CPM 与 trusted publishing/WebAPI）的结构与方法论蒸馏 |
| Microsoft Learn / .NET 官方文档（版本公告、API 参考、指南） | CC-BY 4.0 | 版本特性与 API 事实核对（2026-10 核验） |

两份快照的知识锚点分散在 .NET 8/9/10（dotnet/skills 含 .NET 11 预
览篇）；本模块以 **.NET 10 LTS / C# 14** 为锚点重蒸馏（.NET 11 预
览仅作升级面勘误，见 upgrade-migrations 版本谱系表），非逐句翻译。
上游英文文案不是本模块内容——全部中文重写；引用代码示例按 MIT 惯
例无需逐段标注，结构性方法（如 binlog 排障剧本的骨架、CPM 治理
分层）来源于下表登记。MIT 允许派生；此处登记出处即履行署名义务。

## 逐篇登记

| reference | 主要来源 | 权威级 |
|---|---|---|
| style-and-formatting | Aaronontheweb csharp-coding-standards + MS Learn 编码约定 | 规范 |
| naming-conventions | Aaronontheweb 快照 + Framework Design Guidelines | 规范 |
| modern-csharp | Aaronontheweb 快照 + MS Learn C# 12–14 文档 | 规范 |
| nullable-reference-types | Aaronontheweb nrt 篇 + dotnet/skills migrate-nullable-references + MS Learn | 规范 |
| async-patterns | Aaronontheweb csharp-concurrency-patterns + TAP 文档 | 规范 |
| concurrency-primitives | Aaronontheweb csharp-concurrency-patterns（async→Channel→Akka 层级） + MS Learn 线程化 | 规范+建议 |
| api-design | Aaronontheweb csharp-api-design + Framework Design Guidelines | 规范 |
| performance-engineering | Aaronontheweb csharp-type-design-performance + dotnet/skills analyzing-dotnet-performance/microbenchmarking | 建议 |
| benchmark-measurement | BenchmarkDotNet 文档 + dotnet/skills microbenchmarking | 建议 |
| diagnostics-tools | dotnet/skills dotnet-diag 插件（dotnet-trace-collect/dump-collect）+ MS 诊断文档 | 建议 |
| testing-practices | dotnet/skills dotnet-test 插件（assertion-quality/test-anti-patterns）+ Aaronontheweb snapshot/testcontainers | 建议 |
| verification-gates | 本仓原创（对齐 golang/godot 模块 verification 协议） | 项目纪律 |
| msbuild-fundamentals | dotnet/skills dotnet-msbuild 插件（property-patterns/directory-build-organization/incremental-build）+ MSBuild 文档 | 规范+建议 |
| binlog-analysis | dotnet/skills dotnet-msbuild 插件（binlog-failure-analysis/binlog-generation/build-perf-diagnostics） | 建议 |
| efcore-patterns | Aaronontheweb efcore-patterns + dotnet/skills optimizing-ef-core-queries + MS Learn EF Core | 规范+建议 |
| dependency-injection | Aaronontheweb microsoft-extensions-dependency-injection + MS Learn DI | 规范 |
| configuration-options | Aaronontheweb microsoft-extensions-configuration + MS Learn 配置 | 规范 |
| serialization-json | Aaronontheweb serialization + dotnet/skills system-text-json-net11 + MS Learn STJ | 规范 |
| aot-trimming | Aaronontheweb aot-trimming（含 attributes-reference/playbook）+ dotnet/skills dotnet-aot-compat | 规范 |
| aspire-orchestration | Aaronontheweb aspire-*（configuration/service-defaults/integration-testing/akka-aspire）+ MS Learn Aspire | 建议 |
| akka-patterns | Aaronontheweb akka-*（best-practices/hosting/testing/management）+ Akka.NET 文档 | 建议 |
| aspnet-webapi | dotnet/skills dotnet-webapi + MS Learn ASP.NET Core | 规范+建议 |
| nuget-packaging | dotnet/skills convert-to-cpm/nuget-trusted-publishing + Aaronontheweb package-management/marketplace-publishing + NuGet 文档 | 规范+建议 |
| project-structure | Aaronontheweb project-structure + dotnet/skills directory-build-organization | 建议 |
| upgrade-migrations | dotnet/skills dotnet-upgrade 插件（8→9/9→10/10→11/NRT/thread-abort/aot-compat）+ Aaronontheweb nrt-migration | 建议 |
| observability-opentelemetry | Aaronontheweb opentelemetry-dotnet-instrumentation（含 traces-and-propagation）+ OTel .NET 文档 | 建议 |
| _sources | 本篇 | 项目纪律 |

## 引用上游时的红线

- **binlog MCP 事实核验（2026-10）**：dotnet/skills 官方插件以
  `dotnet dnx Microsoft.AITools.BinlogMcp --yes --prerelease` 形态内嵌
  该 MCP 服务器（stdio，binlog 命名空间）——`dotnet dnx` 不在包内供应链
  白名单且 prerelease 浮动不钉版，故模块清单不声明；接线纪律与降级面
  见束内 `dotnet-mcp` 技能（项目级手工 .pi/mcp.json 形态）。
- 上游素材的知识锚点（.NET 8/9/10 分散）低于或异于本模块锚点
  （.NET 10 LTS）——从快照取材时必须过 .NET 10 勘误（upgrade-
  migrations 的版本谱系表是勘误清单；例：`System.Threading.Lock`
  是 .NET 9+ 语义、.NET 8 LTS 已进入 ETL 尾窗）。
- 上游目录名 `opentelementry-dotnet-instrumentation`（拼写如此）
  是素材快照事实——本模块统一正名为 observability-opentelemetry。
- 本账本随内容演进同步更新：新增 reference 必登记，来源变更必记
  版本与日期。
