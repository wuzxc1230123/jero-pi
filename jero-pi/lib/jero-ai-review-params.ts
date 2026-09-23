// jero-ai 评审控制器参数域：操作/参数 schema、输入解析、模式门、状态/维护/恢复与原生结果映射。
// 自 extensions/jero-ai.ts 拆分（机械平移，语义零改动）。

import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { REVIEW_TRANSITION, type ReviewBudgetV1, ReviewTransactionStore, type ReviewTransition } from "./review-transaction.ts";
import { REVIEW_MODE, REVIEW_PROJECTION, type ReviewMode, type ReviewProjectionV1 } from "./review-snapshot.ts";
import {
	isCanonicalProcessString, NATIVE_REVIEW_ERROR_CODE, NATIVE_REVIEW_MODE_OPERATION,
	NATIVE_REVIEW_MODE_SOURCE, NATIVE_REVIEW_RECONCILE_ANOMALIES, nativeReviewAbandonAuthorization,
	type NativeReviewAcknowledgeApprovedOutcome, type NativeReviewAcknowledgeApprovedRequest,
	type NativeReviewCli, NativeReviewCliError, NativeReviewConsentBindingError,
	NativeReviewIntegrationError, type NativeReviewModeSource, type NativeReviewProcessDiagnostics,
	nativeReviewReconcileAuthorization, type NativeStartResult,
	sanitizeForeignNativeReviewDiagnostics
} from "./authority/client-contract.ts";
import { NATIVE_REVIEW_OUTCOME, type NativeReviewOutcome } from "./review-risk-assessment.ts";
import { type ReviewStatusV3 } from "./authority/wire-contract.ts";
import { isRecord } from "./jero-ai-persona-config.ts";
import { NATIVE_START_UNTRACKED_SCOPE, type NativeStartUntrackedScope } from "./jero-ai-review-consent.ts";
import { nativeOperationFailure } from "./jero-ai-review-native-ops.ts";
import { canonicalReviewCaptureBinding, publicReviewCaptureBindings, reviewIntendedUntrackedInput } from "./jero-ai-review-select.ts";
export const REVIEW_CONTROLLER_OPERATION = {
	START: "start",
	ANSWER_CONSENT: "answer-consent",
	ADVANCE: "advance",
	ACKNOWLEDGE_APPROVED: "acknowledge-approved",
	STATUS: "status",
	SELECT_INTENDED_UNTRACKED: "select-intended-untracked",
	EXPORT: "export",
	IMPORT: "import",
	INSPECT: "inspect",
	RESET: "reset",
	RECOVER: "recover",
	RECOVER_LOCK: "recover-lock",
	ABANDON: "abandon",
	RECONCILE_AUTHORITY: "reconcile-authority",
	REPAIR: "repair",
	// gentle-pi#662：只读原生风险评估（gentle-ai#4295）。从不
	// 变更评审权威状态，也从不要求 lineageId。
	ASSESS: "assess",
} as const;

export type ReviewControllerOperation =
	(typeof REVIEW_CONTROLLER_OPERATION)[keyof typeof REVIEW_CONTROLLER_OPERATION];

export function reviewToolOperationPath(args: unknown): string {
	const operation = isRecord(args) ? args.operation : undefined;
	if (
		typeof operation !== "string" ||
		!Object.values(REVIEW_CONTROLLER_OPERATION).includes(operation as ReviewControllerOperation)
	) {
		return "review";
	}
	return `review ${operation.replaceAll("-", " ")}`;
}

export const REVIEW_CONTROLLER_PARAMETERS = {
	type: "object",
	additionalProperties: false,
	required: ["operation"],
	properties: {
		operation: {
			type: "string",
			enum: Object.values(REVIEW_CONTROLLER_OPERATION),
			description: "Controller operation. Inspect authority before start. Reset requires the exact challenge returned by inspect.",
		},
		lineageId: {
			type: "string",
			description: "Bounded review lineage identifier. A failed start creates no lineage; do not use it with status or advance.",
		},
		selectionBinding: { type: "string", description: "Opaque provider-issued pre-lineage intended-untracked selection binding." },
		intendedUntracked: { type: "array", items: { type: "string" }, description: 'Repository-relative paths selected from the provider binding; on inspect they are accepted only with untrackedScope "select".' },
		untrackedScope: { type: "string", enum: ["exclude", "select"], description: 'Inspect-only: resolve the intended-untracked selection stop in one call. "exclude" excludes every eligible untracked path and forbids intendedUntracked; "select" includes exactly the supplied intendedUntracked paths.' },
		changeName: {
			type: "string",
			description: "Canonical OpenSpec change name required to resolve a recovered authority during lifecycle validate.",
		},
		idempotencyKey: {
			type: "string",
			description: "Required for graph-v1 start and advance operations.",
		},
		transition: {
			type: "string",
			description: "A supported REVIEW_TRANSITION value for advance.",
		},
		input: {
			type: "string",
			description: "A JSON-serialized object string, not a nested object. New native ordinary START uses {\"mode\":\"ordinary\"}; answer-consent uses exactly {\"consentBinding\":\"<opaque id>\",\"answer\":\"granted|declined\"}. Ordinary provider capture belongs only to jero_review_capture. An explicit baseRef requires committedOnly: true and requests a committed range, while repository-local policyPath remains optional. ASSESS accepts an optional object with baseRef, committedOnly, writerModelId, writerEffort, and nativeReviewOutcome (gentle-pi#662/#668); omitting writerModelId and writerEffort assesses the ambient working tree and fails closed to a small writer profile (never large) because the writer's actual profile is unknown to this call. nativeReviewOutcome (one of closed, declined, unavailable, unknown) tells ASSESS whether the native review actually closed for this candidate: when Receipt-driven development reads on but the review was declined for this candidate, is unavailable, or its outcome is unknown, ASSESS falls back to the exact risk-gated plan it returns when RDD is off, re-enabling the separate verifier -- a decline is candidate-scoped and never lowers the bar below the RDD-off path. Omitting it lets ASSESS try to derive declined/unavailable from what this process itself recorded for this exact candidate (never a different one, and never from repository state alone), failing closed to unknown when it cannot; `closed` is never derived -- pass it explicitly, and only right after acknowledging the approved review for this same candidate. The returned outcome_source (explicit|derived|unknown) says which of these produced the value. Legacy controller input remains separate.",
		},
		outputPath: { type: "string", description: "Retired with legacy bundle export; ignored. Export returns legacy-operation-retired." },
		inputPath: { type: "string", description: "Repository-local JSON input file for the separate legacy controller flow (alternative to input). Legacy bundle import is retired." },
		operationId: { type: "string", description: "Retired with legacy bundle transport; ignored. Export/import return legacy-operation-retired." },
		lineageIds: { type: "string", description: "Retired with legacy bundle export; ignored. Export returns legacy-operation-retired." },
		workspaceRoot: {
			type: "string",
			description: "Optional explicit user-authorized absolute path inside the Git worktree that owns this review. It must resolve to an existing Git worktree; nested paths are canonicalized to that worktree root. Pi never invents this selector. Absent, the session cwd is used unless one unambiguous lineage binding already identifies its target root.",
		},
	},
} as const;

export const REVIEW_CAPTURE_PARAMETERS = {
	type: "object",
	additionalProperties: false,
	required: ["lineageId", "collectBinding"],
	properties: {
		lineageId: {
			type: "string",
			minLength: 1,
			description: "Exact lineage from the current provider-issued collect transition.",
		},
		collectBinding: {
			type: "string",
			minLength: 1,
			description: "JSON-serialized exact copy of one decoded provider-owned next_transition.collect input from current STATUS.",
		},
		reviewerRunAcknowledged: {
			type: "boolean",
			description: "Required only after the one-slot materialize reviewer forecast; authorizes exactly one Pi host-relay run.",
		},
		correctionLines: {
			type: "integer",
			minimum: 1,
			description: "Positive correction-line plan in diff lines: one replaced source line counts as two (one deletion plus one addition). A different unit from the provider's frozen logical correction budget. Accepted only for the selected provider correction-plan slot and within its exact bounds.",
		},
		workspaceRoot: {
			type: "string",
			description: "Optional explicit existing Git worktree root, resolved with the controller's worktree confinement semantics.",
		},
	},
} as const;

interface ReviewCaptureParameters {
	lineageId: string;
	collectBinding: string;
	reviewerRunAcknowledged?: boolean;
	correctionLines?: number;
	workspaceRoot?: string;
}

export const REVIEW_CAPTURE_GROUP_PARAMETERS = {
	type: "object",
	additionalProperties: false,
	required: ["lineageId", "collectBindings"],
	properties: {
		lineageId: { type: "string", minLength: 1, description: "Exact lineage from the current provider-issued collect transition." },
		collectBindings: { type: "array", minItems: 1, items: { type: "string", minLength: 1 }, description: "Ordered JSON-serialized exact copies of the complete current materialize reviewer collect set." },
		reviewerRunAcknowledged: { type: "boolean", description: "Required after the one group forecast; authorizes exactly the forecast reviewer runs." },
		workspaceRoot: { type: "string", description: "Optional explicit existing Git worktree root, resolved with the controller's worktree confinement semantics." },
	},
} as const;

interface ReviewCaptureGroupParameters {
	lineageId: string;
	collectBindings: readonly string[];
	reviewerRunAcknowledged?: boolean;
	workspaceRoot?: string;
}

export const REVIEW_SCOPE_PARAMETERS = {
	type: "object",
	additionalProperties: false,
	required: ["manifest", "sha256"],
	properties: {
		manifest: { type: "string", maxLength: 4_096, description: "Exact controller-supplied gzip/base64url frozen changed-scope manifest." },
		sha256: { type: "string", pattern: "^[0-9a-f]{64}$", description: "Exact controller-supplied SHA-256 of the decompressed canonical manifest bytes." },
		cursor: { type: "integer", minimum: 0, description: "Pagination cursor. Start at 0 and continue with nextCursor until absent." },
	},
} as const;

export interface ReviewScopeParameters {
	manifest: string;
	sha256: string;
	cursor?: number;
}

// gentle-pi#662：只读原生风险评估，在渲染的
// `Receipt-driven development:` 行为 `off` 或 `unknown` 时，用原生风险
// 而非任务描述判断来给独立验证者设门。以 `jero_review` 的
// `assess` 操作暴露（不是独立工具），其可选字段经由控制器既有的
// 通用 `input` JSON 字符串传入，与 START 的
// `{"mode":...,"baseRef":...}` 完全一致。
interface ReviewAssessInput {
	baseRef?: string;
	committedOnly?: boolean;
	writerModelId?: string;
	writerEffort?: string;
	// gentle-pi#668：调用方自己掌握的该候选结果。
	// 省略时会尝试为本候选本身的 target identity 自动派生
	// declined/unavailable（绝不是别的候选）；`closed`
	// 永不自动派生——需显式传入。
	nativeReviewOutcome?: NativeReviewOutcome;
}

function isNativeReviewOutcome(value: unknown): value is NativeReviewOutcome {
	return typeof value === "string" && (Object.values(NATIVE_REVIEW_OUTCOME) as readonly string[]).includes(value);
}

export function parseReviewAssessInput(operation: ReviewControllerOperation, raw: string | undefined): ReviewAssessInput {
	if (raw === undefined) return {};
	const value = parseControllerJson(raw, operation);
	const allowed = new Set(["baseRef", "committedOnly", "writerModelId", "writerEffort", "nativeReviewOutcome"]);
	const unexpected = Object.keys(value).find((key) => !allowed.has(key));
	if (unexpected !== undefined) throw new Error(`Review controller ${operation} input does not accept ${unexpected}`);
	const { baseRef, committedOnly, writerModelId, writerEffort, nativeReviewOutcome } = value;
	if (baseRef !== undefined && typeof baseRef !== "string") throw new Error(`Review controller ${operation} input baseRef must be a string`);
	if (committedOnly !== undefined && typeof committedOnly !== "boolean") throw new Error(`Review controller ${operation} input committedOnly must be a boolean`);
	if (writerModelId !== undefined && typeof writerModelId !== "string") throw new Error(`Review controller ${operation} input writerModelId must be a string`);
	if (writerEffort !== undefined && typeof writerEffort !== "string") throw new Error(`Review controller ${operation} input writerEffort must be a string`);
	if (nativeReviewOutcome !== undefined && !isNativeReviewOutcome(nativeReviewOutcome)) {
		throw new Error(`Review controller ${operation} input nativeReviewOutcome must be one of ${Object.values(NATIVE_REVIEW_OUTCOME).join(", ")}`);
	}
	return {
		...(baseRef === undefined ? {} : { baseRef: baseRef as string }),
		...(committedOnly === undefined ? {} : { committedOnly: committedOnly as boolean }),
		...(writerModelId === undefined ? {} : { writerModelId: writerModelId as string }),
		...(writerEffort === undefined ? {} : { writerEffort: writerEffort as string }),
		...(nativeReviewOutcome === undefined ? {} : { nativeReviewOutcome: nativeReviewOutcome as NativeReviewOutcome }),
	};
}

export interface ReviewControllerParameters {
	operation: ReviewControllerOperation;
	lineageId?: string;
	selectionBinding?: string;
	intendedUntracked?: readonly string[];
	untrackedScope?: NativeStartUntrackedScope;
	changeName?: string;
	idempotencyKey?: string;
	transition?: string;
	input?: string;
	outputPath?: string;
	inputPath?: string;
	operationId?: string;
	lineageIds?: string;
	acknowledgeUntrustedBundleSource?: string;
	workspaceRoot?: string;
}

export type NativeReviewAcknowledgementCli = NativeReviewCli & {
	acknowledgeApproved?: (request: NativeReviewAcknowledgeApprovedRequest) => Promise<NativeReviewAcknowledgeApprovedOutcome | void>;
};

interface ReviewControllerStartInput {
	mode: ReviewMode;
	projection: ReviewProjectionV1;
	policyHash: string;
	evidenceHash: string;
	budget: ReviewBudgetV1;
	parentLineageId?: string;
}

function isReviewControllerOperation(value: string): value is ReviewControllerOperation {
	return Object.values(REVIEW_CONTROLLER_OPERATION).some((operation) => operation === value);
}

export function parseReviewControllerParameters(value: unknown): ReviewControllerParameters {
	if (!isRecord(value)) throw new Error("Review controller parameters must be an object");
	if (typeof value.operation !== "string" || !isReviewControllerOperation(value.operation)) {
		throw new Error("Review controller operation is unsupported");
	}
	if (value.operation === REVIEW_CONTROLLER_OPERATION.SELECT_INTENDED_UNTRACKED) {
		const unexpected = Object.keys(value).find((key) => !["operation", "selectionBinding", "intendedUntracked", "workspaceRoot"].includes(key));
		if (unexpected !== undefined || typeof value.selectionBinding !== "string" || !Array.isArray(value.intendedUntracked) || (value.workspaceRoot !== undefined && typeof value.workspaceRoot !== "string")) throw new Error("Review intended-untracked selection accepts exactly selectionBinding and intendedUntracked, with optional workspaceRoot");
		return { operation: value.operation, selectionBinding: value.selectionBinding, intendedUntracked: value.intendedUntracked, ...(typeof value.workspaceRoot === "string" ? { workspaceRoot: value.workspaceRoot } : {}) };
	}
	// gentle-pi#706：顶层 untrackedScope/intendedUntracked 仅凭
	// inspect 就能解决 intended-untracked 停止点。intendedUntracked 不是
	// 独立选择器：只有显式 select 范围时 inspect 才接受它。
	const hasIntendedUntracked = "intendedUntracked" in value;
	if (hasIntendedUntracked && value.operation !== REVIEW_CONTROLLER_OPERATION.INSPECT) {
		throw new Error(
			`Review controller ${value.operation} does not accept intendedUntracked; it is accepted only by inspect with untrackedScope select`,
		);
	}
	if (value.untrackedScope !== undefined) {
		if (value.operation !== REVIEW_CONTROLLER_OPERATION.INSPECT)
			throw new Error(
				`Review controller ${value.operation} does not accept untrackedScope; it is accepted only by inspect`,
			);
		if (
			value.untrackedScope !== NATIVE_START_UNTRACKED_SCOPE.EXCLUDE &&
			value.untrackedScope !== NATIVE_START_UNTRACKED_SCOPE.SELECT
		)
			throw new Error(
				"Review controller inspect untrackedScope must be exclude or select",
			);
	}
	if (hasIntendedUntracked) {
		if (value.untrackedScope !== NATIVE_START_UNTRACKED_SCOPE.SELECT) {
			throw new Error(
				"Review controller inspect intendedUntracked requires untrackedScope select",
			);
		}
		if (!Array.isArray(value.intendedUntracked)) {
			throw new Error(
				"Review controller inspect intendedUntracked must be an array of repository-relative paths",
			);
		}
	}

	const needsLineage = !([REVIEW_CONTROLLER_OPERATION.START, REVIEW_CONTROLLER_OPERATION.ANSWER_CONSENT, REVIEW_CONTROLLER_OPERATION.STATUS, REVIEW_CONTROLLER_OPERATION.EXPORT, REVIEW_CONTROLLER_OPERATION.IMPORT, REVIEW_CONTROLLER_OPERATION.INSPECT, REVIEW_CONTROLLER_OPERATION.RESET, REVIEW_CONTROLLER_OPERATION.RECOVER, REVIEW_CONTROLLER_OPERATION.RECOVER_LOCK, REVIEW_CONTROLLER_OPERATION.ABANDON, REVIEW_CONTROLLER_OPERATION.RECONCILE_AUTHORITY, REVIEW_CONTROLLER_OPERATION.REPAIR, REVIEW_CONTROLLER_OPERATION.ASSESS] as readonly ReviewControllerOperation[]).includes(value.operation);
	if (needsLineage && (typeof value.lineageId !== "string" || value.lineageId.trim().length === 0)) {
		throw new Error("Review controller requires a lineageId");
	}
	const untrackedScope = value.untrackedScope === NATIVE_START_UNTRACKED_SCOPE.EXCLUDE ? value.untrackedScope
		: value.untrackedScope === NATIVE_START_UNTRACKED_SCOPE.SELECT ? value.untrackedScope
		: undefined;
	let intendedUntracked: readonly string[] | undefined;
	// 上方 hasIntendedUntracked 块的 Array.isArray 检查保证数组性；元素类型与原 any[] 透传一致。
	if (hasIntendedUntracked) intendedUntracked = [...value.intendedUntracked as string[]];
	const parameters: ReviewControllerParameters = {
		operation: value.operation,
		...(typeof value.lineageId === "string" ? { lineageId: value.lineageId } : {}),
		...(value.operation === REVIEW_CONTROLLER_OPERATION.INSPECT && untrackedScope !== undefined ? { untrackedScope } : {}),
		...(value.operation === REVIEW_CONTROLLER_OPERATION.INSPECT && intendedUntracked !== undefined ? { intendedUntracked } : {}),
	};
	for (const key of ["changeName", "idempotencyKey", "transition", "input", "outputPath", "inputPath", "operationId", "lineageIds", "acknowledgeUntrustedBundleSource", "workspaceRoot"] as const) {
		const optional = value[key];
		if (optional !== undefined && typeof optional !== "string") {
			if (value.operation === REVIEW_CONTROLLER_OPERATION.START && key === "input") {
				throw new Error("Review controller START input must be a JSON string encoding an object, not a nested object. No lineage was created; do not call STATUS or ADVANCE for this attempted lineage.");
			}
			throw new Error(`Review controller ${key} must be a string`);
		}
		if (typeof optional === "string") parameters[key] = optional;
	}
	return parameters;
}

export function parseReviewCaptureParameters(value: unknown): ReviewCaptureParameters {
	if (!isRecord(value)) throw new Error("Review capture parameters must be an object");
	const allowed = new Set(["lineageId", "collectBinding", "reviewerRunAcknowledged", "correctionLines", "workspaceRoot"]);
	const unexpected = Object.keys(value).find((key) => !allowed.has(key));
	if (unexpected !== undefined) throw new Error(`Review capture does not accept ${unexpected}`);
	if (!isCanonicalProcessString(value.lineageId)) throw new Error("Review capture requires an exact non-empty lineageId");
	if (typeof value.collectBinding !== "string" || value.collectBinding.length === 0) throw new Error("Review capture requires a JSON-serialized collectBinding");
	let reviewerRunAcknowledged: boolean | undefined;
	if (value.reviewerRunAcknowledged !== undefined) {
		if (typeof value.reviewerRunAcknowledged !== "boolean") throw new Error("Review capture reviewerRunAcknowledged must be boolean");
		reviewerRunAcknowledged = value.reviewerRunAcknowledged;
	}
	let correctionLines: number | undefined;
	if (value.correctionLines !== undefined) {
		// typeof 守卫只负责把 unknown 收窄成 number；整数语义仍由 isSafeInteger 把关。
		if (typeof value.correctionLines !== "number" || !Number.isSafeInteger(value.correctionLines) || value.correctionLines < 1) throw new Error("Review capture correctionLines must be a positive integer");
		correctionLines = value.correctionLines;
	}
	let workspaceRoot: string | undefined;
	if (value.workspaceRoot !== undefined) {
		if (typeof value.workspaceRoot !== "string") throw new Error("Review capture workspaceRoot must be a string");
		workspaceRoot = value.workspaceRoot;
	}
	return {
		lineageId: value.lineageId,
		collectBinding: value.collectBinding,
		...(reviewerRunAcknowledged === undefined ? {} : { reviewerRunAcknowledged }),
		...(correctionLines === undefined ? {} : { correctionLines }),
		...(workspaceRoot === undefined ? {} : { workspaceRoot }),
	};
}

export function parseReviewCaptureGroupParameters(value: unknown): ReviewCaptureGroupParameters {
	if (!isRecord(value)) throw new Error("Review capture group parameters must be an object");
	const allowed = new Set(["lineageId", "collectBindings", "reviewerRunAcknowledged", "workspaceRoot"]);
	const unexpected = Object.keys(value).find((key) => !allowed.has(key));
	if (unexpected !== undefined) throw new Error(`Review capture group does not accept ${unexpected}`);
	if (!isCanonicalProcessString(value.lineageId)) throw new Error("Review capture group requires an exact non-empty lineageId");
	if (!Array.isArray(value.collectBindings) || value.collectBindings.length === 0 || value.collectBindings.some((binding) => typeof binding !== "string" || binding.length === 0)) throw new Error("Review capture group requires one or more JSON-serialized collectBindings");
	let reviewerRunAcknowledged: boolean | undefined;
	if (value.reviewerRunAcknowledged !== undefined) {
		if (typeof value.reviewerRunAcknowledged !== "boolean") throw new Error("Review capture group reviewerRunAcknowledged must be boolean");
		reviewerRunAcknowledged = value.reviewerRunAcknowledged;
	}
	let workspaceRoot: string | undefined;
	if (value.workspaceRoot !== undefined) {
		if (typeof value.workspaceRoot !== "string") throw new Error("Review capture group workspaceRoot must be a string");
		workspaceRoot = value.workspaceRoot;
	}
	return {
		lineageId: value.lineageId,
		collectBindings: [...value.collectBindings],
		...(reviewerRunAcknowledged === undefined ? {} : { reviewerRunAcknowledged }),
		...(workspaceRoot === undefined ? {} : { workspaceRoot }),
	};
}

export function requiredControllerString(
	parameters: ReviewControllerParameters,
	key: "idempotencyKey" | "transition" | "command" | "input" | "outputPath" | "inputPath" | "operationId",
): string {
	const value = parameters[key];
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(`Review controller ${parameters.operation} requires ${key}`);
	}
	return value;
}

export function readRepositoryControllerInput(inputPath: string, repositoryRoot: string): string {
	const canonicalRoot = realpathSync(repositoryRoot);
	const requestedPath = resolve(canonicalRoot, inputPath);
	const relativePath = relative(canonicalRoot, requestedPath);
	if (relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
		throw new Error("Review controller inputPath must be confined to the repository");
	}
	const stat = lstatSync(requestedPath);
	if (!stat.isFile() || stat.isSymbolicLink() || realpathSync(requestedPath) !== requestedPath) {
		throw new Error("Review controller inputPath must be a regular non-symlink file");
	}
	return readFileSync(requestedPath, "utf8");
}

export function parseControllerJson(input: string, operation: ReviewControllerOperation): Record<string, unknown> {
	let value: unknown;
	try {
		value = JSON.parse(input);
	} catch (error) {
		if (operation === REVIEW_CONTROLLER_OPERATION.START) {
			throw new Error(
				`Review controller START input must be a JSON string encoding an object: ${error instanceof Error ? error.message : String(error)}. No lineage was created; do not call STATUS or ADVANCE for this attempted lineage.`,
			);
		}
		throw new Error(
			`Review controller ${operation} input is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	if (!isRecord(value)) throw new Error(`Review controller ${operation} input must be a JSON object`);
	return value;
}

export async function authorizeDestructiveReviewOperation(
	parametersValue: unknown,
	ctx: ExtensionContext,
): Promise<void> {
	const parameters = parseReviewControllerParameters(parametersValue);
	// 只有 RESET 携带旧式的全仓库挑战。原生 compact-v2 的
	// RECOVER 有自己的六字段契约和自己的派生
	// `gentle-ai.review-recovery-authorization/v1` 绑定，这两者都无法用
	// 旧式的 `repositoryId`/`commonDirHash`/`inventoryHash`/`confirmation`
	// 四元组表达。原生 INSPECT 也从不发布该四元组，因此
	// 在这里强求它会让唯一受支持的恢复流程不可达
	// （issue #212）。
	// RECOVER 在 `executeReviewControllerOperation` 中自行授权，因为
	// 其绑定只能从一次新的原生 target-status 读取中派生。
	const isReset = parameters.operation === REVIEW_CONTROLLER_OPERATION.RESET;
	const maintenance = nativeMaintenanceOperation(parameters.operation);
	if (!isReset && maintenance === undefined) return;
	const input = parseControllerJson(requiredControllerString(parameters, "input"), parameters.operation);
	if (maintenance !== undefined && (missingNativeMaintenanceInputs(maintenance, input).length > 0 || invalidNativeMaintenanceInput(maintenance, input))) return;
	if (isReset) {
		for (const key of ["repositoryId", "commonDirHash", "inventoryHash"] as const) {
			if (typeof input[key] !== "string" || input[key].length === 0) throw new Error(`Review controller ${parameters.operation} requires an exact string ${key}`);
		}
		if (typeof input.confirmation !== "string" || input.confirmation.length === 0) throw new Error(`Review controller ${parameters.operation} requires an exact string confirmation`);
	}
	if (!ctx.hasUI) {
		throw new Error(`Review controller ${parameters.operation.toUpperCase()} requires fresh explicit authorization through the interactive Pi UI; headless execution fails closed`);
	}
	const maintenanceAuthorization = maintenance === undefined ? undefined : nativeMaintenanceAuthorization(maintenance, input);
	const approved = await ctx.ui.confirm(
		maintenance !== undefined ? `Authorize review authority ${parameters.operation.toUpperCase()}?` : `Authorize destructive review authority ${parameters.operation.toUpperCase()}?`,
		maintenance !== undefined
			? [`Operation: ${parameters.operation.toUpperCase()}`, "Exact published authorization binding:", maintenanceAuthorization!, maintenance === "abandon" ? "The native command may abandon only an eligible pristine compact-v2 lineage." : "The native command may quarantine only the bound invalid recovery successor; the predecessor stays untouched."].join("\n")
			: [`Operation: ${parameters.operation.toUpperCase()}`, `Repository: ${input.repositoryId}`, `Exact challenge: ${input.confirmation}`, "This invalidates all prior review authority for this repository."].join("\n"),
	);
	if (!approved) throw new Error(`Review controller ${parameters.operation.toUpperCase()} was not explicitly authorized`);
}

function parseReviewBudget(value: unknown, label: string): ReviewBudgetV1 {
	if (!isRecord(value)) throw new Error(`${label} must be an object`);
	return value as unknown as ReviewBudgetV1;
}

export function parseStartInput(value: Record<string, unknown>): ReviewControllerStartInput {
	if (value.mode !== REVIEW_MODE.ORDINARY && value.mode !== REVIEW_MODE.JUDGMENT_DAY) {
		throw new Error(
			'Review controller START supports only "ordinary" or "judgment-day" mode; use "ordinary" unless Judgment Day was explicitly selected. Pass input as a JSON string encoding the START object. START failed before authority access, so no lineage was created; do not call STATUS or ADVANCE for this attempted lineage.',
		);
	}
	if (!isRecord(value.projection) || typeof value.projection.kind !== "string") {
		throw new Error("Review controller start requires a projection");
	}
	let projection: ReviewProjectionV1;
	if (value.projection.kind === REVIEW_PROJECTION.COMPLETE) {
		projection = { kind: REVIEW_PROJECTION.COMPLETE };
	} else if (
		value.projection.kind === REVIEW_PROJECTION.INTENDED_COMMIT &&
		typeof value.projection.tree === "string"
	) {
		projection = {
			kind: REVIEW_PROJECTION.INTENDED_COMMIT,
			tree: value.projection.tree,
		};
	} else {
		throw new Error("Review controller start projection is unsupported or unresolved");
	}
	if (typeof value.policyHash !== "string" || typeof value.evidenceHash !== "string") {
		throw new Error("Review controller start requires policyHash and evidenceHash");
	}
	if (value.parentLineageId !== undefined && typeof value.parentLineageId !== "string") {
		throw new Error("Review controller parentLineageId must be a string");
	}
	const result: ReviewControllerStartInput = {
		mode: value.mode,
		projection,
		policyHash: value.policyHash,
		evidenceHash: value.evidenceHash,
		budget: parseReviewBudget(value.budget, "Review controller start budget"),
	};
	if (typeof value.parentLineageId === "string") result.parentLineageId = value.parentLineageId;
	return result;
}

export function isReviewTransition(value: string): value is ReviewTransition {
	return Object.values(REVIEW_TRANSITION).some((transition) => transition === value);
}

function isGraphV1JudgmentDayLineage(cwd: string, lineageId: string): boolean {
	try {
		return ReviewTransactionStore.forRepository(cwd).read(lineageId).mode === REVIEW_MODE.JUDGMENT_DAY;
	} catch {
		return false;
	}
}

interface NativeStartPreAuthorityRejection {
	lineage_created: false;
	mutation_performed: false;
	mutation_outcome: "none";
	reset_eligible: false;
}

export function nativeStartPreAuthorityRejection(): NativeStartPreAuthorityRejection {
	return {
		lineage_created: false,
		mutation_performed: false,
		mutation_outcome: "none",
		reset_eligible: false,
	};
}

// Organic-rdd-parity 第三阶段（设计决策 #7）：在 ORDINARY START 分支
// 顶部、targetStatus 之前咨询一次。在协商版本将 `mode` 能力报告为
// true 之前保持暗置——那种情况下 `reviewMode` 抛出
// VERSION_INCOMPATIBLE，这里将其与“能力缺失”同等对待
// （今天的路径不变），绝不当作失败。任何
// 其他错误（真正的原生进程故障）仍通过调用方既有的
// nativeOperationFailure 处理浮出。
const REVIEW_MODE_DISABLED_OUTCOME = "review-mode-disabled";

// 与 gentle-ai 的 reviewModeScopeForSource
// （internal/reviewtransaction/rdd_mode.go）对齐：continuation 按真正
// 做出决定的来源限定作用域，这样操作者不必自己去推断
// 两个独立来源中该改哪一个。
//
// clone-local 覆盖只能用于关闭。Pi 显式的 clone 范围 enable 会清除
// 该覆盖，但不能开启全局 RDD：当全局仍未设置或为 off 时，清除覆盖后
// 生效模式仍是 off。需要时应告诉操作者先完成全局
// opt-in，再清除这个 clone 覆盖。
// Pi 从不自动改写操作者的全局 gentle-ai 状态。
//
// default 分支随锁定的 v2.4.0 运行时而改变，回执驱动开发
// 变为 opt-in。它过去不可能是评审被关闭的原因——一个所有来源
// 均未设置的安装会解析为 ON 且来源为 `default`——所以为它命名
// continuation 只能是瞎猜，gentle-ai 正是为此返回空
// scope。v2.4.0 把同样的安装解析为 OFF 且来源为 `default`，这让它
// 成为最常见的拒绝：每一个从未 opt-in 的安装。gentle-ai 现在
// 对它回答 `global`，不是 default 代表全局意见，而是因为
// global 是唯一能把评审打开的 scope，Pi 也给出同样
// 回答。让它保持 undefined 等于把最常见的状态
// 逼进死胡同。
function reviewModeContinuation(source: NativeReviewModeSource): string | undefined {
	if (source === NATIVE_REVIEW_MODE_SOURCE.CLONE_LOCAL) return "If global RDD is still off, write {\"schema\":\"jero.authority.review-mode/v1\",\"value\":\"on\"} to ~/.pi/jero/review-mode.json, then run /jero:review-mode enable to clear this clone-local override.";
	if (source === NATIVE_REVIEW_MODE_SOURCE.GLOBAL) return "Write {\"schema\":\"jero.authority.review-mode/v1\",\"value\":\"on\"} to ~/.pi/jero/review-mode.json to turn reviews back on; /jero:review-mode enable only clears the clone-local setting, which cannot override a global off.";
	return "Write {\"schema\":\"jero.authority.review-mode/v1\",\"value\":\"on\"} to ~/.pi/jero/review-mode.json to opt in; RDD is off by default until explicitly enabled. /jero:review-mode enable only clears a clone-local override and cannot enable global RDD.";
}

// 先说处境再说机制，与 gentle-ai 的
// RDDDisabledError.Error() 对齐。Pi 选择跳过而非拒绝——被关闭的开关
// 在这里从不阻塞——但它不能丢弃是哪个来源做的决定，因为那正是
// 操作者需要的信息，也是唯一能选出可行恢复路径的依据。
function nativeReviewModeSkipped(operation: ReviewControllerOperation, source: NativeReviewModeSource): Record<string, unknown> {
	const continuation = reviewModeContinuation(source);
	return {
		operation,
		status: "skipped",
		outcome: REVIEW_MODE_DISABLED_OUTCOME,
		delivery: "disabled/unmanaged",
		mode_source: source,
		reason: `receipt-driven development is disabled: ${operation} is skipped because the ${source} mode source keeps it off`,
		...(continuation === undefined ? {} : { next_action: continuation }),
		...nativeStartPreAuthorityRejection(),
	};
}

export async function resolveReviewModeGate(
	nativeReviewCli: NativeReviewCli | null,
	operation: ReviewControllerOperation,
	cwd: string,
	signal: AbortSignal | undefined,
): Promise<Record<string, unknown> | undefined> {
	if (nativeReviewCli?.reviewMode === undefined) return undefined;
	try {
		const mode = await nativeReviewCli.reviewMode({ cwd, operation: NATIVE_REVIEW_MODE_OPERATION.STATUS, ...(signal === undefined ? {} : { signal }) });
		return mode.status.effective === "off" ? nativeReviewModeSkipped(operation, mode.status.source) : undefined;
	} catch (error) {
		if (asNativeReviewCliError(error)?.code === NATIVE_REVIEW_ERROR_CODE.VERSION_INCOMPATIBLE) return undefined;
		throw error;
	}
}

// gentle-pi#185：没有协商出 STATUS 支持的原生 CLI（没有
// `targetStatus`，或 provider 版本不兼容）会在任何候选视图恢复尝试
// 之前撞上这条边界，因此绝不会复现 #176 的空注册表
// 失败——但这条边界自己的 `next_action` 是一个机器 token，
// 人类或代理都无法执行。`remediation_command` 指明恢复动作；
// 自二进制退役以来，STATUS 由进程内权威提供，唯一
// 失去它的可能就是 jero-pi 安装损坏。
const NATIVE_STATUS_UNSUPPORTED_REMEDIATION_COMMAND = "reinstall the jero-pi package (pnpm install); review STATUS is served in-process and there is no external CLI to run";

export function nativeStatusUnsupported(operation: ReviewControllerOperation): Record<string, unknown> {
	return {
		operation,
		status: "blocked",
		outcome: "native-status-unsupported",
		...(operation === REVIEW_CONTROLLER_OPERATION.START ? nativeStartPreAuthorityRejection() : { mutation_performed: false }),
		inventory_complete: false,
		next_action: "require-upstream-read-only-native-status-inventory",
		remediation_command: NATIVE_STATUS_UNSUPPORTED_REMEDIATION_COMMAND,
		evidence: {
			native_contract: "gentle-ai/2.1.4",
			general_status: "unsupported",
			claimant_inventory: "unsupported",
		},
	};
}

// 打包版与源码版模块实例可能共存，因此 instanceof 不可靠。
export function asNativeReviewCliError(error: unknown): { code: string; diagnostics: NativeReviewProcessDiagnostics } | undefined {
	if (error instanceof NativeReviewCliError) return error;
	if (!isRecord(error) || error.name !== "NativeReviewCliError") return undefined;
	const value = error as { code?: unknown; diagnostics?: unknown };
	if (typeof value.code !== "string") return undefined;
	const diagnostics = sanitizeForeignNativeReviewDiagnostics(value.diagnostics);
	return diagnostics === undefined || value.code !== diagnostics.error_code ? undefined : { code: value.code, diagnostics };
}

// 与上方 asNativeReviewCliError 相同的模块实例共存注意事项。
export function asNativeReviewConsentBindingError(error: unknown): { reason: string; message: string } | undefined {
	if (error instanceof NativeReviewConsentBindingError) return { reason: error.reason, message: error.message };
	if (!(error instanceof Error) || error.name !== "NativeReviewConsentBindingError") return undefined;
	const reason = (error as unknown as { reason?: unknown }).reason;
	return typeof reason !== "string" || reason.length === 0 ? undefined : { reason, message: error.message };
}

export function nativeStatusFailed(operation: ReviewControllerOperation, error: unknown): Record<string, unknown> {
	const cliError = asNativeReviewCliError(error);
	if (cliError?.code === NATIVE_REVIEW_ERROR_CODE.VERSION_INCOMPATIBLE) return nativeStatusUnsupported(operation);
	if (cliError !== undefined) {
		return {
			...nativeOperationFailure(operation, error),
			outcome: "native-status-unavailable",
			inventory_complete: false,
			next_action: "require-complete-native-authority-inventory",
		};
	}
	// gentle-pi#599：已协商的 STATUS/inspect 请求若被原生 provider 以
	// 解码后的 failure/v2 封套拒绝（例如针对嵌套外部 Git 仓库的预检
	// `invalid_request` 拒绝），过去会落到下方通用结果，
	// 丢弃封套自带的 cause、code、retry_safe 和 next_action——而那正是
	// 让拒绝可付诸行动的唯一信息（把目标嵌套仓库作为
	// workspaceRoot 传入）。`nativeOperationFailure` 已经为每个变更操作
	// 忠实渲染这种确切的失败封套形态；这里复用它，
	// 而不是把拒绝掩盖成不透明的权威清单
	// 损坏。
	if (error instanceof NativeReviewIntegrationError) {
		return {
			...nativeOperationFailure(operation, error),
			outcome: "native-status-unavailable",
			inventory_complete: false,
		};
	}
	return {
		operation,
		status: "blocked",
		outcome: "native-status-unavailable",
		lineage_created: false,
		mutation_performed: false,
		mutation_outcome: "none",
		inventory_complete: false,
		next_action: "require-complete-native-authority-inventory",
	};
}

export const NATIVE_RECOVERY_INPUT = {
	reclaim: ["lineage", "actor", "reason"],
	recover: ["predecessorLineage", "expectedPredecessorRevision", "successorLineage", "disposition", "actor", "reason"],
} as const;

const NATIVE_MAINTENANCE_INPUT = {
	abandon: ["lineage", "expectedRevision", "snapshotIdentity", "actor", "reason"],
	reconcileAuthority: ["predecessorLineage", "expectedPredecessorRevision", "successorLineage", "expectedSuccessorRevision", "actor", "reason"],
} as const;
type NativeMaintenanceOperation = keyof typeof NATIVE_MAINTENANCE_INPUT;

export function nativeMaintenanceOperation(operation: ReviewControllerOperation): NativeMaintenanceOperation | undefined {
	if (operation === REVIEW_CONTROLLER_OPERATION.ABANDON) return "abandon";
	if (operation === REVIEW_CONTROLLER_OPERATION.RECONCILE_AUTHORITY) return "reconcileAuthority";
	return undefined;
}

function missingNativeMaintenanceInputs(operation: NativeMaintenanceOperation, input: Record<string, unknown>): readonly string[] {
	const missing = NATIVE_MAINTENANCE_INPUT[operation].filter((key) => !isCanonicalProcessString(input[key]));
	if (operation !== "abandon") return missing;
	return [
		...missing,
		...(Array.isArray(input.capturedLensResults) && input.capturedLensResults.every((entry) => isCanonicalProcessString(entry)) ? [] : ["capturedLensResults"]),
		...(typeof input.findingsPresent === "boolean" ? [] : ["findingsPresent"]),
	];
}

function invalidNativeMaintenanceInput(operation: NativeMaintenanceOperation, input: Record<string, unknown>): boolean {
	return operation === "reconcileAuthority" && input.anomalies !== undefined && input.anomalies !== NATIVE_REVIEW_RECONCILE_ANOMALIES.COMBINED;
}

function nativeMaintenanceAuthorization(operation: NativeMaintenanceOperation, input: Record<string, unknown>): string {
	if (operation === "abandon") return nativeReviewAbandonAuthorization({ lineage: String(input.lineage), expectedRevision: String(input.expectedRevision), snapshotIdentity: String(input.snapshotIdentity), capturedLensResults: (input.capturedLensResults as readonly unknown[]).map(String), findingsPresent: input.findingsPresent === true, actor: String(input.actor), reason: String(input.reason) });
	return nativeReviewReconcileAuthorization({ predecessorLineage: String(input.predecessorLineage), expectedPredecessorRevision: String(input.expectedPredecessorRevision), successorLineage: String(input.successorLineage), expectedSuccessorRevision: String(input.expectedSuccessorRevision), actor: String(input.actor), reason: String(input.reason), ...(input.anomalies === undefined ? {} : { anomalies: NATIVE_REVIEW_RECONCILE_ANOMALIES.COMBINED }) });
}

export async function executeNativeAuthorityMaintenance(
	operation: ReviewControllerOperation,
	nativeOperation: NativeMaintenanceOperation,
	input: Record<string, unknown>,
	cwd: string,
	nativeReviewCli: NativeReviewCli | null,
	signal: AbortSignal | undefined,
): Promise<Record<string, unknown>> {
	const method = nativeOperation === "abandon" ? nativeReviewCli?.abandon : nativeReviewCli?.reconcileAuthority;
	const nativeCommand = nativeOperation === "reconcileAuthority" ? "review reconcile-authority" : "review abandon";
	if (method === undefined) {
		return { operation, status: "blocked", outcome: "native-maintenance-unavailable", native_operation: nativeCommand, mutation_performed: false, mutation_outcome: "none", next_action: "in-process-review-authority-unavailable" };
	}
	const missing = missingNativeMaintenanceInputs(nativeOperation, input);
	if (missing.length > 0) {
		return { operation, status: "blocked", outcome: "native-input-required", native_operation: nativeCommand, missing_input: missing, mutation_performed: false, mutation_outcome: "none", next_action: "resubmit-with-exact-native-maintenance-input" };
	}
	if (invalidNativeMaintenanceInput(nativeOperation, input)) {
		return { operation, status: "blocked", outcome: "native-input-invalid", native_operation: nativeCommand, mutation_performed: false, mutation_outcome: "none", next_action: "resubmit-with-the-exact-published-native-maintenance-binding" };
	}
	try {
		const result = nativeOperation === "abandon"
			? await nativeReviewCli.abandon!({ cwd, lineage: String(input.lineage), expectedRevision: String(input.expectedRevision), snapshotIdentity: String(input.snapshotIdentity), capturedLensResults: (input.capturedLensResults as readonly unknown[]).map(String), findingsPresent: input.findingsPresent === true, actor: String(input.actor), reason: String(input.reason), maintainerAuthorization: nativeMaintenanceAuthorization(nativeOperation, input), ...(signal === undefined ? {} : { signal }) })
			: await nativeReviewCli.reconcileAuthority!({ cwd, predecessorLineage: String(input.predecessorLineage), expectedPredecessorRevision: String(input.expectedPredecessorRevision), successorLineage: String(input.successorLineage), expectedSuccessorRevision: String(input.expectedSuccessorRevision), actor: String(input.actor), reason: String(input.reason), ...(input.anomalies === undefined ? {} : { anomalies: NATIVE_REVIEW_RECONCILE_ANOMALIES.COMBINED }), maintainerAuthorization: nativeMaintenanceAuthorization(nativeOperation, input), ...(signal === undefined ? {} : { signal }) });
		return { operation, native_operation: nativeCommand, result: result.record, mutation_performed: true, mutation_outcome: "committed", next_action: "inspect" };
	} catch (error) {
		return nativeOperationFailure(operation, error);
	}
}

/**
 * 将破坏性控制器操作路由到最接近的已审计原生等价物：
 * RESET 与 RECOVER_LOCK 映射到 `gentle-ai review reclaim`
 * （对单个不完整条目的已审计隔离），RECOVER 映射到
 * `gentle-ai review recover`（可审计的后继权威）。旧流程从未
 * 携带过的原生输入通过结构化封套请求，
 * 而不是凭空捏造。Pi 自有的授权语义先于该
 * 路由运行且保持不变。
 */
export async function executeNativeRecoveryRoute(
	operation: ReviewControllerOperation,
	nativeOperation: "reclaim" | "recover",
	input: Record<string, unknown>,
	cwd: string,
	nativeReviewCli: NativeReviewCli | null,
	signal: AbortSignal | undefined,
): Promise<Record<string, unknown>> {
	const nativeCommand = `review ${nativeOperation}`;
	const method = nativeOperation === "reclaim" ? nativeReviewCli?.reclaim : nativeReviewCli?.recover;
	if (nativeReviewCli === null || method === undefined) {
		return {
			operation,
			status: "blocked",
			outcome: "native-recovery-unavailable",
			native_operation: nativeCommand,
			mutation_performed: false,
			mutation_outcome: "none",
			next_action: "in-process-review-authority-unavailable",
		};
	}
	const missing = NATIVE_RECOVERY_INPUT[nativeOperation].filter((key) =>
		key === "disposition"
			? input[key] !== "scope_changed" && input[key] !== "invalidated" && input[key] !== "escalated"
			: typeof input[key] !== "string" || (input[key] as string).trim().length === 0,
	);
	if (missing.length > 0) {
		return {
			operation,
			status: "blocked",
			outcome: "native-input-required",
			native_operation: nativeCommand,
			missing_input: missing,
			mutation_performed: false,
			mutation_outcome: "none",
			next_action: "resubmit-with-exact-native-recovery-input",
		};
	}
	try {
		const result = nativeOperation === "reclaim"
			? await nativeReviewCli.reclaim!({ cwd, lineage: String(input.lineage), actor: String(input.actor), reason: String(input.reason), ...(signal === undefined ? {} : { signal }) })
			: await nativeReviewCli.recover!({
				cwd,
				predecessorLineage: String(input.predecessorLineage),
				expectedPredecessorRevision: String(input.expectedPredecessorRevision),
				successorLineage: String(input.successorLineage),
				disposition: input.disposition as "scope_changed" | "invalidated" | "escalated",
				actor: String(input.actor),
				reason: String(input.reason),
				...(typeof input.maintainerAuthorization === "string" ? { maintainerAuthorization: input.maintainerAuthorization } : {}),
				...(signal === undefined ? {} : { signal }),
			});
		return {
			operation,
			native_operation: nativeCommand,
			result: result.record,
			mutation_performed: true,
			mutation_outcome: "committed",
			next_action: "inspect",
		};
	} catch (error) {
		return nativeOperationFailure(operation, error);
	}
}

export function mapNativeStartResult(result: NativeStartResult): Record<string, unknown> {
	return {
		lineage_id: result.lineageId,
		state: result.state,
		risk_tier: result.riskLevel,
		selected_lenses: result.selectedLenses,
		changed_files: result.changedFiles,
		original_changed_lines: result.changedLines,
		correction_budget: result.correctionBudget,
		action: result.action,
		lenses_required: result.lensesRequired,
		...(result.riskReasons === undefined ? {} : { risk_reasons: result.riskReasons }),
		// Organic-parity 直通（设计决策 #8，organic-rdd-parity）：
		// risk_evidence/hint 从原生 start 结果原样渲染，
		// 零本地派生；只要协商版本的能力是暗置的
		// （今天所有已发布行），两者都保持缺失。
		...(result.riskEvidence === undefined ? {} : { risk_evidence: result.riskEvidence }),
		...(result.hint === undefined ? {} : { hint: result.hint }),
		...(result.nextTransition === undefined ? {} : { next_transition: result.nextTransition }),
	};
}

export function requiredStatusActionText(lineageId?: string): string {
	return `Run target-scoped review.status${lineageId === undefined ? "" : ` for lineage ${lineageId}`} and follow only its declared action.`;
}

// 公开的 collect 投影是 collectBindings：每个 provider collect
// 输入序列化一次，作为 jero_review_capture 消费的不透明绑定。
// 原始 next_transition.collect.inputs 携带相同字节，因此一个四镜头
// collect 状态过去每次 STATUS、INSPECT 或 START 应答要花约 2.8 万字符，
// 且每次被阻塞的重试还要再花一次（#465）。原始 transition
// 保留 kind 与 reason，让编排器仍能看到 collect 状态。
function withoutRawCollectInputs(raw: Record<string, unknown>): Record<string, unknown> {
	if (!isRecord(raw.next_transition)) return raw;
	const { collect: _collect, ...transition } = raw.next_transition;
	return { ...raw, next_transition: transition };
}

export function mapNativeTargetStatus(operation: ReviewControllerOperation, status: ReviewStatusV3, requestedLineageId?: string): Record<string, unknown> {
	if (
		status.nextTransition?.kind === "collect" &&
		(operation === REVIEW_CONTROLLER_OPERATION.START || operation === REVIEW_CONTROLLER_OPERATION.INSPECT || operation === REVIEW_CONTROLLER_OPERATION.STATUS)
	) {
		const selection = reviewIntendedUntrackedInput(status);
		return {
			operation,
			status: "blocked",
			result: withoutRawCollectInputs(status.raw),
			...(selection === undefined
				? { collectBindings: publicReviewCaptureBindings(status) }
				: { selectionBinding: canonicalReviewCaptureBinding(selection) }),
		};
	}
	if (status.action === "recover") {
		return {
			operation,
			status: "blocked",
			result: status.raw,
			provider_action: "recover",
			recovery_disposition: status.actionDisposition,
			next_action: "recover-with-provider-disposition",
			required_status_action: "Use only the provider-selected recovery disposition; do not substitute scope_changed, invalidated, or escalated.",
		};
	}
	// gentle-pi#627：过期的受管理资产集会用能解决它的那条
	// 精确 `gentle-ai sync` 调用来停止 transition。把该命令渲染为
	// 唯一可行动的下一步；其他所有 reason code 继续
	// 渲染为普通的 blocked 结果。
	if (status.nextTransition?.kind === "stop" && status.nextTransition.reasonCode === "managed_assets_outdated" && status.nextTransition.continuation !== undefined) {
		return {
			operation,
			status: "blocked",
			result: status.raw,
			...(requestedLineageId === undefined ? {} : { requested_lineage_id: requestedLineageId }),
			hint: `run ${status.nextTransition.continuation.command}`,
		};
	}
	// gentle-pi#638：unachievable-lens 停止为每个声明的槽位携带精确的 withdraw 命令，与 managed_assets_outdated 的先例一致。从未见过 collect 提议的重启仍能仅凭这条提示找到回去的路。
	// gentle-pi#822：当调用方询问某一个 lineage 时，只渲染该 lineage 的 withdraw 命令；第一个条目可能属于无关的 lineage，因此未匹配的请求省略提示，而不是浮出可能无关的 withdraw 命令。没有请求 lineage 时，第一个条目仍是兜底。
	if (status.nextTransition?.kind === "stop" && status.nextTransition.reasonCode === "unachievable_lens_slot" && status.nextTransition.unachievableLensSlots !== undefined) {
		const withdrawSlot = requestedLineageId === undefined ? status.nextTransition.unachievableLensSlots[0] : status.nextTransition.unachievableLensSlots.find((slot) => slot.withdraw.binding.lineageId === requestedLineageId);
		return {
			operation,
			status: "blocked",
			result: status.raw,
			...(requestedLineageId === undefined ? {} : { requested_lineage_id: requestedLineageId }),
			...(withdrawSlot === undefined ? {} : { hint: `run ${withdrawSlot.withdraw.command}` }),
		};
	}
	return {
		operation,
		status: status.action === "start" ? "ready" : "blocked",
		result: status.raw,
		...(requestedLineageId === undefined ? {} : { requested_lineage_id: requestedLineageId }),
	};
}
