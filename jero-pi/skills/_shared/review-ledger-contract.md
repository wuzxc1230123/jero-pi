# 紧凑因果评审契约

The local orchestrator and same-user process are trusted to execute selected actors and submit their exact outputs. Reviewer and validator outputs remain semantically untrusted inputs: native code owns scope, risk, IDs, canonicalization, ordinary state, and legal lifecycle transitions, and rejects malformed or causally inconsistent results.（本地编排器与同用户进程受信任地执行所选执行者并提交其确切输出；而评审者与验证者的输出仍是语义上不可信的输入，权威归属原生代码。）Git 公共目录权威是唯一的授权来源；摘要与散文台账是不可信数据。旧版 Pi 镜像与 bundle 传输已退役。

Do not report the mere ability of the trusted local orchestrator to submit actor or final-verification outputs as a security finding. Report concrete bypasses where untrusted repository content, malformed inputs, stale authority, path drift, or external callers can produce approval contrary to this boundary.（不要把受信本地编排器"能够提交"这件事本身报成安全问题；只报告具体越界。）恶意的同用户宿主/进程真实性不在目标范围内，因为它可以替换扩展或篡改本地权威；外部证明需要单独的特权签名者或服务，且本契约不作此声明。

## 普通评审门面

对每个新的普通评审，把 `jero_review` 用作 `start -> finalize -> validate`。

`start` 推导仓库根、完整 Git 快照、未跟踪集合、谱系、风险层级、所选评审视角、原始署名改动行数与纠正预算。层级、范围、原始行数与预算在 start 之后绝不改变。

风险路由是确定性的：

| 层级 | 路由 |
|---|---|
| `low` | 零评审视角；仅限被证明的文档/注释/格式/错别字字符串工作，无可执行或配置变更 |
| `medium` | 普通变更使用一个主导评审视角 |
| `high` | 权威 4R：用于 auth、update、security、payments、数据暴露/丢失、权限、shell/进程，或超过 400 行署名改动 |

匹配 `testdata/golden/**` 的生成文件保留在快照身份中，但不计入署名风险行。普通测试、fixture 与快照绝不被广泛排除。纠正预算冻结为 `min(200, ceil(original_changed_lines / 2))`。

在 status/START 之前，查询生效的评审模式。`off` 不创建任何权威或授权，产出自然的 `disabled/unmanaged`，绝不是批准。普通 START 声明 `--consent relay`；低风险保持静默。中/高风险的 `consent/v3` 结果携带完整的原始两选一提供方封套，外加一个不透明的内存候选绑定。在符合条件的交互式父 Pi 会话中，宿主原样展示两个提供方标签与效果，外加一个明确分开的宿主动作：**Run this review and allow reviews for this Pi session**。前两个动作保持仅候选。人工直接选择第三个动作，会通过 `answer-consent` 执行该新鲜封套既有确切的 `granted` 调用，然后只为同一个存活 SessionManager 对象、确切的非空会话 ID 与权威 Git 工作树根，授权未来的新鲜已验证封套。每个封套在提供方变更之前一次性消费，并复查仓库、目标、投影、谱系、应答绑定与存活会话身份；含糊之处通过 STATUS 调和，绝不重放。

宿主授权只存在于一个经 schema 校验的 `globalThis[Symbol.for(...)]` WeakMap 注册表中。重载保留 SessionManager 并重连授权；退出、新建、恢复、分叉、显式撤销或进程重启会移除它。`/tree` 保留它。子代理进程、headless/RPC/不支持的 UI、显式的跨仓库 `workspaceRoot`、模型散文与工具参数，都不能提供、创建或消费它。它不授予任何提供方模式、裁定、成本预测、确认、维护、交付或跨仓库权威。若宿主 UI 被取消、失败或无法证明当前 Git/会话身份，则原样返回未决的原提供方封套。若该封套到达父会话，无损地本地化并呈现其原始的两个选择；绝不把宿主动作追加到解码后的提供方契约。拒绝不创建谱系、权威、常驻授权、闩锁或未决授权；下一个候选会再次询问。旧 Pi 克隆的闩锁文件是惰性的，且 Pi 不写 asked 闩锁。

评审者、反驳者与验证者的裁定由原生接纳，绝不是 Pi 署名。`finalize` 遵循提供方协商的 `next_transition`，只提供协商好的收集答案：以 `--agent=pi --materialize=true` 渲染的 lens `review.capture-result` 收集输入由 gentle-pi 宿主中继满足——它打印 Go 物化的确切不透明提示词，在一个空草稿目录中启动一个全新的 lockdown print 模式 `pi` 子进程（关闭所有发现面），并通过提供方拥有的提交表单（provider-owned submission form）提交未经改动的原始输出字节。对抗角色不经过该中继：`review.capture-refuter` 与 `review.capture-validation` 收集输入渲染为自包含的权威推进向量（self-contained authority-advancing vectors：绑定令牌加 `--agent=pi --execute=true`，无提交描述符）；执行渲染出的确切调用会让 Go 物化角色提示词、派生自己的 lockdown `pi` 进程并接纳原始裁定。原生 Go 拥有验证、权威化、缺失 lens/发现 ID 分配、持久化与哈希，且只执行从当前紧凑状态出发的合法迁移。The five states are `reviewing`, `correction_required`, `validating`, `approved`, and `escalated`.

### 并发评审者组（强制）

当一个新鲜 `collect.inputs` 集合包含多个不同的独立 `review.capture-result` 评审者槽位时，调用一次 `jero_review_capture_group`，带上完整的有序提供方绑定及其预测确认。在任何物化之前，它验证整个当前分组、其共同绑定字段、唯一槽位身份与每个提供方提交描述符；然后先启动全部评审者，再开始等待。对权威 4R，保持 `review-risk`、`review-resilience`、`review-readability`、`review-reliability` 顺序。

每个分组启动只运行自己的提供方签发的 `review.capture-result` 绑定，接纳仍按提供方顺序。类型化的终局或非终局闭包直接返回；较早接纳之后发生较晚停止时，报告有界的部分进度，绝不声称无变更。若每次提交都未闭包返回，则调和新鲜绑定的 STATUS 并返回其声明的动作，而不是推断分组成功。在 `correction_required` 时，只通过确切绑定的 STATUS 与提供方签发的 `review.capture-correction-plan` 绑定继续。

`validate` 是信息性的，零执行者运行。它绝不更改紧凑权威，也不控制交付。

## 因果发现

Every finding supplies `evidence_class`, `causal_disposition`, and concrete proof. Concrete proof is one of `changed-hunk`, `candidate-created-path`, `differential-test`, or `before-after`.（每个发现必须给出证据类别、因果定性与具体证明；具体证明取四种之一。）

| 字段 | 取值 |
|---|---|
| `severity` | `BLOCKER` \| `CRITICAL` \| `WARNING` \| `SUGGESTION` |
| `evidence_class` | `deterministic` \| `inferential` \| `insufficient` |
| `causal_disposition` | `introduced` \| `behavior-activated` \| `worsened` \| `pre-existing` \| `base-only` \| `unknown` |
| `proof_refs` | 带前缀的具体证明引用 |

Only severe `introduced`, `behavior-activated`, or `worsened` findings with valid proof can enter `correction_ids`. 确定性的候选致因 blocker 无需反驳者。所有推断性的候选致因 blocker 共享恰好一个完整的只读反驳者批，通过提供方渲染的自包含 `review.capture-refuter` 向量执行：Go 物化反驳者提示词、运行自己的 lockdown `pi` 进程并接纳原始裁定。Pi 绝不署名、编辑、分批或重新打分任何反驳者行。

反驳者行可以引用独立的具体证明，无需重复评审者的 `proof_refs`。`pre-existing` and `base-only` findings become non-blocking follow-ups. `unknown`、证据不足、畸形的严重主张、空/畸形的证明、缺失/重复/多余的反驳者行，以及不确定的严重结局，都会升级。`WARNING` 与 `SUGGESTION` 保持信息性。

执行者输出不能授权迁移、纠正或交付。

## 纠正

Ordinary review permits one correction transaction within the original budget. 它由一次纠正、一个定向验证者与最终验证组成。

编辑之前，`finalize` 要求一个为正的纠正行数预测。预测超过预算即升级。编辑之后，原生权威从 Git 推导实际纠正行数。

初始评审视角绝不重跑。The correction preserves frozen findings and genesis scope: the original candidate tree, paths, untracked set, and correction IDs. 它不能扩大范围。

定向验证者通过提供方渲染的自包含 `review.capture-validation` 向量运行——Go 物化其提示词、运行自己的 lockdown `pi` 进程并接纳原始裁定——且只检查原始标准与针对确切纠正 ID 的一次纠正回归。它不能添加发现、请求另一次纠正、启动执行者、持久化权威或请求另一次尝试。失败即升级。后续观察是惰性跟进。

最终验证证据只在最终化期间提供并哈希。失败即升级，且绝不重开评审。

## 权威与兼容

协商出的原生提供方拥有 compact-v2 存储及其私有路径。Pi 只消费类型化的 START、FINALIZE、目标 status、validation、recovery、reconciliation 与 SDD 绑定结果。Content-derived revisions, compare-and-swap replacement, exact retry idempotency, stale/semantic retry rejection, semantic validation, terminal immutability, atomic publication, and receipt readback remain provider guarantees.（内容推导修订、比较交换替换、精确重试幂等、过期/语义重试拒绝、语义校验、终局不可变、原子发布与回执回读，仍是提供方保证。）

Existing graph-v1 ordinary lineages remain readable for compatibility but reject new mutation. Legacy graph bundle export/import is retired. Judgment Day remains mutable on graph-v1. 前图的编号权威仍仅支持破坏性重置，而原生目标 status 拥有混合权威的含糊性判定与必需的维护者动作。

Pi 永久拥有的消费方基础设施仅限于权威身份原语、仓库/公共目录绑定与不可变候选视图。这些模块不是权威镜像。

## 交付边界

Commit, push, pull-request creation, and release creation are not RDD gates. Review outcomes and receipt state are informational and never authorize, consume, rewrite, or block a Bash delivery command; ordinary repository policy owns delivery. Pi does not inspect RDD mode or native authority for those commands. Review transactions, validation, and SDD never perform delivery commands themselves.

危险命令确认/安全与破坏性评审维护的同意保持独立。

## Judgment Day

Judgment Day is independent: it neither enables nor replaces ordinary review; a separately requested ordinary review remains independent.

Judgment Day starts with exactly two blind judges and zero refuters.

Judgment Day alone may iterate discovery and scoped re-judgment, for at most two rounds.

Findings surviving round two escalate; no third-round transition exists.

A standalone `jd-fix-agent` dispatch requires no graph-v1 or native review lineage and is accepted only with this exact Markdown shape. 校正批只含一轮（`1 of 2` 或 `2 of 2`）与一个小写 SHA-256。精确冻结发现行为每行一个 JSON 对象，只使用权威行字段，且与授权 ID 完全一致。

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

Judgment Day 在 graph-v1 上保持可变。即便普通权威已经原生化，它的 reducer、replay、对象存储、锁、快照与图回执校验依赖仍然存活。
