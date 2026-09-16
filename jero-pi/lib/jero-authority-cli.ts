import type { NativeReviewCli, NativeSddStatusRequest, NativeSddStatusV2 } from "./native-review-cli.ts";
import { resolveJeroAuthorityContextV1, type JeroAuthorityContextV1 } from "./authority/review.ts";
import { jeroSddStatusV1, type JeroSddStatusV2 } from "./authority/sdd-status.ts";
import { jeroSddContinueV1 } from "./authority/sdd-continue.ts";

// P4c: the in-process authority adapter over the NativeReviewCli surface.
// The review operations stay on the fail-closed P1 stub until their
// controller wiring lands; the SDD projection methods (sddStatus/sddContinue)
// are served here by authority.sdd.* — the v2 record shape M4 projected is
// decodeNativeSddStatusV2-compatible by construction, so the extension's
// existing command paths (selection transport, /gentle-sdd-status, the
// consent-gated continue) run unchanged over the in-process authority.

function projectV2(status: JeroSddStatusV2): NativeSddStatusV2 {
	return status as unknown as NativeSddStatusV2;
}

function contextOrThrow(workspaceRoot: string): JeroAuthorityContextV1 {
	const resolution = resolveJeroAuthorityContextV1(workspaceRoot);
	if (resolution.kind !== "ok") throw new Error(`authority-unavailable: the jero authority refused to resolve ${workspaceRoot}: ${resolution.code}${resolution.detail === undefined ? "" : ` (${resolution.detail})`}`);
	return resolution.context;
}

export function createJeroAuthoritySddCli(): Pick<NativeReviewCli, "sddStatus" | "sddContinue"> {
	return {
		async sddStatus(request: NativeSddStatusRequest): Promise<NativeSddStatusV2> {
			const result = jeroSddStatusV1(contextOrThrow(request.workspaceRoot), { changeName: request.changeName, workspaceRoot: request.workspaceRoot });
			if (result.kind === "refused") throw new Error(`authority-unavailable: sdd status refused: ${result.code} (${result.detail})`);
			return projectV2(result.status);
		},
		async sddContinue(request: NativeSddStatusRequest): Promise<NativeSddStatusV2> {
			if (request.changeName === undefined || request.changeName.trim() === "") throw new Error("authority-unavailable: SDD continuation requires an exact selected change");
			const result = jeroSddContinueV1(contextOrThrow(request.workspaceRoot), { changeName: request.changeName, workspaceRoot: request.workspaceRoot });
			if (result.kind === "refused") throw new Error(`authority-unavailable: sdd continue refused: ${result.code} (${result.detail})`);
			return projectV2(result.status);
		},
	};
}
