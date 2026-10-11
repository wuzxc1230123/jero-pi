# 三道门验证协议（verification-gates）

> 来源：本仓原创（协议形态对齐 godot 模块 references/verification.md）；权威级：项目纪律
> 最低 Go 版本：1.22 ｜ 核验日期：2026-10 ｜ 授权账本：`_sources.md`

## 协议（按序，前门不过后门不开）

```
门 1  gofmt -l .              → 输出必须为空（列出的是未格式化文件）
门 2  go vet ./...            → 退出码 0
门 3  go test ./...           → 退出码 0；并发改动追加 go test -race ./...
```

- **结论只认退出码与产物**："编译通过"不是验证、"看起来没问题"
  不是验证、"我机器上是好的"不是验证。
- 门 3 的命令是模块 `config.testCommand` 钉住的 `go test ./...`
  ——SDD Strict TDD 转发取值链的第一级（覆盖层 → config → 探测），
  项目内改测试命令走配置覆盖，不改协议。

## 各门的职责边界

| 门 | 抓什么 | 抓不了什么 |
|---|---|---|
| gofmt | 格式漂移 | 一切语义 |
| go vet | 可疑构造（printf 动词/锁拷贝/不可达分支） | 逻辑错误 |
| go test | 行为回归 | 未写测试的行为 |
| -race | 数据竞争 | 逻辑性并发错误（死锁的一部分） |
| golangci-lint（可选） | 风格/复杂度横切面 | 已过前三门的问题不重复报 |

golangci-lint 在项目已配置时顺带运行；**未配置不自行安装**——验证
协议不引入新依赖（工具面纪律见 tooling-guide）。

## 留证形态

- 验证报告逐门记录：命令、`go version`、退出码、关键输出摘录。
- 失败时的最小失败包名/测试名定位到行；`NOT VERIFIED`（工具链不可
  用/环境不符）与 FAIL 是不同结论，绝不混用、绝不伪装通过。
- "跑起来看一眼"：行为可见的变更（CLI 输出/服务响应）截图或输出
  摘录入验证产物——`t.ArtifactDir`（1.26+）是测试侧的标准去处
  （testing-advanced）。

## 与仓库既有验证回路的衔接

- 模块束自身（本目录）随 jero-pi 包一起被 `check:module-contract`
  门校验（库绿灯）；Go 项目的三道门是**目标项目**的验证协议，
  两者作用域不同。
- 评审侧：Go 变更的评审委派 `golang-reviewer`；验证执行委派
  `golang-tester`（本协议的执行者）；SDD 阶段的 Strict TDD 转发
  取 `config.testCommand` 钉住值。
- 测试进程环境纪律（不设 `GIT_*`）是宿主仓库侧约束，不因模块安装
  而改变。

## 变更→验证强度对照

| 变更面 | 最低验证 |
|---|---|
| 纯注释/文档 | 门 1 |
| 单包内部逻辑 | 门 1–3 |
| 并发结构（goroutine/channel/锁） | 门 1–3 + race + goleak（若有） |
| 公共 API/接口 | 门 1–3 + 表驱动覆盖新行为 |
| 性能声明 | 门 1–3 + benchstat 对比（benchmark-measurement） |
| 依赖变更 | 门 1–3 + govulncheck（dependency-management） |
