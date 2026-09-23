# lib/authority/ 权威域审核报告

> 本子域的子代理两次因网关 524 超时失败，本报告由主会话基于结构化分析（grep 顶层声明 + 关键段精读）产出。authority/ 共 35 个文件 13625 行。

## 文件规模与超 1000 行拆分建议

authority/ 有 2 个文件超 1000 行，均属"契约/协议"大类，且**高度同质化**（大量 `export interface` + `export const` 枚举 + `decode*` 校验函数）：

### wire-contract.ts（2834 行）拆分建议
- 构成：84 个 `export interface/type` + 40 个 `export const/function/class`。
- 内容分四簇，建议按"契约域"拆成 4 个文件：
  1. **`wire-contract-enums.ts`**（约 4-256 行）：所有 `REVIEW_*` 操作/状态/lens/risk 枚举常量 + 配套 `type X = (typeof X)[keyof ...]`。纯值+类型，零函数。
  2. **`wire-contract-interfaces.ts`**（约 258-620 行）：`Review*V1/V2/V3` 接口族（ReviewStartV3/V4、ReviewStatusAuthorityV1、ReviewCollectInputV3、ReviewNextTransitionV3 等约 40 个 interface）。纯类型。
  3. **`wire-contract-decode-status.ts`**（约 1810-2310 行）：`decodeReviewStatusV3`、`decodeReviewConsentV2/V3`、`decodeReviewFailureV2`、`decodeReviewRepairV2`、`decodeEligibility` 等状态/同意/失败/修复解码器。
  4. **`wire-contract-decode-last-event.ts`**（约 2396-2834 行）：last-event-closure 域——`decodeReviewLastEventClosureV1`、`decodeReviewLastEventReviewerFindingV1`、`assertReviewApprovedAcknowledgementExecuteV1`、`decodeReviewAcknowledgedV1` 等 + 配套常量。
- 拆分后每个文件 <800 行，且 enums/interfaces 被 decode 层 import，依赖单向。

### client-contract.ts（1540 行）拆分建议
- 构成：64 个 `export interface/type` + 44 个 `export const/function/class`。
- 内容是"原生评审 CLI 客户端契约"，建议按职责拆 3 个文件：
  1. **`client-contract-enums.ts`**（约 35-680 行的常量簇）：`NATIVE_REVIEW_OPERATION`、`NATIVE_REVIEW_ERROR_CODE`、`NATIVE_REVIEW_MODE_*`、`NATIVE_REVIEW_AUTHORITY_*`、`NATIVE_START_ACTION` 等全部 `export const` 枚举 + stderr 容忍/预报旁白正则。
  2. **`client-contract-interfaces.ts`**：`NativeReviewCli`、`NativeStartResult`、`NativeReviewCliError` 及各类 Request/Result interface。
  3. **`client-contract-risk.ts`**（约 661-736 行）：`nativeRiskEvidenceSubject/Phrase/Phrases`、`NATIVE_REVIEW_LENS`、`REVIEW_RISK_SUBJECT_BY_CODE/SIGNAL` 风险证据文案域。

### 未超 1000 但偏大的文件
- `finalize.ts`（802）、`judgment-day.ts`（735）、`protocol.ts`（725）——暂不强制拆，但 finalize.ts 的 `reviewFinalizeV1` 状态机派发（268-302）+ 5 个 `finalize*V1` 操作函数已可按操作再细分（见下）。

## 文件级问题清单

### P1
1. **finalize.ts:291 — 运算符优先级隐患 + 重复子表达式**
   ```ts
   if (input.review_result !== undefined && state.state !== "findings_frozen" || (input.review_result !== undefined && input.reviewer_run_acknowledged === true)) {
   ```
   - 依赖 `&&` 优先于 `||`（成立，但极脆弱）；`input.review_result !== undefined` 重复两次。
   - 可读性差到子代理在初读时将其标记为疑似 bug。虽逻辑当前正确（`A && B || (A && C)`），但任何后续编辑加括号失误都会引入回归。
   - **修法**：提取 `const hasReviewResult = input.review_result !== undefined;` 再写 `if (hasReviewResult && (state.state !== "findings_frozen" || input.reviewer_run_acknowledged === true))`，或加显式括号并补注释说明"评审视角提交的优先派发规则"。

2. **finalize.ts:294-301 — 状态机派发与 finalizeFreezeLedgerV1 前置重叠**
   `reviewFinalizeV1` 在 291 行已把"带 review_result"的请求分流给 freeze-ledger，但 294 的 switch 又对 `findings_frozen` 分流给 resolveEvidence。两条路径的边界（什么时候一个带 review_result 的请求落到 switch 而非 291）依赖 291 行的隐式条件组合，缺乏单一事实来源。建议在 reviewFinalizeV1 顶部用一张"（state × 输入形态）→ handler"的显式派发表替代 if+switch 混合。

### P2
3. **wire-contract.ts / client-contract.ts — 巨型文件的 decode 函数重复模式**
   每个 `decode*` 函数都重复"取字段 → 类型窄化 → 报错带 label"的手工校验序列（如 decodeReviewStatusV3 1905-2056 约 150 行）。authority/ 已有 `validate.ts`、`canonical.ts`，但 decode 层未复用统一的字段断言助手，导致近似的 `if (typeof x !== "string") throw ...` 遍布。建议下沉一个 `reqString(obj, key, label)` / `reqEnum(obj, key, allowed, label)` 助手到 `wire.ts` 或新 `decode-util.ts`，可显著压缩 decode 函数体积并统一错误格式。

## 跨文件重复 / 可下沉公共逻辑
- `decode*` 字段断言模式（见 P2#3）在 wire-contract.ts 内部即高频重复，且 client-contract.ts 的 CLI 结果解码极可能复用同一套（建议核对该文件 736 行后的解码函数）。
- authority/ 已有 `wire.ts`（257 行）——确认它与 wire-contract.ts 的职责边界：若 wire.ts 是"信封/帧"而 wire-contract.ts 是"载荷契约"，命名易混淆，建议在文件头注释明确分工。

## 死代码
- 未逐函数核对（子代理未完成），但基于结构：wire-contract.ts 的 84 个 interface/type 全部 export，需用 `grep -r "符号名" --include="*.ts" lib extensions` 逐一确认是否有导出后零消费的契约类型（这类"为未来契约预留"的类型在快速迭代的 fork 里常见）。建议跑一次全局未使用导出扫描（knip 或 ts-prune）覆盖整个 authority/。

## 与项目 pillars 一致性
- wire-contract/client-contract 均为纯 TypeScript 契约 + Node 解码，无二进制依赖、无 shell 调用，符合"零二进制 / Node 权威"。
- client-contract.ts 顶部 `promisify(execFile)`（35 行）是唯一进程边界——这是评审 CLI 客户端的本职，合理；但应确认它只被 authority 层调用而非扩展层直接调用（保持 Node 权威单一入口）。
