# P2-M3 审核结论与修复简报（2026-09-16）

> 总判定：FIX-FIRST。核心（四槽位/渲染/准入/闭包/JD 驱动/staged/relay 缝）扎实，180/180 自有电池绿。
> MAJOR 2（conformance 未接线 + manifest 钉过期）已由主会话修复（test glob 补 conformance + package-manifest pin 更新）。

## 主会话裁定

- **M4（finalize 磁盘前置）**：采纳"最小修 + 文件校验"——freeze-ledger 必须要求 capturedJeroArtifactsCompleteV1 通过，且该谓词真正校验每个已入册透镜的 per-lens 结果文件存在且 sha256 与清单一致（实现其文档承诺）；删除工件后 hand-built review_result 直接 freeze 的旁路必须关闭。
- **Mi5（fix_validating 的 STATUS 形状）**：改为 kind "collect"（reason targeted_validation_ready）携带 validator 向量输入——对齐 §A.4 语义与扩展 kind==="collect" 消费模式；同步调整 M2 转移测试的相关断言。执行 review.validate 的路径经 capture→admit→validate 完成，不再从 STATUS 直接 execute。
- **Mi7（relay 准入失败启发式）**：本轮只做文档化注释（P4 包装器须以 [invalid_request] 标记类型化拒绝）；结构化拒绝通道留 P4。
- **Mi8（有 findings 时 evidence 允许为空）**：采纳放宽——findings 非空时 evidence 可为空；clean 场景（findings 空）仍强制非空 evidence。删除死行。
- **NIT follow-up advisory id**：不用 prose 前缀截断——用 jeroDomainHash("follow-up", observation) 派生稳定 id。
- **歧义 2（身份匹配遮蔽纠正血统）**：维持现状（上游语义：身份匹配优先，纠正绑定走显式 lineage），不改。

## 修复清单

| # | 位置 | 问题 | 修法 |
|---|---|---|---|
| MA1 | judgment-day.ts:102-113, :323-357, :448-475 | JD ledger sidecar 读用不校验：篡改 rows/哈希被接受；崩溃回滚后 rounds 失同步 | 每次读取/使用校验 canonicalHash(rows)===frozen_ledger_hash；judge_proofs 与 record.judge_proof_hash 交叉核对；冻结后与 record 持久 ledger_hash 核对；不符→类型化 invalid-state（"re-admit the judges"）+ 回归测试（篡改/陈旧两探测场景） |
| MA3 | judgment-day.ts:230-250 + lineage-store.ts:279-284 | round-1 重开后字节相同 fix 重放返回陈旧结果，状态卡死 fixing | JD 请求哈希/幂等键折入当前 revision（或 fix_batches/scoped_rejudgments）；或状态感知重放守卫（记录的后置状态不再成立时拒绝重放）+ 回归测试（同字节 fix 在重开后再提交→拒绝或正确推进） |
| MA4 | finalize.ts freeze-ledger + result-artifacts.ts:142-158 | finalize 无磁盘工件前置；完整性谓词只查清单不查文件 | 按裁定 M4：谓词校验 per-lens 文件存在+sha256 一致；freeze-ledger 强制前置 + 回归测试（删工件→finalize 拒绝；完整→通过） |
| Mi5 | status.ts:146-151 | fix_validating 混合形状（execute+collect payload） | 按裁定改 kind collect；M2 transitions 测试同步 |
| Mi6 | status.ts currentTargetStatusV1 | projection 硬编码 workspace | 回显请求的 projection |
| Mi7 | review-host-relay.ts:676-686 | [invalid_request] 启发式无文档 | 注释说明 P4 包装契约 |
| Mi8 | capture.ts:503-506 | findings 非空仍强制 evidence 非空；506 死行 | 按裁定放宽 + 删死行 + 测试 |
| NIT | capture.ts:279；collect-inputs.ts:130；transitions.ts:148-150；judgment-day 判事 id 唯一性 | 见审核 NIT 段 | 各自小修：no-op 三元、死常量、JD-only 分支注释、judge_ids/distinct+哈希格式校验、relay 默认 fail-closed 消息补一条测试 |

修后门禁：tests/authority + conformance 全绿（glob 已含 conformance）；gentle-ai/review-host-relay-routing 不回归；typecheck 零新增（基线 147）；check:runtime-modules、verify-package-files、check:authority-boundary 全过；package-manifest 测试绿。
