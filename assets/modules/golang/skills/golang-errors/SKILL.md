---
name: golang-errors
description: 错误处理：策略选择（哨兵/类型/不透明）、%w 与 %v 包装、错误只处理一次、errors.Is/As 与 AsType、panic 边界。当编写返回/包装/处理错误的代码或设计错误 API 时使用。触发词：错误、error、%w、包装、errors.Is、errors.As、哨兵错误。
---

# 错误处理（Go）

管"errors are values"：错误是返回值不是异常——策略化地决定每个错误的命运。

> **相关技能：** 日志与错误的交界（记日志即处理）→ `golang-logging`；panic/recover 边界 → `golang-defensive`；错误语义测试 → `golang-testing`；错误命名（ErrXxx）→ `golang-naming`。

## 何时使用

写任何返回 error 的函数、决定包装方式、设计可被调用方匹配的错误 API 时使用；评审错误流时同样适用。

## 核心要点

- **策略四步**：① 系统边界（RPC/存储/IPC）→ `%v` 包装防内部泄漏；② 调用方需匹配 → 哨兵 `var ErrXxx` 或自定义类型，配 `%w`；③ 只需调试上下文 → `fmt.Errorf("doing x: %w", err)`；④ 叶子函数 → 直接返回。
- **默认动作是包装**：`fmt.Errorf("...: %w", err)`，`%w` 放句尾、加调用方没有的上下文；不加上下文的包装不如直接返回 `err`。
- **匹配**：`errors.Is`（哨兵）/ `errors.As`（类型）；Go 1.26 起泛型 `errors.AsType[T]` 免声明目标变量。字符串比较 `err.Error() ==` 永不。
- **只处理一次**：要么返回要么记日志，绝不双做（log-and-return 是把决定权偷走两次）；`_` 丢弃必须带注释豁免。
- **导出签名只写 error**：返回具体类型 `*MyError` 会造 typed-nil 接口陷阱（nil 具体指针 != nil 接口）。
- **错误串**：小写开头、无结尾标点；展示层（UI/日志摘要）再人性化。
- **不做 in-band 错误**：不用 `-1`/`nil` 表失败，用 `(T, error)` 或 `(T, bool)`。

## 红线

- exported 函数返回具体错误类型。
- 同一错误既 log 又 return。
- `err.Error()` 字符串匹配、错误信息大写开头带句号。

## 深读指路（references/）

错误全文（策略决策树/包装矩阵/哨兵与类型设计/边界案例）：`references/error-handling.md`。
