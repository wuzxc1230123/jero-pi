---
name: dotnet-di
description: 依赖注入纪律：生命周期选型（singleton/scoped/transient）、捕获陷阱、注册面收敛（TryAdd/装配扩展）、服务定位反模式与 Options 绑定。当设计或评审 DI 注册与构造注入时使用。触发词：依赖注入、DI、IServiceCollection、生命周期、singleton、scoped、transient、构造函数注入。
---

# 依赖注入（Microsoft.Extensions.DependencyInjection）

DI 是关于让依赖显式且可替换的：构造注入是正文，容器是接线板——服务定位器用法把依赖重新藏起来。

> **相关技能：** 配置绑定（IOptions 族） → `dotnet-configuration`；EF Core 生命周期 → `dotnet-efcore`；Web API 装配面 → `dotnet-webapi`。

## 何时使用

设计服务注册与生命周期、评审构造注入/服务定位、组织装配层（扩展方法收敛）时使用。

## 核心要点

- **生命周期选型**：无状态且线程安全 → `singleton`；请求/作用域语义（`DbContext`、事务）→ `scoped`；轻量有状态/每次新依赖 → `transient`（注入成本可忽略，别为"性能"乱单例）。
- **捕获陷阱**：singleton 依赖 scoped 会炸（`ValidateScopes` 开发期拦截）；合法需求走 `IDbContextFactory<T>`/`IServiceScopeFactory` 显式开作用域——不是关验证。
- **构造注入是正文**：依赖全进构造器（显式可测）；`IServiceProvider.GetService` 服务定位只许在框架缝隙（中间件/过滤器/宿主管道）出现。
- **注册面收敛**：`AddXxx` 扩展方法按功能域组装（`AddApplication`/`AddInfrastructure`）；`TryAdd` 防重复注册覆盖；实现类型与接口分离注册（`services.AddSingleton<IFoo, Foo>`）。
- **批量/装饰/拦截**：Scrutor 谱系的装配约定（项目已用才引入）；装饰器优先于拦截器魔法。
- **Dispose 纪律**：容器管理 `IDisposable`（创建者负责销毁）；`IDisposable` transient 注入 singleton 的坟墓——编译器分析器（DI 分析器）开着别压。

## 红线

- `BuildServiceProvider` 在配置/中间件管道外调用（第二容器 = 第二套生命周期，泄漏源）。
- 用 `IServiceProvider` 直传代替具体依赖（依赖黑洞）。
- 可变静态状态替代注入（测试不可替换）。

## 深读指路（references/）

生命周期谱系、捕获形态与装配纪律：`references/dependency-injection.md`。
