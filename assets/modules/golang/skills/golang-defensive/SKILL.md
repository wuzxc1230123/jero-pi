---
name: golang-defensive
description: 防御性边界：API 输入输出切片拷贝、Must 函数只用于包初始化、panic/recover 仅限包内兜底、crypto/rand、时间类型纪律、可变全局禁令。当设计公开 API、写边界转换或兜底 recover 时使用。触发词：防御、边界、拷贝、panic、recover、typed-nil、全局状态。
---

# 防御性边界（Go）

管"把意外消灭在边界"：API 是契约，边界之外的一切不可信、边界之内的一切可维护。

> **相关技能：** 错误流策略 → `golang-errors`；切片底层与别名机制 → `golang-data-structures`；安全攻防全景 → `golang-security`。

## 何时使用

设计导出 API、写跨信任边界的数据转换（解析外部输入/序列化）、决定 panic 还是 error、写库的兜底 recover 时使用。

## 核心要点

- **切片是视图**：API 接收切片意味着调用方仍持有底层数组（可能并发改）；返回内部切片意味着内部状态可被外部改写——跨边界收发需要时显式拷贝（`slices.Clone`），文档声明所有权。
- **typed-nil 兜底**：`if err != nil` 之前先确认签名是 `error` 接口而非具体类型；包内返回 `nil, nil` 陷阱同理要防。
- **Must 函数**：`MustCompile` 类只在包初始化/常量数据上用（失败即程序员错误）；运行期数据永远走 error 返回。
- **panic/recover 边界**：库代码不 panic 出包边界——顶层 recover 转 error 是唯一合法形态（如 http handler 的兜底中间件）；panic 只用于"不可能状态"被打破，不用于可预期失败。
- **可变全局禁令**：包级可变状态是隐藏的并发耦合；配置用注入（参数/结构体字段），测试才可能隔离。标准库 `regexp.MustCompile` 的包级变量是只读的，不在此列。
- **时间纪律**：持续时长用 `time.Duration`、时刻用 `time.Time`、比较用 `time.Equal`（时区语义）；`time.Now()` 依赖注入，测试才可控。
- **随机数**：安全敏感（token/密钥/会话）一律 `crypto/rand`；`math/rand` 只用于模拟/测试数据。

## 红线

- 库向调用方 panic（可预期错误必须 error 返回）。
- 返回内部 map/切片引用导致状态泄漏且无文档声明。
- `math/rand` 生成任何安全敏感值。

## 深读指路（references/）

防御全文（边界拷贝矩阵/Must 纪律/recover 金样/时间与枚举）：`references/defensive-boundaries.md`。
