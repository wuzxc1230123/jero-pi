---
name: dotnet-efcore
description: EF Core 模式：NoTracking 默认、查询拆分防笛卡尔积、投影优先于实体装载、迁移纪律与 DbContext 生命周期。当写 LINQ 查询/管迁移或评审数据访问代码时使用。触发词：EF Core、DbContext、LINQ、查询、迁移、migration、N+1、AsNoTracking。
---

# EF Core 数据访问

EF Core 的性能与正确性都在查询形状里：追踪什么、装载什么、何时拆分——默认值适合 CRUD 应用，不适合一切。

> **相关技能：** DI 生命周期（DbContext 注册） → `dotnet-di`；异步纪律 → `dotnet-async`；配置绑定 → `dotnet-configuration`。

## 何时使用

写/评审 LINQ-to-Entities 查询、管理迁移、设计 DbContext 划分与生命周期时使用。

## 核心要点

- **追踪分层**：只读路径 `AsNoTracking()`；更新走变更追踪；`AsNoTrackingWithIdentityResolution` 在有关联重复的只读图里省解析。全局默认查 `QueryTrackingBehavior` 配置（按需再开追踪）。
- **投影优先**：`Select(x => new Dto { … })` 只取所需列——不 `Include` 整图再丢弃；`ExecuteUpdate`/`ExecuteDelete`（批量 DML）绕过追踪做 Set 式更新。
- **集合导航拆分**：多个 `Include` 集合导航 = 笛卡尔积；`AsSplitQuery()` 拆成多条（注意非原子一致性）；单集合导航可接受，双集合必拆。
- **迁移纪律**：一个变更一个迁移（可回滚审读）；自动迁移进生产是红线；迁移与模型快照同 PR；`dotnet ef migrations has-pending-model-changes` 查漂移。
- **DbContext 生命周期**：scoped（每请求）为铁律——unit-of-work 短事务；跨请求缓存实体改存 DTO；`DbContextFactory` 服务于线程池/后台任务（`IDbContextFactory<T>`）。
- **异步全链**：`ToListAsync`/`FirstOrDefaultAsync`；客户端求值（`AsEnumerable` 后的 LINQ）要显式且有理由——那是把数据拉到内存再算。
- **防注入**：`FromSqlInterpolated` 参数化内建；`FromSqlRaw` 拼接是红线。

## 红线

- 循环内懒加载/查询（N+1）与循环内 `SaveChanges`（该批量或事务收口）。
- `DbContext` 单例注册或被多线程共享。
- 迁移跳过快照直接改库（模型与迁移漂移）。

## 深读指路（references/）

查询/追踪/迁移全谱与测试面（SQLite/InMemory 差异/Testcontainers）：`references/efcore-patterns.md`。
