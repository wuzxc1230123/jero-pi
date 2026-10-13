# 依赖注入（dependency-injection）

> 来源：dotnet-skills microsoft-extensions-dependency-injection 快照 / Microsoft Learn DI 文档；权威级：规范
> 锚定运行时：.NET 10（Microsoft.Extensions.DependencyInjection 10） ｜ 核验日期：2026-10 ｜ 授权账本：`_sources.md`

## 生命周期语义

| 生命周期 | 实例 | 适用 |
|---|---|---|
| Singleton | 全局一份 | 无状态/线程安全共享（配置缓存/时钟） |
| Scoped | 每作用域一份（HTTP 请求） | `DbContext`/事务/请求上下文 |
| Transient | 每次解析一份 | 轻量有状态/即用即弃 |

- 解析成本极低（字典查 + 构造链）：**别为性能乱单例**——共享
  可变状态才是真成本。
- 请求粒度：作用域由宿主管（ASP.NET Core 每请求一 scope）；
  非请求上下文（后台任务）显式开（见捕获节）。

## 捕获陷阱（captive dependency）

singleton 依赖 scoped：容器构造 singleton 时从根解析 scoped 服务
——开发期 `ValidateScopes`（默认开）直接抛，别关验证。

合法场景的解法：

```csharp
public sealed class OutboxProcessor(IServiceScopeFactory scopeFactory)
    : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            using var scope = scopeFactory.CreateScope();       // 每轮新作用域
            var db = scope.ServiceProvider.GetRequiredService<AppDb>();
            await ProcessBatchAsync(db, ct);
        }
    }
}
```

- 后台轮询/消息泵：`IServiceScopeFactory`（本身 singleton）显式
  开 scope——`IDbContextFactory<T>` 是 EF 侧等价物（efcore-
  patterns）。
- 每次批处理一个 scope：短事务 + 边界清晰。

## 注册与装配

- **接口与实现分离**：`services.AddSingleton<IOrderBus,
  RabbitOrderBus>()`；测试替换在注册层（`services.RemoveAll<
  IOrderBus>().AddSingleton<IOrderBus, FakeBus>()`）。
- `TryAddSingleton`（防重复注册覆盖）用于装配扩展；`Replace` 显式
  替换。
- **装配面收敛**：功能域 `AddXxx(this IServiceCollection)` 扩展方
  法（`AddApplication`/`AddInfrastructure`），组合根（Host）只调
  扩展——库项目不自我装配（project-structure 的组合根唯一）。
- keyed 服务（.NET 8+）：`AddKeyedSingleton<ICache, LocalCache>
  ("local")` + `[FromKeyedServices("local")]`——多实现按名选，
  别回 `Func<string, T>` 工厂。
- 批量注册（Scrutor 谱系）：项目已引入才用；约定清晰优先于反射
  魔法。

## 注入形态

- **构造注入是正文**：依赖显式可测；参数多 = 类职责多的信号（构
  造器爆炸先拆类）。
- `IServiceProvider` 直传是依赖黑洞（服务定位器反模式）；合法缝
  隙仅框架面（中间件 `InvokeAsync` 注入/`IStartupFilter`/视图组
  件）。
- `ActivatorUtilities.CreateInstance<T>(sp)` 只用于框架接缝的晚期
  构造。

## Dispose 与生命周期尾巴

- 容器管理 `IDisposable`/`IAsyncDisposable`：transient 也是（容
  器跟踪到 scope 释放）——**transient IDisposable 注入 singleton
  会随 singleton 永生**（内存坟墓）；DI 分析器（`ServiceProvider
  Options.ValidateOnBuild`）开发期抓。
- `BackgroundService` 的 `ExecuteAsync` 异常默认吞（.NET 6+ 停主
  机行为按 `HostOptions.BackgroundServiceExceptionBehavior`）——
  顶层 try-catch + 日志是自己的责任（async-patterns 的 fire-and-
  forget 同族）。

## Options 联动

强类型配置走 `IOptions<T>` 族（configuration-options）：`AddOptions
<T>().BindConfiguration("Section")`；`IOptionsSnapshot<T>` scoped
重读、`IOptionsMonitor<T>` 热更新——生命周期语义与注入点对齐。

## 测试面

- 单测直构：`new OrderService(fakeBus, fakeClock)`——容器不出场
  （testing-practices）。
- 集成测换件：`WebApplicationFactory` 的 `WithWebHostBuilder(b =>
  b.ConfigureTestServices(…))` 替换边界服务。
- 装配完整性：`ValidateOnBuild = true` 进开发配置——注册图错配
  启动即炸。

## 红线

- 配置/中间件管道外 `BuildServiceProvider()`（第二容器 = 泄漏与
  生命周期分叉）。
- 关闭 `ValidateScopes`/`ValidateOnBuild` 来"修"捕获问题。
- 静态 `ServiceLocator.Current` 谱系（把依赖重新藏起来）。
