# 项目布局（project-layout）

> 来源：Go 官方 "Organizing a Go module" / cc-skills-golang project-layout 篇（MIT）蒸馏；权威级：建议
> 最低 Go 版本：1.22 ｜ 核验日期：2026-10 ｜ 授权账本：`_sources.md`

## 默认骨架

```
myapp/
├─ go.mod
├─ cmd/
│  ├─ server/main.go        # 薄入口：装配 + run(ctx)
│  └─ migrator/main.go
├─ internal/
│  ├─ server/               # HTTP 层（handler/中间件）
│  ├─ store/                # 存储层
│  └─ app/                  # 多入口共享的业务核心
└─ README.md
```

- **main 薄**：`func main() { ctx := signal context; if err := run(ctx); err != nil { slog.Error(...); os.Exit(1) } }`
  ——业务零行（run 模式，见 cli-engineering 的退出码纪律）。
- **internal 是默认归属**：Go 编译器保证私有；`pkg/` 只在真实外部
  import 出现那天才建（不是仪式目录）。
- internal 层级即可见性：`internal/`（全应用共享）vs
  `internal/<app>/`（单入口私有）。

## 包组织判据

| 判据 | 规则 |
|---|---|
| 命名 | 名字表职责；util/common/helpers/misc 禁入 |
| 尺寸 | 不是首要判据——依赖方向清晰优先；单包 >5k 行考虑拆 |
| 拆分信号 | import 成环（不可能但会绕道三方）、测试互相依赖私有函数、改动总跨同批文件 |
| 方向 | handler → service → store 单向；反向依赖用接口反转（interface-design） |
| 数据 | 跨包 DTO 显式建模，不透传内部结构体 |

## import 分组

```go
import (
	"fmt"                            // 标准库
	"go.uber.org/goleak"             // 第三方

	"myapp/internal/store"           // 本项目
)
```

- 别名只在重名/文档必要性时；禁点导入（`_` 与测试的 `.` 例外）。

## monorepo 与 go.work

```
repo/
├─ go.work                 # 本地开发的 replace 层
├─ services/api/go.mod
├─ services/worker/go.mod
└─ libs/kit/go.mod
```

- 模块边界 = 独立发布/复用单元（不是目录美学）；go work use ./xxx
  注册本地模块。
- **go.work 不随发布**：库模块的 go.mod 不引用兄弟模块路径；CI 验证
  `GOWORK=off go build ./...` 保证无工作区也能构建。
- 共享库版本提升走模块版本语义（改 API → bump minor/主版本路径）。

## 新项目立项三问（先答再建目录）

1. 单二进制还是多服务？（决定 cmd 形态与是否 monorepo）
2. 谁是外部消费者？（决定 internal/pkg 边界）
3. 配置与密钥怎么注入？（决定装配层设计——见 cli-engineering 分层）

## 迁移路径（存量项目收敛）

- 大杂烩包按依赖方向逐文件迁移（不是一次性重构）；每步全量测试。
- cmd 里的业务逻辑下沉 internal/<domain>，main 只剩装配。
- 迁移 PR 独立于功能变更（评审面隔离）。
