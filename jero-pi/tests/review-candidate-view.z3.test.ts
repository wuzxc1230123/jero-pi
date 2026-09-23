// review-candidate-view 测试第 3 段（共 3 段；夹具在 review-candidate-view-shared.ts）。
// 机械平移自原 review-candidate-view.test.ts，语义零改动。

import { default as assert } from "node:assert/strict";
import { default as childProcess, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	chmodSync, default as fs, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync,
	readFileSync, realpathSync, renameSync, rmSync, symlinkSync, utimesSync, writeFileSync
} from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { default as test } from "node:test";
import { gzipSync } from "node:zlib";
import {
	type CandidateGitExecutor, CandidateViewError, CandidateViewRegistry, CANONICAL_GZIP_OPTIONS,
	createCandidateView, decodeCandidateContextManifest, deriveChangedPathManifest,
	digestChangedPathManifest, hasExpectedExecutableBits, injectReviewCandidateView,
	type NativeCandidateProjectionDescriptor, readCandidateContextManifestPage
} from "../lib/review-candidate-view.ts";
import {
	assertCandidateOwnerParent, assertTrustedWindowsOwner, prepareCandidateOwnerParent,
	setWindowsAclAuthorityForTesting, validatePrivateWindowsDacl, validatePrivateWindowsOwner,
	WindowsDaclValidationError, WindowsOwnerValidationError
} from "../lib/review-candidate-view-owner.ts";
import { git, mockOwnerProbe, mockWindowsAcl, orphanFixture, ownerMarker, repository } from "./review-candidate-view-shared.ts";
import { emptyTreeOf, unbornRepository } from "./review-candidate-view.test.ts";

test("fresh registries restore only one exact authoritative reviewing candidate and reject zero or multiple matches", (t) => {
	const contributorRoot = repository(t);
	writeFileSync(join(contributorRoot, "tracked.txt"), "reviewing\n");
	const source = new CandidateViewRegistry();
	const frozen = source.create({ contributorRoot });
	const state = {
		lineageId: "reloaded-current",
		contributorRoot,
		baseCommit: frozen.baseCommit,
		baseTree: frozen.baseTree,
		candidateTree: frozen.candidateTree,
		paths: frozen.paths,
		modes: frozen.modes,
		deletedPaths: frozen.deletedPaths,
		selectedLenses: ["review-reliability"],
	};
	const restored = new CandidateViewRegistry();
	try {
		restored.restoreCurrentFromAuthoritativeReviewingStates(contributorRoot, [state]);
		const dispatch = { agent: "review-reliability", task: "review", mode: "task" };
		injectReviewCandidateView(dispatch, restored);
		assert.match(dispatch.task, /Controller-owned review lineage: `reloaded-current`/);
		assert.throws(() => restored.resolveCurrentForLens("review-risk"), (error: unknown) => error instanceof CandidateViewError && error.reason === "current-binding-lens-unselected");
		for (const candidates of [[], [state, { ...state, lineageId: "duplicate" }]]) {
			const rejected = new CandidateViewRegistry();
			let error: unknown;
			try {
				rejected.restoreCurrentFromAuthoritativeReviewingStates(contributorRoot, candidates);
			} catch (value) {
				error = value;
			}
			assert.ok(error instanceof CandidateViewError);
			assert.match(error.reason, /authoritative-current-match-(missing|ambiguous)/);
		}
	} finally {
		source.cleanup(frozen.token);
		const resolved = restored.resolveCurrentForLens("review-reliability");
		restored.cleanup(resolved.token);
	}
});

export interface CandidateViewRegistryInternals {
	records: Map<string, unknown>;
	bindRecord: (token: string, lineageId: string, selectedLenses: readonly unknown[]) => unknown;
}

export function bindingFailureRegistry(t: test.TestContext): { registry: CandidateViewRegistry; materializedRoot: () => string | undefined; internals: CandidateViewRegistryInternals } {
	let root: string | undefined;
	const registry = new CandidateViewRegistry((file, arguments_, options) => {
		if (arguments_[0] === "worktree" && arguments_[1] === "add") root = arguments_[arguments_.indexOf("--no-checkout") + 1];
		return execFileSync(file, arguments_, options);
	});
	t.after(() => registry.cleanupAll());
	return { registry, materializedRoot: () => root, internals: registry as unknown as CandidateViewRegistryInternals };
}

test("failed authoritative restores remove the inserted registry record and readonly worktree", (t) => {
	const contributorRoot = repository(t);
	writeFileSync(join(contributorRoot, "tracked.txt"), "reviewing\n");
	const source = new CandidateViewRegistry();
	const frozen = source.create({ contributorRoot });
	const state = {
		lineageId: "restore-bind-failure",
		contributorRoot,
		baseCommit: frozen.baseCommit,
		baseTree: frozen.baseTree,
		candidateTree: frozen.candidateTree,
		paths: frozen.paths,
		modes: frozen.modes,
		deletedPaths: frozen.deletedPaths,
		selectedLenses: ["review-reliability"],
	};
	const { registry, materializedRoot, internals } = bindingFailureRegistry(t);
	const originalBindRecord = internals.bindRecord;
	internals.bindRecord = (token) => {
		assert.equal(internals.records.has(token), true, "the failure must occur after insertion");
		throw new CandidateViewError("test-only bind failure");
	};
	try {
		assert.throws(
			() => registry.restoreCurrentFromAuthoritativeReviewingStates(contributorRoot, [state]),
			CandidateViewError,
		);
	} finally {
		internals.bindRecord = originalBindRecord;
		source.cleanup(frozen.token);
	}
	assert.equal(internals.records.size, 0);
	assert.ok(materializedRoot(), "the restore must have created a candidate worktree");
	assert.equal(existsSync(materializedRoot()!), false);
});

test("failed finalize restores remove the inserted registry record and readonly worktree", (t) => {
	const contributorRoot = repository(t);
	writeFileSync(join(contributorRoot, "tracked.txt"), "candidate\n");
	const source = new CandidateViewRegistry();
	const frozen = source.create({ contributorRoot });
	const { registry, materializedRoot, internals } = bindingFailureRegistry(t);
	const originalBindRecord = internals.bindRecord;
	internals.bindRecord = (token) => {
		assert.equal(internals.records.has(token), true, "the failure must occur after insertion");
		throw new CandidateViewError("test-only bind failure");
	};
	try {
		assert.throws(
			() => registry.restoreForFinalizeFromNative("finalize-bind-failure", contributorRoot, {
				baseTree: frozen.baseTree,
				currentCandidateTree: frozen.candidateTree,
				paths: frozen.paths,
				intendedUntracked: [],
				projection: "workspace",
			}),
			CandidateViewError,
		);
	} finally {
		internals.bindRecord = originalBindRecord;
		source.cleanup(frozen.token);
	}
	assert.equal(internals.records.size, 0);
	assert.ok(materializedRoot(), "the restore must have created a candidate worktree");
	assert.equal(existsSync(materializedRoot()!), false);
});

export function materializationFailureRegistry(t: test.TestContext, failureAt: number): { registry: CandidateViewRegistry; roots: () => readonly string[]; removalAttempts: (root: string) => number; internals: CandidateViewRegistryInternals } {
	const roots: string[] = [];
	const removalAttempts = new Map<string, number>();
	let materializations = 0;
	let failPending = true;
	const registry = new CandidateViewRegistry((file, arguments_, options) => {
		if (arguments_[0] === "worktree" && arguments_[1] === "add") {
			const root = arguments_[arguments_.indexOf("--no-checkout") + 1];
			assert.equal(typeof root, "string", "worktree add must name its candidate root");
			roots.push(root);
			materializations += 1;
		}
		if (arguments_[0] === "worktree" && arguments_[1] === "remove") {
			const root = arguments_[arguments_.indexOf("--force") + 1];
			assert.equal(typeof root, "string", "worktree remove must name its candidate root");
			removalAttempts.set(root, (removalAttempts.get(root) ?? 0) + 1);
		}
		if (failPending && materializations === failureAt && options.cwd === roots.at(-1) && arguments_[0] === "read-tree") {
			failPending = false;
			throw Object.assign(new Error("test-only materialization failure"), { status: 1 });
		}
		return execFileSync(file, arguments_, options);
	});
	t.after(() => registry.cleanupAll());
	return { registry, roots: () => roots, removalAttempts: (root) => removalAttempts.get(root) ?? 0, internals: registry as unknown as CandidateViewRegistryInternals };
}

test("finalize restore removes a registered projection when its first materialization fails and retries cleanly", (t) => {
	const contributorRoot = repository(t);
	writeFileSync(join(contributorRoot, "tracked.txt"), "candidate\n");
	const source = new CandidateViewRegistry();
	const frozen = source.create({ contributorRoot });
	const lineageId = "finalize-materialization-failure";
	const descriptor = {
		baseTree: frozen.baseTree,
		currentCandidateTree: frozen.candidateTree,
		paths: frozen.paths,
		intendedUntracked: [],
		projection: "workspace" as const,
	};
	const baselineWorktrees = git(contributorRoot, "worktree", "list", "--porcelain");
	const { registry, roots, internals } = materializationFailureRegistry(t, 1);
	try {
		assert.throws(() => registry.restoreForFinalizeFromNative(lineageId, contributorRoot, descriptor), CandidateViewError);
		assert.equal(registry.hasProjection(lineageId, contributorRoot), false);
		assert.equal(internals.records.size, 0);
		assert.equal(git(contributorRoot, "worktree", "list", "--porcelain"), baselineWorktrees);
		assert.equal(existsSync(roots()[0]!), false);

		const restored = registry.restoreForFinalizeFromNative(lineageId, contributorRoot, descriptor);
		assert.equal(registry.resolveForFinalize(lineageId, contributorRoot).token, restored.token);
		registry.cleanup(restored.token);
	} finally {
		source.cleanup(frozen.token);
	}
});

test("finalize restore does not re-remove its first fallback record when the empty-untracked retry materialization fails", (t) => {
	const contributorRoot = repository(t);
	writeFileSync(join(contributorRoot, "tracked.txt"), "candidate\n");
	writeFileSync(join(contributorRoot, "excluded.txt"), "excluded\n");
	const source = new CandidateViewRegistry();
	const frozen = source.create({ contributorRoot, intendedUntracked: [] });
	const lineageId = "finalize-fallback-materialization-failure";
	const descriptor = {
		baseTree: frozen.baseTree,
		currentCandidateTree: frozen.candidateTree,
		paths: frozen.paths,
		intendedUntracked: [],
		projection: "workspace" as const,
	};
	const baselineWorktrees = git(contributorRoot, "worktree", "list", "--porcelain");
	const { registry, roots, removalAttempts, internals } = materializationFailureRegistry(t, 2);
	try {
		assert.throws(() => registry.restoreForFinalizeFromNative(lineageId, contributorRoot, descriptor), CandidateViewError);
		assert.equal(removalAttempts(roots()[0]!), 1, "the first mismatched record must receive exactly one physical worktree removal");
		assert.equal(registry.hasProjection(lineageId, contributorRoot), false);
		assert.equal(internals.records.size, 0);
		assert.equal(git(contributorRoot, "worktree", "list", "--porcelain"), baselineWorktrees);
		assert.equal(existsSync(roots()[0]!), false);
		assert.equal(existsSync(roots()[1]!), false);

		const restored = registry.restoreForFinalizeFromNative(lineageId, contributorRoot, descriptor);
		assert.equal(registry.resolveForFinalize(lineageId, contributorRoot).token, restored.token);
		registry.cleanup(restored.token);
	} finally {
		source.cleanup(frozen.token);
	}
});

test("dispatch restore removes a registered projection when materialization fails and records the hydration failure before retrying", (t) => {
	const contributorRoot = repository(t);
	writeFileSync(join(contributorRoot, "tracked.txt"), "candidate\n");
	const source = new CandidateViewRegistry();
	const frozen = source.create({ contributorRoot });
	const lineageId = "dispatch-materialization-failure";
	const descriptor = {
		baseTree: frozen.baseTree,
		currentCandidateTree: frozen.candidateTree,
		paths: frozen.paths,
		intendedUntracked: [],
		projection: "workspace" as const,
	};
	const baselineWorktrees = git(contributorRoot, "worktree", "list", "--porcelain");
	const { registry, roots, internals } = materializationFailureRegistry(t, 1);
	try {
		let failure: unknown;
		try {
			registry.restoreCurrentForDispatchFromNative(lineageId, contributorRoot, descriptor, ["review-reliability"]);
		} catch (error) {
			failure = error;
		}
		assert.ok(failure instanceof CandidateViewError);
		assert.equal(registry.hasProjection(lineageId, contributorRoot), false);
		assert.equal(registry.hasCurrentBinding(contributorRoot), false);
		assert.equal(internals.records.size, 0);
		assert.equal(git(contributorRoot, "worktree", "list", "--porcelain"), baselineWorktrees);
		assert.equal(existsSync(roots()[0]!), false);
		assert.deepEqual(registry.lastDispatchHydrationFailure(contributorRoot), {
			lineageId,
			reason: failure.reason,
			message: failure.message,
		});

		registry.restoreCurrentForDispatchFromNative(lineageId, contributorRoot, descriptor, ["review-reliability"]);
		const restored = registry.resolveCurrentForLens("review-reliability", contributorRoot);
		assert.equal(registry.lastDispatchHydrationFailure(contributorRoot), undefined);
		registry.cleanup(restored.token);
	} finally {
		source.cleanup(frozen.token);
	}
});

test("candidate root resolution drift is exposed as a typed candidate-view error", () => {
	const missingRoot = join(tmpdir(), `gentle-pi-missing-root-${process.pid}-${Date.now()}`);
	assert.throws(
		() => new CandidateViewRegistry().hasCurrentBinding(missingRoot),
		(error: unknown) => error instanceof CandidateViewError && error.reason === "contributor-root-unresolvable",
	);
});

test("live candidate drift blocks dispatch before candidate text can be injected", (t) => {
	const contributorRoot = repository(t);
	writeFileSync(join(contributorRoot, "tracked.txt"), "reviewed\n");
	const registry = new CandidateViewRegistry();
	const view = registry.create({ contributorRoot });
	registry.bindCurrent({ token: view.token, lineageId: "drifted", selectedLenses: ["review-reliability"] });
	try {
		writeFileSync(join(contributorRoot, "tracked.txt"), "drifted\n");
		const input = { agent: "review-reliability", task: "review", mode: "task" };
		let error: unknown;
		try {
			injectReviewCandidateView(input, registry);
		} catch (value) {
			error = value;
		}
		assert.ok(error instanceof CandidateViewError);
		assert.equal(error.reason, "current-binding-live-candidate-drift");
		assert.equal(input.task, "review");
	} finally {
		registry.cleanup(view.token);
	}
});

// --- Phase 3: field-wise changed-path manifest binding -----------------------
//
// The sorted-path-set check these tests replace could not see a mode-only or a
// type change: a file turning executable between START and dispatch produced an
// identical path set, so the candidate Pi materialized could diverge from the
// provider's frozen one and the comparison still passed. `--name-status` never
// carried old_mode, which is why the manifest needs its own derivation.

export function treeOf(cwd: string): string {
	git(cwd, "add", "-A");
	return git(cwd, "write-tree");
}

export function baseTreeOf(cwd: string): string {
	return git(cwd, "rev-parse", "HEAD^{tree}");
}

test("deriveChangedPathManifest reports old and new mode, and flags a mode-only change", (t) => {
	const cwd = repository(t);
	chmodSync(join(cwd, "tracked.txt"), 0o755);
	// core.filemode=false 平台（Windows 默认）读不到 chmod，索引层植入执行位。
	git(cwd, "update-index", "--chmod=+x", "tracked.txt");
	const candidate = treeOf(cwd);

	const manifest = deriveChangedPathManifest(cwd, baseTreeOf(cwd), candidate);

	assert.deepEqual(manifest, [{
		path: "tracked.txt",
		status: "M",
		oldMode: "100644",
		newMode: "100755",
		deleted: false,
		typeChanged: false,
		modeOnly: true,
	}]);
});

test("deriveChangedPathManifest distinguishes content change from mode-only", (t) => {
	const cwd = repository(t);
	writeFileSync(join(cwd, "tracked.txt"), "changed\n");
	const manifest = deriveChangedPathManifest(cwd, baseTreeOf(cwd), treeOf(cwd));

	assert.equal(manifest.length, 1);
	assert.equal(manifest[0]?.modeOnly, false);
	assert.equal(manifest[0]?.oldMode, "100644");
	assert.equal(manifest[0]?.newMode, "100644");
});

test("deriveChangedPathManifest marks an added path and a deleted path", (t) => {
	const cwd = repository(t);
	writeFileSync(join(cwd, "added.txt"), "new\n");
	rmSync(join(cwd, "tracked.txt"));
	const manifest = deriveChangedPathManifest(cwd, baseTreeOf(cwd), treeOf(cwd));

	const byPath = new Map(manifest.map((entry) => [entry.path, entry]));
	assert.equal(byPath.get("added.txt")?.status, "A");
	assert.equal(byPath.get("added.txt")?.deleted, false);
	assert.equal(byPath.get("tracked.txt")?.status, "D");
	assert.equal(byPath.get("tracked.txt")?.deleted, true);
});

test("a mode-only divergence is rejected even though the sorted path set matches", (t) => {
	const cwd = repository(t);
	chmodSync(join(cwd, "tracked.txt"), 0o755);
	// core.filemode=false 平台（Windows 默认）读不到 chmod，索引层植入执行位。
	git(cwd, "update-index", "--chmod=+x", "tracked.txt");
	const candidate = treeOf(cwd);
	const base = baseTreeOf(cwd);

	// The provider froze the path as non-executable; Git now reports 100755.
	// The old check compared only sorted paths and would accept this.
	assert.throws(
		() => new CandidateViewRegistry().restoreProjectionFromNative("review-mode-drift", cwd, {
			baseTree: base,
			currentCandidateTree: candidate,
			paths: ["tracked.txt"],
			intendedUntracked: [],
			projection: "workspace",
			manifest: [{ path: "tracked.txt", status: "M", oldMode: "100644", newMode: "100644", deleted: false, typeChanged: false, modeOnly: false }],
		}),
		(error: unknown) => error instanceof CandidateViewError && error.reason === "manifest-mode-drift",
	);
});

test("a manifest whose path set differs from Git content is rejected as path-set drift", (t) => {
	const cwd = repository(t);
	writeFileSync(join(cwd, "tracked.txt"), "changed\n");
	const candidate = treeOf(cwd);
	const base = baseTreeOf(cwd);

	assert.throws(
		() => new CandidateViewRegistry().restoreProjectionFromNative("review-path-drift", cwd, {
			baseTree: base,
			currentCandidateTree: candidate,
			paths: ["tracked.txt", "ghost.txt"],
			intendedUntracked: [],
			projection: "workspace",
			manifest: [
				{ path: "ghost.txt", status: "M", oldMode: "100644", newMode: "100644", deleted: false, typeChanged: false, modeOnly: false },
				{ path: "tracked.txt", status: "M", oldMode: "100644", newMode: "100644", deleted: false, typeChanged: false, modeOnly: false },
			],
		}),
		(error: unknown) => error instanceof CandidateViewError && error.reason === "manifest-path-set-drift",
	);
});

test("a manifest whose status disagrees with Git is rejected as status drift", (t) => {
	const cwd = repository(t);
	writeFileSync(join(cwd, "tracked.txt"), "changed\n");
	const candidate = treeOf(cwd);
	const base = baseTreeOf(cwd);

	assert.throws(
		() => new CandidateViewRegistry().restoreProjectionFromNative("review-status-drift", cwd, {
			baseTree: base,
			currentCandidateTree: candidate,
			paths: ["tracked.txt"],
			intendedUntracked: [],
			projection: "workspace",
			manifest: [{ path: "tracked.txt", status: "A", oldMode: "100644", newMode: "100644", deleted: false, typeChanged: false, modeOnly: false }],
		}),
		(error: unknown) => error instanceof CandidateViewError && error.reason === "manifest-status-drift",
	);
});

test("intended-untracked outside the manifest path set is rejected as a subset violation", (t) => {
	const cwd = repository(t);
	writeFileSync(join(cwd, "tracked.txt"), "changed\n");
	const candidate = treeOf(cwd);
	const base = baseTreeOf(cwd);

	// intended_untracked is provider-only knowledge no Git command reproduces,
	// so it is checked structurally as a subset rather than compared field-wise.
	// That is a deliberate, documented deviation from the spec's field list.
	assert.throws(
		() => new CandidateViewRegistry().restoreProjectionFromNative("review-untracked-drift", cwd, {
			baseTree: base,
			currentCandidateTree: candidate,
			paths: ["tracked.txt"],
			intendedUntracked: ["not-in-manifest.txt"],
			projection: "workspace",
			manifest: [{ path: "tracked.txt", status: "M", oldMode: "100644", newMode: "100644", deleted: false, typeChanged: false, modeOnly: false }],
		}),
		(error: unknown) => error instanceof CandidateViewError,
	);
});

test("a manifest that disagrees with the descriptor's own paths is rejected as input divergence", (t) => {
	const cwd = repository(t);
	writeFileSync(join(cwd, "tracked.txt"), "changed\n");
	const candidate = treeOf(cwd);
	const base = baseTreeOf(cwd);

	assert.throws(
		() => new CandidateViewRegistry().restoreProjectionFromNative("review-input-drift", cwd, {
			baseTree: base,
			currentCandidateTree: candidate,
			paths: ["tracked.txt"],
			intendedUntracked: [],
			projection: "workspace",
			manifest: [{ path: "other.txt", status: "M", oldMode: "100644", newMode: "100644", deleted: false, typeChanged: false, modeOnly: false }],
		}),
		(error: unknown) => error instanceof CandidateViewError && error.reason === "manifest-input-divergence",
	);
});

test("a manifest matching Git field-wise restores the projection", (t) => {
	const cwd = repository(t);
	writeFileSync(join(cwd, "tracked.txt"), "changed\n");
	const candidate = treeOf(cwd);
	const base = baseTreeOf(cwd);

	assert.doesNotThrow(() => new CandidateViewRegistry().restoreProjectionFromNative("review-manifest-ok", cwd, {
		baseTree: base,
		currentCandidateTree: candidate,
		paths: ["tracked.txt"],
		intendedUntracked: [],
		projection: "workspace",
		manifest: [{ path: "tracked.txt", status: "M", oldMode: "100644", newMode: "100644", deleted: false, typeChanged: false, modeOnly: false }],
	}));
});

test("a descriptor without a manifest keeps the legacy path-set behavior", (t) => {
	const cwd = repository(t);
	writeFileSync(join(cwd, "tracked.txt"), "changed\n");
	const candidate = treeOf(cwd);
	const base = baseTreeOf(cwd);

	// Phase 3 is additive: the manifest is optional, and its absence must not
	// change how existing callers behave.
	assert.doesNotThrow(() => new CandidateViewRegistry().restoreProjectionFromNative("review-no-manifest", cwd, {
		baseTree: base,
		currentCandidateTree: candidate,
		paths: ["tracked.txt"],
		intendedUntracked: [],
		projection: "workspace",
	}));
});

// --- 3.1 completion: manifest-subject-drift ---------------------------------
//
// The v2 artifact-subject schema (contracts/review-integration/v2/schemas/
// artifact-subject.schema.json) requires `changed_path_manifest_sha256` on
// every subject. That is the provider's own claim about what the manifest it
// handed the dispatch digests to. A manifest that does not digest to that
// claim is a self-consistency failure Pi can catch without touching Git at
// all: the descriptor disagrees with itself before any content comparison.

test("a manifest whose digest disagrees with the subject's claim is rejected as subject drift", (t) => {
	const cwd = repository(t);
	writeFileSync(join(cwd, "tracked.txt"), "changed\n");
	const candidate = treeOf(cwd);
	const base = baseTreeOf(cwd);
	const manifest = [{ path: "tracked.txt", status: "M", oldMode: "100644", newMode: "100644", deleted: false, typeChanged: false, modeOnly: false }];

	assert.throws(
		() => new CandidateViewRegistry().restoreProjectionFromNative("review-subject-drift", cwd, {
			baseTree: base,
			currentCandidateTree: candidate,
			paths: ["tracked.txt"],
			intendedUntracked: [],
			projection: "workspace",
			manifest,
			// A subject claim that cannot possibly match any real digest.
			manifestSha256: `sha256:${"0".repeat(64)}`,
		}),
		(error: unknown) => error instanceof CandidateViewError && error.reason === "manifest-subject-drift",
	);
});

test("a manifest digest matching the subject's claim restores the projection", (t) => {
	const cwd = repository(t);
	writeFileSync(join(cwd, "tracked.txt"), "changed\n");
	const candidate = treeOf(cwd);
	const base = baseTreeOf(cwd);
	const manifest = [{ path: "tracked.txt", status: "M", oldMode: "100644", newMode: "100644", deleted: false, typeChanged: false, modeOnly: false }];

	assert.doesNotThrow(() => new CandidateViewRegistry().restoreProjectionFromNative("review-subject-ok", cwd, {
		baseTree: base,
		currentCandidateTree: candidate,
		paths: ["tracked.txt"],
		intendedUntracked: [],
		projection: "workspace",
		manifest,
		manifestSha256: digestChangedPathManifest(manifest),
	}));
});

test("a descriptor without a subject digest keeps validating the manifest without a subject-drift check", (t) => {
	const cwd = repository(t);
	writeFileSync(join(cwd, "tracked.txt"), "changed\n");
	const candidate = treeOf(cwd);
	const base = baseTreeOf(cwd);
	const manifest = [{ path: "tracked.txt", status: "M", oldMode: "100644", newMode: "100644", deleted: false, typeChanged: false, modeOnly: false }];

	// `manifestSha256` is additive, mirroring `manifest` itself: its absence
	// must not change existing manifest-bound behavior.
	assert.doesNotThrow(() => new CandidateViewRegistry().restoreProjectionFromNative("review-no-subject-digest", cwd, {
		baseTree: base,
		currentCandidateTree: candidate,
		paths: ["tracked.txt"],
		intendedUntracked: [],
		projection: "workspace",
		manifest,
	}));
});

// --- 3.4 threat matrix: Git repository selection ----------------------------
//
// A manifest binding must never widen the existing root-scoping guarantee:
// a projection frozen against one contributor root stays rejected when
// resolved against a different one, exactly as it was before manifests
// existed.

test("a manifest-bound projection is rejected when resolved against a different contributor root", (t) => {
	const cwd = repository(t);
	writeFileSync(join(cwd, "tracked.txt"), "changed\n");
	const candidate = treeOf(cwd);
	const base = baseTreeOf(cwd);
	const manifest = [{ path: "tracked.txt", status: "M", oldMode: "100644", newMode: "100644", deleted: false, typeChanged: false, modeOnly: false }];
	const registry = new CandidateViewRegistry();
	registry.restoreProjectionFromNative("review-root-scope", cwd, {
		baseTree: base,
		currentCandidateTree: candidate,
		paths: ["tracked.txt"],
		intendedUntracked: [],
		projection: "workspace",
		manifest,
	});

	const otherRoot = repository(t);
	assert.throws(
		() => registry.resolveProjection("review-root-scope", otherRoot),
		(error: unknown) => error instanceof CandidateViewError && /different contributor root/.test(error.message),
	);
	// The root guard still resolves correctly against the true root.
	assert.equal(registry.resolveProjection("review-root-scope", cwd).candidateTree, candidate);
});

// --- 3.5 threat matrix: Commit state ----------------------------------------
//
// `projection` on the descriptor claims "staged" (a committed range) or
// "workspace" (dirty-inclusive). `restoreProjectionFromNative` independently
// derives `committedOnly` from the descriptor's own base/candidate
// relationship to HEAD; the claimed label must agree with that derivation, or
// the request is rejected rather than silently trusting — or silently
// overriding — a mislabeled projection kind.

test("a projection labeled workspace but derived as a genuinely committed range is rejected as a projection-kind mismatch", (t) => {
	const cwd = repository(t);
	const baseTree = baseTreeOf(cwd);
	writeFileSync(join(cwd, "tracked.txt"), "committed candidate\n");
	git(cwd, "add", "tracked.txt");
	git(cwd, "-c", "user.name=Candidate Test", "-c", "user.email=candidate@example.invalid", "commit", "-m", "candidate");
	const candidateTree = git(cwd, "rev-parse", "HEAD^{tree}");

	assert.throws(
		() => new CandidateViewRegistry().restoreProjectionFromNative("review-projection-kind-drift", cwd, {
			baseTree,
			currentCandidateTree: candidateTree,
			paths: ["tracked.txt"],
			intendedUntracked: [],
			// Git facts derive committedOnly=true (HEAD moved past base with no
			// dirty overlay), but the descriptor mislabels it as a workspace
			// snapshot.
			projection: "workspace",
		}),
		(error: unknown) => error instanceof CandidateViewError && error.reason === "projection-kind-drift",
	);
});

test("candidate view treats an unborn staged repository base as Git's empty tree without needing HEAD^{commit}", (t) => {
	const contributorRoot = unbornRepository(t);
	const view = createCandidateView({ contributorRoot });
	try {
		const emptyTree = emptyTreeOf(contributorRoot);
		assert.equal(view.baseTree, emptyTree);
		assert.equal(view.baseCommit, "HEAD");
		assert.equal(view.committedOnly, false);
		assert.notEqual(view.candidateTree, emptyTree);
		assert.deepEqual(view.paths, ["staged.txt"]);
		assert.deepEqual(view.deletedPaths, []);
	} finally {
		view.cleanup();
	}
});

test("candidate view of an unborn repository with no content yields an empty candidate scope instead of a misleading base-ref failure", (t) => {
	const contributorRoot = unbornRepository(t, false);
	const view = createCandidateView({ contributorRoot });
	try {
		const emptyTree = emptyTreeOf(contributorRoot);
		assert.equal(view.baseTree, emptyTree);
		assert.equal(view.candidateTree, emptyTree);
		assert.equal(view.baseCommit, "HEAD");
		assert.deepEqual(view.paths, []);
		assert.deepEqual(view.deletedPaths, []);
	} finally {
		view.cleanup();
	}
});

test("candidate view materializes an unborn staged repository without mutating the contributor index or creating a phantom commit", (t) => {
	const contributorRoot = unbornRepository(t);
	const indexBefore = readFileSync(join(contributorRoot, ".git", "index"));
	const view = createCandidateView({ contributorRoot });
	try {
		// No phantom commit: HEAD stays unborn and no refs exist.
		assert.throws(() => git(contributorRoot, "rev-parse", "--verify", "HEAD"), /fatal/i);
		assert.equal(git(contributorRoot, "rev-list", "--all").length, 0);
		// Contributor's real index is untouched; materialization uses a private index file.
		assert.deepEqual(readFileSync(join(contributorRoot, ".git", "index")), indexBefore);
		// The materialized candidate carries the staged content, isolated from the contributor tree.
		assert.equal(readFileSync(join(view.root, "staged.txt"), "utf8"), "first staged\n");
		assert.deepEqual(view.paths, ["staged.txt"]);
	} finally {
		view.cleanup();
	}
	// Cleanup removed the orphan worktree; no worktree lingers and no commit appeared.
	assert.equal(git(contributorRoot, "worktree", "list").split("\n").filter((line) => line.includes("jero-candidate")).length, 0);
	assert.equal(git(contributorRoot, "rev-list", "--all").length, 0);
});

test("candidate view fails closed for a detached HEAD pointing at a missing commit, not an unborn empty tree", (t) => {
	const contributorRoot = unbornRepository(t);
	// Detach HEAD to a non-existent object id. This is a corrupt/missing-object
	// existing HEAD state, not a valid unborn symbolic HEAD, so it must fail
	// closed rather than producing an empty-tree unborn candidate.
	writeFileSync(join(contributorRoot, ".git", "HEAD"), "0".repeat(40));
	let failure: unknown;
	try {
		createCandidateView({ contributorRoot });
	} catch (error) {
		failure = error;
	}
	assert.ok(failure instanceof CandidateViewError, "a detached missing HEAD must fail closed");
	assert.notEqual((failure as CandidateViewError).reason, undefined);
	assert.ok((failure as CandidateViewError).reason !== "base-ref-moved");
});

test("candidate view fails closed when symbolic HEAD target ref exists but points to a missing object, not unborn", (t) => {
	const contributorRoot = repository(t);
	// Break the main ref: it exists (show-ref --exists returns 0) but points to
	// a missing object. This is a broken symbolic HEAD, not a valid unborn repo.
	writeFileSync(join(contributorRoot, ".git", "refs", "heads", "main"), `${"0".repeat(40)}\n`);
	let failure: unknown;
	try {
		createCandidateView({ contributorRoot });
	} catch (error) {
		failure = error;
	}
	assert.ok(failure instanceof CandidateViewError, "a broken symbolic HEAD must fail closed, not unborn");
});

test("candidate view probe does not convert a ref-existence probe timeout into an unborn empty-tree base", (t) => {
	const contributorRoot = unbornRepository(t);
	const executor: CandidateGitExecutor = (file, args, options) => {
		if (args[0] === "rev-parse" && args.includes("--quiet")) throw Object.assign(new Error("timed out"), { code: "ETIMEDOUT", killed: true });
		return execFileSync(file, args, options);
	};
	let failure: unknown;
	try {
		new CandidateViewRegistry(executor).create({ contributorRoot });
	} catch (error) {
		failure = error;
	}
	assert.ok(failure instanceof CandidateViewError, "ref-existence probe timeout must fail closed");
	assert.equal((failure as CandidateViewError).reason, "candidate-view-timeout");
});

test("candidate view fails closed when the unborn ref probe exits with an unexpected status instead of treating it as unborn", (t) => {
	const contributorRoot = unbornRepository(t);
	// Only status 1 means "ref absent" (valid unborn). Any other nonzero status
	// (128, etc.) signals corruption or an I/O failure and must fail closed,
	// never masquerade as an unborn empty-tree base.
	const executor: CandidateGitExecutor = (file, args, options) => {
		if (args[0] === "rev-parse" && args.includes("--quiet")) throw Object.assign(new Error("fatal: probe failed"), { status: 128 });
		return execFileSync(file, args, options);
	};
	let failure: unknown;
	try {
		new CandidateViewRegistry(executor).create({ contributorRoot });
	} catch (error) {
		failure = error;
	}
	assert.ok(failure instanceof CandidateViewError, "an unexpected unborn probe status must fail closed, not unborn");
	assert.equal((failure as CandidateViewError).reason, "candidate-view-git-failure");
});

test("candidate view treats an unborn sha256 repository base as the repository-native sha256 empty tree", (t) => {
	const contributorRoot = mkdtempSync(join(tmpdir(), "gentle-pi-candidate-view-unborn-sha256-"));
	t.after(() => rmSync(contributorRoot, { recursive: true, force: true }));
	try {
		git(contributorRoot, "init", "--object-format=sha256", "-b", "main");
	} catch {
		t.skip("installed git does not support `git init --object-format=sha256`");
		return;
	}
	git(contributorRoot, "config", "user.name", "Candidate Test");
	git(contributorRoot, "config", "user.email", "candidate@example.invalid");
	writeFileSync(join(contributorRoot, "staged.txt"), "first staged\n");
	git(contributorRoot, "add", "staged.txt");
	const view = createCandidateView({ contributorRoot });
	try {
		const emptyTree = emptyTreeOf(contributorRoot);
		assert.equal(emptyTree.length, 64, "a sha256 repository must derive a 64-hex empty tree, not the hardcoded SHA-1 id");
		assert.equal(view.baseTree, emptyTree);
		assert.equal(view.baseCommit, "HEAD");
		assert.equal(view.committedOnly, false);
		assert.notEqual(view.candidateTree, emptyTree);
		assert.deepEqual(view.paths, ["staged.txt"]);
		assert.deepEqual(view.deletedPaths, []);
	} finally {
		view.cleanup();
	}
});

test("candidate view unborn worktree falls back when --orphan is unsupported, preserving isolation, no phantom commit, and contributor immutability", (t) => {
	const contributorRoot = unbornRepository(t);
	const indexBefore = readFileSync(join(contributorRoot, ".git", "index"));
	// Intercept --orphan with status 129 (Git < 2.42 unknown option).
	const executor: CandidateGitExecutor = (file, args, options) => {
		if (args[0] === "worktree" && args[1] === "add" && args.includes("--orphan")) throw Object.assign(new Error("unknown option"), { status: 129 });
		return execFileSync(file, args, options);
	};
	const view = new CandidateViewRegistry(executor).create({ contributorRoot });
	try {
		assert.equal(readFileSync(join(view.root, "staged.txt"), "utf8"), "first staged\n");
		assert.deepEqual(view.paths, ["staged.txt"]);
		assert.equal(view.baseTree, emptyTreeOf(contributorRoot));
		// No phantom commit; contributor index untouched.
		assert.throws(() => git(contributorRoot, "rev-parse", "--verify", "HEAD"), /fatal/i);
		assert.equal(git(contributorRoot, "rev-list", "--all").length, 0);
		assert.deepEqual(readFileSync(join(contributorRoot, ".git", "index")), indexBefore);
	} finally {
		view.cleanup();
	}
	assert.equal(git(contributorRoot, "worktree", "list").split("\n").filter((line) => line.includes("jero-candidate")).length, 0);
	assert.equal(git(contributorRoot, "rev-list", "--all").length, 0);
});

test("candidate view unborn worktree propagates a non-usage --orphan failure instead of falling back", (t) => {
	const contributorRoot = unbornRepository(t);
	// A non-129 status must not trigger the fallback.
	const calls: string[][] = [];
	const executor: CandidateGitExecutor = (file, args, options) => {
		calls.push([...args]);
		if (args[0] === "worktree" && args[1] === "add" && args.includes("--orphan")) throw Object.assign(new Error("genuine failure"), { status: 128 });
		return execFileSync(file, args, options);
	};
	let failure: unknown;
	try { new CandidateViewRegistry(executor).create({ contributorRoot }); } catch (error) { failure = error; }
	assert.ok(failure instanceof CandidateViewError, "a non-usage --orphan failure must propagate");
	assert.equal((failure as CandidateViewError).reason, "candidate-view-git-failure");
	assert.ok(!calls.some((args) => args[0] === "commit-tree"), "the fallback must not create a temporary commit");
	assert.ok(!calls.some((args) => args[0] === "worktree" && args.includes("--detach")), "the fallback must not add a detached worktree");
});

test("candidate view cleans up a partially registered unborn fallback worktree when a later step fails", (t) => {
	const contributorRoot = unbornRepository(t);
	// Force the --orphan path to take the pre-2.42 fallback, then fail the
	// symbolic-ref rewrite that follows `worktree add --no-checkout --detach`.
	// The worktree is already registered with Git at that point; the cleanup
	// boundary must remove both the registered worktree and its directory.
	const executor: CandidateGitExecutor = (file, args, options) => {
		if (args[0] === "worktree" && args[1] === "add" && args.includes("--orphan")) throw Object.assign(new Error("unknown option"), { status: 129 });
		if (args[0] === "symbolic-ref") throw Object.assign(new Error("symbolic-ref failed"), { status: 1 });
		return execFileSync(file, args, options);
	};
	let failure: unknown;
	try { new CandidateViewRegistry(executor).create({ contributorRoot }); } catch (error) { failure = error; }
	assert.ok(failure instanceof CandidateViewError, "the symbolic-ref failure must propagate");
	assert.equal((failure as CandidateViewError).reason, "candidate-view-git-failure");
	// No registered/admin worktree remains.
	assert.equal(git(contributorRoot, "worktree", "list").split("\n").filter((line) => line.includes("jero-candidate")).length, 0);
	// No candidate directory remains under the candidate-view parent.
	const parent = join(realpathSync(git(contributorRoot, "rev-parse", "--path-format=absolute", "--git-common-dir")), "jero-review", "candidate-views");
	const leftover = existsSync(parent) ? readdirSync(parent).filter((entry) => lstatSync(join(parent, entry)).isDirectory()) : [];
	assert.deepEqual(leftover, [], "no candidate directory remains after a partial unborn fallback failure");
});

export function stagedFinalizeDescriptor(cwd: string, path: string, content: string): NativeCandidateProjectionDescriptor {
	writeFileSync(join(cwd, path), content);
	git(cwd, "add", path);
	const baseTree = git(cwd, "rev-parse", "HEAD^{tree}");
	const currentCandidateTree = git(cwd, "write-tree");
	return { baseTree, currentCandidateTree, paths: [path], intendedUntracked: [], projection: "staged" };
}

export function candidateViewWorktreeCount(cwd: string): number {
	return git(cwd, "worktree", "list").split("\n").filter((line) => line.includes("candidate-views")).length;
}

test("gentle-pi#185: a forecast-restored FINALIZE worktree does not leak across the next restore for the same lineage", (t) => {
	// gentle-pi#185: `restoreForFinalizeFromNative` materializes a real Git
	// worktree to restore a lineage's FINALIZE binding from the native frozen
	// projection. A forecast-only FINALIZE after a process restart uses this
	// exact path, but its outcome is non-terminal, so `cleanupTerminal` (which
	// only fires for "approved"/"escalated") never runs for it. Before the fix,
	// `restoreForFinalizeFromNative` never cleared the stale binding it had
	// just created, so restoring the same lineage's FINALIZE binding again
	// (the lineage's later approved FINALIZE, or another restart-time
	// forecast) threw "native frozen projection is invalid or already
	// restored" from `restoreProjectionFromNative` — leaving the first
	// worktree registered forever and breaking the very finalize that should
	// have succeeded.
	const cwd = repository(t);
	const registry = new CandidateViewRegistry();
	const lineageId = "forecast-lineage-185";
	const descriptor = stagedFinalizeDescriptor(cwd, "tracked.txt", "forecast change\n");

	assert.equal(candidateViewWorktreeCount(cwd), 0, "no candidate worktree exists before any restore");

	// Reproduces the leak symptom: a forecast-only FINALIZE restore
	// materializes a worktree that is still registered with Git once the
	// (non-terminal) forecast finalize returns.
	registry.restoreForFinalizeFromNative(lineageId, cwd, descriptor);
	assert.equal(candidateViewWorktreeCount(cwd), 1, "the forecast restore leaves its worktree registered with Git after it returns");

	// A later restore for the same lineage (its approved FINALIZE, or another
	// restart-time forecast) must clean up the stale worktree and replace it
	// deterministically instead of throwing or leaking a parallel sibling.
	assert.doesNotThrow(
		() => registry.restoreForFinalizeFromNative(lineageId, cwd, descriptor),
		"restoring the same lineage's FINALIZE binding again must not fail on the stale binding it left behind",
	);
	assert.equal(candidateViewWorktreeCount(cwd), 1, "the second restore must replace the first worktree, never accumulate a parallel sibling");

	// The subsequent approved FINALIZE's terminal cleanup must still work for
	// the worktree that is actually registered after the restore.
	registry.cleanupTerminal(lineageId, "approved", cwd);
	assert.equal(candidateViewWorktreeCount(cwd), 0, "approved cleanup removes the restored worktree, leaving no candidate worktree registered");
});

test("gentle-pi#185 review correction: a restore whose materialization fails leaves the previous binding intact", (t) => {
	const cwd = repository(t);
	const lineageId = "forecast-lineage-185-rollback";
	const descriptor = stagedFinalizeDescriptor(cwd, "tracked.txt", "forecast change\n");
	let worktreeAdds = 0;
	const executor: CandidateGitExecutor = (file, args, options) => {
		if (args[0] === "worktree" && args[1] === "add" && ++worktreeAdds === 2) throw Object.assign(new Error("simulated worktree add failure"), { status: 128 });
		return execFileSync(file, args, options);
	};
	const registry = new CandidateViewRegistry(executor);
	const first = registry.restoreForFinalizeFromNative(lineageId, cwd, descriptor);
	assert.equal(candidateViewWorktreeCount(cwd), 1);
	let failure: unknown;
	try { registry.restoreForFinalizeFromNative(lineageId, cwd, descriptor); } catch (error) { failure = error; }
	assert.equal((failure as CandidateViewError)?.reason, "candidate-view-git-failure", "a failed materialization must propagate, not silently succeed");
	assert.equal(candidateViewWorktreeCount(cwd), 1, "the previously registered worktree must survive the failed restore");
	assert.equal(registry.resolveForFinalize(lineageId, cwd).token, first.token, "the lineage must still resolve to its original worktree");
	registry.cleanupTerminal(lineageId, "approved", cwd);
});

