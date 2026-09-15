# P2-M2 审核结论与修复简报（2026-09-16）

> 审核代理完整报告已核；此处为修复代理的执行清单。裁定者：主会话。
> 总判定：FIX-FIRST——无数据损坏级 BLOCKER，持久化/日志/fail-closed/烧毁模型扎实，120/120 真实；7 MAJOR 须在提交前落地。

## 主会话裁定（对 F4/F6）

- **F4（mode 默认值）**：改为默认 ON，对齐上游（native-review-cli.ts:269-271 "Reviews are on by default; this was never explicitly chosen"）。D9 保留上游已验证语义；静默翻转会使 §B.5 同意仪式永不触发。同步改 authority-mode.test.ts 的默认断言。
- **F6（JD 死胡同）**：M2 拒绝 judgment-day START——start.ts 对 requestMode "judgment-day" 返回类型化拒绝（kind:"refused", code:"judgment-day-unavailable", 说明 M3 驱动落地后开放）。transitions.ts 的 JD 行与测试保留（正确且被纯表测试）。M3 摘门闩时加集成测试"JD 两轮升级"。

## MAJOR 修复清单

| # | 位置 | 问题 | 修法 |
|---|---|---|---|
| F1 | status.ts:131；finalize.ts:236 loadForMutationV1；validate.ts:76 loadLineageV1 | 畸形 lineageId 裸抛 JeroLineageStoreError，违反"公共边界一律判别联合" | 三个入口 isJeroLineageId 预检 → invalid-request 类型化拒绝 |
| F2 | review.ts:46 | forStore 未传 {lock}，withAuthorityLock 空转，全部 M2 变更无锁 | 先建 JeroAuthorityLocksV1 再传入 options.lock |
| F3 | validate.ts:124-147 | reopen 清空 correction_evidence 后 failed_evidence_revision 从未被比对——同一证据身份复用被接受 | 校验 evidenceIdentity !== state.failed_evidence_revision（或记录保留全部历史身份） |
| F5 | finalize.ts:660-707 | apply-fix 信任调用方申报的 actual_correction_lines/candidate_tree/fix_delta_hash，预算超限升级与回执受调用方控制（§9.2 演员输出不可信） | 从隔离快照库 derive：git diff --numstat initial_review_tree..申报 candidate_tree（限 genesis 路径）得实际行数；verify tree 可解析；不符即拒 |
| F6 | start.ts | （见裁定）拒绝 JD START | 类型化拒绝 + M3 注释 |
| F7 | status.ts:130-147 | 显式 lineageId 路径跳过身份匹配：漂移工作区误报 current_target 且 frozen 块混入 LIVE manifest 摘要 | 显式路径同样要求 record.state.snapshot.identity === targetIdentity；否则 unrelated（或漂移处置），绝不发混合 frozen 块 |
| F4 | mode.ts:66 | （见裁定）默认 ON | + 测试同步 |

## MINOR/NIT（一并修）

- F8 start.ts:484-491：零透镜关闭的回执崩溃窗不愈合——重放时补发缺失回执（或并入同锁/日志步骤）。
- F9 start.ts:416-438：默认幂等键下 START-after-burn 返回 replayed(approved)——consumed 检查移到 replay 分支之前。
- F10 start.ts:370-384：同意门阻塞 resume——仅在无活血统时走门（上游：仅在尚未冻结权威时问询）。
- F11 mode.ts:113：mode.set 用 temp+rename 原子写。
- F12 start.ts:226-235：intended 路径须 ⊆ ls-files --others --exclude-standard 清单，预冻结校验。
- F13 死代码：finalize.ts:337 terminalOrRevisionV1；transitions.ts:52 JERO_ACTIVE_REVIEW_STATES；start.ts:119 未发射的 RISK_REASON_CODES service_token/shell_source（删或留注释说明）。
- F14 finalize.ts:674 预算超限升级日志操作名 authorize-fix → 更准确的 apply-fix 事件名；jeroDomainHash("request",{...,input}) 含 idempotencyKey——改哈希输入剔除 idempotencyKey（注意会变 request_hash 语义，测试同步）。
- F15/F16：不修，记录——persisted 枚举实际 11 态可达（evidence_classified/final_verifying 跳过，语义等价）；authority.version "jero-authority/v1" 自有标记可接受。
- 测试 F：authority-validate.test.ts:211 的 `assert.ok(kind==="validated"||kind==="refused")` 同义反复——改具体断言。

## 批准的实现偏差（留档，勿改回）

- snapshots.ts 重实现捕获编排（非参数化）——理由成立：移植件硬编码 gentle-ai 路径 + 任何 .git/gentle-ai 残留永久毒化外源探针；崩溃残留 .capture-* 只落 jero 快照根。
- protocol.ts 扩展两记录（correction_evidence/mode record）——跨进程证据序需要持久化，理由成立（F3 是执行缺口而非设计错误）。
- §D.2 首次 FINALIZE "WITHOUT mutation" 实现为"无状态迁移但持久化分类"——可辩护，保留。
- 身份含 repository_root（上游 SnapshotV1 平价：同字节不同克隆路径不同血统）——批准该读法。
- 烧毁模型：completed acknowledge 日志条目即回执消费标记 + STATUS 排除 consumed——批准。
