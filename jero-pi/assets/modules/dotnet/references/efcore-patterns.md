# EF Core 模式（efcore-patterns）

> 来源：dotnet-skills efcore-patterns 快照 / dotnet-skills 仓库 optimizing-ef-core-queries 与 create-datadriven-aspnetcore（经 skills-main 快照派生）/ Microsoft Learn EF Core 文档；权威级：规范+建议
> 锚定运行时：EF Core 10（.NET 10） ｜ 核验日期：2026-10 ｜ 授权账本：`_sources.md`

## 查询形状优先

EF Core 的性能问题 80% 是查询形状（拉了什么、追踪了什么、几次
往返），不是"EF 慢"。

## 追踪分层

- 默认追踪（变更检测开销）；**只读路径显式 `AsNoTracking()`**：
  列表页/报表/投影查询。
- `AsNoTrackingWithIdentityResolution()`：有关联重复的只读图（同
  一订单出现多次）——一次物化 + 身份去重。
- 全局默认切换：`context.QueryTrackingBehavior =
  QueryTrackingBehavior.NoTracking` + 写路径显式 `AsTracking()`
  （读多写少的系统这样倒置更省心）。

## 投影与装载

```csharp
var orders = await db.Orders
    .Where(o => o.Status == OrderStatus.Pending)
    .OrderByDescending(o => o.CreatedAt)
    .Select(o => new OrderListItemDto      // 只取所需列——单条 SQL
    {
        Id = o.Id,
        Customer = o.Customer.Name,
        Total = o.Lines.Sum(l => l.Price * l.Qty),
    })
    .Take(50)
    .ToListAsync(ct);
```

- **投影优先于 Include 整图**：DTO `Select` 让 SQL 只带需要的列；
  `Include` 拉实体树（宽行 + 追踪成本）。
- 分页必须 `OrderBy`（确定性）+ `Take/Skip`；键集分页（`Where(Id >
  lastSeen)`）深翻页优于 offset。

## 集合导航与拆分

- 多个集合 `Include` = 笛卡尔积（行数 = 各集合乘积）。
- `AsSplitQuery()`：每集合一条 SQL（一致性非原子——同事务内多数
  场景可接受）；双集合导航必拆，单集合按行宽判断。
- `.Load()`/显式加载（`context.Entry(o).Collection(x => x.Lines).
  LoadAsync()`）留给条件性装载的少数路径。

## 批量写与执行

- `ExecuteUpdateAsync`/`ExecuteDeleteAsync`（EF 7+）：Set 式 DML
  不拉实体、不追踪——批量状态翻转的第一选择。
- `AddRange`/批量 `SaveChanges`（EF Core 8+ 单批多语句）；循环内
  `SaveChanges`（每行一往返 + 每行一事务）是 N+1 的写侧形态。
- 显式事务收口多步写：`await using var tx = await db.Database.
  BeginTransactionAsync(ct)` 或 `ExecutionStrategy`（重试策略下
  显式事务必须包进 `ExecuteAsync`）。
- 防注入：`FromSqlInterpolated($"… {id} …")` 参数化内建；
  `FromSqlRaw` 手拼是红线；`SqlQuery<T>`（非实体类型）走同参数化。

## DbContext 生命周期

- **scoped（每请求）为铁律**：unit-of-work 短事务语义；
  `AddDbContext<T>` 默认 scoped。
- 线程池/后台任务/单例服务：`IDbContextFactory<T>`（`AddDbContext
  Factory`）每用例 `CreateAsync()` + `await using`。
- 并发使用 `DbContext` 抛 `InvalidOperationException`（线程不安
  全）——它从来不是线程安全的。
- 拦截器/选项：`AddDbContext<T>(o => o.UseNpgsql(…).
  AddInterceptors(…))` 单一注册链（不双注册）。

## 迁移纪律

- 一个变更一个迁移（可审读可回滚）；迁移与模型快照同 PR。
- `dotnet ef migrations add <Name>`（工具安装：`dotnet tool
  install -g dotnet-ef`）；`has-pending-model-changes` 查漂移。
- 生产库迁移：启动时自动 `Database.Migrate()` 是红线（多实例竞
  态 + 启动耦合）——独立迁移步骤/作业（Aspire 里独立 worker）。
- SQL 检视：`dotnet ef migrations script <from> <to>` 生成审读；
  破坏性操作（删列）走两阶段（先停写后删）。

## 测试分层

| 层 | 工具 | 覆盖 |
|---|---|---|
| 逻辑单测 | InMemory / SQLite 内存 | 仓库逻辑（注意差异：无 SQL 翻译/约束弱） |
| 查询语义 | Testcontainers + 真 provider | LINQ 翻译/事务/索引行为 |
| 完整接线 | Aspire 测试拓扑 | 迁移 + 全链路 |

- InMemory 不是关系数据库：不验证翻译/外键/事务语义——"绿了"
  不等于 SQL 对（testing-practices 分层节）。

## 索引与 N+1

- 查询模式定索引：过滤器列 + 排序列组合索引（`HasIndex(…)`);
  `EXPLAIN`（provider 侧）复核。
- N+1 识别：循环内查询/懒加载（`LazyLoadingProxies` 默认不装——
  装了就是隐式 N+1 工厂）；日志 `Microsoft.EntityFrameworkCore.
  Database.Command` Information 级看 SQL 次数。

## 红线

- 循环内查询或 `SaveChanges`；`DbContext` 单例/静态持有。
- 生产启动自动迁移；`FromSqlRaw` 拼接用户输入。
- 只读端点拉追踪实体整图（该投影 + NoTracking）。
