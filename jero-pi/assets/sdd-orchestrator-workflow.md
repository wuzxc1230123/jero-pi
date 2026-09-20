# SDD 编排器工作流

这是 el Jero 在 Pi 上的懒加载 SDD 工作流面。处理 `/sdd-*`、自然语言 SDD 请求、SDD 继续/路由、apply/verify/sync/archive 工作，或 SDD/Judgment-Day 阶段委托之前，先读此文件。

## SDD 工作流

SDD 阶段：

```text
init → explore → research (optional) → proposal → spec → design → tasks → apply → verify → sync → archive
```

依赖图：

```text
explore → research (optional) → proposal
proposal → spec ─┬→ tasks → apply → verify → sync → archive
proposal → design ┘
```

`/jero-sdd-status [change]` 是只读状态动作，用于在 apply/verify/sync/archive 之前解析活动变更、产物路径、任务进度、依赖就绪度与动作上下文。

## 原生 SDD 派发器

进程内权威的 `gentle-ai.sdd-status/v2` 投影（由 `/jero-sdd-status` 渲染）是所有存储的唯一只读状态权威。编排器原样携带该投影；它绝不重构就绪度、选择替代动作、使用记忆旁路，或仅因状态展示了某推荐就启动它。

`/jero-sdd-status` 只检查并渲染该投影。仅显式授权的 `/jero-sdd-continue` 可以解析延续；它按同一投影路由，且不授予任何源根。原生状态不可用、畸形或不匹配时，停止并报告失败。

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

仅当依赖与 `actionContext` 许可时，才执行选定的原生动作。未知、畸形、被阻塞或不支持的值在工作之前停止；散文与本地路由不能替代它们。`notes` 独立于 `blockedReasons` 且绝不设门：非空的 `notes` 值作为信息报告，当依赖与 `blockedReasons` 门允许时继续。手工 sdd-sync 有意保留其本地解析器，绝不是自动的原生状态派发。

## SDD 状态契约

在 `/jero-sdd-continue`、`sdd-apply`、`sdd-verify`、`sdd-sync` 或 `sdd-archive` 之前，解析并携带结构化状态。查找顺序：父会话提供的状态，然后是项目覆盖 `.pi/jero/support/sdd-status-contract.md`，然后是全局安装的 `~/.pi/agent/jero/support/sdd-status-contract.md`，然后是内嵌的 `sdd-status` 提示契约。不要把 `assets/support/...` 当作运行时路径；那只是安装前的包源路径。

状态必须包含：

- 活动变更选择及其解析方式；
- proposal、specs、design、tasks、apply-progress、verify-report 与 sync-report 的产物存储及路径/主题；
- 任务进度，含精确的未勾选 `- [ ]` 实现任务行；
- apply、verify、sync 与 archive 的依赖状态；
- 含模式、工作区根、允许编辑根与警告的 `actionContext`；
- 下一个推荐动作。

不要猜测活动变更。变更选择歧义时，询问用户并停止。若 `actionContext.mode: workspace-planning` 且未提供允许编辑根，在 apply/verify/sync/archive 之前停止，并请求显式的实现/编辑范围。

## 懒 SDD 预检

不要在会话开始时询问 SDD 设置问题。用户在 Pi 会话中首次发起 SDD 流程时，运行一次 SDD 预检，并在该会话余下部分复用这些选择。运行时触发检测有意保持确定性：斜杠 SDD 流程与 `/jero-sdd-init` 自动运行预检；对自然语言请求，由父会话/编排器语义判断是否需要 SDD，并必须在继续之前运行/复用 `/jero:sdd-preflight`。

**硬门：** `openspec/config.yaml`、既有 SDD 变更、已安装的 `.pi`/全局 SDD 资产、名为 "preflight" 的 todo 都不是会话预检，只是项目上下文。在本会话获得注入的 `## SDD Session Preflight` 块或下方权威顺序的等价裁决之前，不要标记 SDD 预检完成、启动 `sdd-init`、派发 SDD 子代理/链，或进入 explore/proposal/spec/design/tasks。

每个新交互会话的首次 SDD 调用，即使已保存有效偏好，也要确认预检选择。持久化偏好与权威默认值是预选建议，不是当前会话的同意。提供对分组建议或其变更的确认；取消则预检保持未解析。显式的当前会话选择优先，一经解析即在该会话内复用。若 `/jero:sdd-preflight` 不可用，内联执行同样的确认。父会话的 `subagent_run` 派发边界为每个交付的 SDD 代理解析此门，把精确渲染的 `## SDD Session Preflight` 块前置到既有的子代 `context`，并在取消或失败时阻塞启动。RPC 子代消费该传输，但绝不发起或持久化默认值；缺失或畸形的传输在进程派发之前保守失败。只有可安全区分的独立 headless 父会话，才可在无 UI 的情况下保留权威/持久化默认值。缺少 Engram 会把产物存储限制为 `openspec`，除非不兼容的显式请求需要人类决策。

预检权威默认值为：执行 `auto`、产物存储 `openspec`、交付策略 `ask-on-risk`、评审预算 `400`；能力与已选约束可以收窄它们。

分组会话确认包含默认值与能力受限的建议。若要求变更，预选已保存的值并省略冗余的单选项选择器。绝不仅因新会话需要确认而重新初始化项目上下文。`chain_strategy` 保持延后，`exception-ok` 需要显式接受 `size:exception`，绝不推断。

`sdd-tasks` 与 `sdd-apply` 接受的精确 `delivery_strategy` 域为 `ask-on-risk`、`auto-chain`、`single-pr` 或 `exception-ok`；高于评审阈值时，`auto-chain` 无需再次询问即被解析。

包应确保 SDD 资产作为全局 Pi 运行时资产存在，用户无需记忆逐项目的设置命令。资产缺失时，非破坏性地安装到：

```text
~/.pi/agent/agents/sdd-*.md
~/.pi/agent/chains/sdd-*.chain.md
```

手工安装命令是恢复/调试路径，不是快乐路径。`/jero:sdd-preflight` 是供代理/编排器使用的显式预检命令。用户在同一会话稍后显式更改 SDD 偏好时，遵循新指令。

## Init 守卫

任何 SDD 流程之前，确保项目上下文存在。该上下文位于何处取决于会话的产物存储，因此先按存储限定检查，再据以行动。

存储为 `openspec` 或 `both` 时，本地产物是：

```text
openspec/config.yaml
```

缺失时，向用户询问所需的最少信息，或在可用时运行 `/jero-sdd-init`。

存储为 `engram` 或 `none` 时，`/jero-sdd-init` 绝不写该文件，其缺失是预期行为，不是 init 缺失。绝不在其上重新触发 `/jero-sdd-init`。`engram` 从 Engram `sdd-init/{project}` 主题解析项目上下文，`none` 从会话内联解析，仅当该上下文确实缺失时才询问用户。

此 init 守卫运行于上方会话预检门之后；项目配置的存在与否绝不替代会话预检选择。不要在假装项目上下文、测试能力或会话预检选择已知的情况下，推进实质性的 SDD 流程。

## 产物存储策略

本包自身不提供持久记忆。

- 默认：仓库中的 `openspec` 产物。
- 若安装并可调用独立的记忆包，可使用 memory/hybrid 流程。
- 绝不因安装了 Jero 就声称存在记忆。

## 执行模式

使用会话的 SDD 预检选择：

- `auto`：阶段背靠背运行不暂停，但编排器守门员在启动下一阶段之前逐阶段验证。
- `interactive`：每个阶段之后展示简明摘要，并询问是调整还是继续。

用户未指定时，默认 `auto`。范围批准后，快乐路径上预期零进一步提示，每个可恢复失败至多一个可行动提示；守门员摘要阶段进度而非打断，除非连续第二次门失败或出现真正的范围/产品决策。

interactive 模式下，阶段之间：

1. 展示简明的阶段结果；
2. 陈述下一阶段；
3. 询问继续还是调整。

交互式批准按阶段生效。诸如 "continue"、"dale" 或 "go on" 的用户回应只批准紧随的下一阶段，不是 SDD 流水线的其余部分。在用户有机会评审或显式委托该评审之前，不要把生成的产物当作已批准。

interactive 模式下 `sdd-proposal` 之前，向用户提供一轮提案提问，而不是静默决定提案是否足够清晰。说明这些问题旨在通过揭示业务理解、业务规则、影响与冲击、边界情形与产品权衡来改进 PRD/提案。每轮偏好 3–5 个具体的产品问题，然后汇总由此形成的假设，并询问用户是否要纠正某些内容或进行第二轮提问。覆盖业务/产品/PRD 决策：业务问题、目标用户与情境、业务规则、产品结果、现状差距、影响与冲击、边界情形、决策缺口、首片范围边界、非目标、产品约束与业务权衡。提案时不要询问测试命令、PR 形状、变更行预算或其他 harness 机制，除非用户显式要求讨论交付。

## 研究与提案前门

此门为强制，且在两种执行模式下都适用；interactive 模式下它与上方的提案提问并行运行，两者绝不矛盾：提问轮塑造提案，此门决定 `sdd-proposal` 是否可以启动。

- `sdd-explore` 之后立即提供 `sdd-research`。研究在被选择之前可选；选择即令完成成为强制。
- 每次提案之前，仅当选中的研究为 `done` 或研究未选、产品决策为 `confirmed`、证据引用有效、且所选产物存储状态就绪时，才调用 `sdd-proposal`。
- 编排器拥有产品发现。自动模式下，未解析的产品选择需要一个无损的分组提示，包含全部上下文、选项、后果、允许答案与精确令牌；编排器必须在提示之前持久化待定的提案前状态，然后在不调用 `sdd-proposal` 的情况下停止。
- 提案者接收已确认的提案前交接，绝不面试用户或推断同意。
- Pi 的原生 `gentle-pi.sdd-status` 契约保持唯一状态契约。研究与提案前状态是编排器所有的散文与产物（`sdd/{change}/research`、`sdd/{change}/preproposal`、`openspec/changes/{change}/research.md`），叠加其上——绝不是原生状态字段。

运行时映射：使用注入的 `## SDD Research Capabilities`，由包批准的精确工具名与活动工具的交集解析。官方文档只需 `fetch_content`；开放网络需要全部四个工具：`web_search`、`source_check`、`fetch_content` 与 `get_search_content`，各自在子代中活跃且已批准/可达。无一可选；清单收录不是执行证据。保留显式的代理/来源限制。研究子代在其 CLI 白名单中只接收可达的已批准名称，并重查子代本地的可用性。通用 `mcp` 与动态 `mcp__context7` 网关不授权任意服务器或远程方法；没有经验证的窄路由，它们什么也不授予。

选中的受支持研究必须运行，并以精确的工具调用、URL、发布者/版本、检索时间、支撑摘录与断言-来源 ID，持久化有来源支撑的断言。工具清单与搜索摘要不是证据。只阻塞真正不可用的类别，保留不含未验证断言的部分结果，并在每个选中类别完成之前保持提案就绪为假。绝不因虚构的一刀切限制而建议跳过研究、编造引用，或以 bash 顶替缺失的工具。SDD 链把研究视为未选。

## 交付策略

会话中首次 SDD 链请求时，从预检解析交付策略（或询问一次）并缓存：

- `ask-on-risk`——默认；仅当任务预测检测到评审预算风险时询问。
- `auto-chain`——需要时自动拆分为链式/堆叠 PR 切片。
- `single-pr`——仅当规模在预算内时作为一个 PR 进行。
- `exception-ok`——用户在超预算时接受 `size:exception`。预检菜单不能选择它；只有用户显式接受 `size:exception` 才能到达，无论预先接受，还是在 `ask-on-risk` 停下询问时接受。

这四个就是全部域。把 `delivery_strategy` 传给 `sdd-tasks` 与 `sdd-apply`。

## 链策略

交付规划产出链式 PR 时，询问一次链策略并缓存：

- `stacked-to-main`——每个 PR 依次指向前一个 PR 分支或 main。
- `feature-branch-chain`——PR #1 指向 tracker 分支；子 PR 指向紧邻的前一个 PR 分支；仅 tracker 合入 main。

选中链式 PR 时，把注册表技能 `jero-chained-pr` 当作必需的技能匹配。按注册表路径解析并转发给 `sdd-tasks` 与 `sdd-apply`；不要硬编码其路径。

与 `delivery_strategy` 一并作为 `chain_strategy` 传入 `sdd-tasks` 与 `sdd-apply` 的提示。

## 结果契约

每个阶段结果应包含：

```text
status
executive_summary
artifacts
next_recommended
risks
skill_resolution
```

父会话应综合这些封套，除非确有必要，不粘贴冗长的原始报告。

### Key Learnings closing block (routing)

Every installed SDD phase executor agent (`assets/agents/sdd-*.md`) carries the effective `## Key Learnings Closing` contract in its own loaded prompt; this workflow file documents routing only and is not the executor authority. Each phase executor closes its final report text with a `## Key Learnings` block for the orchestrator and user to read; nothing parses it automatically — durable capture happens only through the explicit Memory Contract `mem_save`. Generic delegated workers receive the same closing instruction via `assets/orchestrator-delegation.md`.

## 自动模式守门员

`auto` 执行模式下，父会话/编排器是 SDD 阶段之间的质量门。被委托阶段返回之后、启动下一阶段之前，验证该阶段确实达成了其目标。此验证是自主的：快乐路径上不询问用户，但门捕获到真实问题时停止并报告。

按结果契约检查每个阶段结果：

- **契约符合：**阶段返回了 `status`、`executive_summary`、`artifacts`、`next_recommended`、`risks` 与 `skill_resolution`，且 `status` 表示成功而非 partial、failed 或 blocked。
- **产物存在：**每个声明的产物在活动后端存在且可读。memory 支撑的流程用可用的记忆工具检索主题；OpenSpec/文件支撑的流程读取声明的路径。成功的阶段却没有可检索的产物，即未过门。
- **无幻觉引用：**抽查阶段声称创建或使用过的具体文件路径、符号、命令与产物。无法解析的被引用路径或产物，即未过门。
- **无范围漂移：**输出必须与其输入及依赖图保持一致：spec 保持在提案范围之内，design 回答提案，tasks 覆盖 spec 与 design，apply 实现 tasks，verify 依 spec 检查实现，sync 在归档之前反映已验证的状态。
- **路由连贯：**`next_recommended` 必须遵循 SDD 依赖图，且不得有未处理的严重风险被静默带入下一阶段。

使用成本感知的验证：

- 较低风险阶段（`sdd-explore`、`sdd-research`、`sdd-spec`、`sdd-tasks`、`sdd-sync`、`sdd-archive`），父会话可以内联验证：回读产物并核对断言。
- 较高风险阶段（`sdd-design`、`sdd-apply`），在继续之前直接验证产物、声明的路径、任务状态与聚焦的测试证据，因为那里的错误会向下游复利。
- 若门发现任何异味——产物缺失、status 不匹配、路径未解析、疑似漂移或严重风险——带着纠正反馈重跑同一 SDD 阶段一次。SDD 阶段验证不启动普通评审，也不启动 Judgment Day。

门通过时，自动继续下一阶段。门失败时，带着点名具体失败的纠正反馈，精确重跑同一阶段一次。验证该重跑。若再次失败，停止自动链，并报告该阶段、两次尝试的失败与建议的修复。绝不在失败的门上推进依赖阶段。

守门员是叠加性的：它不放宽评审负载守卫、Strict TDD 转发、原生状态依赖检查或强制委托规则。它绝不创建 SDD 之后的评审轮。

## 原生运行时尝试权威

进程内的 Jero 权威（`lib/authority/`，存储于 Git common dir 之下）拥有紧凑的 SDD 尝试台账。它是 Pi 上 OpenSpec 与 Engram 流程唯一的尝试与变更行预算权威。Pi 不得实现本地的尝试镜像、计数器、令牌存储、状态机或扩展拦截层；此类代码会复制提供方权威，且无法真实地结算所有运行。jero-pi 不发布尝试 CLI——acquire/settle 是由包自身运行时调用的内部类型化操作，绝不由散文或 shell 命令调用。

- 受管理的修复启动（经 `subagent_run` 启动 `sdd-remediate` 代理）被自动包裹：运行时在启动之前获取一个有界尝试，仅在权威返回的 `proceed`、`blocked` 或 `complete` 上路由，并在运行之后以精确的结果字段（`outcome`、`evidence_revision`、`diagnosis`、`harness_disposition`、`cleanup_evidence`、`process_evidence`）结算。编排器不在此路径周围添加任何东西，绝不发明权威未返回的延续或修复状态。
- `sdd-apply` 与 `sdd-verify` 的启动不被运行时尝试包裹。其单飞纪律是编排器的责任：绝不同时为同一变更启动两个承载运行时的角色，把权威状态投影当作唯一的启动门，并在状态报告阶段被阻塞或已完成时停止。

绝不把调用方撰写的尝试计数器、令牌或状态持久化到 OpenSpec 产物、记忆、提示或任何 Pi 所有的状态之中。

`reset` 绝不自动执行，需要维护者范围的显式决策。

### 守门员对账

上方的自动模式守门员单次重跑规则是质量门，不是启动授权。重跑绝不绕过尝试权威：受管理修复的重跑仍经自动 acquire/settle 包裹，apply/verify 的重跑仍需要一次承认该阶段的新权威状态读取。守门员质量规则被保留，且从属于该权威。

## SDD 阶段委托模式

父会话需要阶段结果来路由下一步时，以 `subagent_run` 的 `mode: "task"` 启动 SDD 阶段子代理。SDD 阶段、写者、依赖的验证证据与归档，在委托契约的后台子代理策略块之下为前台强制；后台完成是通知/历史机制，不是编排恢复的保证。

## 模型分配

在会话中首次 SDD/Judgment-Day 阶段委托之前读本表，缓存它，并仅对 SDD/Judgment-Day 阶段代理使用。阶段缺失时用 `default` 行。所指派的层级不可用时，使用运行时的默认模型并继续。

在 Pi 上，阶段模型路由由用户所有并持久化，而非经提示传入：`/jero:models` 写入 `.pi/jero/models.json`，包把每个已保存的指派应用到已安装的阶段代理定义（frontmatter `model:`/`thinking:`）或 `.pi/settings.json` 覆盖。下表是用户未保存指派时各阶段的默认能力层级。

**强制阶段模型门：**启动 SDD/Judgment-Day 阶段代理之前，确认该阶段经已保存的模型配置或这些默认值解析。绝不为 SDD/Judgment-Day 阶段传递临时的 `model` 参数，也绝不把本表应用于通用 Pi 委托——通用子代理经 `pi-subagents` 配置解析模型/思考，且仅显式用户覆盖时才在那里传 `model`。

| 阶段        | 默认层级   | 原因                                     |
| ------------ | -------------- | ------------------------------------------ |
| sdd-explore  | balanced       | 读代码，结构性——非架构性 |
| sdd-research | balanced       | 保守失败的证据记录 |
| sdd-proposal | deep-reasoning | 架构决策 |
| sdd-spec     | balanced       | 结构化写作 |
| sdd-design   | deep-reasoning | 架构决策 |
| sdd-tasks    | balanced       | 机械分解 |
| sdd-apply    | balanced       | 实现 |
| sdd-verify   | balanced       | 依规格验证 |
| sdd-sync     | fast           | 反映已验证状态 |
| sdd-archive  | fast           | 复制并收尾 |
| jd-judge-a   | deep-reasoning | 对抗性评审 |
| jd-judge-b   | deep-reasoning | 对抗性评审 |
| jd-fix-agent | balanced       | 外科手术式的已确认修复 |
| default      | balanced       | SDD 阶段回退；绝不是 Judgment Day 角色 |

## Judgment Day 修复路由

Judgment Day 阶段角色绝不是通用回退。若通用写者链不可用，使用文档记载的原生通用回退或停止。Judgment Day 独立：它既不启用也不替代普通评审；单独请求的普通评审保持独立。独立的 Judgment Day 修复不需要 graph-v1 或原生评审 lineage。仅为显式的 Judgment Day 修复批次启动 `jd-fix-agent`，携带此精确的运行时接受 Markdown 形状：`## Judgment Day activation` 只含 `User explicitly requested Judgment Day.`。用控制器授权的值替换示例 ID、冻结台账哈希、行数据与编辑面。纠正批次只含一轮（`1 of 2` 或 `2 of 2`）与一个小写 SHA-256。精确冻结发现行为每行一个 JSON 对象，仅使用权威行字段，并与授权 ID 精确匹配。

```markdown
## Judgment Day activation
User explicitly requested Judgment Day.
## Exact authorized severe IDs
- `JD-A-001`
## Judgment Day correction batch
Round: 1 of 2.
Frozen ledger SHA-256: `aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`
## Exact frozen finding rows
{"id":"JD-A-001","lens":"judgment-day","location":"path/to/authorized-file.ts:1","severity":"CRITICAL","status_at_freeze":"open","evidence_class":"deterministic","evidence_claim":"Concrete user-impact claim supported by the frozen location."}
## Allowed edit surfaces
path/to/authorized-file.ts
```

## 子代理启动去重

维护会话范围的 `(phase, task-fingerprint)` 启动日志。若同一对已存在，不再启动。每个不同的任务恰好一次启动，并在启动之后追加该对。

## 子代理启动协议

每次 SDD/Judgment-Day 阶段启动之前预检：

1. 识别阶段键（`sdd-apply`、`sdd-verify`、`jd-judge-a` 等）。
2. 按上方的模型分配门确认其模型路由。
3. 每会话一次从注册表解析匹配的技能路径，并在 `## Skills to load before work` 之下传递精确的 `SKILL.md` 路径。
4. 若被委托结果把 `skill_resolution` 报告为 `fallback-registry`、`fallback-path` 或 `none`，在后续委托之前重读注册表。

**Key Learnings closing（通用委托）：**委托给通用代理（`jero-explore`、`jero-worker`、`jero-verify`、scout/worker 角色或原生 `Agent` 回退）时，精确按 `assets/orchestrator-delegation.md` 中 "Key Learnings closing block" 之下的规则原文执行。该文件是该规则的唯一陈述；不要在此重述或转述。SDD 阶段启动提示无需此类注入：每个已安装的 SDD 阶段执行器已在其自身提示中携带有效契约（见上方 "Key Learnings closing block (routing)"）。

## Strict TDD 转发

对 `sdd-apply` 与 `sdd-verify`，存在时读取 `openspec/config.yaml`。

若它声明 strict TDD 与测试命令，在阶段提示中包含一条不可协商的指令：

```text
STRICT TDD MODE IS ACTIVE. Test runner: <command>. Follow RED, GREEN, TRIANGULATE, REFACTOR. Record evidence.
```

不要依赖子代理自行发现这一点。

## 归档终态交接

启动 `sdd-archive` 时，为 `apply-progress`、`verify-report` 或 `sync-report` 持久化之后完成的任何工作转发显式的终态事实——后续提交中修复的验证警告、已解除的阻塞、已完成的任务、更新的测试或 issue 计数——并在可用时附上提交或证据引用。那些产物是中间快照，写入之时有效；归档报告记录收尾时的状态，`sdd-archive` 启动提示中的显式终态事实高于过期的快照断言。

## 评审负载守卫

`sdd-tasks` 完成之后、启动 `sdd-apply` 之前，检查任务输出的 `Review Workload Forecast`。

若它说 `Chained PRs recommended: Yes`、`400-line budget risk: High`、估计变更行数超过 400，或 `Decision needed before apply: Yes`，应用缓存的 `delivery_strategy`：

- `ask-on-risk`：停止并询问是拆分，还是以 `size:exception` 继续。
- `auto-chain`：自动拆分；仅在缺失时询问 `chain_strategy`。
- `single-pr`：停止并在 apply 之前要求/记录 `size:exception`。
- `exception-ok`：继续并告知 `sdd-apply` 本次运行使用 `size:exception`。

任何其他 `delivery_strategy` 值都无效。不要选最接近的分支，也不要继续：停止，报告无法识别的值，并在启动 `sdd-apply` 之前重新收集交付策略。

始终把已解析的 `delivery_strategy`、`chain_strategy` 及任何选定的 PR 边界/例外传给 `sdd-apply` 的启动提示。

在 SDD 之外显式启动的任何评审事务，经其自身的产物存储分支与预算持久化。SDD 完成本身不启动任何评审角色，也不铸造评审权威。

自动模式不覆盖评审者过载保护。

## 恢复

对每个存储，请求新的原生 v2 状态投影。产物读取仅在原生选择之后才可以供给阶段输入；它们绝不重新推导就绪度、替代状态或绕过原生拒绝。手工 sdd-sync 保留其独立的本地解析器。

## Provider Defect Handoff

当 SDD 任务遇到疑似 Jero 提供方缺陷时，完整契约位于 `assets/orchestrator-delegation.md` 的 `#### Jero Provider Defect Handoff (MANDATORY)`。本工作流有意不提供摘要、替代报告路由或 RDD 生命周期指令。
