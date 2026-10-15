import { existsSync } from "node:fs";
import { join } from "node:path";
import { ReviewTransactionStore } from "./review-transaction-store.ts";
import { existingReviewStoreRootV1 } from "./review-repository.ts";
import type { DiffFindingMarker } from "./shell-changes.ts";

// 冻结评审发现 → TUI 展示投影的只读来源。纯展示辅助：绝不写权威
// 存储、绝不参与状态转移；存储缺席或损坏一律按"无发现"处理，变更
// 覆盖层绝不因此带病失败。谱系语义：根集合内最新的携带冻结台账的
// graph 谱系胜出——旧谱系（已结算/已废弃）的发现是陈旧噪声，不投影。

const NO_FINDINGS: readonly DiffFindingMarker[] = [];

export function frozenFindingMarkersForRepository(cwd: string): ReadonlyArray<DiffFindingMarker> {
	try {
		const storeRoot = existingReviewStoreRootV1(cwd);
		if (storeRoot === undefined || !existsSync(join(storeRoot, "graph-v1"))) return NO_FINDINGS;
		const store = ReviewTransactionStore.forRepository(cwd);
		const lineages = store.readCurrentAuthority().body.lineages as Array<Record<string, unknown>>;
		for (const entry of [...lineages].reverse()) {
			if (typeof entry.lineage_id !== "string" || entry.mode !== "graph") continue;
			try {
				const ledger = store.read(entry.lineage_id).frozen_ledger;
				if (!ledger) continue;
				return ledger.rows.map(({ id, location, severity, evidence_claim }) => ({ id, location, severity, claim: evidence_claim }));
			} catch {
				// 单个谱系损坏/不连续不拖垮整体展示：跳过它，继续找更早的台账。
			}
		}
		return NO_FINDINGS;
	} catch {
		return NO_FINDINGS;
	}
}
