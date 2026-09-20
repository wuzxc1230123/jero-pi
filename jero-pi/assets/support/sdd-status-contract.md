# SDD 状态与动作上下文契约

供 Gentle Pi 的 SDD 各阶段共享的 OpenSpec 风格契约。在对变更采取行动之前先使用本契约，使编排（父会话）与各执行器无需猜测状态、路径或编辑范围。

## 目的

任何对 SDD 变更进行选择、继续、应用、验证、同步或归档的阶段，都必须先产出或消费结构化状态。该状态是父编排器（父会话）与阶段执行器之间的交接物。

## 变更选择

- 若已提供变更名，在确认其存在于所选产物存储中之后，使用该确切变更。
- 若未提供变更名，仅当从会话状态看活跃变更无歧义、或恰好只有一个活跃变更时才可推断。
- 若多个活跃变更匹配或活跃变更不明确，请让用户选择。绝不猜测。
- 若不存在活跃变更，报告当前没有活跃的 SDD 变更，并建议发起一个。

## 原生引擎

- 进程内权威的 `gentle-ai.sdd-status/v2` 投影（由 `/jero-sdd-status` 渲染）是所有存储的唯一状态权威。它是只读的：原样检查其原生投影，读取期间绝不发起阶段、准备同意或授予根权限。
- 若原生状态不可用、格式错误，或未选中请求的变更/工作区，停止并报告该失败。绝不构造本地状态、从产物推断就绪度、顶替继续流程，或经由 Engram 绕过它。
- `nextRecommended`、`dependencies`、`blockedReasons`、`actionContext` 与可选的 `phaseInstructions` 是生产者事实。仅依据其类型化值路由，绝不依据自然语言描述或本地生命周期图路由。真实阻塞项的人类可读解释属于 `blockedReasons`；非阻塞诊断属于 `notes`；两者都不属于 `nextRecommended`。
- 运行时尝试权威独立于状态：托管修复启动由包运行时在进程内以 acquire/settle 方式包裹（按 `proceed`、`blocked` 或 `complete` 路由）；apply/verify 的单飞（single-flight）经由同一权威投影强制执行。
- 仅显式授权的 `/jero-sdd-continue` 可以解决继续流程；它按同一投影路由，且不授予任何源码根权限。

## Bounded Planning Routing

For authoritative native status, route only by the bounded `nextRecommended` token and dependency states; never infer a route from prose. Keep genuine blockers in `blockedReasons` and non-blocking diagnostics in `notes`, never in `nextRecommended`, and report them without discarding them to enable a route.

| `nextRecommended` | Planning route |
| --- | --- |
| `propose` | `sdd-proposal` |
| `spec` | `sdd-spec` |
| `design` | `sdd-design` |
| `tasks` | `sdd-tasks` |

Native unprefixed tokens are the only automatic planning routes. Prefixed or locally derived status tokens never authorize a phase.

These planning routes remain runnable when missing planning artifacts leave `dependencies.apply: blocked`; do not require apply readiness to produce those artifacts. This is a planning-only exception, not permission to run apply or another blocked non-planning phase.

Before any planning launch, stop for ambiguous change selection, unresolved session preflight, or unsafe action context. Carry `actionContext` and prove planned writes are within the authoritative workspace or allowed edit roots; workspace-planning without allowed edit roots remains read-only. Planning does not bypass the init guard, pre-proposal gate, or phase approval requirements.

## 有界执行路由

| 原生 `nextRecommended` | Pi 执行器 |
| --- | --- |
| `apply` | `sdd-apply` |
| `verify` | `sdd-verify` |
| `remediate` | `sdd-remediate` |
| `archive` | `sdd-archive` |

仅执行依赖与 `actionContext` 均已允许的原生选中动作。未知、格式错误、阻塞或不支持的动作在工作开始前停止；任何本地路由、带前缀 token 或自然语言描述都不能替代它们。`notes` 独立于 `blockedReasons` 且绝不充当门控：将非空 `notes` 值作为信息性内容报告，并在依赖与 `blockedReasons` 门控允许时继续。Manual `sdd-sync` remains its intentional local resolver，且绝不由原生状态自动派发。

## 状态 Schema

无损地消费原生 v2 投影（`schemaName: gentle-ai.sdd-status`，`schemaVersion: 2`）。其生产者定义的变更选择、产物定位符、任务进度、七项依赖、`actionContext`、`blockedReasons`、可选的执行说明、修复状态与 `nextRecommended` 都是状态事实，而不是需要 Pi 重建的 schema。

## 动作上下文守卫

编排器（父会话）必须将 `actionContext` 携带进任何阶段启动。

- 若 `mode: workspace-planning` 且 `allowedEditRoots` 为空，则在编辑、验证实现归属、同步规格或归档之前停止。将链接的仓库与目录视为只读的规划上下文。
- 若存在 `allowedEditRoots`，仅在这些根之内编辑或移动文件。
- 若某阶段无法证明文件位于权威工作区或允许编辑根之内，停止并请求澄清。

## 原生运行时尝试权威

紧凑的 SDD 运行时尝试权威独立于产物派发与状态。它与产物存储无关：同一套 acquire/settle 纪律适用于 `openspec`、`engram`、`both` 与 `none` 存储。其载荷绝不能嵌入上面的 SDD v1 状态 schema；状态只报告产物状态，绝不报告尝试 token 或尝试计数器。Pi 不得创建或镜像任何 OpenSpec 或 Engram 尝试台账。

托管修复启动由包运行时自动以 acquire/settle 方式包裹（进程内，无 CLI）：权威从 `proceed|blocked|complete` 中返回恰好一个路由状态——仅在 `proceed` 时启动，在 `blocked` 或 `complete` 时停止——运行结束后由运行时结算。`sdd-apply` 与 `sdd-verify` 不做尝试包裹；编排器（父会话）通过权威状态投影强制其单飞：一个变更绝不同时存在两个承载运行时的 actor，绝不发起状态不接纳的启动。`reset` 绝不自动执行，需要维护者显式的范围决策。

关于精确的紧凑 acquire/settle 形态与完整字段语义，见懒加载的 `SDD Orchestrator Workflow` 契约中的 `Native Runtime Attempt Authority` 小节。不要在运行时查找 `assets/...` 路径；那些是安装前的包源码路径。

## 状态输出

任何作用于变更的命令或代理，在进行阶段工作之前都必须展示或消费状态：

- 活跃变更的选择及其解析方式；
- 作为上下文使用的产物状态与路径/主题；
- 存在任务时的任务进度与未勾选任务列表；
- 下一个推荐动作；
- 任何 `actionContext` 或编辑根警告。
