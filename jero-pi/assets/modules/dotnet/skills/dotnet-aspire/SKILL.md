---
name: dotnet-aspire
description: .NET Aspire 编排：AppHost 资源模型（容器/项目/连接串）、ServiceDefaults 统一面（OTel/健康检查/弹性）、集成测试与开发态生命周期。当搭建本地多服务编排或接线 Aspire 集成时使用。触发词：Aspire、AppHost、ServiceDefaults、编排、本地编排、Aspire.Hosting。
---

# .NET Aspire 编排

Aspire 把"本地起一串依赖服务"变成代码：AppHost 描述拓扑，ServiceDefaults 统一横切面——重复的 docker-compose 与散装 OTel 接线被收敛成声明。

> **相关技能：** 配置绑定 → `dotnet-configuration`；可观测接线 → `dotnet-observability`；集成测试 → `dotnet-testing`。

## 何时使用

搭建/改造 AppHost 拓扑（服务+容器资源+连接串流转）、统一 ServiceDefaults 横切面、Aspire 集成包接线时使用。

## 核心要点

- **AppHost 是拓扑代码**：`DockerComposeEnvironment` 的等价物 `builder.AddProject<…>("api")` + `AddContainer("db", "postgres")`；`WithReference` 流转连接串/服务发现——端口与环境变量不手写。
- **ServiceDefaults 一处钉**：`builder.AddServiceDefaults()` 进每个服务——OTel（traces/metrics/logs）、健康检查端点、`HttpClient` 弹性（重试/超时/断路，标准钩子）统一装配；项目模板自带，不散装复制。
- **资源依赖**：`WaitFor` 显式依赖顺序（DB ready 才起迁移者）；`WithReplicas` 本地扩容验证并发；外部端点 `WithExternalHttpEndpoints`。
- **集成包**：`Aspire.Hosting.PostgreSQL`/`Redis`…连接串+健康检查+OTel 一条龙（`AddRedisClient` 谱系）；与手写 `AddConnectionString` 二选一，不双层。
- **配置分层**：AppHost 的 `builder.Configuration` 管拓扑参数；服务自身配置仍走 `dotnet-configuration` 纪律——两层不混。
- **DistributedApplication.Run 的生命周期**：开发态起停即拓扑；`aspire run`/`dotnet run AppHost` 同义；CI 里 `DistributedApplicationTestingBuilder` 驱动集成测试（见 `dotnet-testing`）。

## 红线

- 服务项目里复制 ServiceDefaults 代码而不引用共享项目（横切面漂移）。
- 手写容器连接串覆盖 `WithReference` 的服务发现流转。
- 生产部署直接跑 AppHost（它是开发/测试态编排器——生产拓扑另管）。

## 深读指路（references/）

资源模型、横切面与测试剧本：`references/aspire-orchestration.md`。
