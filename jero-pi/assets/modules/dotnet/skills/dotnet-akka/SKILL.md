---
name: dotnet-akka
description: Akka.NET actor 模式：actor 一次一消息、Props 与监督策略、消息契约不可变、Ask/Tell 取舍、集群分片入门边界。当高并发有状态实体建模或写/评审 Akka.NET 代码时使用。触发词：Akka、Akka.NET、actor、消息传递、监督、分片、ReceiveActor。
---

# Akka.NET actor 模式

actor 是"并发下的所有权单元"：每个 actor 串行处理自己的状态，并发问题被消息边界消除——代价是异步思维与消息契约纪律。

> **相关技能：** 并发原语选型（先问要不要 actor） → `dotnet-concurrency`；异步纪律 → `dotnet-async`；性能取证 → `dotnet-performance`。

## 何时使用

高并发下有状态实体（聚合根/会话/设备影子）建模、写或评审 Akka.NET actor 代码、设计监督层级时使用——先经 `dotnet-concurrency` 确认 Channel/锁不解，再上 actor。

## 核心要点

- **一次一消息**：actor 内状态零并发访问是全部前提；actor 内绝不长阻塞（`Await result`/同步 IO）——阻塞邮箱即饿死下游。
- **消息即契约**：消息 record 不可变；`Tell`（fire-and-forget，主流）与 `Ask`（请求-响应，留超时）——`Ask` 只在协议需要同步语义时；消息类型进共享程序集，演进按不可变契约纪律。
- **Props 与生命周期**：`Props.Create(() => new Actor(args))` 工厂式；`IWithUnboundedStash` 切行为状态机（`Become`）；`Context.Self` 回信地址传递。
- **监督策略**：`OneForOneStrategy`（子独立恢复）默认；`Directive` 分级（Restart/Resume/Stop/Escalate）——异常分类是设计决策，写在父 actor。
- **集群边界**：单机 `ActorSystem` 已够多数场景；`Cluster.Sharding`/`Akka.Persistence`（事件溯源）是重武器，引入前显式列出实体量级与恢复需求。
- **测试**：`TestKit`/`TestProbe` 挂在邮箱外断言消息流；`Akka.TestKit.Xunit2` 集成测试框架。

## 红线

- actor 间共享可变对象（消息必须不可变或深拷贝传递）。
- `actor.Ask(…).Result` 同步等待（死锁/吞吐悬崖）。
- 在 actor 外持有 actor 内部状态引用（`IActorRef` 是唯一合法句柄）。

## 深读指路（references/）

actor 建模、监督与集群谱系：`references/akka-patterns.md`。
