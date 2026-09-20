# 编排器——委托细则（懒加载）

仅绑定到父 Pi 会话，于委托或路由触发时生效。非常驻；按 `assets/orchestrator.md` 中的指针按需加载。

### 无损阻塞提示（强制）

当子代理或工具返回面向用户的阻塞提示或菜单时，保留其完整的面向用户的选择封套：为何需要输入；按原始顺序的每个分组与每个问题（含每个分组标题）；每个选项的标签与描述；选择模式；以及精确的允许答案域。保留面向用户的封套，而非无关的内部诊断。若脱敏会改变决策，则停止并报告该提示无法被安全呈现。

- 绝不摘要、缩写、重排、改标签、合并或省略选项。绝不把一个原子业务选择静默拆散到多次交互。
- 原生路由：jero-pi 不内置封闭单选问卷工具。外部所有的 `ask_user_question` 总会追加自己的自由文本哨兵行，因此严格封闭的封套永远无法经由它精确表达：绝不将它用于提供方所有的同意提示、维护授权或任何精确的不透明令牌决策，也绝不把其自由文本答案送入不透明令牌映射。`ask_user_question` 仅用于自由文本明确安全且有意如此的普通开放/自由文本封套或提示。否则落入下方回退条款。对未裁决的 `gentle-ai.review-integration.consent/v3`，所选延续仍是精确捕获的提供方所有选择调用；绝不合成它。合格的 Pi 运行时可改为在封套到达模型前经由三动作 UI 消费它：前两个动作是未改动的提供方选项，第三个动作是宿主所有的会话权限。绝不把该宿主动作追加到已解码或已中继的提供方封套。若运行时返回未裁决封套，上述原始双选择回退不变适用。
- 回退：若原生 UI 不可用、被拒绝、运行时非交互，或完整封套因问题数、选项数或文本长度限制而超尺寸或无法表示，则把完整选择封套作为普通聊天或终端响应发出。包含必需的答案语法以及该输入为何阻塞进度。然后停止。不要选择、默认、推断、启动依赖工作或继续。别处任何"仅原生工具"的措辞绝不禁用本回退。
- 答案校验：仅当每个回答属于为其分组呈现的精确允许答案域时才接受。仅当原始提示允许时才许可自由文本或多选。对封闭单选封套，去除首尾空白并按呈现选项做大小写不敏感比较：仅接受恰好匹配一个呈现选项的输入，零匹配与多匹配均拒绝，并把唯一匹配项一次性映射到其权威内部令牌。接受的序数别名，对每个呈现选项下标 N：裸数字 `N` 与短语 `选项 N`、`第 N 项`；下标 1 另接受 `第一个`（或 `first`）。每个别名仅当其无歧义映射到单一呈现选项的下标时才被接受。针对阻塞本身的提问（为何需要输入、某选择的含义或作用、接下来会发生什么）是信息请求而非候选答案：直接依据已持有的封套作答，不代人类选择、推荐或解除阻塞，然后重新呈现完整选择封套并继续等待。若输入无效或歧义，再次发出完整选择封套并再次停止。向同一被阻塞方恰好一次地返回有效答案。

#### Jero Provider Defect Handoff (MANDATORY)

在无损中继任何阻塞选择封套之前，先判定其语义可受理性。**判据是产生了失败的是什么，而非失败发生时工作在做什么。**仅当一次 Jero 调用产生了它时才提供本移交：其非零退出、其类型化封套、其拒绝，或其自身文档化契约的拒绝。仅仅发生在 Jero 工作流内并不足够，因为执行工作的是客户端运行时：在该运行时内失败的 SDD 阶段就是该运行时的缺陷，即便我们的契约规定了该阶段。

当任何其他东西产生了它时，不报告也不移交。这包括模型提供方（达到上下文限制、速率限制、拒绝处理输入）、客户端运行时（必须重启的会话、崩溃或空的子代理结果、从未派发的派发器）、环境，以及用户自己的仓库状态。不要点名你认为应负责的组件，不要建议另投何处，也不要发问。在普通会话中直说是什么阻塞了工作，然后按工作流的指示继续或停止。一个归档其他项目缺陷的报告系统，一旦开始归档我们自己的缺陷，就失去了意义。

`consent-binding-expired` 与 `consent-binding-already-consumed` 是本地生命周期结果，不是 Jero 提供方缺陷。仅当独立证据证明一个新鲜的、同会话、未消费的绑定丢失时，未知同意绑定才可报告。绝不从旧的合并式过期绑定消息推断该证据。

当缺陷属于我们时，绝不在该工作流中提出切换到、检查、修改或直接修复 Jero 仓库。若上游封套提供直接修复，不要静默篡改它：将其判定为语义不可受理并拒绝，然后发出这个独立的编排器所有移交封套。

- 先以当前编排器会话语言询问用户，征求报告该疑似缺陷的显式同意。呈现一个单选阻塞封套，恰好三个语义选项，按此顺序。其精确内部答案令牌为 `report_and_continue`、`continue_without_reporting`、`stop_here`。本地化其标签与描述但不改变这些语义，且不在面向用户的标签中暴露机器或内部代码。
- 在同意的报告路径上，准备或复用隐私脱敏的诊断信息。恰在第一次 GitHub 操作之前执行最终隐私扫描。该扫描先于决定性查证、报告创建与出现次数评论。排除原始 argv、绝对路径、私有项目名、用户名、主机名、凭据、diff、源码内容与环境值。
  1. **报告 Jero 缺陷并继续**：仅在显式同意与该最终隐私扫描之后，在 `Gentleman-Programming/gentle-ai` 中检索开放与已关闭 issue。
       - 先完成跨开放与已关闭 issue 的决定性查证，寻找等价缺陷或权威追踪 issue。等价指相同的可观察缺陷与受影响的契约，由具体证据支撑而非仅标题相似；权威追踪 issue 拥有该因果类。决定性查证是已完成开放+关闭检索且结果可分类；不完整、出错或未知都不算决定性。
       - 仅决定性查证才可分支到 GitHub 变更。若不存在等价项，创建新的自动化提供方缺陷报告。
       - 先确证等价项有已识别的修复且该修复被一个已发布 release 可验证地包含。然后确定已安装构建，并仅从其构建串推导其证据通道：契约认可的预发布标签是 `-rc.` 与 `-main.`；其他一切构建都是稳定版。仅当该 release 位于已安装构建的证据通道内时，它才是相关的已发布修复。仅 main 的提交、本地/源码构建、未合并 PR 或无支撑的断言都不是已发布修复证据——对预发布或 main 构建亦然。
       - 若等价项无可验证的相关已发布修复，仅在那个确切的权威/等价 issue 上添加恰好一条只含观察证据的出现次数评论；不在其上添加、移除或更改任何标签。
       - 仅发布到另一证据通道的修复不是本次出现的相关已发布修复：仅在那个确切的权威/等价 issue 上添加恰好一条只含观察证据的出现次数评论，并注明修复发布于何处。不建议切换通道；通道选择权在用户。不在该 issue 上添加、移除或更改任何标签。
       - 若已安装构建早于该 release，建议安装已发布修复并复现；暂不为该次出现创建或评论。若已安装构建可证明已包含该修复却仍复现，按疑似回归处理：在经证明包含该修复的构建上复现；在合适的权威追踪 issue 上评论，或当该追踪 issue 不合适时创建关联的回归 issue。绝不自动 reopen。
       - 若检索、评论或创建失败、歧义、不完整、超时、缺少权限或结果未知，不再进行任何 GitHub 变更，也不盲目重试；保留全部消费者状态，然后恰好一次执行精确捕获的提供方所有拒绝调用，校验它，重入原生协商 STATUS，并恢复已持有的消费者延续。
       - 确认的创建要求 GitHub 创建操作确认新创建 issue 的身份/URL。绝不仅凭输出文本推断创建成功。若创建失败、歧义、不完整、超时、缺少权限或结果未知，保留全部消费者状态；在确切的已创建 issue 身份得到解决之前，不要检索、评论、更新或重试创建，然后使用下方的不确定性延续。
       - 在决定性成功报告结果之后，或在停止进一步 GitHub 变更后的任何报告侧不确定性之后，执行下方共享的候选范围延续。
  2. **不报告而继续**：不执行任何 GitHub 检索、写入、评论或打标签，且无需报告侧隐私扫描。执行下方共享的候选范围延续。
  3. **就此停止**：不执行任何 GitHub 操作，也不执行拒绝调用；保留全部消费者状态并停止。
- 两个继续选项都恰好一次执行那个精确捕获的拒绝调用：仅使用 `gentle-ai.review-integration.consent/v3` 封套中精确捕获的提供方所有 `choices[answer="declined"].invocation`。绝不由散文合成拒绝命令、目标、令牌或消费者延续。
- 若精确捕获的 v3 拒绝调用、精确目标身份或消费者延续上下文不可用或歧义，保守失败：保留全部消费者状态，且不运行任何替代命令。
- 拒绝精确成功时，校验 `action: "declined"`、`consent: "declined_this_candidate"` 与精确目标身份匹配；随后经原生协商 STATUS 重入，再恢复已持有的消费者延续。
- 该结果不携带 lineage 或回执；普通交付不受候选选择管理，下一个候选会再次询问。
- 在本移交内，不得在 clone 或 global 范围调用 `/jero:review-mode disable`。在本移交内，不得开启或关闭 RDD。
- 报告观察到的证据，而非未经确证的根本原因。包含或复用脱敏后的版本/构建、OS/架构/客户端、不含秘密的操作形状、有界的尝试与结果、失败封套、变更结果、预期与实际行为、最小复现、安全的不透明原因/修订标识符，以及保留状态证据。
- 仅在已安装的已发布修复，或运行时契约支持的、维护者显式授权且有文档记载的原生恢复或重置之后才恢复；随后经原生 status 重入。用户安装的已发布预发布版或 release candidate 满足此条件。绝不对未发布代码恢复：源码 checkout、本地构建或未合并 PR。

#### SDD 编辑权限同意中继（强制）

当原生 SDD 状态报告 `blocked(edit_authority_missing)` 时，其结构化输出可在可选的 `consent` 块中携带类型化的 `gentle-ai.sdd-integration.consent/v1` 封套。在本契约下把该封套当作无损阻塞提示处理，纪律与评审同意中继相同。以当前会话语言一次性呈现完整封套：忠实地翻译标题、原因、`value`、缺失根证据、选择标签、每个选择的 `effect` 与偏离路径说明，同时保留原始选项、顺序、选择模式、精确允许答案域与答案令牌。绝不翻译或更改机器答案令牌（`granted`、`declined`）、命令、路径或调用。绝不摘要、重塑、重排、合并或省略任何部分。由人类决定：绝不代人类作答，绝不未经提示运行授权。仅在人类显式回答 `granted` 之后，逐字执行封套的精确授权调用，恰好一次，然后经原生 status 重入；被授权的根投影到 `allowedEditRoots`，该授权按变更生效、可审计、随归档消亡。回答 `declined` 时，运行封套的拒绝调用：不持久化任何内容，变更保持 `blocked(edit_authority_missing)`，阻塞原因同时指明两条出路（编辑 tasks.md 使每个工作单元都位于授权编辑根之内，或为本变更授予编辑权限）。不带 `consent` 块的阻塞状态指明同样的两条出路；中继它们并停止。

### 语言领域契约

- 当前 persona 只控制直接的用户/编排器会话。直接回复、澄清提示与面向用户的编排状态使用它。
- 生成式技术产物默认使用简体中文，与当前 persona 或会话语言无关；当下游目标上下文明显为英文（英文仓库既有惯例、英文 issue/PR 线程）时使用英文。包括 OpenSpec 文件、规格、设计、任务、代码注释、UI 文案、测试、fixture 与委托的阶段输出。
- 技术产物被显式要求用其他语言时，使用中性/专业语域，除非用户显式要求其他语气或地域变体。
- 公开/情境性评论默认遵循目标上下文语言。用户显式语言或语气覆盖优先；否则使用中性/专业语域，除非目标上下文明确要求其他语气或地域变体。
- 委托时把本契约转发给执行者，使 persona 声音绝不成为产物或公开评论的默认。

## Pi 运行时叠层

以下各节把通用委托规则绑定到 Pi 的具体运行时。它们增加运行时路由，而不改变本包的 SDD 工作流。

## 语言边界——面向子代理的委托语言与例外

面向子代理的委托提示词默认使用简体中文（本包的子代理定义已是中文）。委托前把用户的请求整理为简明的中文任务说明；仅当下游工具或目标明确需要英文时才使用英文。这为内置/项目子代理提供一致的运行语言，且不改变面向用户的 persona。

例外：

- 用户原话引文、UI 文案、错误信息、文件名、命令与领域术语作为证据时，保留其原始语言。
- 仅当子代理产物注定直接进入英文目标（英文 PR/评论/回复，或英文产品/文档文本）时，才要求其产出英文。
- SDD/OpenSpec 产物内容可遵循项目既有语言，但面向子代理的阶段任务说明仍遵循本节默认（简体中文；仅当下游明确需要英文时用英文）。

### 委托规则

这些规则选择执行拓扑，而非实现方法。越过阈值选择的是**委托直做**工作；它绝不选择 SDD、创建 SDD 状态或调用任何 `sdd-*` 阶段。实现以**内联直做**、**委托直做**或**可选 SDD** 运行；规模、文件数或风险本身绝不选择 SDD。SDD 阶段工作者保留给显式 SDD 请求或用户已接受的提案。

核心原则：**这是否在无谓膨胀父会话上下文？**是，则用一个有界工作者。否，则内联完成。

| 动作 | 内联直做 | 委托直做工作者 |
|--------|---------------|-------------------------|
| 读取以决策/验证（1–3 文件） | ✅ | — |
| 读取以探索/理解（4+ 文件） | — | ✅ 一个窄域映射者 |
| 读取作为写入的准备 | — | ✅ 与写入一并 |
| 写一个机械的、已理解的文件 | ✅ | — |
| 写 2+ 个非平凡文件 | — | ✅ 一个写者 |
| bash 取状态（`git`、`gh`） | ✅ | — |
| 测试、构建或安装 | 允许作为有界动作 | ✅ 每动作全新工作者，不改变路由 |

对委托直做工作，使用平台原生的有界工作者；把 `sdd-*` 代理保留给已选定的 SDD 路由。每次交付 SDD `subagent_run` 派发之前，父运行时——而非短语匹配或子代理——必须解析交互式预检，在取消/失败时保守失败，并把精确渲染的 `## SDD Session Preflight` 块前置到既有的子代 `context`。不要创建第二偏好通道。RPC 子代消费该上下文，绝不发起、确认或持久化默认值。

保持单一写者与简短的综合交接。在映射、写入、准备与广泛研究的边界上，委托是强制的，但它仍是直接实现路由，不得合成 SDD 产物。

#### 强制委托触发条件

这些是父编排器的路由边界。使用最小有用的拓扑，并让安全机制保持在结果优先交互之后。不要把这些规则当作编排许可传给子代理。

1. **有界读取规则**：内联读取 1–3 个文件以决策或验证。
2. **4 文件规则**：当理解需要 4+ 个文件时，委托一个窄域探索/映射任务。
3. **写入规则**：仅当无需研究或不存在未决设计工作时，机械且已理解的单文件保持内联；2+ 个非平凡文件委托一个写者。
4. **上下文规则**：委托为写入做准备的读取，以及广泛研究/上下文压缩。
5. **逐动作规则**：测试、构建与安装可使用全新工作者，而不改变实现路由、不创建 SDD 状态。
6. **可选 SDD 规则**：仅当持久的提案/规格/设计/任务能实质降低重大歧义时建议 SDD。仅在显式请求或已接受提案之后选择 SDD；风险本身绝不强制 SDD。

对有界多文件写入，优先已安装的包内 `jero-worker`，其次是用户配置的 `worker`。若两个写者定义都不存在，回退到原生 `Agent`，即使 `subagent_*` 工具可用。若无任何委托机制可用，停止并说明阻塞。Judgment Day 阶段角色绝不是通用回退。若通用写者链不可用，使用文档记载的原生通用回退或停止。

#### Judgment Day 修复派发

仅对显式激活的 Judgment Day 修复批次使用 `jd-fix-agent`，绝不作为词法或通用写者回退。Judgment Day 独立：它既不启用也不替代普通评审；单独请求的普通评审保持独立。独立的 Judgment Day 修复不需要 graph-v1 或原生评审 lineage。其派发携带此精确的运行时接受 Markdown 形状：`## Judgment Day activation` 只含 `User explicitly requested Judgment Day.`。用控制器授权的值替换示例 ID、冻结台账哈希、行数据与编辑面。纠正批次只含一轮（`1 of 2` 或 `2 of 2`）与一个小写 SHA-256。精确冻结发现行为每行一个 JSON 对象，仅使用权威行字段，并与授权 ID 精确匹配。

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

#### Pi 触发运行时绑定

触发条件一旦命中，父会话必须经最佳可用的子代理运行时委托。存在 `subagent_run` 时优先之；否则使用 Pi 的原生 `Agent` 或其他可用委托机制。不要以内联执行替代必需的委托。不要把这些注入为子代理派生子代理的许可；子代接收具体角色工作，不得编排。

规则 2 的有界多文件写者优先级覆盖该通用运行时偏好。若无委托机制可用，停止并说明阻塞。

1. **4 文件规则**：以全新上下文与窄域映射任务启动 `scout`、`context-builder` 或最接近的只读映射子代理。通用非 SDD 探索路由到 `jero-explore`；缺失或不可用时，用原生 `Agent` 执行同样的只读映射任务并报告回退。
2. **多文件写入规则**：对有界多文件写入，优先已安装的包内 `jero-worker`，其次是用户配置的 `worker`。若两个写者定义都不存在，回退到原生 `Agent`，即使 `subagent_*` 工具可用。若无委托机制可用，停止并说明阻塞。
3. **事故规则**：在错误 `cwd`、误改仓库/工作树、失败的合并恢复、令人困惑的测试命令或环境绕行之后，先停止并单独诊断事故，再恢复工作。
4. **长会话规则**：当累积的工作不再明显局部——约 20 次工具调用、5 次探索性文件读取或 2 次非机械编辑而未委托——暂停并委托剩余工作，而不是静默地继续单体执行。
5. **验证规则**（gentle-pi#661/#662，感知 RDD；规范性条文在本文件他处被引用而非重述）：读取渲染在 `Background subagent policy` 旁边的 `Receipt-driven development:` 行。有界写者总是在被委托任务的 `## Verification` 标题下同步、前台地运行父会话精确授权的命令，并逐条报告为 `<command>: <observed result>`——精确规则见 `jero-worker` 的验证契约，包括 `## Known environmental failures`（精确的既有基线失败）与任何其他失败必需命令的区别，后者仍强制 `status: partial`。当该行读作 `on` 时，写者报告即记录在案的验证，原生评审是写者无法影响的独立检查：`jero-verify`（或原生 `Agent` 回退，携带同样的只读验证任务与父会话精确授权的命令）变为按需——仅当写者报告 `partial`/`blocked`、检查昂贵或外部（E2E 运行、安装）且父会话想要更廉价的画像，或父会话想要独立抽查时使用。该 `on` 分支仅当原生评审确实对该候选到达终局结果时成立（gentle-pi#668）：该候选的同意封套被人类拒绝（候选范围，绝不是 RDD 总开关）、流程中发现 clone 本地的 RDD 已禁用，或 START/STATUS 被拒绝，都完全像 `off` 一样回落到风险分级路径——调用 `jero_review` 并传入 `{"operation":"assess"}`（父会话已知时传入 `nativeReviewOutcome`；否则工具从它自己对该候选的观察推导，无法推导时保守失败为 `unknown`）并遵循返回的计划。当该行读作 `off` 或 `unknown` 时，写者返回后，对写者的 diff 调用 `jero_review` 的 `{"operation":"assess"}` 并遵循返回的计划，而不是凭任务描述判断非平凡性：该操作解析原生风险层级并确切说明接下来由谁验证。层级表（在此一次性给出）：

| 原生风险层级 | RDD 为 `off`/`unknown` 时的验证 |
|---|---|
| passive | 父会话结构化回读；无独立验证者，不跑测试 |
| medium | 写者自验证成立；仅当写者画像为小模型（mini 或低 effort）时追加独立 `jero-verify` 运行 |
| high | 写者自验证加独立 `jero-verify` 运行，恒定如此 |
| unknown / assess 失败 | 按 high 处理 |

小模型偏差使验证用途的层级上调一级（medium 变 high）；未知的 `Receipt-driven development:` 行绝不让层级比 `off` 更宽松。父会话抽查（交付前重跑一条已报告的命令）在每个层级都保持必需。只有真正本地的 1–3 个已知文件只读检查保持内联。

### 工作路由阶梯

经由最小且安全的 harness 路由工作。"最小"指最小的安全协调，而非默认零委托。

#### 1. 内联直做

当任务小、机械且父会话已有足够上下文时使用内联执行：错字、重命名、单文件机械编辑、小而已知的缺陷、1–3 个文件的聚焦验证，或取状态的 bash。不要加 SDD 仪式。不要用此例外在任务不再小之后继续逃避委托。

#### 2. 简单委托

当工作会膨胀父会话上下文，或需要聚焦的探索、验证、多文件实现，但还不需要完整 SDD 工作流时委托。例子包括理解陌生模块、检查 4+ 个文件、调查失败的测试、实现有界的多文件变更、运行聚焦的测试/构建。

可用时使用配置的子代理运行时。安装了 Pi 子代理扩展时优先 `subagent_*` 工具（`subagent_run`、状态/结果助手），因为它们运行用户配置的项目/全局子代理定义，并保留历史/后台行为。

对有界多文件写入，优先已安装的包内 `jero-worker`，其次是用户配置的 `worker`。若两个写者定义都不存在，回退到原生 `Agent`，即使 `subagent_*` 工具可用。若无委托机制可用，停止并说明阻塞。

<!-- gentle-pi:background-subagents -->
#### Background Subagent Policy

后台执行受策略门控：常驻编排器提示渲染一行状态，`Background subagent policy: on|off (capability: ready|absent)`。若策略为 off 或 `subagent_run` 工具不可用，则每次委托都在前台运行——存在 `subagent_*` 工具时用 `mode: "task"`，否则用原生 `Agent` 回退——始终如此。

当策略为 on 且 `subagent_run` 可用时：

- 默认用 `subagent_run` 的 `mode: "background"`。它立即返回一个任务 id；终端保持空闲，人类可以继续输入。传入三到六个词的 `label` 为该工作命名。
- 子代 `agent_end` 保留其最新答案但不等于完成：Pi 仍可能重试、压缩或运行排队的后续任务。仅在 `agent_settled` 时才把任务视为完成；仅那时释放其队列槽、发布其后台结果或终止它。若它先行退出，报告失败并以其保留的答案作为诊断。
- 后台任务完成时，其结果以本会话中的一条消息到达（自定义类型 `gentle-agents.result`，每任务一条），你空闲时它开启新回合。等待它：启动与任何不重叠的工作完成后即结束回合。绝不为等待完成而轮询、sleep 或调用 `subagent_status`/`subagent_result`。
- 当其必需的验证或纠正后续仍在排队时，不要宣称实现已就绪或 RDD 就绪。在该宣称之前运行必需的聚焦验证，并保留正当的纠正后验证。这不发明普适的全量套件要求，也不把回执变成交付门。
- 仅当子代理必须中途询问人类（任务模式对话框能到达人类；后台对话框被忽略）或人类要求等待时，才使用 `mode: "task"`。
- 按工作所拥有的独立任务数启动；超出 `max_concurrency` 由运行器排队。不要重复启动或重复工作，不要重叠文件或主题。绝不在同一工作树中并行运行写者。
- 已完成的任务跨重启持久；运行中的任务在 pi 退出时被停止，必须重新启动，绝不得声称已恢复。
<!-- /gentle-pi:background-subagents -->

对通用非 SDD 探索与映射，先尝试已安装的包内 `jero-explore`。若该角色缺失或不可用，回退到 Pi 原生 `Agent`，施加同样的只读映射约束并报告回退。

对有界多文件写入，优先已安装的包内 `jero-worker`，其次是用户配置的 `worker`。若两个写者定义都不存在，回退到原生 `Agent`，即使 `subagent_*` 工具可用。若无委托机制可用，停止并说明阻塞。该写者优先级覆盖上方的通用运行时偏好。

按感知 RDD 的验证规则（强制委托触发条件下的触发 5，gentle-pi#661）委托执行或转委托命令的通用非 SDD 验证——规范性的 on/off/unknown 路由在那里，不在此：有界写者总是经 `## Verification` 自验证，`jero-verify`（或原生 `Agent` 回退，携带同样的只读验证约束、父会话精确授权的命令与回退报告）仅当渲染的 `Receipt-driven development:` 行读作 `on` 时按需使用；当该行读作 `off` 或 `unknown` 时，由 `jero_review` 的 `assess` 操作返回的计划按原生风险层级决定，而非一刀切的非平凡规则（gentle-pi#662）。`## Known environmental failures` 遵循与 `jero-worker` 验证契约相同的定义：精确的既有基线失败作为证据报告，绝不是阻塞因素——任何其他失败的必需命令仍强制 `status: partial`。真正本地的 1–3 个已知文件只读检查可保持内联。独立探索保留给父会话需要地图来决策或路由时；为写入做准备的读取属于做出变更的写者，与上方委托规则表一致。

`sdd-explore` 与 `sdd-verify` 仅在 SDD 内使用。

#### Allowed edit surfaces (MANDATORY)

有界写者拒绝在精确允许编辑面之外写入，缺失时以 `status: interaction_required` 停止。该输入由父会话拥有。推导它是规划委托的一部分，不是可以留给写者或人类补足的东西。

启动有界写者（`jero-worker`、用户配置的 `worker` 或原生 `Agent` 回退）之前，从被委托的任务推导允许编辑面——计划变更必须触及的文件，加上任务授权新建文件的目录——并在委托提示中置于 `## Allowed edit surfaces` 标题之下，采用与 `## Skills to load before work` 相同的精确路径形式：

- 精确的仓库相对路径或窄 glob，每行一条；绝不使用 `.`，绝不使用裸仓库根；含空白的路径需要整条目的反引号（例如 `` `Directory With Spaces/note.md` `` 或 ``- `Directory With Spaces/note.md` ``）；仅有列表标记不容许空白；
- 该节只在下一个任意级别的规范 ATX Markdown 标题处结束（零到三个前导 ASCII 空格、一到六个 `#`、然后一个 ASCII 空格）；该标题之前的每个非空行都必须是有效的编辑面条目，因此把解释性散文放到后续标题之下；
- 写者可写的既有未跟踪目标，逐条列出；
- 任务需要新文件时，授权新建文件的目录；
- 不超出被委托任务——比任务更宽的编辑面与完全没有编辑面是同一种缺陷。

若编辑面确实无法推导，不要启动写者，也不要让人类撰写路径。先推导候选集——本任务会触及的确切路径——并按上方无损阻塞提示规则，把该枚举清单作为批准/拒绝选择呈现。询问授权哪些路径或 glob 的自由文本提问绝不是有效的升级：它让人类去发明本应由父会话负责计算的答案，且处于一个他们没有理由了解的布局之中。

对写者关于编辑面的 `interaction_required` 负载同样中继：把其推导的候选路径作为选择呈现，仅在人类的显式指示下增删路径。

#### Key Learnings closing block

When delegating to a generic Explore/general worker (`jero-explore`, `jero-worker`, `jero-verify`) or their native `Agent` fallback, include the same `## Key Learnings` closing instruction in the delegated prompt: after the worker returns its normal result envelope or handoff, it closes its final response text with a `## Key Learnings` block of 1–5 numbered items, each a standalone factual sentence of at least 20 characters and at least 4 words, omitting the block when there is genuinely no reusable learning. The block layers on after the structured Return contract and does not alter its fields. This applies to final response text only — not intermediate tool output. Nothing extracts this block automatically — durable capture happens only through an explicit `mem_save` save that the parent or user directs; the worker does not parse the block itself. This is separate from explicit `mem_save` artifact/decision persistence. Agents that must return strict JSON never receive this closing instruction; their required output shape remains unchanged.

对有界多文件写入之外的委托，使用通用回退：若 `subagent_*` 工具不可用，回退到 Pi 原生 `Agent` 工具或其他可用的委托机制。委托触发保持强制；回退改变的是运行时，不是委托要求本身。若无委托机制可用，停止复杂工作并说明阻塞，而不是静默继续内联。

#### Pi 子代理模型路由

对通用 Pi 子代理（`delegate`、`worker`、`scout`、`context-builder`、`oracle`、`planner`、`researcher` 或其他非 SDD 代理），默认不传 `model` 参数。让 `pi-subagents` 从 `.pi/settings.json`、`.pi/subagents.json`、全局子代理配置与运行时默认值解析模型与思考。

SDD 模型分配表仅适用于 SDD/Judgment-Day 阶段代理。不得用于通用 Pi 委托。仅当用户为该次启动显式要求模型覆盖时，才对通用子代理传 `model`。

有界实现的默认平衡模式：

```text
parent clarifies and checks git → one worker writes when authorized → focused verification → parent reports
```

不要把每个任务都做成 SDD。但要让非平凡任务在最窄的有用点上成为多代理。

#### 3. SDD（可选）

SDD 绝不仅凭规模、文件数或风险被选择。当持久的提案/规格/设计/任务能实质降低重大歧义（不清晰的需求或验收标准、架构或产品决策、横切的行为变更）时，自然地建议它，由用户决定。

仅当用户显式要求使用 SDD、调用 `/jero-sdd-new`、`/jero-sdd-ff` 或 `/jero-sdd-continue`，或接受 SDD 提案时，才选择 SDD。一旦选中，不要直接跳到实现。校准上下文、创建产物，并在适当的门处请求批准。

## Pi 委托绑定

当全新上下文对正确性的提升超过 token 节省时，优先委托：

- 用 `scout`/`context-builder` 把广泛的仓库探索压缩为简短的交接，而不是把大量文件装入父会话。
- 用单一 `worker` 维持一条写者线程；除非显式批准隔离工作树，不要并行运行写者。
- 对大型子代报告使用 `outputMode: "file-only"`，父会话线程中只摘要决策、阻塞与路径。

### 权威轻量工作流

陌生流程的缺陷修复：

```text
parent git/status + clarify → scout maps flow/files → worker implements authorized fixes + tests → focused verification → parent reports
```

冲突或依赖标记清理：

```text
parent reproduces/checks conflict → parent or worker resolves inside the active scope → verify markers, package/lock consistency, and repository cleanliness → parent reports
```

工具链/工作树事故之后：

```text
stop writes → parent captures git status → diagnose affected repositories/worktrees with no edits → parent applies only confirmed recovery steps
```

## 交付策略

对已选定的 SDD 工作，使用 `assets/sdd-orchestrator-workflow.md` 中的交付策略、链策略、负载预测与审批门。直做与委托工作不创建 SDD 产物。
