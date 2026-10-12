# ASP.NET Core Web API（aspnet-webapi）

> 来源：dotnet-skills 仓库 dotnet-webapi（经 skills-main 快照派生）/ dotnet-skills serialization·configuration 联动 / Microsoft Learn ASP.NET Core 文档；权威级：规范+建议
> 锚定运行时：.NET 10（ASP.NET Core 10） ｜ 核验日期：2026-10 ｜ 授权账本：`_sources.md`

## Minimal API 与控制器

```csharp
var app = builder.Build();

app.MapGet("/orders/{id:guid}", async (Guid id, OrderService svc, CancellationToken ct)
        => await svc.FindAsync(id, ct) is { } order
            ? Results.Ok(order.ToDto())
            : Results.NotFound())
   .WithName("GetOrder")
   .RequireAuthorization("read:orders");

app.MapPost("/orders", async (CreateOrderRequest req, OrderService svc,
        CancellationToken ct) =>
    {
        var created = await svc.CreateAsync(req, ct);
        return Results.CreatedAtRoute("GetOrder", new { id = created.Id }, created.ToDto());
    })
   .WithValidation();
```

- 选型：微端点/垂直切片/组合式路由用 Minimal；重契约（过滤器/
  ApiVersioning 惯例/控制器测试面）用控制器——**按域分区统一**，
  不逐端点随机选。
- 端点内薄：参数绑定/校验 + 编排调用 + 结果映射；业务在服务层
  （project-structure 的域分层）。

## 错误面统一（RFC 7807）

```csharp
// 全局异常→问题详情（.NET 8+ IExceptionHandler）：
builder.Services.AddExceptionHandler<DomainExceptionHandler>();
builder.Services.AddProblemDetails();
app.UseExceptionHandler();
```

- 唯一错误体形态 `ProblemDetails`（`application/problem+json`）：
  `type`/`title`/`status`/`detail`/`errors`（校验字典）。
- 域异常→状态码映射集中在 handler（`OrderNotFound → 404`、
  `InvalidOrder → 422`）；端点不手工拼错误 JSON、不 try-catch 包
  一切。
- 校验失败统一 400/422（FluentValidation/DataAnnotations 管道化）；
  `TypedResults.Xxx` 让返回类型即 OpenAPI 文档。

## 版本化

- `Asp.Versioning`（路由段 `/api/v2/orders` 或查询/头）：破坏性
  变更升版本，同版本内加字段（可空容忍）。
- 弃用端点：`Deprecated` 头 + 日志计数 + 日落日期公告——不静默改
  语义（序列化契约的兼容纪律见 serialization-json）。
- 版本化策略一处配置（`AddApiVersioning`），控制器/端点声明式。

## 管线与中间件

```
ExceptionHandler → HSTS/HttpsRedirection（生产）→ StaticFiles
→ Cors → Authentication → Authorization → 路由/端点
```

- 顺序即语义：认证在授权前；异常处理在最外。
- 自定义中间件窄做（横切面：租户解析/请求日志）；业务逻辑不进
  管线。
- `app.MapDefaultEndpoints()`（Aspire ServiceDefaults）挂 /health
  /alive（aspire-orchestration）。

## 请求路径纪律

- **全异步**：同步 IO 是线程池饥饿主源（async-patterns 死锁节）；
  `HttpContext.RequestAborted` 的 `CancellationToken` 传进服务层。
- 大体分流式：`Request.Body` 直读流（`PipeReader` 谱系）/分块，
  不整读进内存；响应同（`Results.Stream`）。
- `HttpContext` 不出 API 层：域层收纯参数（TimeProvider/IOptions
  注入谱系）——框架对象污染域是依赖倒置的反面。

## 安全底线

- 认证/授权显式：端点 `RequireAuthorization("policy")`，公开面
  `AllowAnonymous` 显式声明——默认拒绝。
- CORS 白名单显式来源（`WithOrigins`，不 `AllowAnyOrigin` +
  credentials）。
- 请求体限流（`AddRequestSizeLimit`/反代理层）；`FormOptions`
  多部件上限。
- secrets 不进配置明文（configuration-options）；日志脱敏中间件
  统一（observability-opentelemetry 的 tag 纪律同族）。

## 测试面

- `WebApplicationFactory<Program>`：内存 host + DI 换件（`Configure
  TestServices` 替换外部依赖）——API 集成测的事实标准（testing-
  practices）。
- 契约快照：路由表/响应 schema 锁定（Verify 惯例）防无意识破坏
  性变更。

## 红线

- 端点内 try-catch 拼 500 JSON（错误面必须统一 ProblemDetails）。
- 无版本化下改响应字段语义；`HttpContext`/`HttpContext.Request`
  传进域层。
- 同步 IO/`.Result` 在请求路径；`AllowAnyOrigin` + 凭据的 CORS。
