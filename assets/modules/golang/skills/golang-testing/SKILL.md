---
name: golang-testing
description: 测试工程：表驱动测试、t.Run 子测试与并行、失败信息含 got/want、cmp.Diff、t.Helper/t.Cleanup、测试组织与辅助函数。当写或评审 Go 测试时使用。触发词：测试、test、表驱动、t.Run、断言、覆盖率、testify、go test。
---

# 测试（Go）

管"测试是第一个消费者"：测试代码的可读性标准与生产代码相同，断言的是预期行为不是实现现状。

> **相关技能：** 基准与性能测量 → `golang-benchmark`；fuzz/泄漏检测等进阶面 → 本技能要点 + 深读；并发原语测试 → `golang-concurrency`；执行验证协议 → `golang-tester`。

## 何时使用

写新测试、评审测试质量、设计测试辅助函数、组织测试包时使用。

## 核心要点

- **表驱动优先**：case 表（name/input/want/err 想要匹配）+ `for _, tc := range cases` + `t.Run(tc.name, ...)`；case 加了就跑，不用复制粘贴函数；`t.Parallel` 提速时 case 直接引用（Go 1.22 起循环变量每轮独立，无需再 `tc := tc`）。
- **失败信息必须自证**：`got/want` 全打（`t.Errorf("got %v, want %v", got, want)`）；结构体用 `cmp.Diff`（`google/go-cmp`）——"不相等"三个字不叫失败信息。
- **错误断言**：哨兵用 `errors.Is(err, ErrX)`；无错误路径也要测（`err == nil` 不该是默认唯一断言）。
- **辅助函数纪律**：包装断言的 helper 必须 `t.Helper()`（失败行号指向调用处）；清理用 `t.Cleanup(fn)` 替代手工 defer 链；测试内 timeout 用 `t.Context()`（Go 1.24+，测试结束自动取消）。
- **组织**：`package foo`（白盒）与 `package foo_test`（黑盒）分层——导出面用黑盒测；测试文件与被测文件同目录；一个行为一个 case 名（`"negative input rejects"`）。
- **不测实现细节**：mock 换成真依赖能测就不 mock（文件系统用 `t.TempDir()`、时间注入 fake、HTTP 用 `httptest`）；mock 上限是边界外部的网络服务。
- **确定性**：随机注入 seed；时间注入；并发测试等待用 channel/`require.Eventually` 形态，绝不用 sleep 碰运气。

## 红线

- 断言不含 got/want、为通过弱化断言（先写 `t.Skip` 也不许静默删）。
- 测试之间共享可变状态（顺序依赖）。
- 测试内真 sleep 当同步、真网络调用（集成测试显式分组/tag 分离）。

## 深读指路（references/）

表驱动与组织全文：`references/testing-table-driven.md`；fuzz/goleak/覆盖率/ArtifactDir 进阶：`references/testing-advanced.md`。
