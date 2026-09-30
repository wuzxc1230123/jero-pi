# jero-pi 技术参考

本文档由当前代码状态生成（2026-09，对应 `refactor/jero-ai-split` 分支）。jero-pi 是面向 Pi coding-agent 的扩展包：评审权威、SDD/OpenSpec 编排、子代理、持久记忆、精益纪律与 shell 层——全部进程内 Node 实现，零原生二进制、零安装期网络。

要求 Pi ≥ 0.85.1（`peerDependencies` 钉定；0.85.1 为 `agent_settled` 事件经测试验证的最低版本）。

## 架构分层

```text
Pi 宿主（@earendil-works/pi-coding-agent ≥0.85.1，peer）
├─ 扩展层 extensions/（9 个文件，~3.7k 行；只做注册与编排，业务实现下沉 lib）
│   jero-ai · jero-agents · jero-memory · jero-shell ·
│   runtime-metrics · sdd-init · skill-registry · startup-banner · module-verify
├─ 领域层 lib/（173 个文件，~50k 行）
│   authority/（进程内评审权威，51 个文件）· review-* · agents-* ·
│   shell-* · sdd-* · module-contract · module-trigger-compiler · module-verify-pipeline ·
│   jero-ai-lean · jero-ai-context-monitor · jero-ai-bootstrap · jero-ai-sdd-guard ·
│   jero-ai-sdd-breadcrumb · jero-ai-spec-index · memory · runtime-metrics*
├─ 伴生插件（dependencies 精确钉版，经 pi 清单加载）
│   pi-pretty · rpiv-ask-user-question · rpiv-todo · billion-context-pi ·
│   pi-cache-optimizer · pi-fovea · pi-hashline-edit-pro · pi-lens · pi-web-access
└─ 系统边界（仅 git / gh(可选) / pi 自身三类外部进程；另有唯一一条带凭证的网络出口：活动 provider 为 openai-codex 时订阅用量查询 GET `https://chatgpt.com/backend-api/wham/usage`，`JERO_PI_USAGE_FETCH=0` 可完全关闭）
```

- **进程内评审权威** `lib/authority/`：13 个持久状态，15 个 wire 状态投影；不变量——透镜只跑一次、冻结发现与创世范围不变、恰一次有界纠正（预算 `min(200, ceil(原始变更行/2))`）、actor 产物（模型输出）永远是无信托数据。存储在 `.git/jero-review/`（CAS 对象 + lineage 记录 + 候选视图），随仓库走。`scripts/check-authority-boundary.mjs` 结构性强制 authority 不 import 扩展层、不做 IO/env 读取。
- **评审域命名棘轮**（`scripts/check-review-naming.mjs` + `scripts/review-naming-baseline.json`）：评审域的三前缀是分阶段移植的化石——`authority/`（51，信任边界核心，**收敛目的地**）· `review-*`（24）· `jero-ai-review-*`（9，含 2026-09-27 记录决策的宿主侧工具注册 jero-ai-review-tools.ts）；两个外围前缀钉在基线最大值只降不升（`--update` 棘轮下移），新评审域代码进 `authority/` 或显式记录决策。**身份层三件永久宿主侧**：`review-canonical.ts`（上游 `domainHashV1` 定义点）、`review-lock.ts`、`review-repository.ts`（repository_id/authority_id 铸造点）——边界门第三条规则刻意把上游身份命名空间挡在 authority 外，authority 只消费它们铸好的身份值。`jero-authority-cli.ts` 的 SDD 投影已改为逐字段结构化重投影（不再 `as unknown as` 双盲强转）。
- **宿主 relay** `lib/review-host-relay.ts`：渲染权威方审查员提示 → `--agent pi --materialize` → 锁定 print-mode pi 子进程在只读工作树评审 → 原始字节经 provider 提交令牌回交；任何失败都是 typed transport error，不重试、不合成。
- **黄金向量** `tests/fixtures/review-integration/`：68 个字节钉住向量（SHA-256 由 `scripts/verify-package-files.mjs` 校验），是 authority 一致性测试的行为规范。

## 命令（26 个斜杠命令）

| 组 | 命令 |
|---|---|
| 状态与诊断 | `/jero:status` `/jero:doctor` `/jero:guard` `/jero:banner` `/jero:banner-color` `/jero:toggle-rose` `/jero:toggle-text-logo` |
| 精益纪律 | `/jero:lean`（status\|off\|lite\|full\|ultra；输入 "stop lean" 亦可关闭） |
| 评审 | `/jero:review-mode`（RDD 开关）`/jero:review-session-permission`（status\|revoke）`/jero:changes` `/jero:usage` |
| 子代理与模型 | `/jero:agents` `/jero:models` `/jero:profiles` `/jero:persona` `/jero:background-subagents` |
| SDD | `/jero:sdd-preflight` `/jero-sdd-init` `/jero-sdd-status` `/jero-sdd-continue` `/jero:install-{delegation,review,sdd}` |
| 技能与扩展 | `/skill-registry:refresh` `/jero-module-verify`；另有 `prompts/agents-init.md`（`/agents-init`）、`prompts/skill-creation.md`（`/skill-creation`）、`prompts/module-creation.md`（`/module-creation`）与 `prompts/agent-creation.md`（`/agent-creation`）四个随包 prompt 模板 |

评审生命周期动词（`inspect`/`start`/`answer-consent`/`assess`/`finalize`/`validate`/`select-intended-untracked`/`export`/`import`/`recover` 等）是 `jero_review` 工具操作，不是斜杠命令。`inspect` 在候选干净就绪（passive 风险且 authored 行数 ≤10）时附加建议性字段 `triviality_hint`：提示可先与用户确认是否值得走完整评审，只读的 `assess` 是轻量替代；该字段不参与任何状态转移。

## 工具

- `jero_review`（控制器）、`jero_review_capture`（单捕获槽）、`jero_review_capture_group`（有序并发审查组）、`jero_review_scope`（冻结范围只读分页）
- `mem_save` / `mem_read` / `mem_list` / `mem_search`（持久记忆）
- `subagent_list_agents` / `subagent_run` / `subagent_status` / `subagent_reconcile` / `subagent_result` / `subagent_list_tasks` / `subagent_reply` / `subagent_cancel` / `subagent_send_message` / `subagent_continue`
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
- **轻量 change**（P1.1）：changeRoot 下的规范常规文件 `.jero-lightweight` 声明显式豁免——proposal + tasks 即可 apply-ready（specs/design 不再阻塞，在场时仍作上下文与 sync 对象）；无 delta specs 时 sync `not_applicable`、archive 不要求 sync-report；写了 specs 则走正常 sync。规划推荐链跳过 spec/design 横档直达 tasks；目录等非规范形状保守视为未声明。引擎字段 `lightweight?: true`（`jero-pi.sdd-status@1` 向后兼容扩展）经权威投影稀疏携带（wire `jero-ai.sdd-status@2` 同名字段，解码器校验布尔型）。
- 阶段代理 `assets/agents/sdd-*.md`（14 个）+ 链 `assets/chains/sdd-{plan,full,verify}.chain.md`、`4r-review.chain.md`；确定性状态引擎给出 `next_recommended`。
- **提案提问轮强化**（借鉴 grilling，纯资产文本、零流程改动）：interactive 提问轮的问题从探索/研究证据与用户先前答案中派生、按"会否改变提案走向"取舍开放分支；逐轮汇总已闭合/仍开放假设，用户持续作答即持续追问、随时可停；问答中达成一致的术语沉淀为提案 `## 共享语言` 小节（术语/定义/来源），经 sync 回写 spec 形成词汇复利。不新增预检项、门条件或工件。
- **知识沉淀回写**（借鉴 CONTEXT.md/ADR/non-goal-retrospective/build-eval，零流程改动）：sync 阶段把提案 `## 共享语言` 合并进 `openspec/specs/glossary/`，把 design/proposal 的关键决策与明确放弃的方向以追加式条目回写 `openspec/specs/decisions/`（`## 决策记录` DR-日期编目 + `## 非目标记录`）——读取侧由已确立规范索引自动发现，零新机制；archive 归档回顾三件套（放弃与砍除/关键裁决/重复 offender）随报告入审计轨迹，engram/both 下另合并持久化到 `project/non-goals`、`project/repeat-offenders` 记忆主题（先读后写防覆盖）；remediate 对同类缺陷第二次出现提议具体可执行检查（不自行改测试套件），把"解释过的教训"升级为"机械把关的门"。
- **量化与追溯**（借鉴 bigpowers verify-命令/BCP/traceability，零流程改动）：任务级 `<!-- verify: ... -->` 行内命令由 sdd-tasks 定死（一行可运行/确定性退出码/无网络；不可机械验证的标 `manual`），sdd-apply 勾选前执行并记 `Task Verify Evidence` 表，sdd-verify 对已勾选任务重跑复核（失败=CRITICAL"勾选与证据矛盾"），遗留任务无命令不阻塞；可选 `## Size Estimate` 斐波那契估点表 + apply-progress 顶部 `started:` 时间戳（只补不改），archive 回顾记周期天数与估点校准、并生成 `traceability.md` 追溯矩阵（需求→任务→证据→验证，`untraced`/`orphan` 照实标注不补造，审计产物不阻塞归档）。
- **诊断与防御**（借鉴 bigpowers diagnose-stall/THREAT_MODEL/spike，零流程改动）：`jero-diagnose-stall` 技能对编排停滞做只读六类分诊（状态投影/门失败停链/等人确认丢失/子代未结算/修复循环/预算停——先读事实再分类，绝不替权威做状态转移）；sdd-design 对安全敏感变更（认证/网络边界/写入面/spawn/加密/新依赖）可选产出 `## Threat Model`（攻击面/威胁/缓解，不新增门禁）；选档文档新增抛弃式原型纪律（时间盒+问题先行、代码即弃、结论回写决策记录/非目标）。
- **计划期风险分级**（借鉴 bigpowers 风险分层验证，零流程改动）：sdd-tasks 给任务标 `<!-- risk: P0|P1|P2|P3 -->`（后果轴，与预算体量轴正交；P0=不可逆/安全敏感且触发事前威胁建模，P2 为未标记默认，拿不准就高不就低）；sdd-verify 按级调节复核深度——P0 强制逐任务重跑+报告单列+完整评审生命周期建议、P1 重跑、P2 既有路径、P3 可豁免逐条重跑（豁免留痕）；绝不调节评审预算、交付门槛或替代评审轴决策。
- **上下文清单与注入回执**（借鉴 Trellis jsonl 上下文清单/first-reply-notice，零流程改动）：sdd-tasks 产出 `## Context Manifest`（消费者 apply/verify × 具体文件路径 × 一句话理由，规划期策展），apply/verify 按行取上下文并在报告/进度列出实际读到者，清单缺失回退既有产物路径不阻塞，清单只授予读取、绝不扩大编辑面（编辑面归 allowedEditRoots/Allowed edit surfaces）；bootstrap 注入尾附一次性回执指令（会话/压缩后首个可见回复一行确认，语言跟随用户，中性回退 `jero bootstrap ✓`，不重复）——注入从"静默祈祷被读"变成"用户可观测被消费"。
- **架构巡检**（借鉴 mattpocock improve-codebase-architecture/bigpowers deepen-architecture，零流程改动）：`jero-architecture-patrol` 技能对仓库结构做只读幂等六轴巡检——深模块机会（Ousterhout）/信息隐藏违反/巨型单元（以仓库自身常规为基线）/重复/命名漂移（对照 glossary 共享语言表）/分层违规——产出按收益排序的发现报告，每条含"为什么是结构问题"与 SDD 切入点，前几条建议走 `/jero-sdd-init` 立变更；绝不直接重构、绝不自我触发，与 per-change 评审透镜正交（透镜看 diff，巡检看仓库长期结构）。
- 编排纪律（jero 技能）：先澄清；严格 TDD（RED/GREEN/TRIANGULATE/REFACTOR 带证据）；单父编排（子代理不得再派生）；委托触发——4 文件规则、多文件写入规则、事故规则、长会话规则；有界写者需非空 `## Allowed edit surfaces`；裁决与停问（Rulings, not stalls）——歧义默认自行裁决并记台账，仅不可逆/安全敏感/工作区外副作用/计划坏死四类停下问人，同一修复连续 3 次失败视为架构问题。
- **harness 纪律引导**（`lib/jero-ai-bootstrap.ts`）：`session_start`/`session_compact` 置位、`agent_end`/`session_shutdown` 复位的窗口内，把压缩后仍须存续的核心纪律作为单条 user 消息注入每次 LLM 请求（Pi `context` 事件按请求转换，紧随压缩摘要、marker `jero:harness-bootstrap/v1` 去重，每循环至多一轮）。RPC 子进程与包子进程（`JERO_PI_AGENTS_CHILD=1`）绝不注入。
- **SDD 状态面包屑**（`lib/jero-ai-sdd-breadcrumb.ts`）：bootstrap 注入的是不变纪律，面包屑注入的是活状态——磁盘状态引擎（`resolveSddStatus`，native `sddStatus` 背后的同一实现）解析的当前变更、`next_recommended`、任务进度与首个阻塞，在每次 LLM 请求刷新（marker `jero:sdd-breadcrumb/v1` + 16 位状态指纹去重，陈旧面包屑先剔除再插新）。不变量借自 Trellis："必需步骤不在每回合可见，就会被模型静默跳过"。无活跃变更/已归档/非权威存储不注入；状态解析失败保守跳过绝不阻塞请求。`JERO_PI_SDD_BREADCRUMB=0|false|off` 关闭。
- **已确立规范索引**（`lib/jero-ai-spec-index.ts`，知识飞轮读取侧）：SDD sync 把增量 spec 回写 `openspec/specs/` 后，后续会话在 bootstrap 同一注入窗口收到域索引（域路径 + Purpose 首行摘要，marker `jero:spec-index/v1`，≤40 域、摘要 ≤160 字符）——沉淀下来的规范会被看见，同一教训不再每会话重学。写入侧归 SDD sync 既有机制；索引只是发现入口，内容以 spec.md 为准。`JERO_PI_SPEC_INDEX=0|false|off` 关闭。
- Judgment Day（显式触发）：双盲评审（jd-judge-a/b）→ 冻结发现（SHA-256）→ 至多两轮有界修复（jd-fix-agent）→ 一次终审 `APPROVED|ESCALATED`；`lib/jero-ai-writer-scope.ts` 代码级校验派发块。

## 能力模块契约（jero.module-contract/v1）

目标项目/全局的领域扩展（如 go、godot）走机器验证的契约化路径：`.pi/modules/{token}/module.json` 一份清单声明触发（静态 glob）、知识（L0/L1/L2 渐进披露）、角色（隔离正当性必填）、接线（八个编排面）与路由（消费路由单字段）。核心机制：

- **静态触发编译**：`lib/module-trigger-compiler.ts` 对仓库文件树确定性判定模块激活，产出 `.atl/module-overlay.md`（自动生成物）——各面注入档位、追加角色、Strict TDD 命令（SDD 转发取值链第一级：覆盖层 → config.yaml → 探测）、C 级硬门声明的响亮缺席。
- **安装验证八查**：`/jero-module-verify`——token 合法/唯一/双轨（与松散技能重名即拒）、防遮蔽、触发命中、路由解析、隔离正当、entry ≤60 行、命令钉住；`check:module-contract` 门钉 schema 与 TS 常量零漂移 + 创建器金样绿灯。
- **注册表桥**：模块知识入口 `knowledge/SKILL.md` 进技能注册表——宿主触发与编排器注入零新协议消费模块知识；编排器按覆盖层档位收窄注入（`assets/orchestrator-skills.md` 注册协议第 5 步），委派以 `module_resolution` 回报（`delegated`/`skipped`/`name-unresolved`，SDD 结果契约字段）。
- **自然语言路由单**：`assets/orchestrator-delegation.md`——语义层只填类型化单据（trigger_hit 由覆盖层预填），路由是 R1–R4 确定性规则；风险/规模/文件数永不触发 SDD 建议。

规范单一事实源见 `docs/module-contract.md`；松散资产（无清单 legacy 路径）见 `docs/extension-guide.md`。

## 记忆 / Shell / 指标

- **记忆**：topic 键 Markdown（`<root>/entries/<topic>.md` + YAML frontmatter），`index.json`（`jero.memory-index/v1`）加速检索；根 `<cwd>/.jero/memory` 优先，否则 `~/.pi/jero/memory`；原子写 + 目录锁；64 KiB 内容上限。`JERO_PI_MEMORY=0` 可禁用。
- **Shell**：底部状态栏（cwd/git/脏文件/模型/effort/上下文窗口 %/会话成本/订阅用量）、侧栏、变更小部件 + diff 全屏视图（alt+g）、订阅用量窗口（≤5 分钟刷新；Codex 用量端点是唯一带凭证的网络出口，`JERO_PI_USAGE_FETCH=0` 关闭）、花瓣动画提示框、三套主题（Jero / Jero-Cute / Jero-Sexy）。
- **上下文余量监控**：`agent_settled` 时按宿主精确 token 计数逐档告警（已用 70%/85%/93% → notice/warning/critical，每档升级通知一次；阈值与 shell 仪表的 80/95 显示色解耦）；`session_compact`（手动/阈值/溢出恢复）复位档位并提示用 `mem_search`/`mem_read` 找回上下文。仅主会话 TUI 生效，绝不自动触发压缩。
- **运行时指标**：纯内存（无外发），按模型/提供商/effort/代理类聚合 token 与成本；子代理用量经 `CHILD_METRICS_EVENT` 汇聚；Agents 视图显示每任务 tokens+成本。

## 技能（21 个目录，`jero` + `jero-*` 命名）

`jero-skills`（能力路由器：场景 → 技能/命令/工具入口表）· `jero`（harness 纪律）· `jero-lean`（梯子参考）· `jero-lean-review`（diff 级精益评审：delete/stdlib/native/yagni/shrink 标签 + `net: -N lines possible`）· `jero-debt`（标记台账）· `jero-judgment-day` · `jero-rdd-defect-workflow` · `jero-branch-pr` · `jero-chained-pr`（400 行预算链式 PR）· `jero-work-unit-commits` · `jero-cognitive-doc-design` · `jero-comment-writer` · `jero-issue-creation` · `jero-skill-creator` · `jero-skill-improver` · `jero-skill-registry` · `jero-module-creator`（领域模块脚手架：技能 + 子代理 + 命令钉住）· `jero-agent-creator`（单个项目级子代理）· `release`。

技能写作/触发措辞/生命周期规范见 `docs/skill-authoring.md`；零代码扩展（目标项目技能/子代理/语言包）见 `docs/extension-guide.md`；能力模块契约（`.pi/modules/` 机器验证清单、编排面接线、`/jero-module-verify`）见 `docs/module-contract.md`；版本演化见 `CHANGELOG.md`。

## 契约与环境

| 面 | 值 |
|---|---|
| 契约串 | `jero.authority/v1`（协议族）、`jero.authority.review-mode/v1`、`jero.review-assessment-plan/v1`、`jero.lean-mode/v1`、`jero.background-subagents/v1`、`jero.session-change/v1`、`jero.session-worktree/v1`、`jero.child-standing-review-permission/v1`、`jero.agent_model_profiles/v1`、`jero.memory-index/v1`、`jero.remediation-evidence/v1`、`jero.task-reconciliation-lock/v1`、`jero.module-contract/v1`、`jero.module-overlay/v1` |
| 环境变量 | `JERO_PI_CONFIG_HOME` `JERO_PI_AGENT_HOME`（兼容 `PI_CODING_AGENT_DIR`）`JERO_PI_LEAN_MODE` `JERO_PI_MEMORY` `JERO_PI_MEMORY_ROOT`（显式记忆根覆盖；编排器经它把父会话解析的记忆根下传给子代理，保证"子保存、父检索"同一存储）`JERO_PI_AUTONOMOUS_MODE` `JERO_PI_CONTEXT_MONITOR`（`0` 关闭上下文余量告警）`JERO_PI_USAGE_FETCH`（`0` 关闭 Codex 订阅用量端点外发，自动与手动刷新一并关闭）`JERO_PI_SDD_BREADCRUMB`（`0` 关闭 SDD 状态面包屑）`JERO_PI_SPEC_INDEX`（`0` 关闭已确立规范索引注入） |
| 配置路径 | `~/.pi/jero/`（全局：models.json / persona.json / review-mode.json）、`<repo>/.pi/jero/`（项目覆盖）、`<repo>/.jero/policies/`（评审策略）、`.atl/skill-registry.md`（技能索引）、`.pi/modules/`（项目能力模块）与 `~/.pi/agent/modules/`（全局能力模块）、`.atl/module-overlay.md`（模块派发覆盖层，自动生成） |

### 兼容白名单（gentle- 残留，2026-09-26 审计；2026-09-27 两批清退后仅剩守卫与历史事实）

五类残留已全部清退或转性：四类于当日两批专项完成（工单注释、persona、agents 存储、自有契约串）；wire 身份同日自化——进程内权威（`lib/jero-authority-cli.ts`，生产唯一默认 CLI，评审全操作进程内服务）本就是自实现，其 wire schema 身份、capabilities 包名、invocation 调用词、managed 存储路径全部改 `jero-ai.*`/`jero-ai`，68 个黄金向量重导为本仓行为规格。**现存的 gentle-ai 字样全部是守卫对象或历史事实**，不是依赖：

| 类别 | 说明 | 保留理由 |
|---|---|---|
| 外来存储守卫（`FOREIGN_REVIEW_STORE`/`FOREIGN_TRANSACTION_STORE` 指向 `gentle-ai/reviews`、`gentle-ai/review-transactions`） | 探测上游权威数据并以 `foreign-authority-store` 拒绝 START，绝不写入 | 守卫对象是上游数据的位置事实；若用户另装上游工具，此守卫防止双权威互踩 |
| 上游工单与版本引用（注释中 `gentle-ai#NNN`、`ga#NNN`、"gentle-ai 2.4.0 行为锚点"等） | 解释"此处行为镜像/分歧自上游某版"的来源事实 | 历史事实，清除即丢失行为出处的可考性 |
| `tests/runtime-harness-support.mjs` 的 `FORBIDDEN_COMPAT_COMMANDS` 中 gentle 时代命令名 | 禁用清单：断言旧入口保持未注册 | 是守卫本身，不是残留 |
| 迁移期兼容读取（旧存储根 `gentle-ai/reviews` 原地收编、旧 managed-assets 注册表路径、consent off-path 旧命令双接受、旧会话 legacy customType 渲染、persona 非 neutral 归一 direct） | "新名写 + 旧名读"的探测迁移面 | 旧数据与旧会话在迁移窗口内可读；写侧一律新名 |

<!-- jero:manifest:begin (generated by scripts/check-docs-manifest.mjs) -->
斜杠命令（26）：`/jero-module-verify` `/jero-sdd-continue` `/jero-sdd-init` `/jero-sdd-status` `/jero:agents` `/jero:background-subagents` `/jero:banner` `/jero:banner-color` `/jero:changes` `/jero:doctor` `/jero:guard` `/jero:install-delegation` `/jero:install-review` `/jero:install-sdd` `/jero:lean` `/jero:models` `/jero:persona` `/jero:profiles` `/jero:review-mode` `/jero:review-session-permission` `/jero:sdd-preflight` `/jero:status` `/jero:toggle-rose` `/jero:toggle-text-logo` `/jero:usage` `/skill-registry:refresh`
工具（19）：`jero_review` `jero_review_capture` `jero_review_capture_group` `jero_review_scope` `mem_list` `mem_read` `mem_save` `mem_search` `session_worktree_register` `subagent_cancel` `subagent_continue` `subagent_list_agents` `subagent_list_tasks` `subagent_reconcile` `subagent_reply` `subagent_result` `subagent_run` `subagent_send_message` `subagent_status`
技能（21）：`branch-pr` `chained-pr` `cognitive-doc-design` `comment-writer` `issue-creation` `jero-agent-creator` `jero-ai` `jero-architecture-patrol` `jero-debt` `jero-diagnose-stall` `jero-lean` `jero-lean-review` `jero-module-creator` `jero-skills` `judgment-day` `rdd-defect-workflow` `release` `skill-creator` `skill-improver` `skill-registry` `work-unit-commits`
<!-- jero:manifest:end -->

## 测试与打包门

- 201 个测试文件（node:test，并发 12）+ runtime harness（真实扩展装配 × 假宿主端到端，三段场景）。**行覆盖以 `pnpm run test:coverage` 为准**（NODE_V8_COVERAGE 跨进程归并，含 harness 与 CLI 子进程）；Node 内置 `--experimental-test-coverage` 在全量多子进程场景对同文件的合并会失真（实测同一文件 19% vs 真值 87%），勿直接采信内置全量表。
- CI（GitHub Actions）：Ubuntu 全量测试 + 类型诊断棘轮（`scripts/types-baseline.json`）+ runtime 模块一致性（`runtime/*.mjs` 由 lib 再生成）+ 权威边界检查 + 测试质量棘轮（`scripts/check-test-quality.mjs`，5 条反模式只降不升，含分片互 import）+ 空 catch 卫生门（`scripts/check-empty-catch.mjs`，空块必须带注释或语句）+ 文档清单同步门（`scripts/check-docs-manifest.mjs`，从注册点派生命令/工具/技能清单并钉住本文件的生成块）+ 评审域命名棘轮（`scripts/check-review-naming.mjs`，外围前缀只降不升）+ 模块契约门（`scripts/check-module-contract.mjs`，schema 与 lib 常量零漂移 + 创建器金样绿灯）+ 断网测试门（代理黑洞 + `NODE_OFFLINE=1`）；Windows 权威探测、候选视图回归与符号链接夹具回归（`sdd-research-capabilities` / `review-candidate-view.z2`——钉住「Windows 上 rmSync 对悬垂符号链接是静默 no-op，夹具须用 unlinkSync」的语义）。套件级挂起兜底：全部 `--test` 入口带 `--test-timeout=300000`。
- 打包门 `prepack`/`prepublishOnly`：全量测试 → runtime 一致性 → 权威边界 → 测试质量棘轮 → 空 catch 卫生门 → `verify-package-files.mjs`（当前钉 158 个必需文件 = 90 条直接断言 + 68 个字节钉住向量，另 25 条禁带路径）→ 文档清单同步门 → 评审域命名棘轮 → 模块契约门 → packed tarball 分发链校验（`test-packed-runner.mjs`，仅 publish 链）。
- 供应链：9 个伴生依赖精确钉版；`pnpm-workspace.yaml` 强制发布龄期 / 信任不降级 / 无非常规子依赖来源；CI 重跑 `pnpm audit --prod --audit-level=high` 与 npm publish provenance；`/jero:doctor` 内置伴生依赖健康审计（钉版安装 + pi 清单入口解析，处置指引见 `docs/dependency-exit-plan.md`）。
