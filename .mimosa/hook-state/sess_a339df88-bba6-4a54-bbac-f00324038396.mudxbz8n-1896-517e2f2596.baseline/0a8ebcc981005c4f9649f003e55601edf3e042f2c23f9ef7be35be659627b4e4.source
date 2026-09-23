import type { JeroAuthorityContextV1 } from "./review.ts";
import { jeroSddStatusV1, type JeroSddStatusV2 } from "./sdd-status.ts";

// `authority.sdd.continue`（规范 _tools/p2-m4-sdd-analysis.md §A.4）：
// sdd-status 的变更兄弟——必须提供精确选定的变更（上游 sddContinue
// 缺少它时抛 TypeError；这里是类型化拒绝）。在进程内，转移就是投影
// 本身：调用方声明哪个变更实例继续，返回的状态反映选择后的状态。
// 合法性派生自同一投影；未知变更或终局/已归档状态以不支持的转移
// 拒绝（二进制 UNSUPPORTED_TRANSITION_OPERATION 的对应物）。
//
// 未从上游契约文档移植：变更实例标记的准备
// （ensureChangeInstanceMarker / PrepareChangeInstanceConsent，
// sdd-status-contract.md:22）——该机制只存在于上游 head，不在本次重建
// 跟踪的固定 v2.7.0 代码中（代码+fixture 优先）。在此点名该接缝，
// 使未来的移植能在一处落地。

export type JeroSddContinueRefusalCode = "invalid-request" | "unsupported-transition" | "projection-violation";

export type JeroSddContinueResultV1 =
	| { readonly kind: "ok"; readonly status: JeroSddStatusV2; readonly isNonAuthoritative: boolean }
	| { readonly kind: "refused"; readonly code: JeroSddContinueRefusalCode; readonly detail: string };

/** `sdd.continue`——必须提供精确的权威 changeName；绝不模糊。 */
export function jeroSddContinueV1(context: JeroAuthorityContextV1, request: { changeName: string; workspaceRoot: string }): JeroSddContinueResultV1 {
	if (request.changeName.trim() !== request.changeName || request.changeName.includes("\0") || request.changeName.length === 0) {
		return { kind: "refused", code: "invalid-request", detail: "SDD continuation requires an exact canonical selected change" };
	}
	const projected = jeroSddStatusV1(context, request);
	if (projected.kind === "refused") {
		return projected.code === "invalid-request"
			? { kind: "refused", code: "invalid-request", detail: projected.detail }
			: { kind: "refused", code: "projection-violation", detail: projected.detail };
	}
	if (projected.status.changeName === null || projected.status.changeName !== request.changeName || projected.status.changeRoot === null) {
		return { kind: "refused", code: "unsupported-transition", detail: `change ${JSON.stringify(request.changeName)} is not continuable (not an active change)` };
	}
	if (projected.status.nextRecommended === "archived") {
		return { kind: "refused", code: "unsupported-transition", detail: "archived changes cannot continue" };
	}
	return { kind: "ok", status: projected.status, isNonAuthoritative: projected.isNonAuthoritative };
}
