---
name: dotnet-testing
description: 测试实践：框架选型不混用、AAA 结构、测试命名即文档、Test Driven 的 RED-GREEN 节奏、依赖注入化可测性、快照与集成测试的边界。当写测试或评审测试质量时使用。触发词：测试、xUnit、NUnit、MSTest、单元测试、断言、测试反模式、覆盖率。
---

# 测试实践

测试是行为的可执行规格：读测试就能懂契约——测试本身不可读/不稳定/验证实现细节时，它就从资产变负债。

> **相关技能：** 验证执行三道门 → `dotnet-tester`；基准取证 → `dotnet-benchmark`；EF Core 测试面 → `dotnet-efcore`。

## 何时使用

编写/评审单元测试、决定测试层级（单元/集成/端到端）、治理测试稳定性时使用。

## 核心要点

- **框架不混用**：一个解决方案一套主框架（xUnit 惯例优先）；`Microsoft.NET.Test.Sdk` + runner 包钉版本；`.runsettings` 收敛运行配置。
- **AAA + 命名即文档**：Arrange-Act-Assert 三段；名字写行为（`Withdraw_InsufficientFunds_Throws` 或 `取款_余额不足_抛异常`）；一个测试一个行为断言簇。
- **依赖全部可注入**：时间走 `TimeProvider`（.NET 8+ 的 `FakeTimeProvider`）、GUID 走注入工厂、env 走 `IConfiguration`——测试里替换真实依赖不靠魔法。
- **测行为不测实现**：断言公开可观察结果；mock 收窄到边界协议（接口），内部调用链不 mock（否则重构即红）。
- **稳定性纪律**：不依赖执行顺序与共享可变状态；异步测试异步等待不 `.Result`；flake 复现优先于重跑掩盖。
- **层级配比**：单元为底座；集成（Testcontainers 起 DB）验证接线关键路径；UI/端到端窄面冒烟——金字塔不倒置。
- **快照测试**：序列化输出比对（Verify 惯例）适合大结构回归；快照 diff 进 PR 评审，不当黑盒垃圾场。

## 红线

- 测试内分支逻辑（if/try 吞断言路径）与随机数据无 seed。
- 为绿而弱化断言、catch-all 捕获吞掉失败。
- 覆盖率数字当目标（行为覆盖是目的，行覆盖是副产品）。

## 深读指路（references/）

测试谱系与反模式清单：`references/testing-practices.md`；验证协议（build/test/退出码）：`references/verification-gates.md`。
