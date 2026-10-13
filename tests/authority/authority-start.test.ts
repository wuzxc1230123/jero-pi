import assert from "node:assert/strict";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { canonicalJsonV1, domainHashV1 } from "../../lib/review-canonical.ts";
import { resolveJeroAuthorityContextV1 } from "../../lib/authority/review.ts";
import { reviewStartV1 } from "../../lib/authority/start.ts";
import { reviewStatusV1 } from "../../lib/authority/status.ts";
import { reviewFinalizeV1 } from "../../lib/authority/finalize.ts";
import { reviewAcknowledgeV1 } from "../../lib/authority/acknowledge.ts";
import { jeroReceiptPathV1 } from "../../lib/authority/receipts.ts";
import { setJeroReviewModeV1 } from "../../lib/authority/mode.ts";
import { JeroLineageStoreV1 } from "../../lib/authority/lineage-store.ts";
import { applyRiskChange, git as fixturesGit, repository, admitFixtureReviewerResults, reviewHarness, startCreatedReview } from "./fixtures.ts";

// Spec §B: START semantics — created/resumed/replayed/closed variants, the
// consent gate, foreign-store refusal, lock discipline, budget formula, and
// artifact-subject field-level checks.

test("created: a medium-risk candidate freezes one dominant lens and a reviewing lineage", (t) => {
	const { repo, context, start } = startCreatedReview(t, "medium", 4);
	assert.equal(start.state, "reviewing");
	assert.equal(start.risk_level, "medium");
	assert.deepEqual(start.selected_lenses, ["review-readability"]);
	assert.equal(start.lenses_required, true);
	assert.equal(start.changed_lines, 4);
	assert.equal(start.changed_files, 1);
	// Budget = min(200, ceil(lines/2)) (spec §B.3).
	assert.equal(start.correction_budget, 2);
	assert.match(start.lineage_id, /^review-[0-9a-f]{16}$/);
	assert.equal(start.target_identity.startsWith("sha256:"), true);
	// repository_context is REQUIRED iff (created|resumed) ∧ state=reviewing.
	assert.equal(typeof start.repository_context?.handle, "string");
	assert.ok(start.revision.startsWith("sha256:"));
	// Persisted record decodes through the lineage store.
	const store = JeroLineageStoreV1.forStore(context.store.store_root);
	const loaded = store.load(start.lineage_id);
	assert.equal(loaded.kind, "ok");
	if (loaded.kind === "ok") {
		assert.equal(loaded.record.state.state, "reviewing");
		assert.equal(loaded.record.state.generation, 1);
		assert.equal(loaded.record.state.counters.full_reviews, 1);
		assert.equal(loaded.record.state.mode, "ordinary_bounded");
		assert.deepEqual(loaded.record.state.genesis_paths, ["src/app.ts"]);
	}
});

test("budget formula: min(200, ceil(lines/2)) across line counts, capped at 200", (t) => {
	const odd = startCreatedReview(t, "medium", 5);
	assert.equal(odd.start.changed_lines, 5);
	assert.equal(odd.start.correction_budget, 3);
	const large = startCreatedReview(t, "medium", 500);
	assert.equal(large.start.changed_lines, 500);
	assert.equal(large.start.risk_level, "high");
	// ceil(500/2) = 250 capped at MAX_CORRECTION_CHANGED_LINES = 200.
	assert.equal(large.start.correction_budget, 200);
	assert.equal(large.start.selected_lenses.length, 4);
});

test("closed: a low-risk documentation-only candidate closes at START (zero lens, action closed)", (t) => {
	const { repo, start } = startCreatedReview(t, "low", 2);
	assert.equal(start.kind, "closed");
	assert.equal(start.action, "closed");
	assert.equal(start.state, "approved");
	assert.equal(start.lenses_required, false);
	assert.deepEqual(start.selected_lenses, []);
	assert.deepEqual(start.artifact_subjects, []);
	// The budget is still frozen even though the lineage closed at START.
	assert.equal(start.correction_budget, Math.min(200, Math.ceil(start.changed_lines / 2)));
	assert.equal(start.repository_context, undefined);
});

test("high-risk: four subjects share authority_revision/base/candidate/manifest digest and differ per lens", (t) => {
	const { start } = startCreatedReview(t, "high", 6);
	assert.equal(start.risk_level, "high");
	assert.deepEqual(start.selected_lenses, ["review-risk", "review-resilience", "review-readability", "review-reliability"]);
	assert.equal(start.artifact_subjects.length, 4);
	const [first, ...rest] = start.artifact_subjects;
	for (const subject of rest) {
		assert.equal(subject.authority_revision, first!.authority_revision);
		assert.equal(subject.base_tree, first!.base_tree);
		assert.equal(subject.candidate_tree, first!.candidate_tree);
		assert.equal(subject.changed_path_manifest_sha256, first!.changed_path_manifest_sha256);
		assert.equal(subject.lineage_id, first!.lineage_id);
		assert.equal(subject.target_identity, first!.target_identity);
	}
	const hashes = new Set(start.artifact_subjects.map(({ subject_hash }) => subject_hash));
	assert.equal(hashes.size, 4);
	assert.deepEqual(start.artifact_subjects.map(({ selected_order }) => selected_order), [0, 1, 2, 3]);
	assert.deepEqual(start.artifact_subjects.map(({ lens }) => lens), start.selected_lenses);
	assert.match(start.artifact_subjects[0]!.subject_hash, /^sha256:[0-9a-f]{64}$/);
});

test("risk reasons use the closed 11-code / 6-signal vocabulary with at least one unique row", (t) => {
	const { start } = startCreatedReview(t, "high", 3);
	assert.ok(start.risk_reasons.length >= 1);
	const signals = new Set(["auth", "update", "security", "payments", "permissions", "shell_process"]);
	const codes = new Set(["configuration_change", "empty_content", "executable_change", "executable_mode", "hot_path", "large_change", "non_executable_only", "process_boundary", "process_scan_limit", "service_token", "shell_source"]);
	for (const reason of start.risk_reasons) {
		assert.ok(codes.has(reason.code), `unknown reason code ${reason.code}`);
		if (reason.signal !== undefined) assert.ok(signals.has(reason.signal), `unknown signal ${reason.signal}`);
	}
	const low = startCreatedReview(t, "low", 1);
	assert.deepEqual(low.start.risk_reasons.map(({ code }) => code), ["non_executable_only"]);
});

test("resumed and replayed: the same candidate continues idempotently under fresh vs identical keys", (t) => {
	const harness = reviewHarness(t, "medium", 4);
	const first = reviewStartV1(harness.context, { cwd: harness.repo }, { consent: "granted", idempotencyKey: "start-first" });
	assert.equal(first.kind, "created");
	// A fresh key for the same frozen candidate resumes the existing lineage.
	const second = reviewStartV1(harness.context, { cwd: harness.repo }, { idempotencyKey: "start-second" });
	assert.equal(second.kind, "resumed");
	if (second.kind === "resumed" && first.kind === "created") {
		assert.equal(second.lineage_id, first.lineage_id);
		assert.equal(second.revision, first.revision);
	}
	// The identical (key, request) pair replays the stored canonical result.
	const replay = reviewStartV1(harness.context, { cwd: harness.repo }, { idempotencyKey: "start-first" });
	assert.equal(replay.kind, "replayed");
});

test("replayed: an exact (idempotency_key, request_hash) replay returns the stored result; a changed candidate starts a new lineage", (t) => {
	const harness = reviewHarness(t, "medium", 4);
	const selection = { consent: "granted" as const, idempotencyKey: "start-fixed-key" };
	const first = reviewStartV1(harness.context, { cwd: harness.repo }, selection);
	assert.equal(first.kind, "created");
	const replay = reviewStartV1(harness.context, { cwd: harness.repo }, selection);
	assert.equal(replay.kind, "replayed");
	if (replay.kind === "replayed") {
		assert.equal(replay.replayability, "exact_replay_safe");
		assert.equal(replay.lineage_id, first.lineage_id);
	}
	// A changed candidate derives a different lineage identity (content-derived ids).
	applyRiskChange(harness.repo, "medium", 8);
	const divergent = reviewStartV1(harness.context, { cwd: harness.repo }, { ...selection, idempotencyKey: "start-fixed-key-2" });
	assert.equal(divergent.kind, "created");
	if (divergent.kind === "created" && first.kind === "created") {
		assert.notEqual(divergent.lineage_id, first.lineage_id);
	}
});

test("blocked-scope-action: a drifted untracked inventory stops pre-lineage", (t) => {
	const harness = reviewHarness(t, "medium", 4);
	const stopped = reviewStartV1(harness.context, { cwd: harness.repo }, { consent: "granted", expectedUntrackedInventory: "sha256:" + "0".repeat(64) });
	assert.equal(stopped.kind, "blocked-scope-action");
	if (stopped.kind === "blocked-scope-action") {
		assert.match(stopped.expected_untracked_inventory, /^sha256:[0-9a-f]{64}$/);
	}
	// No lineage was created by the stop.
	const after = reviewStartV1(harness.context, { cwd: harness.repo }, { consent: "granted" });
	assert.equal(after.kind, "created");
});

test("consent_required: mode-on medium risk without an answer freezes no authority", (t) => {
	const harness = reviewHarness(t, "medium", 4);
	const mode = setJeroReviewModeV1(harness.repo, "on");
	assert.equal(mode.kind, "ok");
	const gated = reviewStartV1(harness.context, { cwd: harness.repo });
	assert.equal(gated.kind, "consent_required");
	if (gated.kind === "consent_required") {
		assert.equal(gated.risk_level, "medium");
		assert.equal(gated.action, "consent_required");
		assert.equal(typeof gated.target_identity, "string");
	}
	assert.equal(JeroLineageStoreV1.forStore(harness.context.store.store_root).list().length, 0);
});

test("declined: the consent answer creates zero review authority (empty fields)", (t) => {
	const harness = reviewHarness(t, "high", 5);
	setJeroReviewModeV1(harness.repo, "on");
	const declined = reviewStartV1(harness.context, { cwd: harness.repo }, { consent: "declined" });
	assert.equal(declined.kind, "declined");
	if (declined.kind === "declined") {
		assert.equal(declined.action, "declined");
		assert.equal(declined.consent, "declined_this_candidate");
		assert.equal(declined.lineage_id, "");
		assert.equal(declined.state, "");
		assert.equal(declined.lenses_required, false);
		assert.deepEqual(declined.selected_lenses, []);
		assert.deepEqual(declined.lens_bindings, []);
		assert.equal(declined.correction_budget, 0);
	}
	assert.equal(JeroLineageStoreV1.forStore(harness.context.store.store_root).list().length, 0);
});

test("granted: the consent answer proceeds into a normal created START", (t) => {
	const harness = reviewHarness(t, "high", 5);
	setJeroReviewModeV1(harness.repo, "on");
	const granted = reviewStartV1(harness.context, { cwd: harness.repo }, { consent: "granted" });
	assert.equal(granted.kind, "created");
});

test("foreign-authority-store: upstream gentle-ai data refuses START before any jero write", (t) => {
	const repo = repository(t);
	// Probe names from store-root.ts: gentle-ai/reviews/IDENTITY.
	mkdirSync(join(repo, ".git", "gentle-ai", "reviews"), { recursive: true });
	writeFileSync(join(repo, ".git", "gentle-ai", "reviews", "IDENTITY"), "x");
	const resolution = resolveJeroAuthorityContextV1(repo);
	assert.equal(resolution.kind, "refused");
	if (resolution.kind === "refused") {
		assert.equal(resolution.code, "foreign-authority-store");
		assert.match(resolution.detail ?? "", /gentle-ai\/reviews\/IDENTITY/);
	}
	assert.equal(existsSync(join(repo, ".git", "jero-review")), false);
});

test("a live owned lock refuses START while a released dead-owner leftover does not", (t) => {
	const harness = reviewHarness(t, "medium", 4);
	const owner = harness.context.locks.acquire();
	try {
		const blocked = reviewStartV1(harness.context, { cwd: harness.repo });
		assert.equal(blocked.kind, "refused");
		if (blocked.kind === "refused") assert.equal(blocked.code, "authority-lock-held");
	} finally {
		harness.context.locks.release(owner);
	}
	// Fabricate the gentle-ai #184 leftover: a dead-owner lock directory.
	const storeRoot = harness.context.store.store_root;
	const token = "b".repeat(64);
	const pid = 4_000_000;
	const ownerHash = domainHashV1("lock-owner", { token, pid, repository_id: harness.context.store.repository_id, authority_id: harness.context.store.authority_id });
	mkdirSync(join(storeRoot, "locks", "authority.lock"), { recursive: true, mode: 0o700 });
	writeFileSync(join(storeRoot, "locks", "authority.lock", "owner.json"), canonicalJsonV1({ token, owner_hash: ownerHash, pid, repository_id: harness.context.store.repository_id, authority_id: harness.context.store.authority_id }), { mode: 0o600, flag: "wx" });
	assert.equal(harness.context.locks.inspect().status, "released");
	const afterLeftover = reviewStartV1(harness.context, { cwd: harness.repo }, { consent: "granted" });
	assert.equal(afterLeftover.kind, "created");
});

test("pairing rules fail closed as TypeErrors (§B.1)", (t) => {
	const harness = reviewHarness(t, "medium", 4);
	assert.throws(() => reviewStartV1(harness.context, { cwd: harness.repo, baseRef: "HEAD" }), /baseRef requires committedOnly/);
	assert.throws(() => reviewStartV1(harness.context, { cwd: harness.repo, committedOnly: true }), /committedOnly requires baseRef/);
	assert.throws(() => reviewStartV1(harness.context, { cwd: harness.repo }, { untrackedScope: "exclude", intendedUntracked: ["x"] }), /exclude cannot carry/);
	assert.throws(() => reviewStartV1(harness.context, { cwd: harness.repo }, { untrackedScope: "select" }), /select requires at least one/);
	assert.throws(() => reviewStartV1(harness.context, { cwd: harness.repo }, { intendedUntracked: ["C:\\abs"] }), /POSIX/);
});

test("targetIdentity drift is refused as identity-mismatch", (t) => {
	const harness = reviewHarness(t, "medium", 4);
	const drifted = reviewStartV1(harness.context, { cwd: harness.repo, targetIdentity: `sha256:${"9".repeat(64)}` });
	assert.equal(drifted.kind, "refused");
	if (drifted.kind === "refused") assert.equal(drifted.code, "identity-mismatch");
});

test("base-diff candidates start against a committed range", (t) => {
	const repo = repository(t);
	const git = (...args: string[]) => fixturesGit(repo, ...args);
	writeFileSyncSafe(join(repo, "src", "feature.ts"), "export const f = 1;\n");
	git("add", ".");
	git("commit", "-m", "feature");
	const resolution = resolveJeroAuthorityContextV1(repo);
	if (resolution.kind !== "ok") throw new Error(resolution.detail ?? "resolution refused");
	const started = reviewStartV1(resolution.context, { cwd: repo, baseRef: "HEAD~1", committedOnly: true }, { consent: "granted" });
	assert.equal(started.kind, "created");
	if (started.kind === "created") {
		assert.equal(started.state, "reviewing");
		assert.equal(started.changed_files, 1);
		// A committed range reviews committed content only: no untracked paths.
		const loaded = JeroLineageStoreV1.forStore(resolution.context.store.store_root).load(started.lineage_id);
		if (loaded.kind === "ok") assert.deepEqual(loaded.record.state.snapshot.intended_untracked, []);
	}
});

function writeFileSyncSafe(path: string, content: string): void {
	mkdirSync(join(path, ".."), { recursive: true });
	writeFileSync(path, content);
}

test("J.4: an explicit Judgment Day START creates a reviewing lineage with no ordinary lenses", (t) => {
	const harness = reviewHarness(t, "medium", 4);
	const started = reviewStartV1(harness.context, { cwd: harness.repo, requestMode: "judgment-day" }, { consent: "granted" });
	assert.equal(started.kind, "created");
	if (started.kind !== "created") throw new Error("start failed");
	assert.equal(started.mode, "judgment_day");
	assert.deepEqual(started.selected_lenses, []);
	assert.equal(started.lenses_required, false);
	const loaded = JeroLineageStoreV1.forStore(harness.context.store.store_root).load(started.lineage_id);
	assert.equal(loaded.kind, "ok");
	if (loaded.kind !== "ok") throw new Error("load failed");
	assert.equal(loaded.record.state.state, "reviewing");
	assert.equal(loaded.record.state.mode, "judgment_day");
	// Immutable JD budgets start zeroed; the budget table is enforced at
	// every admission (judgment-day.ts).
	assert.equal(loaded.record.state.counters.judge_executions, 0);
	assert.equal(loaded.record.state.counters.refuter_batches, 0);
	assert.equal(loaded.record.state.counters.scoped_rejudgments, 0);
});

test("F10: the consent gate fires only while no authority is frozen — a resume is never re-asked", (t) => {
	const harness = reviewHarness(t, "medium", 4);
	const mode = setJeroReviewModeV1(harness.repo, "on");
	assert.equal(mode.kind, "ok");
	const created = reviewStartV1(harness.context, { cwd: harness.repo }, { consent: "granted" });
	assert.equal(created.kind, "created");
	// Mode is still on and this call carries NO consent answer: the existing
	// reviewing lineage resumes (upstream asks only while nothing is frozen,
	// native-review-cli.ts:1806-1820).
	const resumed = reviewStartV1(harness.context, { cwd: harness.repo }, { idempotencyKey: "resume-no-consent" });
	assert.equal(resumed.kind, "resumed");
});

test("F12: declared intended untracked paths must appear in the live untracked inventory", (t) => {
	const harness = reviewHarness(t, "medium", 4);
	const refused = reviewStartV1(harness.context, { cwd: harness.repo }, { consent: "granted", intendedUntracked: ["src/app.ts", "no-such-file.ts"] });
	assert.equal(refused.kind, "refused");
	if (refused.kind === "refused") {
		assert.equal(refused.code, "invalid-request");
		assert.match(refused.detail ?? "", /no-such-file\.ts/);
	}
	// A declared path that IS in the inventory proceeds to a normal start.
	const started = reviewStartV1(harness.context, { cwd: harness.repo }, { consent: "granted", intendedUntracked: ["src/app.ts"] });
	assert.equal(started.kind, "created");
});

test("F9: a burned lineage refuses START-after-burn even under the default idempotency key", (t) => {
	const harness = reviewHarness(t, "medium", 4);
	const start = reviewStartV1(harness.context, { cwd: harness.repo }, { consent: "granted" });
	if (start.kind !== "created") throw new Error(JSON.stringify(start));
	const burnResult = { lens_results: [{ lens: "review-readability" as const, findings: [], evidence: ["clean"] }] };
	admitFixtureReviewerResults(harness, start.lineage_id, burnResult);
	reviewFinalizeV1(harness.context, {
		cwd: harness.repo, lineageId: start.lineage_id, reviewer_run_acknowledged: true,
		review_result: burnResult,
	});
	reviewFinalizeV1(harness.context, { cwd: harness.repo, lineageId: start.lineage_id, classifications: [] });
	reviewFinalizeV1(harness.context, {
		cwd: harness.repo, lineageId: start.lineage_id,
		final_evidence: "final verification output", final_verification_passed: true,
	});
	const status = reviewStatusV1(harness.context, { cwd: harness.repo });
	if (status.kind !== "status" || status.authority === undefined) throw new Error("status failed");
	const acknowledged = reviewAcknowledgeV1(harness.context, {
		cwd: harness.repo, lineageId: start.lineage_id, targetIdentity: start.target_identity,
		expectedRevision: status.authority.revision, token: "burn",
	});
	assert.equal(acknowledged.kind, "acknowledged");
	// START-after-burn under the DEFAULT key: the original start journal entry
	// would otherwise replay its approved canonical result — the consumed
	// check refuses before the replay branch.
	const restarted = reviewStartV1(harness.context, { cwd: harness.repo });
	assert.equal(restarted.kind, "refused");
	if (restarted.kind === "refused") assert.equal(restarted.code, "lineage-consumed");
});

test("F8: replaying a zero-lens close heals a missing receipt (crash window)", (t) => {
	const { repo, context } = reviewHarness(t, "low", 2);
	const closed = reviewStartV1(context, { cwd: repo });
	assert.equal(closed.kind, "closed");
	if (closed.kind !== "closed") return;
	const receiptPath = jeroReceiptPathV1(context.store.store_root, closed.lineage_id);
	assert.equal(existsSync(receiptPath), true);
	// Simulate the crash between the journal save and the receipt write.
	rmSync(receiptPath, { force: true });
	const replay = reviewStartV1(context, { cwd: repo });
	assert.equal(replay.kind, "replayed");
	assert.equal(existsSync(receiptPath), true);
});
