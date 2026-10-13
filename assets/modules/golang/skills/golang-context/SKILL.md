---
name: golang-context
description: context 惯用法：首参数约定、取消与超时传播、WithoutCancel、值的边界（只放请求域元数据）、不存入 struct。当写带 context 的函数签名、设计超时或传播取消时使用。触发词：context、取消、超时、deadline、WithTimeout、传值。
---

# context（Go）

管"取消是一等公民"：context 是调用链的退出协议，不是万能参数袋。

> **相关技能：** goroutine 生命周期消费取消信号 → `golang-concurrency`；HTTP 服务的 ctx 接线 → `golang-cli`；测试中的超时注入 → `golang-testing`。

## 何时使用

设计导出函数签名、设置超时/deadline、跨层传播取消、决定"要不要往 context 塞值"时使用。

## 核心要点

- **首参数约定**：`ctx context.Context` 永远是第一个参数、类型不省略；不接受 ctx 的导出函数要能说清为什么（纯内存计算可以，任何 IO 不可以）。
- **传播不替换**：调用下游用同一个 ctx 派生（`WithTimeout`/`WithCancel`），不用 `context.Background()` 掐断调用方取消——除非显式要"后台续命"，那用 `context.WithoutCancel`（Go 1.21+）保值去取消。
- **值只放请求域元数据**：trace ID、租户、认证主体这类横切数据；业务参数走函数参数——塞进 ctx 的业务值是隐式全局变量。
- **不存入 struct**：ctx 属于函数调用链，不作为结构体字段囤积（极少数框架型类型如 `http.Request` 是历史豁免，不是先例）。
- **超时给边界不给深处**：在发起 IO 的边界设 `WithTimeout`（通常也是清理 cancel 的地方），深处只检查 `ctx.Err()`；`defer cancel()` 紧跟派生。
- **检查取消**：长循环/批量处理逐批检查 `ctx.Err()` 或用 `ctx.Done()` select，让取消真正生效。

## 红线

- 导出的 IO 函数不带 ctx 参数。
- 用 `context.Background()` 替换传入的 ctx（掐断取消）。
- 业务参数走 context value；ctx 存结构体字段。

## 深读指路（references/）

context 全文（传播模式/派生矩阵/值边界案例）：`references/context-patterns.md`。
