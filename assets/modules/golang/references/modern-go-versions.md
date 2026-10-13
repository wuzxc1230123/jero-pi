# 版本现代化（modern-go-versions）

> 来源：go.dev 历版本 release notes（1.22–1.26）+ cc-skills-golang modernize 篇（MIT）蒸馏；权威级：规范
> 最低 Go 版本：1.26 ｜ 核验日期：2026-10 ｜ 授权账本：`_sources.md`

## go fix：现代化器体系（1.26 全面改版）

- `go fix ./...`：内置现代化器目录的统一入口——机械但语义级的迁移
  （不是纯文本替换）。
- 覆盖面（常见项）：`waitgroup`（Add/Done → wg.Go）、`loopclosure`
  （1.22 语义适配）、`builders`（字符串拼接 → Builder）、
  `efaceany`（interface{} → any）、`slicescontains`（手写循环 →
  slices.Contains）等；`//go:fix inline` 标记的 API 会被就地内联
  展开。
- **迁移剧本**：升工具链 → `go fix ./...` → 逐 diff 评审 →
  `go vet ./...` → 全量测试 → 关键基准对比（benchstat）→ 提交。
  go fix 输出不评审直接合入是红线。

## 逐版本要点（存量代码对照迁移）

| 版本 | 语言/工具 | 标准库 | 存量代码迁移点 |
|---|---|---|---|
| 1.22 | for 循环变量每轮独立；`for i := range n` | math/rand/v2、cmp.Or | 删 `tc := tc` 类拷贝；锁 rand 换 v2 |
| 1.23 | range over func 迭代器 | unique 包；timer GC 语义 | 循环 time.After 消除泄漏顾虑；迭代器替代返回 slice |
| 1.24 | 泛型别名 | os.Root；testing.T.Context；weak pointer | 路径锚定换 Root；t.Context 换手动 ctx |
| 1.25 | wg.Go | testing.Synthesize；textproto 编解码 | wg.Add/Done → wg.Go（go fix waitgroup） |
| 1.26 | new(expr)；自引用约束解禁；go fix 体系 | errors.AsType；slog.NewMultiHandler；simd（实验） | B.Loop 基准重测；多 handler 替代手写 fan-out |

## 1.26 运行时

- **Green Tea GC 默认**：GC 开销普遍降 10–40%（分配密集服务更明显）
  ——升级后基准基线整体重测（旧基线失效），部署参数（GOGC/
  GOMEMLIMIT）重新校准。
- goroutine 泄漏剖析（实验）：`GOEXPERIMENT=goroutineleakprofile`
  构建后 profile 可归因创建点。
- `net/url` 解析收严：依赖历史宽松解析的代码（怪协议/空 host）在
  1.26 升级批重点回归。

## go.mod 版本策略

- `go` 指令 = 团队最低可接受版本（不是本地最新版）；升它是一次
  显式决策（启用新特性的前提）。
- `toolchain` 指令与 CI 基础镜像同批升；本地 `go` 版本不匹配时由
  toolchain 自动下载对齐（版本分裂的终结机制）。

## 升级剧本（每 minor 一次）

```
1. 升 toolchain（本地实验）→ go.mod 的 go/toolchain 同步
2. go fix ./... → 评审 diff → go vet → 全量测试（-race）
3. benchstat 对比（1.26 批基线必重测——B.Loop 内联语义变了）
4. CI 镜像与所有开发者环境同步（版本漂移 = 环境分裂）
5. 依赖批升级另开 PR（Go 版本与依赖版本不混批）
```

- 跨多个 minor 的大跃进只允许在"无法逐级构建"的历史包袱场景，
  且每跳级全量验证。
- 新特性进入代码的门槛是"解决真实问题"（wg.Go 消灭配对失误✓；
  "新"本身✗）——手法细节回各领域篇（benchmark-measurement /
  performance-playbook / concurrency-goroutines）。
