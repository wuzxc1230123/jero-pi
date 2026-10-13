---
name: dotnet-configuration
description: 配置与选项：IConfiguration 分层源、强类型 Options 绑定（IOptions/IOptionsSnapshot/IOptionsMonitor）、校验与启动期失败、密钥与环境分离。当设计配置结构或评审配置读取时使用。触发词：配置、appsettings、IConfiguration、IOptions、Options、环境变量、绑定。
---

# 配置与选项

配置是环境的事实，不是代码的常量：分层源提供覆盖序，强类型 Options 提供单一消费者——散读 `IConfiguration` 是配置面腐化的起点。

> **相关技能：** DI 注册（Options 绑定） → `dotnet-di`；序列化面 → `dotnet-serialization`；Aspire 服务接线 → `dotnet-aspire`。

## 何时使用

设计配置结构/绑定/校验，评审配置读取方式与环境差异处理时使用。

## 核心要点

- **分层源顺序即覆盖序**：后注册覆盖先注册（env vars > user-secrets(开发) > appsettings.{Env}.json > appsettings.json）；`builder.Configuration` 显式组装，顺序是设计决策。
- **强类型绑定**：`services.AddOptions<T>().BindConfiguration("Section")`；消费注入 `IOptions<T>`（singleton 快照）/`IOptionsSnapshot<T>`（scoped 每请求重读）/`IOptionsMonitor<T>`（变更回调热更新）——三者生命周期语义选型即正确性。
- **启动期校验**：`.ValidateDataAnnotations()` + `.ValidateOnStart()`——坏配置在启动炸，不在第 N 个请求炸；复杂不变式走 `Validate` 谓词与 `ValidationContext`。
- **密钥不进仓库**：开发 user-secrets；生产环境变量/KeyVault 谱系（密钥管理见 `dotnet-nuget` 的 CI 面与 `references/configuration-options.md`）；`appsettings.json` 里只有非敏感默认。
- **环境命名**：`ASPNETCORE_ENVIRONMENT`/`DOTNET_ENVIRONMENT`（Development/Staging/Production）；环境分支逻辑用配置表达，不用 `#if`。
- **读法收敛**：业务代码不直接持 `IConfiguration`（框架中间件除外）——全走 Options；连接串等散量经 `GetConnectionString` 收口。

## 红线

- 密钥/连接串明文进 appsettings 提交进 git。
- 每处手读 `config["Foo:Bar"]` 字符串键（漂移无编译器兜底）。
- 运行期才因非法配置失败（校验该前置到启动）。

## 深读指路（references/）

源/绑定/校验谱系与环境策略：`references/configuration-options.md`。
