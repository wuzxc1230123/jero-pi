# P2-M4 分析报告 v0（未接地——需本地重锚后使用）

> ⚠️ 产出该报告的代理无本地文件工具：上游证据取自公网 jsdelivr 镜像（存在缓存滞后，[snapshot-risk] 标记），本地断言（尤其 A.2/A.3 的 sdd-attempt 字段名）为推断 [I]。
> 重锚代理须对照本地源逐条核实并改写为 `_tools/p2-m4-sdd-analysis.md`，本文件仅作骨架保留。
> 关键修正点：DISCREPANCY #1 称上游无 sdd-attempt 操作——本地 gentle-pi-main/lib/native-review-cli.ts 明确有 sddAttemptAcquire/sddAttemptSettle（P1 桩 native-review-cli.ts:1853-1855 即列 sddStatus/sddAttemptAcquire/sddAttemptSettle），以本地为准。

## 可保留的结构性结论（待本地验证）

- A.1 sdd-status 投影：NativeSddStatusRequest { changeName?, workspaceRoot, signal? }；NativeSddStatusV2 字段族（schemaName "gentle-ai.sdd-status"/schemaVersion 2/changeName/artifactStore 四值/planningHome {mode:"repo-local",path}/changeRoot/actionContext/七相 dependencies/blockedReasons/nextRecommended 十一值/remediationState）与严格解码规则族（planningHome 规范路径或 "engram:sdd" 字面量、legacy instructions 必须缺省、remediation 不变式等）——字段名自缓存副本 [V]，需对本地 31KB 版核对
- A.5 journal 操作名：新增三个（sdd.attempt.acquire/sdd.attempt.settle/sdd.continue），status 不入账（纯读）
- B 绑定工件：bind-sdd.json 字段（schema/revision/change{changeName,evidencePath}/lineage{id,generation}/authority_revision/receipt_hash/gate_context 必需集）；本地 fixture 可直接读；哈希链纪律 = 规范 JSON 去 revision+receipt_hash 后 sha256；M3 MA1 模式的载入校验 + quarantine-not-delete
- C verify-result：不新建解码器，import protocol.ts 既有者；路径解析 change.evidencePath 对 planningHome；失败分类 taxonomy；上游已弃 verify-result/v1 准入而 jero-pi 按 §5.1.8 重立——记录有意分歧
- D R1-R4 → journal 语义：acquire 持久先于可变更（R1）、token（建议存 sha256(token)）先于 actor 准入（R2）、blocked 命名携带既有 attempt 身份、append-only 单次终结（R3）、终态 verbatim 保留 untrackedScope（R4）
- E 集成面：sdd-preflight.ts/sdd-status.ts 不直接调二进制——实际调用面在扩展模板（sddStatus/sddContinue 工具参数映射）；M4 只落 lib/authority/sdd-* 模块，模板改线归 P4（§9.1 边界门使然）；preflight 的 ENOSDD 二进制门在零二进制落地后成死代码，留改名期清理
- F 模块分解：sdd-status.ts / sdd-attempt.ts / sdd-continue.ts / sdd-binding.ts 四件
- G 测试计划：解码矩阵 / 生命周期集成（崩溃重放证 R1/R3）/ 绑定篡改-陈旧回归 / verify-result 矩阵 / 既有 sdd 测试不动

## 重锚清单（重锚代理执行）

1. 本地 native-review-cli.ts 的 SDD 段全量：操作表 sdd 行、请求/结果类型字段、错误码、argv 形状——逐字段修正 A.1-A.4
2. tests/sdd-managed-runtime-settlement.test.ts 的 R1-R4 测试名与断言形状——修正 D
3. 本地 lib/sdd-status.ts（31KB 版）与 tests/sdd-status.test.ts——找 lib 级接线（缓存版无）
4. tests/native-sdd-attempt-authority.test.ts——attempt 操作的权威行为
5. protocol.ts 的 jero.verify-result/v1 字段清单——填 C
6. bind-sdd.json 本地读——确认 B
7. assets/support/sdd-status-contract.md 本地版（11KB）——managed actor 条款补全
