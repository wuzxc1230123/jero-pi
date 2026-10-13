# 测试实践（testing-practices）

> 来源：dotnet-skills 仓库 dotnet-test 插件（assertion-quality/test-anti-patterns/code-testing，经 skills-main 快照派生）/ dotnet-skills snapshot-testing·testcontainers·verify 快照；权威级：建议
> 锚定运行时：.NET 10 ｜ 核验日期：2026-10 ｜ 授权账本：`_sources.md`

## 框架面

| 框架 | 惯例场景 | 形态要点 |
|---|---|---|
| xUnit | 新项目默认 | 构造即 setup；`IClassFixture` 共享；并行默认开 |
| NUnit | 存量/MS 系传统 | `[Setup]`/`[TearDown]` 显式；并行显式开 |
| MSTest | 存量 | `[TestMethod]`；新项目少选 |

一套解决方案一个主框架；`Microsoft.NET.Test.Sdk` + runner 版本
钉在 CPM（nuget-packaging）；`.runsettings` 收敛运行配置（目标
框架/并行度/数据收集器）。

## 结构：AAA + 命名即规格

- Arrange–Act–Assert 三段可见（空行或注释分节）；Act 一行是理想
  ——多行 Act 是测试在演脚本。
- 名字 = 行为 + 条件 + 预期（`Withdraw_InsufficientFunds_Throws`）；
  `Test1` 是负债。
- 一个测试一个行为簇：失败时名字即定位。

## 依赖注入化（可测性的根）

- 时间：`TimeProvider`（.NET 8+）+ `Microsoft.Extensions.TimeProvider.
  Testing` 的 `FakeTimeProvider`（`Advance`/`SetUtcNow`）——不真睡。
- 随机：`Random` 注入（构造收 seed 或抽象）——失败可重放。
- 环境/配置：`IConfiguration` 测试构造（`ConfigurationBuilder` +
  内存字典）。
- 文件/网络/DB：接口边界 + 测试替身；集成层用真件（Testcontainers）。

## 替身谱系

| 替身 | 用途 |
|---|---|
| Fake（内存实现） | 边界协议的可用假件（内存仓库）——首选 |
| Stub | 只喂预置返回值 |
| Mock | 断言交互（"调了一次 Send"）——交互是契约时才用 |
| Spy | 记录调用不约束 |

- Mock 收窄到边界接口；内部调用链 mock 化 = 重构即红（脆测试）。
- 断言行为结果优先；交互断言只在交互本身是需求时（"不重试第
  三次"）。

## 反模式清单

- 测试内 `if`/`try-catch` 分支（测试在测自己）；`Assert.True(x == y)`
  （失败信息无 got/want——用 `Assert.Equal(expected, actual)` 参数
  序）。
- 测试间共享可变状态与执行顺序依赖（并行默认下即 flake）。
- `.Result`/`.Wait()` 异步测试（async 测试方法直接 `await`）。
- `Thread.Sleep` 等待（事件/`Task.WhenAny`/FakeTimeProvider）。
- 无 seed 随机数据（失败不可重放）；捕获 all 吞断言异常。
- 断言实现细节（私有状态/内部调用序列）而非公共行为。
- 为覆盖率补的无行为测试（覆盖率是副产品，行为覆盖是目的）。

## 集成与端到端

- Testcontainers（项目已引入时）：真 DB/消息件起容器——接线关键
  路径的回归保险；Aspire `DistributedApplicationTestingBuilder` 驱
  动全拓扑（aspire-orchestration）。
- EF Core 测试分层：InMemory/SQLite 只测逻辑（行为差异：事务/
  SQL 翻译/约束不保真——efcore-patterns）；涉及查询语义的测试
  用真 provider。
- 契约面：序列化快照（Verify 惯例——`[Fact] public async Task
  OrderDto_IsStable() => await Verifier.Verify(dto)`）锁公共形状；
  快照 diff 进 PR 评审，不当黑盒垃圾场。
- HTTP 面：`WebApplicationFactory<Program>` 内存起 host + 假件替
  换 DI——API 层集成测的事实标准（aspnet-webapi）。

## 稳定性治理

- flake 三步：隔离复现（单跑/并发跑/换序跑）→ 根因（共享态/
  时序/外部依赖）→ 修复或标记 `Skip` 带工单（不静默重跑掩盖）。
- 慢测试分层标记（Trait/`[Category]`），CI 快道跑单元、门禁跑
  全量——金字塔不倒置（单元为底、集成窄面、端到端冒烟）。

## 验证协议

测试的执行面（命令/退出码/证据）由 verification-gates 钉住——
本篇管"怎么写好测试"，那篇管"怎么证明跑过"。
