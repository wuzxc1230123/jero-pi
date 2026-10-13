---
name: dotnet-webapi
description: ASP.NET Core Web API：Minimal API 与控制器取舍、路由与版本化、Result 映射与问题详情（ProblemDetails）、中间件管线与模型绑定校验。当设计或评审 HTTP API 时使用。触发词：WebAPI、ASP.NET Core、Minimal API、控制器、路由、中间件、ProblemDetails、端点。
---

# ASP.NET Core Web API

HTTP API 的形状是长周期契约：路由/状态码/错误体/版本化一旦有消费方就是兼容面——端点内逻辑薄、契约语义正、错误面统一。

> **相关技能：** DI 装配 → `dotnet-di`；DTO 序列化契约 → `dotnet-serialization`；异步纪律（请求路径全异步） → `dotnet-async`；可观测 → `dotnet-observability`。

## 何时使用

设计新端点（Minimal API 或控制器）、评审路由/校验/错误处理/版本化时使用。

## 核心要点

- **Minimal API 与控制器分层**：微端点/组合式路由用 Minimal（`MapGet(…)` 组）；重行为契约（过滤器/区域/惯例测试）用控制器；一个项目内可共存但按域分区，不逐端点随机选。
- **错误面统一**：`Results.Problem`/`ProblemDetails`（RFC 7807）是唯一错误体形态；异常→状态码映射集中在异常处理中间件/`IExceptionHandler`（.NET 8+），端点不手工拼错误 JSON。
- **校验分层**：模型绑定+DataAnnotations/FluentValidation 在边界拒；域不变式在域层（边界校验通过仍可能违反域规则）；`TypedResults` 让返回类型即文档（OpenAPI 面从签名推）。
- **版本化**：`Asp.Versioning` 路由段或查询参数，破坏性变更升主版本；弃用端点带 `Deprecated` 头与日落时间——不静默改语义。
- **中间件序**：异常处理 →（HSTS/HttpsRedirection 生产）→ CORS/认证 → 授权 → 路由；顺序错=语义错；自定义中间件窄做（横切面才进管线）。
- **请求纪律**：全异步（同步 IO 是线程池饥饿主源）；大流式上传下载走流不整读进内存；`CancellationToken` 从 `HttpContext.RequestAborted` 传入域层。
- **安全底线**：CORS 白名单显式；授权策略在端点声明（`RequireAuthorization`）——默认拒绝、显式开放公开面。

## 红线

- 端点内 try/catch 拼 500 响应体（错误面必须统一）。
- 版本化缺席下改响应字段语义。
- `HttpContext` 传进域层（框架对象止步于 API 层）。

## 深读指路（references/）

端点设计/错误面/版本化谱系：`references/aspnet-webapi.md`。
