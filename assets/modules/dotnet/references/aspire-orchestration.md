# Aspire 编排（aspire-orchestration）

> 来源：dotnet-skills aspire-* 快照（configuration/service-defaults/integration-testing/akka-aspire-configuration/mailpit）/ Microsoft Learn .NET Aspire 文档；权威级：建议
> 锚定运行时：.NET Aspire 9.x（.NET 10） ｜ 核验日期：2026-10 ｜ 授权账本：`_sources.md`

## 拓扑即代码（AppHost）

```csharp
var builder = DistributedApplication.CreateBuilder(args);

var postgres = builder.AddPostgres("pg")
    .WithDataVolume()                          // 数据持久化（开发态）
    .WithPgAdmin();                            // 顺手带管理台
var db = postgres.AddDatabase("orders");

var migrations = builder.AddProject<Projects.Orders_Migrations>("orders-migrations")
    .WithReference(db)
    .WaitFor(db);                              // DB ready 才起

builder.AddProject<Projects.Orders_Api>("orders-api")
    .WithReference(db)
    .WaitForCompletion(migrations)             // 迁移完成才起
    .WithExternalHttpEndpoints();

builder.Build().Run();
```

- 资源模型：`AddProject`（服务）/`AddContainer`（现成镜像）/
  `AddConnectionString`（外部资源）——docker-compose 的开发态替身。
- `WithReference` 流转连接串 + 服务发现（`ConnectionName__`
  环境变量注入/`https+http` 端点解析）；**端口与连接串不手写**。
- `WaitFor`（依赖就绪：健康检查通过）/`WaitForCompletion`（一次性
  任务完成——迁移者模式）；启动序显式声明。
- `WithReplicas(3)` 本地多副本验证并发/选举逻辑。

## ServiceDefaults：横切面一处钉

```csharp
// 每个服务项目的 Program.cs：
builder.AddServiceDefaults();
// …
app.MapDefaultEndpoints();     // /health /alive
```

统一装配：OTel 三信号（traces/metrics/logs 出 OTLP——
observability-opentelemetry）、健康检查端点、服务发现、`HttpClient`
弹性（重试/断路/超时的标准钩子谱系）。

- ServiceDefaults 是共享项目（模板自带）——**服务不复制其代码**，
  引用即生效；横切面升级改一处。
- 弹性策略定制走 `ConfigureHttpClientDefaults`（重试次数/断路参
  数进配置，configuration-options）。

## 集成包谱系

```csharp
// 客户端侧（服务项目）：
builder.AddRedisClient("cache");            // 连接串 + 健康检查 + OTel 一条龙
builder.AddNpgsqlDataSource("orders");      // Npgsql 池化数据源
```

- `Aspire.StackExchange.Redis`/`Npgsql`/`Azure.*` 族：注册即接线
  （连接管理/健康/遥测），比手写 `AddSingleton(sp => new
  ConnectionMultiPlexer(…))` 少一个出错面。
- 与手写 `AddConnectionString` + 自行注册二选一——**不双层**（同
  一资源两套注册是配置漂移源）。

## 集成测试拓扑

```csharp
[Fact]
public async Task Order_flow_persists()
{
    var appHost = await DistributedApplicationTestingBuilder
        .CreateAsync<Projects.AppHost>();
    await using var app = await appHost.BuildAsync();
    await app.StartAsync();

    var api = app.GetEndpoint("orders-api");
    // … 走真 HTTP + 真 Postgres 的端到端断言
}
```

- `DistributedApplicationTestingBuilder` 起**真拓扑**（容器+服务）
  跑集成测试——测试面与开发面同一 AppHost 定义，不二写。
- 容器依赖的测试此前由 Testcontainers 手拼（testing-practices）；
  有 Aspire 后统一走此面。

## 分层边界

| 层 | 管什么 | 不碰什么 |
|---|---|---|
| AppHost | 拓扑/启动序/端口/连接串流转 | 业务配置 |
| ServiceDefaults | 横切面（遥测/健康/弹性） | 业务逻辑 |
| 服务自身 | 业务 + 自身配置（options） | 拓扑 |

AppHost 的 `builder.Configuration` 管拓扑参数（环境/卷/副本数）；
服务业务配置仍走自身 `IConfiguration`（configuration-options）——
两层混写是初版常见病。

## 生产边界

AppHost 是**开发与测试态编排器**：生产部署走正式拓扑（Kubernetes/
容器平台/App Service），Aspire 9+ 的 `aspire publish`/部署工件谱系
按需采用——"本地开发 = 生产拓扑"的等价性靠集成测试拓扑保证，不
靠把 AppHost 推上生产。

## 红线

- 服务项目内复制 ServiceDefaults 代码（横切面漂移——引用共享项
  目）。
- 手写连接串覆盖 `WithReference` 流转；AppHost 里写业务规则。
- 同一资源集成包注册 + 手写注册双层。
