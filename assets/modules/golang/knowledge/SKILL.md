---
name: golang
description: Go 工程领域知识入口：语言惯例、并发纪律、验证主干（go vet/gofmt/go test）与领域评审关注点的指路与硬约束。当仓库含 go.mod 或 .go 文件、任务涉及 Go 开发时使用。触发词：Go、Golang、goroutine、channel、切片、并发、泛型、go.mod、go test、gofmt、golangci。
---

# Go 工程（模块知识入口，L1）

本文件是 golang 模块的知识入口：注册表与派发覆盖层消费的都是它。深度
知识一律住 references（L2，按需读），本入口只做指路与硬约束。知识锚定
Go 1.25/1.26，逐篇出处与授权账本见 `_sources`。

## 知识指路（L2，references/ 按需读）

- 语言与风格：`style-and-formatting`（清晰度优先级与 gofmt 纪律）、`naming`（命名决策树）、`declarations-scope`（声明/初始化/遮蔽）
- 错误与防御：`error-handling`（错误策略/%w 包装/只处理一次）、`defensive-boundaries`（API 边界防御与 panic 纪律）
- 并发：`concurrency-goroutines`（生命周期与泄漏）、`concurrency-channels`（channel 所有权与 select）、`sync-primitives`（mutex/atomic/once/waitgroup）、`context-patterns`（取消传播与取值边界）
- 类型与数据：`interface-design`（消费方接口与编译期断言）、`generics-constraints`（何时泛化与 constraint）、`slices-maps-internals`（切片/映射底层与选型）
- 测试与测量：`testing-table-driven`（表驱动与失败信息）、`testing-advanced`（fuzz/goleak/覆盖率）、`benchmark-measurement`（b.Loop/benchstat 方法论）
- 性能与排障：`pprof-profiling`（剖析定位）、`performance-playbook`（热路径优化手册）、`troubleshooting-bugs`（症状→根因目录）
- 安全：`security-injection-crypto`（注入与密码学红线）、`security-architecture`（威胁建模与依赖面）
- 工程化：`logging-slog`（结构化日志与脱敏）、`project-layout`（cmd/internal/pkg 约定）、`dependency-management`（go.mod/MVS/vulncheck）、`cli-engineering`（退出码/信号/输出纪律）
- 版本与验证：`modern-go-versions`（1.22→1.26 迁移与 go fix）、`verification-gates`（三道门协议）
- 元：`tooling-guide`（gopls/golangci-lint 等工具选型，含 gopls MCP 事实核验——接线与工作流见 `golang-mcp` 技能）、`_sources`（出处账本）

## 硬约束

- 验证走 CLI 退出码：`gofmt -l .` 输出为空、`go vet ./...` 退出码 0、
  `go test ./...` 退出码 0 是最低门槛（三道门协议见 `verification-gates`）；
  "编译通过"不等于"行为正确"，并发改动必须 `-race` 留证。
- 模块 `config.testCommand` 钉住 `go test ./...`——SDD Strict TDD 转发
  的唯一来源；测试进程不设任何 `GIT_*` 环境变量的仓库纪律不因模块改变。
- 错误只处理一次（要么返回要么记日志，绝不双做）；exported 函数绝不
  返回具体错误类型（typed-nil 陷阱）。

## 委派路由

- 评审 Go 变更：追加委派 `golang-reviewer`（只读，报告发现不修复）。
- 验证执行（vet/fmt/test/race、表驱动脚手架、benchstat 对比）：委派
  `golang-tester`（有界写者，产验证报告）。
- 包结构/接口边界/并发模型选型设计：建议 `golang-architect` 产设计提案。
- 执行实现：直接使用 `jero-worker`——本入口注入的惯例随之生效，
  禁止另做与 `jero-worker` 同角色的语言执行代理（孤儿代理）。
