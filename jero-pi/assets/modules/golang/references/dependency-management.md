# 依赖管理（dependency-management）

> 来源：Go 官方 modules 文档 / cc-skills-golang dependency-management 篇（MIT）蒸馏；权威级：规范
> 最低 Go 版本：1.22 ｜ 核验日期：2026-10 ｜ 授权账本：`_sources.md`

## go.mod / go.sum 纪律

- go.sum 是所有传递依赖的校验和锁（防篡改），**绝不手编、绝不
  gitignore**。
- 升级/引入：`go get example.com/pkg@v1.2.3`；清理：`go mod tidy`
  （收尾必跑，清孤儿 require）。
- `go.mod` 的 `go` 指令 = 语言特性下限声明；`toolchain` 指令 = 构建
  工具链下限——两者与 CI 镜像同步升（漂移 = 环境分裂）。

## MVS（最小版本选择）

- 最终版本 = 依赖图中所有 require 该模块的**最高声明版本**——不是
  "最新发布"。谁把它抬上来的：`go mod graph | grep <pkg>`、
  `go why example.com/pkg`。
- 升级一个传递依赖：直接在 go.mod 显式 require（提升锚定），没有
  npm 式 override 概念。

## 主版本语义（/v2+）

- 不兼容主版本是**不同模块路径**：`example.com/pkg/v2` 的 import
  路径带版本后缀——升级 = import 改写 + API 迁移，不是数字游戏。
- 库作者：破坏性改动先复制包给过渡期（`/v2` 新路径），maintain 窗口
  写进迁移文档。

## replace / exclude

```go
// 本地开发（绝不提交）：
replace example.com/lib => ../lib

// fork 修复（须注释原因与退出条件）：
replace example.com/lib => github.com/me/lib v1.2.3-fix
```

- exclude 只绕已知坏版本，带 issue 链接注释。
- 发布前 `go mod edit -dropreplace` 巡检：CI 里
  `go list -m all` 校验无本地路径 replace。

## go.work（工作区）

- 本地多模块联调的 replace 层：`go work init ./api ./libs/kit`；
  `go.work` 与 `go.work.sum` 可提交（团队共享）但**发布不消费**
  （`GOWORK=off` 构建验证是 CI 必跑项）。
- 工作区之外的构建一致性是 go.mod 的责任——go.work 只是本地视图。

## vendoring

- `go mod vendor` 把依赖复制进 `vendor/`：构建环境不可信/离线 CI/
  需要审查依赖源码时用；vendor 目录与 go.mod 漂移即构建失败（好事）。
- 默认不用（module cache + 校验和已够）；用了就全团队统一用。

## 漏洞扫描与升级策略

```bash
govulncheck ./...        # 符号级：只报真实可达调用路径
go list -m -u all        # 可升级清单
```

- govulncheck 进 CI（定期 job）；升级第一、补偿记录第二（见
  security-architecture 的依赖面）。
- 小步升级：一次一个 minor，每步全量测试 + 关键基准
  （modern-go-versions 的剧本同样适用依赖）。

## 引入前四问

1. 标准库/slices/maps/cmp 能替代吗？
2. 维护活性：最近 release 时间、issue 响应、单维护者风险？
3. 传递面：`go mod graph` 展开后多大？cgo 依赖？
4. 许可：MIT/BSD/Apache-2 友好；GPL/AGPL 进库前过法务。

四问通过才 `go get`——每个依赖都是长期负债（安全面 + 升级面 +
许可面），最小化是默认策略。
