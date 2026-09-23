import type { NativeReviewCli } from "./authority/client-contract.ts";
import type { ReviewLastEventClosureBinding, ReviewStatusV3 } from "./authority/wire-contract.ts";

export interface ReviewLastEventCaptureSelector {
	readonly baseRef?: string;
	readonly committedOnly?: true;
	readonly agent?: "pi";
}

/**
 * 只对恰好一个歧义的原生捕获结局做对账。成功的捕获直接返回其原生
 * 产物或闭包；本辅助函数绝不是成功后的生命周期步骤，也绝不重放捕获。
 */
export async function reconcileUnknownReviewLastEventCapture(
	nativeReviewCli: NativeReviewCli,
	cwd: string,
	binding: ReviewLastEventClosureBinding,
	selector?: ReviewLastEventCaptureSelector,
): Promise<ReviewStatusV3> {
	if (nativeReviewCli.targetStatus === undefined) {
		throw new TypeError("native target-scoped STATUS is required to reconcile an ambiguous capture outcome");
	}
	const status = await nativeReviewCli.targetStatus({
		cwd,
		lineageId: binding.lineageId,
		...(selector === undefined ? {} : selector),
	});
	if (status.applicability !== "current_target") {
		throw new TypeError("capture reconciliation STATUS is not current for the bound target");
	}
	if (status.authority?.lineageId !== binding.lineageId) {
		throw new TypeError("capture reconciliation returned missing or different lineage authority");
	}
	if (binding.targetIdentity === undefined || status.targetIdentity !== binding.targetIdentity) {
		throw new TypeError("capture reconciliation returned missing or different target");
	}
	return status;
}
