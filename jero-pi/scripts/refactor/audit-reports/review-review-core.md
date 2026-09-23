# 评审核心三文件审核报告

> 子代理因网关 524 超时未能交付，本报告由主会话基于结构化分析（声明/方法清单 + 关键段精读）产出。

## 文件级问题清单

### P1

1. **review-transaction.ts:1757-1790 / 1791-1820 — `inspectGateTarget` 内两种 target 分支缩进错乱**
   `GATE_TARGET_KIND.PULL_REQUEST`（1760）与 `RELEASE`（1791）两个 `if` 块内部的语句体整体**比外层少一级缩进**（1761-1789、1792-1819），只有闭合括号 `}` 保持在正确层级：
   ```ts
   		if (target.kind === GATE_TARGET_KIND.PULL_REQUEST) {
   		if (                    // ← 少一级缩进
   			!isFullRef(target.base_ref) || ...
   		return { ... };         // ← 同样少一级
   		}                        // ← 正确层级
   ```
   功能不受影响（JS 不看缩进），但这是**机械拆分/合并留下的疤痕**：任何按缩进做块级重构的工具（含本仓库自己的 `scripts/refactor/*.mjs` 的"块边界回溯"逻辑）都会在这里切错。建议整段重新缩进，并跑一次 `prettier --check`（若仓库启用）。

2. **review-transaction.ts:1931-1957 — `createReceiptForState` 与 `assertReceiptMatchesState` 的双向校验路径**
   收据的规范性与校验分散在 `createReceiptEnvelope`(894) / `assertReceiptBody`(900) / `assertReceiptIntegrity`(925) / `assertReceiptMatchesState`(1897) / `createReceiptForState`(1927) 五处。`assertReceiptMatchesState` 与 `assertReceiptIntegrity` 对同一结构做不同强度的检查，无单一入口。建议收敛为 `receipt.validate(envelope, expectedState?)` 一个门。属结构性风险而非现存 bug。

### P2

3. **review-transaction.ts:1707 — `updateKeys.toSorted()` 不可用性风险**
   `canonicalize(updateKeys) !== canonicalize(updateKeys.toSorted())` 要求运行在支持 `Array.prototype.toSorted`（ES2023）的 Node 上。`tsconfig` target 是 ESNext 且 `lib` 是 ESNext，`package.json` 无 `engines` 字段声明 Node 版本下限。若用户跑 Node 18/早期 20，这里会 TypeError。建议补 `"engines": { "node": ">=20" }` 或加 `engines` 检查。同类用法还在 review-transaction.ts:555、587（`toSorted`）、review-candidate-view.ts 若干处。

4. **review-transaction.ts:1509 `isRecord` — 与仓库内多份同名实现重复**
   `lib/review-transaction.ts:1509`、`lib/review-candidate-view.ts:1637`、`lib/jero-ai-persona-config.ts:11`、`lib/sdd-preflight.ts:182`、`extensions/jero-ai.ts:2010` 各有一份 `isRecord`。应下沉到单一 util。

5. **review-candidate-view.ts:984-1628 — `CandidateViewRegistry` 类 645 行、36 个公共方法**
   类承担了五类职责：键规范化（canonicalRoot/lineageKey/replayKey/uniqueKey/requireKey）、生命周期（create/sweepOrphans/cleanupAll/createOrReuse/bind/bindCurrent/retain）、原生投影水合（restoreCurrentFromNativeStart/restoreProjectionFromNative/rebindForFinalizeFromNative/restoreForFinalizeFromNative/restoreCurrentForDispatchFromNative）、解析（resolveProjection/resolveForLens/resolveCurrentForLens/resolveCurrentForLenses/resolveForFinalize）、清理（cleanup/cleanupTerminal/remove/forget/consumeProjection/expose）。七份私有 Map（records/lineages/projections/replays/current/lastHydrationFailures + gitExecutor/platform）共同构成隐式状态机，任何新方法都必须同时理解七个 Map 的不变式。**这是本仓库最脆的类**。

6. **review-host-relay.ts:658-663 — `Promise.allSettled` 后只抛第一个 rejection**
   `runReviewHostRelayReviewerGroup` 并行 prepare 后取 `settled.find(rejected)` 抛其 reason，其余失败被丢弃。对"评审组至少一个失败即整体失败"的语义是正确的，但**吞掉了并发的其他失败详情**，排障时看不到全貌。已在 110-140 行有 `reviewHostRelayUnachievableReason/Detail` 的类型化归因，建议把全部失败折叠进 detail。

7. **review-host-relay.ts:686-739 — 暂存目录清理的 throw-in-finally**
   `submitReviewHostRelayPreparedResult` 的 finally 中，若 `rm` 失败且**不是** primaryFailure，会 `throw new ReviewHostRelayError(...)`。在 finally 中抛错会**覆盖** try 中的正常返回值/正在传播的异常语义（此处用了 primaryFailure 标志守住了主因，属正确写法），但若 `rm` 与 reject 同时发生且 primaryFailure 判定竞态，仍有语义歧义。当前实现是对的，建议加注释固化意图（防后人"简化"掉 primaryFailure 标志）。

## review-transaction.ts 拆分建议（1967 行 → 4 文件）

文件内天然三段，边界清晰：

| 新文件 | 行区间 | 内容 | 预计行数 |
|---|---|---|---|
| `review-transaction-schema.ts` | 1-1072 | 全部枚举/接口/不变式断言/`canonicalize`/`canonicalHash`/`createFrozenLedger`/`assertFrozenLedgerIntegrity`/`createReviewState`/`assertState`/`assertImmutableState`/`createReceiptEnvelope`/`assertReceiptIntegrity`/`reduceReviewState`/`validateReviewGraphReplayV1` | ~1070 |
| `review-transaction-store.ts` | 1084-1499 | `ReviewTransactionStore` 类（416 行）+ `GateTargetInspection` | ~420 |
| `review-transaction-gate.ts` | 1500-1967 | `runGateGit`/`resolveGateObject`/`resolveGateRef`/`assertTreeObject`/`assertCommitBinding`/`inspectPushTarget`/`inspectGateTarget`/`deniedGateResult`/`evaluateGateTarget`/`assertReceiptMatchesState`/`createReceiptForState`/`validateReviewGate`/`validateAuthoritativeReviewGate` | ~470 |

依赖方向单向：schema ← store ← gate（gate 用 store 的收据类型与 schema 的断言）。`calculate` 侧的 `canonicalHash` 已被 `jero-ai-writer-scope.ts` 等 6 个文件 import，拆出后 import 路径变更需同步（约 10 处）。
注意 1084 行的 `ReviewTransactionStore` 引用了顶层的 `assertState`/`canonicalHash`/`ReviewMutationLockV1` 等，全部来自 schema 段与外部模块，无反向依赖 → 拆分无循环风险。

## review-candidate-view.ts 拆分建议（1874 行 → 3 文件）

| 新文件 | 行区间 | 内容 | 预计行数 |
|---|---|---|---|
| `review-candidate-git.ts` | 1-984 | 常量/类型/git 执行器/诊断/`isSafeCandidatePath`/`hasExpectedExecutableBits`/`deriveChangedPathManifest`/`digestChangedPathManifest`/`assertManifestMatchesGit`/`deriveChangedScope`/`entryContentHash`/`makeReadonly`/`candidateViewParent`/`resolveCandidateBase`/`resolveCanonicalCandidateBase`/`checkoutMaterializedEntries`/`addUnbornWorktree`/`seedPrivateIndexFromLiveIndex`/`materializeCandidateView`/`assertRecordSafe` | ~980 |
| `review-candidate-registry.ts` | 984-1628 | `CandidateViewRegistry` 类（645 行） | ~645 |
| `review-candidate-context.ts` | 1628-1874 | `MutableSubagentRunInput`/`validateCandidateContextManifest`/`decodeCandidateContextManifest`/`readCandidateContextManifestPage`/`candidateContextPreamble`/`compactCandidateContextBlock`/`candidateContextBlock`/`injectReviewCandidateView`/`createCandidateView`/`defaultRegistry` | ~250 |

进一步（可选）把 registry 按七份 Map 再切成三个 mixin 式辅助类（KeySpace / ProjectionHydration / Resolution），但那会引入组合间接层，**不建议在本次重构做**——风险大于收益。优先级应是"先把 1874 行拆成 980+645+250"。

依赖方向：git ← registry ← context。`CandidateViewRegistry` 的方法签名大量使用 `CandidateViewRecord`/`FrozenCandidateProjection` 等来自 git 段的类型 → 单向，安全。

## 评审域与 authority 域的职责重叠

- `review-transaction.ts` 经 `review-repository.ts`（`resolveRepositoryAuthorityV1`）访问权威存储根；`review-object-store.ts` 的 `ReviewGraphObjectStoreV1` 负责实际落盘。而 `authority/` 目录另有 `lineage-store.ts`(379)/`object-cas.ts`(137)/`store-root.ts`(340)/`snapshots.ts`(456)。
- **重叠点**：`authority/store-root.ts` 与 `review-repository.ts` 都在解析"权威存储根"；`authority/object-cas.ts` 与 `review-object-store.ts` 都做对象内容寻址。两套实现服务于不同权威层（Graph-v1 vs 原生 compact-v2）。
- **已核实：Graph-v1 写路径仍在生产使用**（非死代码）——
  - `extensions/jero-ai.ts:7437` legacy-v1 权威修复路径调用 `store.repairCurrentAuthority()`；
  - `extensions/jero-ai.ts:7953-7956` Judgment Day 模式 lineage 创建走 `store.create()`；
  - `extensions/jero-ai.ts:7993` 非 ordinary 模式走 `store.runReducerOperation()`；
  - 仅 **ordinary 模式**被明令只读（7991 抛 `GRAPH_V1_ORDINARY_READ_ONLY`）。
  - 因此 review-transaction/object-store 是"Judgment Day + legacy 迁移"的活路径，**不可整层删除**；但 ordinary 分支的 reducer 逻辑（`review-policy-ordinary.ts` 接入点）在该路径下不可达，属条件死代码，可考虑按模式分拆 reducer。

## 死代码清单

1. **review-transaction.ts:223 `GRAPH_V1_ORDINARY_READ_ONLY`**（在 extensions/jero-ai.ts:223 与 lib/jero-ai-package-assets.ts:12 各有一份）——注释型常量，需确认是否有真实消费者（可能仅测试断言字符串存在）。
2. **review-candidate-view.ts:1870 `defaultRegistry`** — 模块级单例，仅 `createCandidateView`(1872) 使用；`createCandidateView` 自身是否被生产代码调用需确认（`extensions/jero-ai.ts` 用的是 `new CandidateViewRegistry()`，6879/7017/7131/8186 四处构造独立实例）。
3. **review-transaction.ts:290 `CreateReviewStateInput` 之后的一批 interface**（ReceiptBodyV1/ReceiptEnvelopeV1/ChildClaimV1/…/ValidateReviewGateOptions）——全部 export，需跑全局未使用导出扫描确认。
