# jero-pi 技术参考

本文档由当前代码状态生成（2026-09，对应 `refactor/jero-ai-split` 分支）。jero-pi 是面向 Pi coding-agent 的扩展包：评审权威、SDD/OpenSpec 编排、子代理、持久记忆、精益纪律与 shell 层——全部进程内 Node 实现，零原生二进制、零安装期网络。

要求 Pi ≥ 0.85.1（`peerDependencies` 钉定；0.85.1 为 `agent_settled` 事件经测试验证的最低版本）。

## 架构分层

```text
Pi 宿主（@earendil-works/pi-coding-agent ≥0.85.1，peer）
├─ 扩展层 extensions/（8 个文件，~5k 行）
│   jero-ai · jero-agents · jero-memory · jero-shell ·
│   runtime-metrics · sdd-init · skill-registry · startup-banner
├─ 领域层 lib/（162 个文件，~46.8k 行）
│   authority/（进程内评审权威，43 个文件 ~14k 行）· review-* · agents-* ·
│   shell-* · sdd-* · jero-ai-lean · jero-ai-context-monitor · jero-ai-bootstrap · jero-ai-sdd-guard · memory · runtime-metrics*
├─ 伴生插件（dependencies 精确钉版，经 pi 清单加载）
│   pi-pretty · rpiv-ask-user-question · rpiv-todo · billion-context-pi ·
│   pi-cache-optimizer · pi-fovea · pi-hashline-edit-pro · pi-lens · pi-web-access
└─ 系统边界（仅 git / gh(可选) / pi 自身三类外部进程）
```

- **进程内评审权威** `lib/authority/`：13 个持久状态，15 个 wire 状态投影；不变量——透镜只跑一次、冻结发现与创世范围不变、恰一次有界纠正（预算 `min(200, ceil(原始变更行/2))`）、actor 产物（模型输出）永远是无信托数据。存储在 `.git/jero-review/`（CAS 对象 + lineage 记录 + 候选视图），随仓库走。`scripts/check-authority-boundary.mjs` 结构性强制 authority 不 import 扩展层、不做 IO/env 读取。
- **宿主 relay** `lib/review-host-relay.ts`：渲染权威方审查员提示 → `--agent pi --materialize` → 锁定 print-mode pi 子进程在只读工作树评审 → 原始字节经 provider 提交令牌回交；任何失败都是 typed transport error，不重试、不合成。
- **黄金向量** `tests/fixtures/review-integration/`：68 个字节钉住向量（SHA-256 由 `scripts/verify-package-files.mjs` 校验），是 authority 一致性测试的行为规范。

## 命令（22 个斜杠命令）

| 组 | 命令 |
|---|---|
| 状态与诊断 | `/jero:status` `/jero:doctor` `/jero:guard` `/jero:banner` `/jero:banner-color` `/jero:toggle-rose` `/jero:toggle-text-logo` |
| 精益纪律 | `/jero:lean`（status\|off\|lite\|full\|ultra；输入 "stop lean" 亦可关闭） |
| 评审 | `/jero:review-mode`（RDD 开关）`/jero:review-session-permission`（status\|revoke）`/jero:changes` `/jero:usage` |
| 子代理与模型 | `/jero:agents` `/jero:models` `/jero:profiles` `/jero:persona` `/jero:background-subagents` |
| SDD | `/jero:sdd-preflight` `/jero-sdd-init` `/jero-sdd-status` `/jero-sdd-continue` `/jero:install-{delegation,review,sdd}` |
| 技能 | `/skill-registry:refresh`；另有 `prompts/agents-init.md`（`/agents-init`）与 `prompts/skill-creation.md` 两个随包 prompt 模板 |

评审生命周期动词（`inspect`/`start`/`answer-consent`/`assess`/`finalize`/`validate`/`select-intended-untracked`/`export`/`import`/`recover` 等）是 `jero_review` 工具操作，不是斜杠命令。`inspect` 在候选干净就绪（passive 风险且 authored 行数 ≤10）时附加建议性字段 `triviality_hint`：提示可先与用户确认是否值得走完整评审，只读的 `assess` 是轻量替代；该字段不参与任何状态转移。

## 工具

- `jero_review`（控制器）、`jero_review_capture`（单捕获槽）、`jero_review_capture_group`（有序并发审查组）、`jero_review_scope`（冻结范围只读分页）
- `mem_save` / `mem_read` / `mem_list` / `mem_search`（持久记忆）
- `subagent_list_agents` / `subagent_run` / `subagent_status` / `subagent_reconcile` / `subagent_result` / `subagent_list_tasks` / `subagent_reply` / `subagent_cancel` / `subagent_send_message`
- `session_worktree_register`（会话工作树注册）

## 评审生命周期

START → 同意（consent 仪式 v3，host 常任权限按 Git 规范身份授予、可撤销）→ relay 评审视角（risk / reliability / resilience / readability，只跑一次）→ 冻结/分类 → 纠正（计划 + 恰一次有界编辑，diff 行计量：一行替换 = 一删一加）→ 定向校验（passed / verification_failed / procedural_tooling_failed）→ 确认销毁 → 维护（abandon / reclaim / recover / reconcile-authority，全部派生授权绑定 + 交互式批准，无头保守失败）。发布门 `review-publication-gate` 独立于交付：commit/push/PR 遵循普通仓库策略。

## 精益纪律（lean discipline）

借自 ponytail 的七级梯子（需要存在吗 → 代码库已有吗 → stdlib → 平台原生 → 已装依赖 → 一行 → 最小可用），提示词层增强、零状态机：

- 档位 `off / lite / full / ultra`，解析顺序：会话条目 `jero.lean-mode/v1`（倒序回放）> 环境变量 `JERO_PI_LEAN_MODE` > 默认 `full`。
- 每次代理启动重新解析，切换即时生效；只注入主会话，具名/SDD 代理经既有任务上下文获得纪律；`off` 逐字节还原历史行为。
- 懒惰边界（绝不简化掉）：信任边界输入校验、防数据丢失的错误处理、安全措施、可访问性基础、用户明确要求的内容；非平凡逻辑必须留一个可运行检查。
- 有意的妥协留 `jero:` 注释标记（`ceiling:` 天花板 + `upgrade:` 重启条件）；`jero-debt` 技能收割台账，缺 upgrade 的记 no-trigger。
- 与 400 行评审切片预算正交：预算管工作切片，梯子管必要性，绝不是代码高尔夫。

## SDD/OpenSpec 与子代理编排

- `/jero-sdd-init` 探测技术栈（package.json/标记文件，≤2 万文件）→ 写 `openspec/config.yaml` + `specs/` + `changes/archive`；会话预检仪式管理资产安装（哈希可证的 managed-assets + 锁 + legacy 迁移）。每次成功 continue 后记录工件水位台账（`<changeRoot>/.jero-artifact-guard.json`，`jero.sdd-artifact-guard/v1`：sha256+行数+字节）；下次 continue 前对比，工件灾难性截断（行数腰斩且水位≥8 行）或消失时要求显式确认才放行，拒绝则只展示状态、文件不动。
- 阶段代理 `assets/agents/sdd-*.md`（14 个）+ 链 `assets/chains/sdd-{plan,full,verify}.chain.md`、`4r-review.chain.md`；确定性状态引擎给出 `next_recommended`。
- 编排纪律（jero 技能）：先澄清；严格 TDD（RED/GREEN/TRIANGULATE/REFACTOR 带证据）；单父编排（子代理不得再派生）；委托触发——4 文件规则、多文件写入规则、事故规则、长会话规则；有界写者需非空 `## Allowed edit surfaces`；裁决与停问（Rulings, not stalls）——歧义默认自行裁决并记台账，仅不可逆/安全敏感/工作区外副作用/计划坏死四类停下问人，同一修复连续 3 次失败视为架构问题。
- **harness 纪律引导**（`lib/jero-ai-bootstrap.ts`）：`session_start`/`session_compact` 置位、`agent_end`/`session_shutdown` 复位的窗口内，把压缩后仍须存续的核心纪律作为单条 user 消息注入每次 LLM 请求（Pi `context` 事件按请求转换，紧随压缩摘要、marker `jero:harness-bootstrap/v1` 去重，每循环至多一轮）。RPC 子进程与包子进程（`JERO_PI_AGENTS_CHILD=1`）绝不注入。
- Judgment Day（显式触发）：双盲评审（jd-judge-a/b）→ 冻结发现（SHA-256）→ 至多两轮有界修复（jd-fix-agent）→ 一次终审 `APPROVED|ESCALATED`；`lib/jero-ai-writer-scope.ts` 代码级校验派发块。

## 记忆 / Shell / 指标

- **记忆**：topic 键 Markdown（`<root>/entries/<topic>.md` + YAML frontmatter），`index.json`（`jero.memory-index/v1`）加速检索；根 `<cwd>/.jero/memory` 优先，否则 `~/.pi/jero/memory`；原子写 + 目录锁；64 KiB 内容上限。`JERO_PI_MEMORY=0` 可禁用。
- **Shell**：底部状态栏（cwd/git/脏文件/模型/effort/上下文窗口 %/会话成本/订阅用量）、侧栏、变更小部件 + diff 全屏视图（alt+g）、订阅用量窗口（≤5 分钟刷新）、花瓣动画提示框、三套主题（Jero / Jero-Cute / Jero-Sexy）。
- **上下文余量监控**：`agent_settled` 时按宿主精确 token 计数逐档告警（已用 70%/85%/93% → notice/warning/critical，每档升级通知一次；阈值与 shell 仪表的 80/95 显示色解耦）；`session_compact`（手动/阈值/溢出恢复）复位档位并提示用 `mem_search`/`mem_read` 找回上下文。仅主会话 TUI 生效，绝不自动触发压缩。
- **运行时指标**：纯内存（无外发），按模型/提供商/effort/代理类聚合 token 与成本；子代理用量经 `CHILD_METRICS_EVENT` 汇聚；Agents 视图显示每任务 tokens+成本。

## 技能（17 个目录，`jero` + `jero-*` 命名）

`jero-skills`（能力路由器：场景 → 技能/命令/工具入口表）· `jero`（harness 纪律）· `jero-lean`（梯子参考）· `jero-lean-review`（diff 级精益评审：delete/stdlib/native/yagni/shrink 标签 + `net: -N lines possible`）· `jero-debt`（标记台账）· `jero-judgment-day` · `jero-rdd-defect-workflow` · `jero-branch-pr` · `jero-chained-pr`（400 行预算链式 PR）· `jero-work-unit-commits` · `jero-cognitive-doc-design` · `jero-comment-writer` · `jero-issue-creation` · `jero-skill-creator` · `jero-skill-improver` · `jero-skill-registry` · `jero-release`。

技能写作/触发措辞/生命周期规范见 `docs/skill-authoring.md`；版本演化见 `CHANGELOG.md`。

## 契约与环境

| 面 | 值 |
|---|---|
| 契约串 | `jero.authority/v1`（协议族）、`jero.authority.review-mode/v1`、`jero.review-assessment-plan/v1`、`jero.lean-mode/v1`、`jero.background-subagents/v1`、`jero.session-change/v1`、`jero.session-worktree/v1`、`jero.child-standing-review-permission/v1`、`jero.agent_model_profiles/v1`、`jero.memory-index/v1`、`jero.remediation-evidence/v1`、`jero.task-reconciliation-lock/v1` |
| 环境变量 | `JERO_PI_CONFIG_HOME` `JERO_PI_AGENT_HOME`（兼容 `PI_CODING_AGENT_DIR`）`JERO_PI_LEAN_MODE` `JERO_PI_MEMORY` `JERO_PI_AUTONOMOUS_MODE` `JERO_PI_CONTEXT_MONITOR`（`0` 关闭上下文余量告警） |
| 配置路径 | `~/.pi/jero/`（全局：models.json / persona.json / review-mode.json）、`<repo>/.pi/jero/`（项目覆盖）、`<repo>/.jero/policies/`（评审策略）、`.atl/skill-registry.md`（技能索引） |

## 测试与打包门

- 190 个测试文件（node:test，并发 12）+ runtime harness（真实扩展装配 × 假宿主端到端，三段场景）。
- CI（GitHub Actions）：Ubuntu 全量测试 + 类型诊断棘轮（`scripts/types-baseline.json`）+ runtime 模块一致性（`runtime/*.mjs` 由 lib 再生成）+ 权威边界检查 + 断网测试门（代理黑洞 + `NODE_OFFLINE=1`）；Windows 权威探测与候选视图回归。
- 打包门 `prepack`/`prepublishOnly`：全量测试 → runtime 一致性 → 权威边界 → `verify-package-files.mjs`（当前钉 148 个必需文件 = 80 条直接断言 + 68 个字节钉住向量，另 25 条禁带路径）→ packed tarball 分发链校验（`test-packed-runner.mjs`）。
- 供应链：9 个伴生依赖精确钉版；`pnpm-workspace.yaml` 强制发布龄期 / 信任不降级 / 无非常规子依赖来源；CI 重跑 `pnpm audit --prod --audit-level=high` 与 npm publish provenance；`/jero:doctor` 内置伴生依赖健康审计（钉版安装 + pi 清单入口解析，处置指引见 `docs/dependency-exit-plan.md`）。
