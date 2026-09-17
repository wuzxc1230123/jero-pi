# P4d-f/g 剩余接线分析（2026-09-17，P4d-e 提交后）

## 剩余调用面盘点（extensions/gentle-ai.ts 对默认 CLI 的真实调用）

| 方法 | 调用点 | 状态 |
|---|---|---|
| start / answerConsent | :7880 / :7675 | ✅ P4d-e 已接 |
| captureCorrectionPlan | :7014 | 本批实现 |
| captureProviderRole | :6535（经 executeProviderRoleVectorCapture） | 待设计决策（见下） |
| captureUnachievableLens | :6391 | ⚠️ 权威侧无对应写入操作（M3 未实现 declaration），暂留 fail-closed 桩 |
| captureResult / repair | 无生产调用点（relay 已覆盖 / 控制器走 targetStatus+本地 store） | 死面，P4e 删 |
| acknowledgeApproved | :7569（NativeReviewAcknowledgementCli 增广面） | 本批实现 |
| abandon / reconcileAuthority / reclaim / recover | :5002 / :5005 / :5127 / :5128 | 本批实现 |
| quarantineLegacy / repairLegacyAlias | :5002 分支 / :5071 | §5.1.6 裁剪面：控制器操作与 CLI 面应在 P4e 一并删除 |

## 权威 API 映射（已核实）

- correction plan → `reviewFinalizeV1({correction_line_forecast})` → `fix_authorized`；closure 经 `buildJeroLastEventClosureV1({operation:"review.capture-correction-plan", state:"correction_required", requestHash, correctionLines})`
- validation 向量 → render `{kind:"validator-vector"}`（prompt 内嵌 request_hash）→ 子进程按 VALIDATOR_ROLE_INSTRUCTIONS 契约作答 → `reviewValidateV1({evidence, validation})` → `reviewFinalizeV1({final_evidence, final_verification_passed:true})` → closure `review.capture-validation`（state approved）
- refuter 向量 → render `{kind:"refuter-vector"}`（findings_frozen + pending_refuter_ids 非空）→ 子进程 resolutions → `reviewFinalizeV1({refuter_batch:{request_hash, resolutions}})`；request_hash = `pendingRefuterRequestHashV1(pending)`（finalize.ts 私有，需导出或经 record 推导）
- acknowledge → `reviewAcknowledgeV1({lineageId, targetIdentity, expectedRevision, token})`；token 为 STATUS 绑定发布值（本批：`jero-burn:<lineage>:<revision>`）
- 维护四联 → `abandonJeroLineageV1 / reclaimJeroAuthorityV1 / recoverJeroLineageV1 / reconcileJeroAuthorityV1`；授权串扩展侧本地镜像 `nativeReviewAbandonAuthorization` 与权威 `jeroAbandonAuthorizationV1` 同构

## 本批同时修复的两个上游投影缺口

1. **acknowledge execute 负载缺失**：transitions.ts:284 的 approved execute 无参数负载，而扩展 `assertReviewApprovedAcknowledgementExecuteV1` 要求恰 5 参数（cwd/lineage/target/expected-revision/token）+ binding + 单前置条件 → attachTransitionPayloadsV1 需补挂
2. **execute.binding 命名**：`buildJeroFinalizeExecuteTransitionV1` 的 binding 是 snake_case（lineage_id/revision/target_identity），wire 投影 verbatim 透传，而扩展消费 camelCase（binding.targetIdentity）→ projectJeroStatusToWireV1 需转换 execute 负载字段

## 开放设计问题（P4d-f 收尾前必须定案）

**Q-A：finalize 组合缺口（最重要）**。`admitJeroCaptureResultForRelayV1`（P4b relay 缝）只做工件准入；工件齐全后 STATUS 给 execute `review.finalize --captured-results=true`，但**没有任何执行者**把已准入工件聚合成 `reviewFinalizeV1({review_result, reviewer_run_acknowledged})`。老架构里二进制在 capture-result 提交内原子完成。候选方案：
  (a) relay admit 缝在"工件齐全"时联动聚合 finalize（对齐老原子性，但 admit 缝职责扩大）；
  (b) 扩展侧 execute 接线：看到 captured_results_ready execute → 调新的聚合入口（如 `finalizeCapturedResultsV1`）。
  建议 (b)：STATUS 驱动、幂等键清晰、失败面可 reconcile。**注意**：classifications 作者是谁仍未定——findings_frozen 后 transitions 给 collect `evidence_classification_required`，但 collect-inputs 没有对应 input 构造器（A.1–A.4 之外缺失），需核对 M3 规格此步是否应由 finalize execute 一步携带（review_result+classifications 同包）或补一个 A.5 classification 向量。authority-acknowledge.test 的 driveToApproved 显示顺序：review_result → classifications([]) → final_evidence 三次 finalize 调用——生产等价物流仍未接。

**Q-B：captureProviderRole 的 relay 组合**。validator/refuter 向量需要 render→relay(pi 子进程)→admit 全链。lib 层可复用 prepareReviewHostRelaySlot/submitReviewHostRelayPreparedResult + 新 render/admit 角色缝（capture-relay.ts 扩展）。依赖 Q-A 的 admission 语义定案后实施。

**Q-C：unachievable-lens declaration**。权威无写入操作，扩展路径当前 catch 后走 declaration-failure 面。P4e 决策：补权威 declaration（M3 规格若有）或删扩展声明路径。

## 测试与门

- 新增 adapter 测试：维护四联（授权串不匹配 fail-closed）、acknowledge burn/replay/binding-mismatch、correction plan（含 {{value}} 替换纪律与 closure wire 可解码）
- 既有 261 权威测试 + conformance 必须保持全绿；typecheck 146 基线；authority-boundary 门洁净

## Q-A 已实施（前半，2026-09-17）

admit 缝组合落地：`admitJeroCaptureResultForRelayV1` 在非重放准入使工件集齐全时，从标准结果目录聚合信封 → `reviewFinalizeV1(review_result)` 冻结 → 由信封行推导 classifications 再 `reviewFinalizeV1(classifications)` 分类。发现行按 finalize 封闭键集（id/location/severity/claim/proof_refs）投影，class 沿 evidence_class、proof 取 proof_refs 连接。组合结果随 manifest 的 finalize_composition 诊断位透出（refused 不撤回已准入工件，不谎报非变更）。测试：tests/authority/authority-capture-composition.test.ts 2 项（severe→correction-plan 闭环经 P4d-g captureCorrectionPlan；clean→final_evidence_required 停靠点）。

**仍开放的 Q-A2**：evidence_classified 无修复项后的 final evidence（`final_evidence_required` execute）驱动者未接——需要终验证据来源设计（wrapper 会话产出 vs 终验向量）。

## 实施后记（2026-09-17 本批已落地）

- 维护四联 + acknowledgeApproved + captureCorrectionPlan 已接线并测试（tests/authority/authority-maintenance-cli.test.ts 5 项；全套 266 绿）。
- 两个投影缺口已修：acknowledge execute 负载补挂（status.ts）、execute.binding snake→camel wire 投影（wire.ts projectJeroExecuteToWireV1）。
- Q-A 线索：评审信封 findings 行自带 evidence_class/causal_disposition（fixtures.ts admitFixtureReviewerResults 可证）——classifications 可由已准入信封行推导，finalize 聚合入口的入参来源解决；剩余决策仅为组合位置（admit 缝联动 vs execute 接线）。
- Q-B/Q-C 未动，见正文。
