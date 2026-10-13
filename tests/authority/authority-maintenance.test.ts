import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { abandonJeroLineageV1, jeroAbandonAuthorizationV1, jeroReconcileAuthorizationV1, reclaimJeroAuthorityV1, reconcileJeroAuthorityV1, recoverJeroLineageV1 } from "../../lib/authority/maintenance.ts";
import { reviewStartV1 } from "../../lib/authority/start.ts";
import { resolveJeroAuthorityContextV1, type JeroAuthorityContextV1 } from "../../lib/authority/review.ts";
import { tempRoot } from "./fixtures.ts";

function harness(t: { after(fn: () => void): void }): { repo: string; context: JeroAuthorityContextV1; lineageId: string; revision: string; snapshotIdentity: string } {
	const parent = tempRoot("jero-maintenance-");
	const repo = join(parent, "repo");
	mkdirSync(repo, { recursive: true });
	const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, stdio: "ignore" });
	git("init", "-b", "main");
	writeFileSync(join(repo, "app.ts"), "export const value = 1;\n");
	git("add", ".");
	git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-m", "init");
	writeFileSync(join(repo, "app.ts"), "export const value = 2;\n");
	t.after(() => rmSync(parent, { recursive: true, force: true }));
	const resolution = resolveJeroAuthorityContextV1(repo);
	if (resolution.kind !== "ok") throw new Error(`resolve refused: ${resolution.code}`);
	const started = reviewStartV1(resolution.context, { cwd: repo }, { consent: "granted" });
	if (started.kind !== "created") throw new Error(`start did not create: ${JSON.stringify(started).slice(0, 160)}`);
	const loaded = resolution.context.lineages.load(started.lineage_id);
	if (loaded.kind !== "ok") throw new Error("lineage missing after start");
	return {
		repo,
		context: resolution.context,
		lineageId: started.lineage_id,
		revision: loaded.record.revision,
		snapshotIdentity: loaded.record.state.snapshot.identity,
	};
}

function abandonInput(h: { lineageId: string; revision: string; snapshotIdentity: string }, overrides: Record<string, unknown> = {}) {
	const base = {
		lineage: h.lineageId,
		expectedRevision: h.revision,
		snapshotIdentity: h.snapshotIdentity,
		capturedLensResults: [] as string[],
		findingsPresent: false,
		actor: "maintainer",
		reason: "wrong target",
	};
	return { ...base, ...overrides, maintainerAuthorization: jeroAbandonAuthorizationV1({ ...base, ...overrides } as never) };
}

test("abandon requires the exact eight-line binding and re-derives the discarded work", (t) => {
	const h = harness(t);
	const forged = abandonInput(h);
	forged.maintainerAuthorization = forged.maintainerAuthorization.replace("wrong target", "another reason");
	const mismatch = abandonJeroLineageV1(h.context, forged);
	assert.equal(mismatch.kind, "refused");
	if (mismatch.kind === "refused") assert.equal(mismatch.code, "authorization-mismatch");
	const driftedWork = abandonInput(h, { findingsPresent: true });
	const work = abandonJeroLineageV1(h.context, driftedWork);
	assert.equal(work.kind, "refused");
	if (work.kind === "refused") assert.equal(work.code, "discarded-work-mismatch");
	const driftedRevision = abandonInput(h, { expectedRevision: `sha256:${"f".repeat(64)}` });
	const rev = abandonJeroLineageV1(h.context, driftedRevision);
	assert.equal(rev.kind, "refused");
	if (rev.kind === "refused") assert.equal(rev.code, "discarded-work-mismatch");
	const ok = abandonJeroLineageV1(h.context, abandonInput(h));
	assert.equal(ok.kind, "abandoned");
	const reloaded = h.context.lineages.load(h.lineageId);
	if (reloaded.kind !== "ok") throw new Error("lineage missing after abandon");
	assert.equal(reloaded.record.state.state, "invalidated");
	assert.equal(reloaded.record.state.invalidation_reason, "wrong target");
	// Terminal lineages are not abandonable again.
	const again = abandonJeroLineageV1(h.context, abandonInput(h, { expectedRevision: reloaded.record.revision, capturedLensResults: [], findingsPresent: false }));
	assert.equal(again.kind, "refused");
	if (again.kind === "refused") assert.equal(again.code, "not-abandonable");
	// The audit sidecar exists and carries the binding hash.
	const maintenance = JSON.parse(readFileSync(join(h.repo, ".git", "jero-review", "lineages", h.lineageId, "maintenance.json"), "utf8")) as { operation: string }[];
	assert.ok(maintenance.some((entry) => entry.operation === "abandon"));
});

test("reclaim quarantines the whole lineage directory and logs it store-wide", (t) => {
	const h = harness(t);
	const result = reclaimJeroAuthorityV1(h.context, { lineage: h.lineageId, actor: "maintainer", reason: "repository reset" });
	assert.equal(result.kind, "reclaimed");
	assert.equal(h.context.lineages.load(h.lineageId).kind, "missing");
	const lineagesDir = join(h.repo, ".git", "jero-review", "lineages");
	const names = readdirSync(lineagesDir);
	assert.ok(names.some((name) => name.startsWith(`.quarantine-${h.lineageId}-`)), "evidence retained under quarantine");
	const storeLog = JSON.parse(readFileSync(join(h.repo, ".git", "jero-review", "maintenance-log.json"), "utf8")) as { operation: string; lineage: string }[];
	assert.ok(storeLog.some((entry) => entry.operation === "reclaim" && entry.lineage === h.lineageId));
	// Unknown lineage refuses typed.
	const missing = reclaimJeroAuthorityV1(h.context, { lineage: h.lineageId, actor: "m", reason: "r" });
	assert.equal(missing.kind, "refused");
	if (missing.kind === "refused") assert.equal(missing.code, "lineage-missing");
});

function twoLineages(t: { after(fn: () => void): void }): ReturnType<typeof harness> & { second: { lineageId: string; revision: string } } {
	const h = harness(t);
	// Freeze the first target so a second START derives a fresh lineage.
	writeFileSync(join(h.repo, "other.ts"), "export const other = 1;\n");
	const second = reviewStartV1(h.context, { cwd: h.repo }, { consent: "granted" });
	if (second.kind !== "created") throw new Error(`second start failed: ${second.kind}`);
	const loaded = h.context.lineages.load(second.lineage_id);
	if (loaded.kind !== "ok") throw new Error("second lineage missing");
	return { ...h, second: { lineageId: second.lineage_id, revision: loaded.record.revision } };
}

test("recover pins the predecessor revision, records linkage on the successor, never touches the predecessor", (t) => {
	const h = twoLineages(t);
	const badDisposition = recoverJeroLineageV1(h.context, { predecessorLineage: h.lineageId, expectedPredecessorRevision: h.revision, successorLineage: h.second.lineageId, disposition: "lost" as never, actor: "m", reason: "r" });
	assert.equal(badDisposition.kind, "refused");
	const stale = recoverJeroLineageV1(h.context, { predecessorLineage: h.lineageId, expectedPredecessorRevision: `sha256:${"e".repeat(64)}`, successorLineage: h.second.lineageId, disposition: "scope_changed", actor: "m", reason: "r" });
	assert.equal(stale.kind, "refused");
	if (stale.kind === "refused") assert.equal(stale.code, "revision-mismatch");
	const ok = recoverJeroLineageV1(h.context, { predecessorLineage: h.lineageId, expectedPredecessorRevision: h.revision, successorLineage: h.second.lineageId, disposition: "scope_changed", actor: "maintainer", reason: "scope drifted" });
	assert.equal(ok.kind, "recovered");
	const successorSidecar = JSON.parse(readFileSync(join(h.repo, ".git", "jero-review", "lineages", h.second.lineageId, "maintenance.json"), "utf8")) as { operation: string; predecessor_lineage_id: string }[];
	assert.ok(successorSidecar.some((entry) => entry.operation === "recover" && entry.predecessor_lineage_id === h.lineageId));
	// The predecessor has NO maintenance sidecar — untouched.
	assert.equal(existsSync(join(h.repo, ".git", "jero-review", "lineages", h.lineageId, "maintenance.json")), false);
});

test("reconcile quarantines only the bound successor under the dual anomaly and never the predecessor", (t) => {
	const h = twoLineages(t);
	const base = { predecessorLineage: h.lineageId, expectedPredecessorRevision: h.revision, successorLineage: h.second.lineageId, expectedSuccessorRevision: h.second.revision, actor: "maintainer", reason: "unchanged target" };
	// Without anomalies: recovery linkage, both lineages intact.
	const plain = reconcileJeroAuthorityV1(h.context, { ...base, maintainerAuthorization: jeroReconcileAuthorizationV1(base) });
	assert.equal(plain.kind, "reconciled");
	assert.equal(h.context.lineages.load(h.second.lineageId).kind, "ok");
	// With the combined anomaly: successor quarantined, predecessor intact.
	const anomalous = { ...base, anomalies: "unchanged_target,malformed_recovery_authorization" as const };
	const quarantined = reconcileJeroAuthorityV1(h.context, { ...anomalous, maintainerAuthorization: jeroReconcileAuthorizationV1(anomalous) });
	assert.equal(quarantined.kind, "reconciled");
	assert.equal(h.context.lineages.load(h.second.lineageId).kind, "missing");
	assert.equal(h.context.lineages.load(h.lineageId).kind, "ok");
	// A forged binding refuses before anything moves.
	const thirdBase = { ...base, reason: "forged" };
	const forged = reconcileJeroAuthorityV1(h.context, { ...thirdBase, maintainerAuthorization: jeroReconcileAuthorizationV1(base) });
	assert.equal(forged.kind, "refused");
	if (forged.kind === "refused") assert.equal(forged.code, "authorization-mismatch");
});

test("the LF-only maintainer authorization discipline rejects control characters", (t) => {
	const h = harness(t);
	const refused = recoverJeroLineageV1(h.context, { predecessorLineage: h.lineageId, expectedPredecessorRevision: h.revision, successorLineage: h.lineageId, disposition: "invalidated", actor: "m", reason: "r", maintainerAuthorization: "line one\r\nline two" });
	assert.equal(refused.kind, "refused");
	if (refused.kind === "refused") assert.equal(refused.code, "invalid-request");
});
