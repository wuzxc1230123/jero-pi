# Akka.NET 模式（akka-patterns）

> 来源：dotnet-skills akka-* 快照（best-practices/hosting-actor-patterns/testing-patterns/management/akka-aspire-configuration，经 Aaronontheweb/dotnet-skills 派生）/ Akka.NET 官方文档；权威级：建议
> 锚定运行时：Akka.NET 1.5.x（.NET 10） ｜ 核验日期：2026-10 ｜ 授权账本：`_sources.md`

## 何时才上 actor

前置判据（concurrency-primitives 的决策树走到底）：**高并发下有
状态实体的一致性**（聚合根事件溯源/百万级设备影子/会话隔离）。
Channel/锁能解的一致性问题不需要 actor——actor 是消息传递的一致
性模型，不是"更高级的并发"。

## 核心不变量：一次一消息

- actor 邮箱串行投递，actor 内状态零并发访问——全部正确性的根。
- actor 内**绝不长阻塞**（同步 IO/`.Result`）：阻塞邮箱 = 下游全
  饿；耗时工作路由给子 worker（`Context.ActorOf`）或管道到外部。
- `IActorRef` 是唯一合法句柄：actor 外不持其内部状态引用（消息传
  递不可变，actor 不共享内存）。

## 消息契约

```csharp
public sealed record PlaceOrder(OrderId Id, Money Total);   // 命令（不可变）
public sealed record OrderPlaced(OrderId Id, DateTimeOffset At);  // 事件
public sealed record GetOrderState(OrderId Id);             // 查询
```

- 消息 = 不可变 record（modern-csharp）；命令/事件/查询分词表。
- 消息类型进共享程序集（通信双方引用同一契约——演进按不可变纪律）。
- `Tell`（`actor.Tell(msg, Sender: Self)`，fire-and-forget 主流）
  vs `Ask`（请求-响应带超时，`actor.Ask<OrderPlaced>(msg,
  TimeSpan.FromSeconds(3))`）——`Ask` 只在协议真需要同步语义；外
  部 `.Result` 等待是红线（死锁/吞吐悬崖）。

## Props 与行为

```csharp
public sealed class OrderActor : ReceiveActor
{
    public OrderActor()
    {
        ReceiveAsync<PlaceOrder>(async msg =>
        {
            var placed = new OrderPlaced(msg.Id, msg.Total, _clock.UtcNow());
            await _repository.SaveAsync(placed);        // IO 想办法外移
            Sender.Tell(placed);
        });
        Receive<GetOrderState>(msg => Sender.Tell(_state));
    }

    public static Props Props(TimeProvider clock)
        => Akka.Actor.Props.Create(() => new OrderActor(clock));
}
var order = system.ActorOf(OrderActor.Props(clock), $"order-{orderId}");
```

- Props 工厂式创建（可测试/可替换派发器）；actor 名稳定（持久引
  用/分片键的地基）。
- 状态机：`Become(Stacked/Unstacked)` 切行为（开单中→已支付→已发
  货），非法状态消息丢弃进死信日志。
- `Stash`：暂存当前状态处理不了的消息，切换后回放。

## 监督层级

```csharp
public sealed class OrderSupervisor : ReceiveActor
{
    private readonly SupervisorStrategy strategy =
        new OneForOneStrategy(
            maxNumberOfRetries: 3,
            withinTimeRange: TimeSpan.FromMinutes(1),
            localOnlyDecider: ex => ex switch
            {
                TransientFailure  => Directive.Restart,   // 瞬态：重启子
                BadMessage        => Directive.Resume,    // 单消息错：跳过继续
                _                 => Directive.Escalate   // 未知：上报父级
            });
    // …
}
```

- `OneForOne`（子独立故障，默认选择）/`AllForOne`（子群共死——
  罕用）。
- Directive 分级是**设计决策写在父级**：Restart（清状态重来）/
  Resume（保状态跳过）/Stop（放弃）/Escalate（上报）。
- `ActorSystem` 顶层的监督者链是最后防线；`Terminate` 优雅停机
  （host 关停钩子里）。

## 宿主集成

- `Akka.Hosting`（.NET 通用宿主谱系）：`builder.Services.AddAkka(
  "orders", (system, di) => { system.WithActors(…); })`——DI 融合
  （TimeProvider/仓库注入 actor 工厂）+ 宿主生命周期绑定（停机即
  优雅终止 actor 系统）。
- Aspire 组合：AppHost 里 `AddProject` actor 服务 + 集群成员源接
  `Akka.Management` 发现（aspire-orchestration）。
- 持久化（事件溯源）：`Akka.Persistence.Sql` 谱系——引入前显式列
  出恢复需求（事件回放建模成本），不是默认配件。

## 集群边界

- 单机 `ActorSystem` 覆盖多数场景；扩容瓶颈先量（diagnostics-tools）
  再考虑 `Cluster.Sharding`（实体分片跨节点）+ `Akka.Management`
  发现。
- 分片实体键 = 稳定 actor 名的路由依据（`ShardRegion` 语义）——
  实体 ID 设计是集群化的前置契约。

## 测试（TestKit）

```csharp
[Fact]
public void OrderActor_PersistsAndReplies()
{
    var probe = CreateTestProbe();
    var order = ActorOfAsTestActorRef<OrderActor>(OrderActor.Props(clock));
    order.Tell(new PlaceOrder(id, total), probe);
    probe.ExpectMsg<OrderPlaced>(p => p.Id == id);
}
```

- `TestProbe` 挂邮箱外断言消息流；`ExpectMsg<T>` 带超时。
- 虚拟时间/确定性调度（`TestScheduler`）避免真睡（testing-
  practices 的注入纪律同族）。
- 集群逻辑用 `ClusterSharding` 的单机测试模式（分片本地跑）。

## 红线

- actor 间共享可变对象（消息必须不可变或深拷贝传递）。
- `Ask(…).Result` 同步等待；actor 处理器内长阻塞 IO。
- 在 actor 外 `new OrderActor()` 直用（绕过邮箱 = 绕过全部一致性
  保证）。
