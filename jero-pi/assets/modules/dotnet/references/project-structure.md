# 项目结构（project-structure）

> 来源：dotnet-skills project-structure 快照 / dotnet-skills 仓库 directory-build-organization（经 skills-main 快照派生）；权威级：建议
> 锚定运行时：.NET 10 ｜ 核验日期：2026-10 ｜ 授权账本：`_sources.md`

## 起步规模

新方案**一个项目起步**：边界与痛点显形再拆（结构服务演化）。
上来十个项目的"微服务"是分布式单体——跨项目改一个用例开十个
PR。模块化单体（单项目内按文件夹/命名空间模块化 + 显式模块边
界）是默认形态。

## 分层参考（拆分时）

```
repo/
├─ Directory.Build.props        # 仓级公共属性（msbuild-fundamentals）
├─ Directory.Packages.props     # CPM（nuget-packaging）
├─ nuget.config                 # 源与映射
├─ global.json                 # SDK 钉版
├─ src/
│  ├─ Contoso.Shipping.Domain/          # 实体/值对象/域服务/域事件
│  │                                    # 零外部依赖（不含 EF/UI）
│  ├─ Contoso.Shipping.Application/     # 用例编排（应用服务/接口定义）
│  │                                    # 依赖 Domain
│  ├─ Contoso.Shipping.Infrastructure/  # EF Core/HTTP/消息 实现
│  │                                    # 依赖 Application（实现其接口）
│  └─ Contoso.Shipping.Api/             # 组合根：DI 装配/端点/宿主
│                                       # 依赖全部（只做组装）
└─ tests/
   ├─ Contoso.Shipping.Domain.Tests/
   ├─ Contoso.Shipping.Application.Tests/
   ├─ Contoso.Shipping.Api.IntegrationTests/    # WebApplicationFactory/Testcontainers
   └─ Contoso.Shipping.Benchmarks/              # BenchmarkDotNet 工程
```

依赖箭头指向稳定端（Domain 最稳）；**Infrastructure 依赖
Application（实现其接口）而不是反过来**——依赖倒置的物理形态。
Host 之外的项目不读配置不自装（组合根唯一，dependency-injection）。

## 项目命名与内容纪律

- `公司.产品.层`；层名表职责（Domain/Application/Infrastructure/
  Api）——`Core`/`Common`/`Shared`/`Utils` 万能桶禁用（放不进某
  层的代码先问归属，再问建层）。
- 解决方案文件夹（sln 虚拟分组）映射结构（src/tests/tools），不
  当杂物抽屉；`.sln` 与 `.slnx`（XML 新形态）二选一。
- 测试项目一一对应（`X` ↔ `X.Tests`；集成/基准另立），公共测试
  工具进 `Contoso.Shipping.Testing`（只在 tests 间共享）。

## internal 划界

- 成员默认 `internal`；`public` 是决策（对外契约/测试替身必需）。
- `InternalsVisibleTo` 只开测试项目（`.csproj` 里
  `AssemblyAttribute` 生成，CPM 钉版本）；不开给其他产品项目——
  跨项目后门毁掉 internal 面。
- 契约面（NuGet 分发）最小公开：`public` + XML doc + SemVer 责任
  （api-design 版本化节）。

## 文件与文件夹内组织

- 一类型一文件（文件名 = 类型名）；record 的伴生工厂/映射器同
  文件可读性优先。
- 文件夹 = 命名空间段（`Contoso.Shipping.Domain/Orders/
  Order.cs` ↔ `Contoso.Shipping.Domain.Orders`）；不用手动
  namespace 飘移。
- 特性竖切（按用例 `Features/PlaceOrder/`）与横切分层（按技术
  层）二选一——团队一致比选哪个重要；竖切适合 Minimal API + 垂
  直切片演进。

## 配置文件归位

| 文件 | 位置 | 提交 |
|---|---|---|
| `Directory.Build.props/targets` | 仓根（分层按需） | ✓ |
| `Directory.Packages.props` | 仓根 | ✓ |
| `nuget.config` | 仓根 | ✓（无凭据） |
| `global.json` | 仓根 | ✓ |
| `appsettings.json` | 服务项目 | ✓（无密钥） |
| user-secrets | 用户 profile | ✗（开发态） |
| `.runsettings` | 仓根或 tests | ✓ |

## 迁移与演化

- 拆分时机：编译时间痛/团队所有权边界清晰/部署节奏分化——不为
  简单拆而拆。
- 拆分动作先建壳后搬码（每步全绿，verification-gates）；引用链
  迁移面列清单（受影响项目）。
- 结构问题在 binlog/诊断面显形（构建慢 = 增量断裂或项目图深）
  ——数据驱动拆分，不是审美驱动。

## 红线

- 循环项目引用（分支出新项目承载共享面）。
- 域层引用 EF/HTTP/UI（依赖箭头翻转）。
- Host 以外的项目读配置/环境变量/自装 DI。
- `Core`/`Common` 万能桶与无 `InternalsVisibleTo` 治理的裸 public
  面。
