// 评审事务门禁：push/pull 目标巡检、回执与状态匹配、gate 评估入口。
// 自 lib/review-transaction.ts 拆分（机械平移，语义零改动）。

import {
	execFileSync
} from "node:child_process";
import {
	resolve
} from "node:path";
import {
	GATE_RESULT,
	GATE_TARGET_KIND,
	type GateTargetV1,
	PUSH_UPDATE_KIND,
	pushRemoteAdvertisesObjectV1,
	resolvePushRemoteRefV1
} from "./review-publication-gate.ts";
import {
	type AuthoritativeReceiptV1,
	canonicalHash,
	canonicalize,
	DIGEST,
	type GateResultV1,
	OBJECT_ID,
	type ReceiptBodyV1,
	type ReceiptEnvelopeV1,
	REVIEW_PHASE,
	type ReviewBudgetV1,
	ReviewIntegrityError,
	type ReviewStateV1,
	TERMINAL_STATE
} from "./review-transaction-schema.ts";
import {
	assertReceiptIntegrity,
	createReceiptEnvelope,
	repositoryRootForGate
} from "./review-transaction-reducer.ts";
import {
	ReviewTransactionStore
} from "./review-transaction-store.ts";

export interface ValidateReviewGateOptions {
	store: ReviewTransactionStore;
	receipt: ReceiptEnvelopeV1;
	target: GateTargetV1;
	repositoryCwd: string;
	idempotencyKey: string;
	scopeBudget: ReviewBudgetV1;
	actualIntendedCommitTree?: string;
}

interface GateTargetInspection {
	valid: boolean;
	matchesReceipt: boolean;
	targetTree?: string;
	reason: string;
}

const FULL_REF = /^refs\/[A-Za-z0-9][A-Za-z0-9._\/-]*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isObjectId(value: unknown): value is string {
	return typeof value === "string" && OBJECT_ID.test(value);
}

function isFullRef(value: unknown): value is string {
	return (
		typeof value === "string" &&
		FULL_REF.test(value) &&
		!value.includes("..") &&
		!value.includes("//") &&
		!value.includes("/.") &&
		!value.endsWith("/") &&
		!value.endsWith(".")
	);
}

function runGateGit(cwd: string, args: readonly string[]): string {
	return execFileSync("git", args, {
		cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	}).trim();
}

function resolveGateObject(cwd: string, objectId: string, label: string): string {
	if (!isObjectId(objectId)) throw new ReviewIntegrityError(`${label} is not an object ID`);
	const resolved = runGateGit(cwd, ["rev-parse", "--verify", `${objectId}^{object}`]);
	if (resolved !== objectId) throw new ReviewIntegrityError(`${label} does not resolve exactly`);
	return resolved;
}

function resolveGateRef(cwd: string, ref: string, label: string): string {
	if (!isFullRef(ref)) throw new ReviewIntegrityError(`${label} is not a full ref`);
	return runGateGit(cwd, ["rev-parse", "--verify", `${ref}^{object}`]);
}

function assertTreeObject(cwd: string, tree: string, label: string): void {
	resolveGateObject(cwd, tree, label);
	if (runGateGit(cwd, ["cat-file", "-t", tree]) !== "tree") {
		throw new ReviewIntegrityError(`${label} is not a tree object`);
	}
}

function assertCommitBinding(
	cwd: string,
	objectId: string,
	peeledCommit: string,
	tree: string,
	label: string,
): void {
	resolveGateObject(cwd, objectId, `${label} object`);
	resolveGateObject(cwd, peeledCommit, `${label} peeled commit`);
	assertTreeObject(cwd, tree, `${label} tree`);
	const resolvedCommit = runGateGit(cwd, [
		"rev-parse",
		"--verify",
		`${objectId}^{commit}`,
	]);
	if (resolvedCommit !== peeledCommit) {
		throw new ReviewIntegrityError(`${label} object does not peel to the supplied commit`);
	}
	const resolvedTree = runGateGit(cwd, [
		"rev-parse",
		"--verify",
		`${peeledCommit}^{tree}`,
	]);
	if (resolvedTree !== tree) {
		throw new ReviewIntegrityError(`${label} commit does not resolve to the supplied tree`);
	}
}

function inspectPushTarget(
	target: Record<string, unknown>,
	receipt: ReceiptEnvelopeV1,
	repositoryCwd: string,
): GateTargetInspection {
	if (typeof target.remote !== "string") {
		return { valid: false, matchesReceipt: false, reason: "Push target requires an exact remote identity." };
	}
	if (typeof target.destination_id !== "string" || !DIGEST.test(target.destination_id)) {
		return { valid: false, matchesReceipt: false, reason: "Push target requires one bound publication destination." };
	}
	if (!Array.isArray(target.updates) || target.updates.length === 0) {
		return { valid: false, matchesReceipt: false, reason: "Push target requires a complete non-empty update set." };
	}
	const updateKeys: string[] = [];
	const newTrees = new Set<string>();
	let matchesReceipt = true;
	for (const value of target.updates) {
		if (!isRecord(value)) {
			return { valid: false, matchesReceipt: false, reason: "Push update is malformed." };
		}
		if (!isFullRef(value.source_ref) || !isFullRef(value.destination_ref)) {
			return { valid: false, matchesReceipt: false, reason: "Push update refs must be fully resolved." };
		}
		if (
			!isObjectId(value.new_object) ||
			!isObjectId(value.new_peeled_commit) ||
			!isObjectId(value.new_tree)
		) {
			return { valid: false, matchesReceipt: false, reason: "Push new identity is unresolved." };
		}
		if (resolveGateRef(repositoryCwd, value.source_ref, "push source ref") !== value.new_object) {
			return { valid: false, matchesReceipt: false, reason: "Push source ref does not resolve to its supplied new object." };
		}
		assertCommitBinding(
			repositoryCwd,
			value.new_object,
			value.new_peeled_commit,
			value.new_tree,
			"push new identity",
		);
		updateKeys.push(`${value.destination_ref}\u0000${value.source_ref}`);
		newTrees.add(value.new_tree);
		if (value.new_tree !== receipt.body.final_candidate_tree) matchesReceipt = false;
		if (value.kind === PUSH_UPDATE_KIND.CREATE) {
			if (
				value.old_object !== null ||
				value.old_peeled_commit !== null ||
				value.old_tree !== null
			) {
				return { valid: false, matchesReceipt: false, reason: "Push create must bind an explicitly absent old identity." };
			}
			if (
				resolvePushRemoteRefV1(
					repositoryCwd,
					target.remote,
					value.destination_ref,
					"push remote destination ref",
					target.destination_id,
				).object_id !== null
			) {
				return { valid: false, matchesReceipt: false, reason: "Push create destination ref already exists." };
			}
			if (value.destination_ref.startsWith("refs/tags/")) {
				if (!value.source_ref.startsWith("refs/tags/") || value.source_ref !== value.destination_ref) {
					return { valid: false, matchesReceipt: false, reason: "Push tag create requires one exact matching tag source and destination ref." };
				}
				if (value.new_tree !== receipt.body.final_candidate_tree) {
					return { valid: false, matchesReceipt: false, reason: "Push tag create tree does not match the approved receipt final candidate." };
				}
				if (!pushRemoteAdvertisesObjectV1(repositoryCwd, target.remote, target.destination_id, value.new_peeled_commit)) {
					return { valid: false, matchesReceipt: false, reason: "Push tag create peeled commit is not advertised by the bound publication destination." };
				}
			} else {
				const parentLine = runGateGit(repositoryCwd, ["rev-list", "--parents", "-n", "1", value.new_peeled_commit]);
				const parents = parentLine.split(" ");
				if (parents.length !== 2 || parents[0] !== value.new_peeled_commit || !isObjectId(parents[1])) {
					return { valid: false, matchesReceipt: false, reason: "Push create requires exactly one resolved parent commit." };
				}
				const parent = parents[1]!;
				if (runGateGit(repositoryCwd, ["rev-parse", "--verify", `${parent}^{tree}`]) !== receipt.body.base_tree) {
					return { valid: false, matchesReceipt: false, reason: "Push create parent tree does not match the approved receipt base tree." };
				}
				if (!pushRemoteAdvertisesObjectV1(repositoryCwd, target.remote, target.destination_id, parent)) {
					return { valid: false, matchesReceipt: false, reason: "Push create parent is not advertised by the bound publication destination." };
				}
			}
		} else if (value.kind === PUSH_UPDATE_KIND.UPDATE) {
			if (
				!isObjectId(value.old_object) ||
				!isObjectId(value.old_peeled_commit) ||
				!isObjectId(value.old_tree)
			) {
				return { valid: false, matchesReceipt: false, reason: "Push old identity is unresolved." };
			}
			const destinationObject = resolvePushRemoteRefV1(
				repositoryCwd,
				target.remote,
				value.destination_ref,
				"push remote destination ref",
				target.destination_id,
			).object_id;
			if (destinationObject === null) {
				return { valid: false, matchesReceipt: false, reason: "Push update destination ref does not exist." };
			}
			if (destinationObject !== value.old_object) {
				return { valid: false, matchesReceipt: false, reason: "Push update destination ref does not match its supplied old object." };
			}
			assertCommitBinding(
				repositoryCwd,
				value.old_object,
				value.old_peeled_commit,
				value.old_tree,
				"push old identity",
			);
			if (value.old_tree !== receipt.body.base_tree) matchesReceipt = false;
		} else {
			return { valid: false, matchesReceipt: false, reason: "Push deletion or unsupported update kind is forbidden." };
		}
	}
	if (new Set(updateKeys).size !== updateKeys.length) {
		return { valid: false, matchesReceipt: false, reason: "Push update set contains duplicate ref pairs." };
	}
	if (canonicalize(updateKeys) !== canonicalize(updateKeys.toSorted())) {
		return { valid: false, matchesReceipt: false, reason: "Push update set is not in stable ref order." };
	}
	if (newTrees.size !== 1) {
		return { valid: false, matchesReceipt: false, reason: "Push update set has an ambiguous target tree." };
	}
	return {
		valid: true,
		matchesReceipt,
		targetTree: [...newTrees][0],
		reason: matchesReceipt
			? "Every push ref update matches the approved receipt."
			: "Push ref update semantics differ from the approved receipt.",
	};
}

export function inspectGateTarget(
	target: GateTargetV1,
	receipt: ReceiptEnvelopeV1,
	repositoryCwd: string,
	actualIntendedCommitTree?: string,
): GateTargetInspection {
	try {
		if (!isRecord(target) || typeof target.kind !== "string") {
			return { valid: false, matchesReceipt: false, reason: "Gate target is malformed." };
		}
		if (target.kind === GATE_TARGET_KIND.INTENDED_COMMIT) {
			if (!isObjectId(target.intended_commit_tree)) {
				return { valid: false, matchesReceipt: false, reason: "Intended commit tree is unresolved." };
			}
			assertTreeObject(repositoryCwd, target.intended_commit_tree, "intended commit tree");
			const actualTree = actualIntendedCommitTree ?? runGateGit(repositoryCwd, ["write-tree"]);
			assertTreeObject(repositoryCwd, actualTree, "actual intended commit tree");
			if (actualTree !== target.intended_commit_tree) {
				return {
					valid: false,
					matchesReceipt: false,
					reason: "The actual staged tree does not match the supplied intended commit tree.",
				};
			}
			const matchesReceipt = target.intended_commit_tree === receipt.body.final_candidate_tree;
			return {
				valid: true,
				matchesReceipt,
				targetTree: target.intended_commit_tree,
				reason: matchesReceipt
					? "Intended commit tree matches the approved receipt."
					: "Intended commit tree differs from the approved receipt.",
			};
		}
		if (target.kind === GATE_TARGET_KIND.PUSH) {
			return inspectPushTarget(target, receipt, repositoryCwd);
		}
		if (target.kind === GATE_TARGET_KIND.PULL_REQUEST) {
		if (
			!isFullRef(target.base_ref) ||
			!isObjectId(target.base_commit) ||
			!isObjectId(target.base_tree) ||
			!isFullRef(target.head_ref) ||
			!isObjectId(target.head_commit) ||
			!isObjectId(target.head_tree)
		) {
			return { valid: false, matchesReceipt: false, reason: "Pull request target contains unresolved identity." };
		}
		if (resolveGateRef(repositoryCwd, target.base_ref, "pull request base ref") !== target.base_commit) {
			return { valid: false, matchesReceipt: false, reason: "Pull request base ref does not resolve to its supplied commit." };
		}
		if (resolveGateRef(repositoryCwd, target.head_ref, "pull request head ref") !== target.head_commit) {
			return { valid: false, matchesReceipt: false, reason: "Pull request head ref does not resolve to its supplied commit." };
		}
		assertCommitBinding(repositoryCwd, target.base_commit, target.base_commit, target.base_tree, "pull request base");
		assertCommitBinding(repositoryCwd, target.head_commit, target.head_commit, target.head_tree, "pull request head");
		const matchesReceipt =
			target.base_tree === receipt.body.base_tree &&
			target.head_tree === receipt.body.final_candidate_tree;
		return {
			valid: true,
			matchesReceipt,
			targetTree: target.head_tree,
			reason: matchesReceipt
				? "Pull request base and head match the approved receipt."
				: "Pull request base or head differs from the approved receipt.",
		};
		}
		if (target.kind === GATE_TARGET_KIND.RELEASE) {
		if (
			!isFullRef(target.tag_ref) ||
			!target.tag_ref.startsWith("refs/tags/") ||
			!isObjectId(target.tag_object) ||
			!isObjectId(target.peeled_commit) ||
			!isObjectId(target.tree)
		) {
			return { valid: false, matchesReceipt: false, reason: "Release target contains unresolved identity." };
		}
		if (resolveGateRef(repositoryCwd, target.tag_ref, "release tag ref") !== target.tag_object) {
			return { valid: false, matchesReceipt: false, reason: "Release tag ref does not resolve to its supplied object." };
		}
		assertCommitBinding(
			repositoryCwd,
			target.tag_object,
			target.peeled_commit,
			target.tree,
			"release identity",
		);
		const matchesReceipt = target.tree === receipt.body.final_candidate_tree;
		return {
			valid: true,
			matchesReceipt,
			targetTree: target.tree,
			reason: matchesReceipt
				? "Release tag and commit tree match the approved receipt."
				: "Release commit tree differs from the approved receipt.",
		};
		}
		return { valid: false, matchesReceipt: false, reason: "Unsupported gate target kind." };
	} catch (error) {
		return {
			valid: false,
			matchesReceipt: false,
			reason: `Gate target identity cannot be resolved in the repository: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
}

export function deniedGateResult(
	receiptHash: string,
	targetHash: string,
	reason: string,
): GateResultV1 {
	return {
		status: GATE_RESULT.DENY,
		actor_count: 0,
		target_hash: targetHash,
		receipt_hash: receiptHash,
		reason,
	};
}

export function evaluateGateTarget(
	receipt: ReceiptEnvelopeV1,
	target: GateTargetV1,
	repositoryCwd: string,
	actualIntendedCommitTree?: string,
): GateResultV1 {
	let targetHash: string;
	try {
		targetHash = canonicalHash(target);
	} catch {
		targetHash = canonicalHash({ invalid_target: true });
	}
	try {
		assertReceiptIntegrity(receipt);
	} catch (error) {
		return deniedGateResult(
			typeof receipt?.receipt_hash === "string" ? receipt.receipt_hash : "0".repeat(64),
			targetHash,
			`Receipt integrity failed: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	if (receipt.body.terminal_state !== TERMINAL_STATE.APPROVED) {
		return deniedGateResult(receipt.receipt_hash, targetHash, "Only an approved receipt can cross a gate.");
	}
	let repositoryRoot: string;
	try {
		repositoryRoot = repositoryRootForGate(repositoryCwd);
	} catch (error) {
		return deniedGateResult(
			receipt.receipt_hash,
			targetHash,
			`Gate repository cannot be resolved: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	const inspection = inspectGateTarget(
		target,
		receipt,
		repositoryRoot,
		actualIntendedCommitTree,
	);
	if (!inspection.valid) {
		return deniedGateResult(receipt.receipt_hash, targetHash, inspection.reason);
	}
	return {
		status: inspection.matchesReceipt ? GATE_RESULT.ALLOW : GATE_RESULT.SCOPE_CHANGED,
		actor_count: 0,
		target_hash: targetHash,
		receipt_hash: receipt.receipt_hash,
		reason: inspection.reason,
	};
}

export function assertReceiptMatchesState(
	receipt: ReceiptEnvelopeV1,
	state: ReviewStateV1,
): void {
	if (!state.frozen_ledger || !state.final_candidate_tree || !state.terminal_state) {
		throw new ReviewIntegrityError("Authoritative state cannot mint a receipt");
	}
	const expected: ReceiptBodyV1 = {
		schema: "gentle-ai.review-receipt-body/v1",
		lineage_id: state.lineage_id,
		mode: state.mode,
		base_tree: state.base_tree,
		complete_snapshot_tree: state.complete_snapshot_tree,
		review_projection: state.review_projection,
		initial_review_tree: state.initial_review_tree,
		final_candidate_tree: state.final_candidate_tree,
		route: state.route,
		lenses: state.lenses,
		policy_hash: state.policy_hash,
		frozen_ledger_hash: state.frozen_ledger.frozen_ledger_hash,
		evidence_hash: state.evidence_hash,
		budget: state.budget,
		counters: state.counters,
		terminal_state: state.terminal_state,
	};
	if (canonicalHash(expected) !== canonicalHash(receipt.body)) {
		throw new ReviewIntegrityError("Receipt body does not match authoritative state");
	}
}

export function createReceiptForState(state: ReviewStateV1): ReceiptEnvelopeV1 {
	if (
		state.phase !== REVIEW_PHASE.TERMINAL ||
		!state.frozen_ledger ||
		!state.final_candidate_tree ||
		!state.terminal_state
	) {
		throw new ReviewIntegrityError("Only terminal authoritative state can mint a receipt");
	}
	const body: ReceiptBodyV1 = {
		schema: "gentle-ai.review-receipt-body/v1",
		lineage_id: state.lineage_id,
		mode: state.mode,
		base_tree: state.base_tree,
		complete_snapshot_tree: state.complete_snapshot_tree,
		review_projection: state.review_projection,
		initial_review_tree: state.initial_review_tree,
		final_candidate_tree: state.final_candidate_tree,
		route: state.route,
		lenses: state.lenses,
		policy_hash: state.policy_hash,
		frozen_ledger_hash: state.frozen_ledger.frozen_ledger_hash,
		evidence_hash: state.evidence_hash,
		budget: state.budget,
		counters: state.counters,
		terminal_state: state.terminal_state,
	};
	return createReceiptEnvelope(body);
}

export function validateReviewGate(
	options: Omit<ValidateReviewGateOptions, "receipt"> & { receipt: AuthoritativeReceiptV1 },
): GateResultV1 {
	return options.store.validateAuthoritativeGate(options);
}

export function validateAuthoritativeReviewGate(
	options: Omit<ValidateReviewGateOptions, "receipt"> & { receipt: AuthoritativeReceiptV1 },
): GateResultV1 {
	return options.store.validateAuthoritativeGate(options);
}
