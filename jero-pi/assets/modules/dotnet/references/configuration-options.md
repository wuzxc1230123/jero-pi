# 配置与选项（configuration-options）

> 来源：dotnet-skills microsoft-extensions-configuration 快照 / Microsoft Learn 配置文档；权威级：规范
> 锚定运行时：.NET 10（Microsoft.Extensions.Configuration 10） ｜ 核验日期：2026-10 ｜ 授权账本：`_sources.md`

## 分层源模型

```csharp
var builder = WebApplication.CreateBuilder(args);   // 默认链已就位
builder.Configuration.AddJsonFile("orders.json", optional: true, reloadOnChange: true);
```

默认覆盖序（后读覆盖先读）：appsettings.json → appsettings.{
Env}.json → user-secrets（开发）→ 环境变量 → 命令行。自定义追
加源在尾（最高优先）——**顺序是设计决策**，追加即覆盖。

- 环境变量扁平化：`Orders__MaxBatchSize`（`__` 双下划线 = `:` 层
  级）；容器编排标准注入面。
- user-secrets 只开发态（`dotnet user-secrets set "Db:Pwd" "…"`，
  值在用户 profile 不进仓）；生产密钥走环境/密钥管理（KeyVault/
  Secrets Manager 谱系——**任何密钥不进仓**）。

## 强类型 Options 三件套

```csharp
public sealed record OrdersOptions
{
    public const string SectionName = "Orders";
    public required int MaxBatchSize { get; init; }
    public required TimeSpan FlushInterval { get; init; }
}

builder.Services.AddOptions<OrdersOptions>()
    .BindConfiguration(OrdersOptions.SectionName)
    .ValidateDataAnnotations()
    .Validate(o => o.FlushInterval > TimeSpan.Zero, "flush interval must be positive")
    .ValidateOnStart();
```

| 注入面 | 生命周期 | 语义 |
|---|---|---|
| `IOptions<T>` | singleton | 启动时快照，不可更新 |
| `IOptionsSnapshot<T>` | scoped | 每作用域重读（reloadOnChange 生效） |
| `IOptionsMonitor<T>` | singleton | 热更新 + `OnChange` 回调 |

选型即正确性：singleton 服务只能注 `IOptions<T>`/`Monitor`（注
Snapshot 是捕获陷阱——dependency-injection）。

## 校验前置

- `ValidateOnStart` 是底线：坏配置在启动炸（部署即失败、回滚即修
  复），不在第 N 个请求炸（深夜值班炸）。
- DataAnnotations 覆盖简单面（`[Range]`/`[Required]`）；复杂不变
  式 `Validate` 谓词；`required` + `init`（modern-csharp）让缺失
  键在绑定即失败。
- 默认值克制：`MaxBatchSize = 100` 类默认写进 options 类，环境
  可覆盖；"魔法默认"藏环境差异。

## 读取纪律

- 业务代码不持 `IConfiguration`（框架中间件/宿主装配除外）——全
  走强类型 Options；字符串键（`config["Orders:MaxBatchSize"]`）
  是漂移源（无编译器兜底、多处复制）。
- 散量收口：`builder.Configuration.GetConnectionString("Default")`
  标准面 + options 化传递。
- 配置分环境差异显式化：`appsettings.Staging.json` 的 diff 就是
  环境差异清单——不靠人脑记。

## 环境与模式

- `ASPNETCORE_ENVIRONMENT`（Web）/`DOTNET_ENVIRONMENT`（通用）：
  Development/Staging/Production 三态惯例；环境分支逻辑用配置表
  达（不同环境的不同 options 值），不用 `#if DEBUG`。
- `IHostEnvironment.IsProduction()` 只用于宿主装配差异（日志级别/
  中间件开关），不渗进业务。

## 进阶面

- 源生成绑定（.NET 8+ `ConfigurationBindingGenerator`）：AOT 兼容
  的反射免绑定（aot-trimming 联动——AOT 目标必开）。
- `IOptionsFactory`/`IConfigureOptions<T>`/`IPostConfigureOptions
  <T>`：装配期加工（拿其他服务算默认值）——复杂度气味，能用
  `Configure` lambda 就不上。
- `reloadOnChange` 的消费纪律：热更新只该影响"下一次读取"（缓存
  TTL/限流参数）；中途换实现是状态机问题不是配置问题（用
  `Monitor.OnChange` 显式迁移或干脆重启）。

## 红线

- 密钥/连接串明文进 appsettings.json 提交 git（历史里也要清——
  轮换密钥，不只删文件）。
- 运行期才发现非法配置（校验前置到启动）。
- 每处手读字符串键；配置里放环境推导逻辑（`if env == prod then
  …` 的 JSON 版）。
