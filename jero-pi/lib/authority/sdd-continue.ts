import type { JeroAuthorityContextV1 } from "./review.ts";
import { jeroSddStatusV1, type JeroSddStatusV2 } from "./sdd-status.ts";

// `authority.sdd.continue` (spec _tools/p2-m4-sdd-analysis.md §A.4): the
// mutating sibling of sdd-status — an exact selected change is REQUIRED
// (upstream sddContinue throws a TypeError without one; here it is a typed
// refusal). In-process, the transition is the projection itself: the caller
// states which change instance continues, and the returned status reflects
// the post-selection state. Legality derives from the same projection; an
// unknown change or a terminal/archived state refuses as an unsupported
// transition (the binary's UNSUPPORTED_TRANSITION_OPERATION analogue).
//
// NOT ported from the upstream contract doc: the change-instance marker
// preparation (ensureChangeInstanceMarker / PrepareChangeInstanceConsent,
// sdd-status-contract.md:22) — that mechanism exists only in upstream head,
// not in the pinned v2.7.0 code this rebuild tracks (code+fixtures win). The
// seam is named here so a future port lands it in one place.

export type JeroSddContinueRefusalCode = "invalid-request" | "unsupported-transition" | "projection-violation";

export type JeroSddContinueResultV1 =
	| { readonly kind: "ok"; readonly status: JeroSddStatusV2; readonly isNonAuthoritative: boolean }
	| { readonly kind: "refused"; readonly code: JeroSddContinueRefusalCode; readonly detail: string };

/** `sdd.continue` — requires an exact canonical changeName; never ambiguous. */
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
