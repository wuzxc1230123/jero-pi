# jero-pi 技术参考

jero-pi 是一个 Pi coding-agent 扩展包：评审权威、SDD/OpenSpec 编排、子代理、持久记忆与 shell 层——全部进程内 Node 实现，零原生二进制、零安装期网络。

Requires Pi 0.85.1 or newer (the tested minimum for `agent_settled`).（要求 Pi ≥ 0.85.1，即经测试验证的 `agent_settled` 最低支持版本。）

> 标注为 **契约锚点** 的英文句子被测试逐字钉住（`tests/package-manifest*.test.ts`、`tests/review-authority-recovery-docs.test.ts`、`tests/skill-collision-prefixes.test.ts`、`tests/jero-ai.z3.test.ts`），改动它们必须同步改测试。

## 架构

- **进程内评审权威**（`lib/authority/`）：START → 同意 → relay 评审视角 → 冻结/分类 → 纠正（计划 + 派生的有界编辑）→ 定向校验 → 确认销毁 → 维护。状态存于 `.git/jero-review/`（CAS 对象、lineage 记录、候选视图），随仓库走。
- **Pi 宿主 relay**（`lib/review-host-relay.ts`）：渲染权威方的审查员/角色提示并运行锁定的 pi 子进程；准入始终在进程内。跨进程握手 `gentle-pi.review-relay/v1` 已按设计删除。
- **客户端契约**（`lib/authority/client-contract.ts` + `wire-contract.ts`）：wire 词汇由迁移后的黄金向量（`tests/fixtures/review-integration/`）字节钉住；这些 schema 字符串有意在身份迁移中保留。
- **持久记忆**（`lib/memory.ts` + `mem_save`/`mem_read`/`mem_list`/`mem_search`）：topic 键文件，存于记忆根目录。
- **精益纪律**（`lib/jero-ai-lean.ts` + `skills/jero-lean*`、`jero-debt`）：借自 ponytail 的提示词层代码极简梯子，按会话模式只注入主会话。绝不接触评审权威、委派传输或任何生命周期状态；`off` 逐字节还原历史行为。
- **Agents 编排**（`lib/agents-*.ts` + `extensions/jero-agents.ts`）：pi RPC 子代理，单父编排，每任务 token/成本核算，全屏视图。
- **Shell 层**（`lib/shell-*.ts` + `extensions/jero-shell.ts`）：状态栏、侧栏、变更小部件与 diff 视图、订阅用量窗口。
- **运行时指标**（`lib/runtime-metrics*.ts`）：纯内存、无外发；按模型/提供商/档位/代理类聚合 token 与成本。

## 身份（jero 命名空间）

| 面 | 值 |
|---|---|
| 命令 | `/jero:*`（status/review-mode/persona/profiles/models/usage/doctor/agents/changes/background-subagents/review-session-permission/lean/sdd-preflight/banner*/toggle*/install-*）、`/jero-sdd-*` 流程。评审生命周期动词（`inspect`/`start`/`answer-consent`/`assess`/`finalize`/`validate`）是 `jero_review` 工具操作，不是斜杠命令 |
| 环境变量 | `JERO_PI_*`（AGENT_HOME 兼容 `PI_CODING_AGENT_DIR`；`JERO_PI_LEAN_MODE` 为会话精益档位提供初始值） |
| 配置主目录 | `~/.pi/jero/`（全局）、`<repo>/.pi/jero/`（项目）、`<repo>/.jero/policies/`（评审策略） |
| 契约 | `jero.session-change/v1`、`jero.session-worktree/v1`、`jero.child-standing-review-permission/v1`、`jero.background-subagents/v1`、`jero.agent_model_profiles/v1`、`jero.verify-result/v1`、`jero.authority/v1`、`jero.lean-mode/v1`（会话条目 `{mode}`） |
| 技能 / 资产 | `jero` + `jero-*` 技能名；`agents/jero-{explore,verify,worker}.md`；`jero/support/*` |

## 评审视角选择（Review Lens Selection）

`review-risk`、`review-reliability`、`review-resilience`、`review-readability` 是评审视角（review lens）词汇。静态编排器与本参考从不选择、调用、排序或重试这些视角；任何适用的运行时只使用其动态提供的指令。

## 评审权威操作

评审控制器工具（`jero_review`)拥有生命周期；捕获槽位经 `jero_review_capture` 以恰好一个当前 collect binding 运行。Review outcomes and receipt state are informational; commit, push, pull-request, and release delivery follow ordinary repository policy.（评审结果与回执状态只作信息展示；commit、push、PR、发布等交付遵循普通仓库策略。）

Maintenance is explicit, audited, and fail-closed headless: RESET and RECOVER stay destructive, audited last resorts; every refusal answers in typed envelopes.（维护是显式、经审计、无头时保守失败的：RESET 与 RECOVER 仍是破坏性的、经审计的最后手段；每次拒绝都以 typed envelopes 应答。）

- **abandon** — 需要 lineage、expectedRevision、snapshotIdentity、capturedLensResults、findingsPresent、actor、reason；派生并展示精确的八字节授权绑定，供全新的交互式 UI 批准。
- **reclaim** — 以破坏性方式隔离卡死的权威目录（带隔离名的审计记录）。
- **recover** — 恰好六个输入：predecessorLineage、expectedPredecessorRevision、successorLineage、disposition、actor、reason；绝不吃 reset challenge，绝不吃 maintainerAuthorization。
- **reconcile-authority** — predecessor lineage and revision, plus successor lineage and revision（前驱 lineage 与 revision，加上后继 lineage 与 revision）；the exact seven-line binding with optional `anomalies=unchanged_target,malformed_recovery_authorization` in that exact order（精确七行绑定，可选 anomalies 按此精确顺序）。It may quarantine only the bound invalid compact-v2 recovery successor; the predecessor stays untouched.（只可隔离绑定的那个非法 compact-v2 恢复后继；前驱保持原样。）The model supplies only lineage, actor, and reason（模型只提供 lineage、actor、reason）——每个绑定都是派生的，展示给 fresh interactive approval（全新的交互式批准），无头时拒绝。

`review dispose-result` is unsupported pending design（尚无设计，不支持）。The legacy quarantine-legacy and alias-repair routes are retired（legacy quarantine-legacy 与 alias-repair 路由已退役）：jero-pi 存储绝不携带 legacy 权威（外来的 `gentle-ai/reviews` 与 `gentle-ai/review-transactions` 存储会被探测并拒绝）。

## 动态 RDD 归属

**契约锚点**：jero-pi dynamically supplies runtime-specific RDD instructions; the static orchestrator prompt does not define an RDD lifecycle.（jero-pi 在运行时动态提供运行时专属的 RDD 指令；静态编排器提示词不定义 RDD 生命周期。）Dangerous-command safety remains independent and authoritative.（危险命令安全保持独立且权威。）

托管代理经包管理的隔离安装（package-managed isolated installation，`<agent-home>/jero/managed-assets.json`，哈希可证）安装；Project and user overrides may shadow a package asset（项目与用户覆盖可遮蔽包资产），上游命名空间的改名只迁移未被触碰的包自有副本，始终保留用户编辑与路由。

## 精益纪律（Lean discipline)

精益模式（`/jero:lean status|off|lite|full|ultra`，或独立输入短语 "stop lean"）控制代码极简梯子注入主会话系统提示的强度。每次代理启动的解析顺序：会话条目（`jero.lean-mode/v1`，最近一条合法者获胜）> `JERO_PI_LEAN_MODE` > `full`。注入发生在 `before_agent_start`，与 persona/编排器提示词并列，绝不触达具名/SDD 代理——worker 经既有的任务上下文传输获得纪律，本特性不改写该通道。梯子管代码必要性，与 400 行评审切片预算正交（预算绝不是代码高尔夫）。`skills/jero-lean-review`（diff 级精益评审）与 `skills/jero-debt`（`jero:` 标记台账，含 `ceiling:`/`upgrade:` 与 no-trigger 标注）是只读伴随物，独立于 `jero_review` 权威。`benchmarks/`（不随包发布）经 `JERO_PI_LEAN_MODE` 度量各臂表现。

## 技能名（Skill names）

**契约锚点**：Treat former package names such as `branch-pr`, `judgment-day`, and `skill-creator` as legacy aliases in prose only; runtime skill selection should use the prefixed `jero-branch-pr`, `jero-judgment-day`, `jero-skill-creator`, and sibling `jero-*` names.（旧包名如 `branch-pr`、`judgment-day`、`skill-creator` 仅在行文中作为 legacy 别名；运行时技能选择应使用带前缀的 `jero-branch-pr`、`jero-judgment-day`、`jero-skill-creator` 及同族 `jero-*` 名。）

| 目录 | 技能名 | 用途 |
|---|---|---|
| `jero-ai` | `jero` | harness 纪律：澄清、OpenSpec、严格 TDD、委派触发、评审负载 |
| `jero-lean` | `jero-lean` | 七级梯子、懒惰边界、`jero:` 标记、模式参考 |
| `jero-lean-review` | `jero-lean-review` | diff 级精益评审（delete/stdlib/native/yagni/shrink 标签） |
| `jero-debt` | `jero-debt` | `jero:` 标记债务台账（no-trigger 标注） |
| `judgment-day` | `jero-judgment-day` | 对抗式盲双评审（显式触发） |
| `rdd-defect-workflow` | `jero-rdd-defect-workflow` | 回执驱动开发缺陷流程 |
| `branch-pr` / `chained-pr` | `jero-branch-pr` / `jero-chained-pr` | PR 创建 / 400 行预算链式 PR |
| `work-unit-commits` | `jero-work-unit-commits` | 工作单元提交规划（预算不是代码高尔夫） |
| `skill-creator` / `skill-improver` / `skill-registry` | `jero-skill-creator` / `jero-skill-improver` / `jero-skill-registry` | 技能创建/改进/注册表维护 |
| `cognitive-doc-design`、`comment-writer`、`issue-creation`、`release` | 同名加 `jero-` 前缀 | 文档、评论、issue、发布 |

## 供应链

六个伴生依赖全部精确钉版；`@earendil-works/pi-tui` 是 `"*"` peer（宿主捆绑 pi-tui/pi-ai/pi-agent-core 核心族；测试向经测试的宿主钉 0.85.1）。伴生经 `pi` 清单中的 `node_modules/` 资源引用加载——这是宿主文档化的 pi-package 依赖契约；缺失路径静默跳过，因此"安装即可用"成立且无需包装层。任何东西都不打包捆绑：pi-pretty 与 pi-lens 携带平台专属原生依赖，必须经宿主的 `npm install` 按平台解析；`dependencies` 中的精确钉版管最终解析版本。伴生级关闭开关是 Pi 设置层的包/资源过滤（外加 pi-pretty 自身的 `PRETTY_DISABLE_TOOLS`）。`pnpm-workspace.yaml` 强制发布龄期、信任不降级、无非常规子依赖来源；lockfile 入库；CI 重跑依赖审计与打包工件断言（`scripts/verify-package-files.mjs`）。
