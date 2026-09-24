// review-candidate-view 测试第 2 段（共 3 段；夹具在 review-candidate-view-shared.ts）。
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

// 机械平移自分片 1：仅本段使用，且分片互相导入会令被导入分片的顶层
// test() 注册在导入方进程里重跑一遍，故就地本地化而不 import 分片 1。
function compactCandidateContextManifest(task: string): { encoded: string; sha256: string } {
	const match = /Frozen changed scope manifest \(gzip\+base64url\): `([A-Za-z0-9_-]+)`.\nFrozen changed scope manifest SHA-256: `([0-9a-f]{64})`./.exec(task);
	assert.ok(match, "expected a compact candidate context manifest");
	return { encoded: match[1]!, sha256: match[2]! };
}


test("candidate view skips a shared index that disappears during stat or copy", (t) => {
	const contributorRoot = repository(t);
	writeFileSync(join(contributorRoot, "tracked.txt"), "tracked selection\n");
	writeFileSync(join(contributorRoot, "staged-addition.txt"), "staged addition\n");
	git(contributorRoot, "add", "staged-addition.txt");
	git(contributorRoot, "update-index", "--split-index");
	const sharedIndexName = readdirSync(join(contributorRoot, ".git")).find((name) => /^sharedindex\.[0-9a-f]+$/.test(name));
	assert.ok(sharedIndexName, "split index must create a shared index fixture");
	const sharedIndexPath = join(contributorRoot, ".git", sharedIndexName);
	for (const phase of ["stat", "copy"] as const) {
			// @types/node 把 lstatSync 声明为只读导出；运行时 patch 经可变视图写入。
			const mutableLstat = fs as { lstatSync: typeof fs.lstatSync };
		const originalLstatSync = fs.lstatSync;
		const originalCopyFileSync = fs.copyFileSync;
		mutableLstat.lstatSync = ((path: string | Buffer, options?: Parameters<typeof lstatSync>[1]) => {
			if (phase === "stat" && path === sharedIndexPath) throw Object.assign(new Error("shared index disappeared"), { code: "ENOENT" });
			return originalLstatSync(path, options);
		}) as typeof fs.lstatSync;
		fs.copyFileSync = ((source: string | Buffer, destination: string | Buffer) => {
			if (phase === "copy" && source === sharedIndexPath) throw Object.assign(new Error("shared index disappeared"), { code: "ENOENT" });
			return originalCopyFileSync(source, destination);
		}) as typeof fs.copyFileSync;
		syncBuiltinESMExports();
		let view: ReturnType<typeof createCandidateView> | undefined;
		try {
			view = createCandidateView({ contributorRoot, intendedUntracked: [] });
			assert.equal(view.paths.includes("staged-addition.txt"), true, phase);
		} finally {
			mutableLstat.lstatSync = originalLstatSync;
			fs.copyFileSync = originalCopyFileSync;
			syncBuiltinESMExports();
			view?.cleanup();
		}
	}
});

test("candidate view recursively protects nested content and worktree metadata, and rejects injected untracked entries", (t) => {
	const contributorRoot = repository(t);
	mkdirSync(join(contributorRoot, "nested", "deeper"), { recursive: true });
	writeFileSync(join(contributorRoot, "nested", "deeper", "candidate.txt"), "candidate\n");
	const view = createCandidateView({ contributorRoot });
	try {
		assert.equal(lstatSync(join(view.root, "nested")).mode & 0o222, 0);
		assert.equal(lstatSync(join(view.root, "nested", "deeper")).mode & 0o222, 0);
		assert.equal(lstatSync(join(view.root, ".git")).mode & 0o222, 0);
		chmodSync(view.root, 0o755);
		chmodSync(join(view.root, "nested"), 0o755);
		chmodSync(join(view.root, "nested", "deeper"), 0o755);
		writeFileSync(join(view.root, "nested", "deeper", "injected.txt"), "injected\n");
		chmodSync(join(view.root, "nested", "deeper"), 0o555);
		chmodSync(join(view.root, "nested"), 0o555);
		chmodSync(view.root, 0o555);
		assert.throws(() => view.verify(), /untracked/);
	} finally {
		view.cleanup();
	}
});

test("candidate view registry rejects unsafe, moved, writable, stale, and unselected lens contexts before dispatch", (t) => {
	const contributorRoot = repository(t);
	writeFileSync(join(contributorRoot, "tracked.txt"), "candidate\n");
	const registry = new CandidateViewRegistry();
	const view = registry.create({ contributorRoot });
	t.after(() => registry.cleanup(view.token));
	registry.bind({ token: view.token, lineageId: "lineage-1", selectedLenses: ["review-risk"] });
	assert.equal(registry.resolveForLens("lineage-1", "review-risk").root, view.root);
	for (const lens of ["review-resilience", "review-readability", "review-reliability"]) {
		assert.throws(() => registry.resolveForLens("lineage-1", lens), CandidateViewError);
	}
	chmodSync(view.root, 0o755);
	assert.throws(() => registry.resolveForLens("lineage-1", "review-risk"), CandidateViewError);
	chmodSync(view.root, 0o755);
	chmodSync(join(view.root, "tracked.txt"), 0o644);
	writeFileSync(join(view.root, "tracked.txt"), "corrupt\n");
	chmodSync(view.root, 0o555);
	chmodSync(join(view.root, "tracked.txt"), 0o444);
	assert.throws(() => registry.resolveForLens("lineage-1", "review-risk"), CandidateViewError);
	registry.cleanup(view.token);
});

test("candidate registry isolates replay, projection, current, and cleanup state by target root plus lineage", (t) => {
	const rootA = repository(t);
	const rootB = repository(t);
	writeFileSync(join(rootA, "tracked.txt"), "candidate A\n");
	writeFileSync(join(rootB, "tracked.txt"), "candidate B\n");
	const registry = new CandidateViewRegistry();
	t.after(() => registry.cleanupAll());
	const viewA = registry.createOrReuse({ contributorRoot: rootA, replayKey: "same-replay" });
	const viewB = registry.createOrReuse({ contributorRoot: rootB, replayKey: "same-replay" });
	assert.notEqual(viewA.token, viewB.token);
	registry.bindCurrent({ token: viewA.token, lineageId: "same-lineage", selectedLenses: ["review-reliability"] });
	registry.bindCurrent({ token: viewB.token, lineageId: "same-lineage", selectedLenses: ["review-reliability"] });
	assert.equal(registry.resolveForLens("same-lineage", "review-reliability", rootA).root, viewA.root);
	assert.equal(registry.resolveForLens("same-lineage", "review-reliability", rootB).root, viewB.root);
	assert.equal(registry.resolveForFinalize("same-lineage", rootA).root, viewA.root);
	assert.equal(registry.resolveForFinalize("same-lineage", rootB).root, viewB.root);
	writeFileSync(join(rootA, "tracked.txt"), "corrected A\n");
	writeFileSync(join(rootB, "tracked.txt"), "corrected B\n");
	const correctedA = registry.createCorrected("same-lineage", rootA, "same-correction-replay");
	const correctedB = registry.createCorrected("same-lineage", rootB, "same-correction-replay");
	assert.notEqual(correctedA.token, correctedB.token);
	registry.promoteCorrected("same-lineage", correctedA.token, rootA);
	registry.promoteCorrected("same-lineage", correctedB.token, rootB);
	assert.equal(registry.resolveForFinalize("same-lineage", rootA).root, correctedA.root);
	assert.equal(registry.resolveForFinalize("same-lineage", rootB).root, correctedB.root);
	assert.throws(() => registry.resolveForLens("same-lineage", "review-reliability"), /workspaceRoot/);
	assert.throws(() => registry.resolveWorkspaceRoot("same-lineage"), /workspaceRoot/);
	registry.cleanupTerminal("same-lineage", "approved", rootB);
	assert.equal(registry.resolveWorkspaceRoot("same-lineage"), realpathSync(rootA));
	assert.equal(registry.resolveForFinalize("same-lineage", rootA).root, correctedA.root);
	registry.cleanupTerminal("same-lineage", "approved", rootA);
});

// ga#4085 / ga#4050: after a valid `granted` consent, a retried native START
// for a lineage this controller already bound (native reports it "resumed")
// re-materializes a fresh, content-identical candidate view under a new
// token -- for example after a transport hiccup between START and the
// follow-up STATUS call. Rebinding that duplicate to the same lineage used to
// fail closed with "candidate view lineage binding is missing or ambiguous"
// even though nothing was actually ambiguous. It must reuse the already-bound
// view instead of failing the retry.
test("candidate registry rebinds a retried native START for an already-bound lineage instead of failing closed", (t) => {
	const contributorRoot = repository(t);
	writeFileSync(join(contributorRoot, "tracked.txt"), "candidate\n");
	const registry = new CandidateViewRegistry();
	t.after(() => registry.cleanupAll());
	const first = registry.create({ contributorRoot });
	registry.bindCurrent({ token: first.token, lineageId: "retry-lineage", selectedLenses: ["review-risk"] });
	assert.equal(registry.hasCurrentBinding(contributorRoot), true);

	const retry = registry.create({ contributorRoot });
	assert.notEqual(retry.token, first.token, "the retry must materialize a distinct physical worktree/token");
	assert.doesNotThrow(() => registry.bindCurrent({ token: retry.token, lineageId: "retry-lineage", selectedLenses: ["review-risk"] }));

	// The already-bound view stays current; the redundant duplicate is discarded.
	assert.equal(registry.resolveForLens("retry-lineage", "review-risk", contributorRoot).root, first.root);
	assert.equal(registry.resolveCurrentForLens("review-risk", contributorRoot).root, first.root);
	assert.equal(existsSync(retry.root), false, "the redundant duplicate candidate view must be cleaned up");
	registry.cleanupTerminal("retry-lineage", "approved", contributorRoot);
});

test("candidate registry still fails closed rebinding the same lineage to genuinely different content", (t) => {
	const contributorRoot = repository(t);
	const registry = new CandidateViewRegistry();
	t.after(() => registry.cleanupAll());
	const first = registry.create({ contributorRoot });
	registry.bindCurrent({ token: first.token, lineageId: "conflict-lineage", selectedLenses: ["review-risk"] });
	writeFileSync(join(contributorRoot, "tracked.txt"), "different content\n");
	const conflicting = registry.create({ contributorRoot });
	assert.notEqual(conflicting.candidateTree, first.candidateTree);
	assert.throws(
		() => registry.bindCurrent({ token: conflicting.token, lineageId: "conflict-lineage", selectedLenses: ["review-risk"] }),
		CandidateViewError,
	);
	registry.cleanup(conflicting.token);
	registry.cleanupTerminal("conflict-lineage", "approved", contributorRoot);
});

// gentle-pi#323: `createOrReuse` reuses whatever view a replay key maps to,
// with no awareness of live candidate content -- a content-independent key
// reuses a stale view even after the candidate content it was frozen from
// has changed. The fix lives at the START call site (extensions/jero-ai.ts),
// which now folds the current candidate tree into the replay key; this test
// documents both the registry's plain-key reuse contract and that folding
// content identity into the key produces a fresh view once content changes.
test("candidate registry reuses a replay-keyed view verbatim regardless of live content, so callers must fold content identity into the key", (t) => {
	const registry = new CandidateViewRegistry();
	t.after(() => registry.cleanupAll());
	const contributorRoot = repository(t);
	const contentIndependentKey = "cwd-and-lineage-only";
	const first = registry.createOrReuse({ contributorRoot, replayKey: contentIndependentKey });
	writeFileSync(join(contributorRoot, "tracked.txt"), "candidate two\n");
	const staleReuse = registry.createOrReuse({ contributorRoot, replayKey: contentIndependentKey });
	assert.equal(staleReuse.token, first.token, "a content-independent replay key reuses the stale view");
	const freshForCurrentContent = registry.create({ contributorRoot });
	assert.notEqual(staleReuse.candidateTree, freshForCurrentContent.candidateTree, "the stale reused view no longer reflects live candidate content");
	const contentScopedKey = `${contentIndependentKey}\u0000${freshForCurrentContent.candidateTree}`;
	const rekeyed = registry.createOrReuse({ contributorRoot, replayKey: contentScopedKey });
	assert.notEqual(rekeyed.token, staleReuse.token, "folding candidate content into the replay key mints a fresh view once content changes");
	assert.equal(rekeyed.candidateTree, freshForCurrentContent.candidateTree);
	registry.cleanup(freshForCurrentContent.token);
});

test("candidate registry rejects a lineage target whose authorized symlink was replaced", (t) => {
	const root = repository(t);
	const replacement = repository(t);
	const alias = join(tmpdir(), `gentle-pi-candidate-alias-${process.pid}-${Date.now()}`);
	t.after(() => rmSync(alias, { recursive: true, force: true }));
	symlinkSync(root, alias, "dir");
	const registry = new CandidateViewRegistry();
	t.after(() => registry.cleanupAll());
	const view = registry.create({ contributorRoot: root });
	registry.bindCurrent({ token: view.token, lineageId: "symlink-lineage", selectedLenses: ["review-reliability"] });
	assert.doesNotThrow(() => registry.assertWorkspaceRoot("symlink-lineage", alias));
	rmSync(alias, { recursive: true, force: true });
	symlinkSync(replacement, alias, "dir");
	assert.throws(() => registry.assertWorkspaceRoot("symlink-lineage", alias), /workspaceRoot|bound to/);
	registry.cleanupTerminal("symlink-lineage", "approved", root);
});

test("review subagent dispatch rejects missing candidate views and uses the explicitly current overlapping lens", (t) => {
	const missing = new CandidateViewRegistry();
	assert.throws(
		() => injectReviewCandidateView({ agent: "review-risk", task: "review", mode: "task" }, missing),
		CandidateViewError,
	);
	const contributorRoot = repository(t);
	writeFileSync(join(contributorRoot, "tracked.txt"), "candidate\n");
	const registry = new CandidateViewRegistry();
	const first = registry.create({ contributorRoot });
	registry.bind({ token: first.token, lineageId: "first", selectedLenses: ["review-risk"] });
	writeFileSync(join(contributorRoot, "tracked.txt"), "candidate two\n");
	const second = registry.create({ contributorRoot });
	registry.bindCurrent({ token: second.token, lineageId: "second", selectedLenses: ["review-risk"] });
	const dispatch = { agent: "review-risk", task: "review", mode: "task" };
	assert.doesNotThrow(() => injectReviewCandidateView(dispatch, registry));
	assert.match(dispatch.task, new RegExp(`Frozen candidate tree: \`${second.candidateTree}\``));
	registry.cleanup(first.token);
	registry.cleanup(second.token);
});

test("candidate view rejects control-character paths before prompt construction", (t) => {
	const contributorRoot = repository(t);
	if (process.platform === "win32") {
		// Windows 在文件系统与 git 索引（--cacheinfo 亦拒）两层都拒绝
		// 控制字符路径，场景无法构造——平台自身已提供本测试要证明的保证。
		assert.throws(() => writeFileSync(join(contributorRoot, "unsafe\npath.txt"), "candidate\n"));
		return;
	}
	writeFileSync(join(contributorRoot, "unsafe\npath.txt"), "candidate\n");
	assert.throws(() => createCandidateView({ contributorRoot }), CandidateViewError);
});

test("candidate view cleanup is confined and idempotent", (t) => {
	const contributorRoot = repository(t);
	const registry = new CandidateViewRegistry();
	const view = registry.create({ contributorRoot });
	const outside = join(contributorRoot, "outside.txt");
	writeFileSync(outside, "preserve\n");
	registry.cleanup(view.token);
	registry.cleanup(view.token);
	assert.equal(readFileSync(outside, "utf8"), "preserve\n");
	assert.equal(lstatSync(view.root, { throwIfNoEntry: false }), undefined);
});

test("candidate cleanup preserves a root when Git reports success without deleting it", (t) => {
	const registry = new CandidateViewRegistry((file, arguments_, options) =>
		arguments_[0] === "worktree" && arguments_[1] === "remove" ? "" : execFileSync(file, arguments_, options));
	const view = registry.create({ contributorRoot: repository(t) });
	assert.equal(lstatSync(view.root).mode & 0o222, 0);
	assert.throws(() => view.cleanup(), /incomplete/);
	assert.throws(() => view.cleanup(), /incomplete/);
	assert.equal(existsSync(view.root), true);
	assert.equal(existsSync(ownerMarker(view.root)), true);
});

test("corrected views stay within frozen scope and replace projections only when promoted", (t) => {
	const contributorRoot = repository(t);
	writeFileSync(join(contributorRoot, "tracked.txt"), "reviewed\n");
	const registry = new CandidateViewRegistry();
	const initial = registry.create({ contributorRoot }); registry.bind({ token: initial.token, lineageId: "correction", selectedLenses: ["review-risk"] });
	writeFileSync(join(contributorRoot, "tracked.txt"), "corrected\n");
	const corrected = registry.createCorrected("correction", contributorRoot, "correction-replay");
	assert.notEqual(corrected.candidateTree, initial.candidateTree);
	assert.equal(registry.resolveProjection("correction", contributorRoot).candidateTree, initial.candidateTree);
	registry.promoteCorrected("correction", corrected.token);
	assert.equal(registry.resolveProjection("correction", contributorRoot).candidateTree, corrected.candidateTree);
	writeFileSync(join(contributorRoot, "escaped.txt"), "outside scope\n");
	assert.throws(() => registry.createCorrected("correction", contributorRoot, "correction-replay"), /escapes the frozen genesis paths/);
	registry.cleanupTerminal("correction", "approved");
});

test("projection-only correction promotion replaces the stale projection and rejects competing bindings", (t) => {
	const contributorRoot = repository(t);
	writeFileSync(join(contributorRoot, "tracked.txt"), "reviewed\n");
	const source = new CandidateViewRegistry();
	const original = source.create({ contributorRoot });
	const restored = new CandidateViewRegistry();
	try {
		restored.restoreProjection("projection-only", contributorRoot, original.baseCommit, original.baseTree, original.candidateTree, original.paths);
		source.cleanup(original.token);
		writeFileSync(join(contributorRoot, "tracked.txt"), "corrected\n");
		const corrected = restored.createCorrected("projection-only", contributorRoot, "corrected-replay");
		const competing = restored.create({ contributorRoot });
		restored.bindCurrent({ token: competing.token, lineageId: "competing", selectedLenses: ["review-reliability"] });
		assert.throws(() => restored.promoteCorrected("projection-only", corrected.token), /conflicts|ambiguous/);
		restored.cleanup(competing.token);
		assert.throws(() => restored.promoteCorrected("wrong-lineage", corrected.token), /missing|ambiguous/);
		assert.throws(() => restored.createCorrected("projection-only", repository(t), "wrong-root"), /different contributor root/);
		restored.promoteCorrected("projection-only", corrected.token);
		assert.equal(restored.resolveProjection("projection-only", contributorRoot).candidateTree, corrected.candidateTree);
		restored.cleanupTerminal("projection-only", "approved");
		assert.equal(restored.resolveProjection("projection-only", contributorRoot).candidateTree, corrected.candidateTree);
	} finally {
		source.cleanup(original.token);
		restored.cleanupTerminal("projection-only", "escalated");
	}
});

test("candidate view exposes a compact 45-path changed scope for a 293-entry candidate tree", (t) => {
	const contributorRoot = repository(t);
	for (let index = 0; index < 248; index += 1) {
		writeFileSync(join(contributorRoot, `unchanged-${String(index).padStart(3, "0")}.txt`), "base\n");
	}
	git(contributorRoot, "add", ".");
	git(contributorRoot, "-c", "user.name=Candidate Test", "-c", "user.email=candidate@example.invalid", "commit", "-m", "many unchanged entries");
	writeFileSync(join(contributorRoot, "tracked.txt"), "changed\n");
	for (let index = 0; index < 44; index += 1) {
		writeFileSync(join(contributorRoot, `added-${String(index).padStart(3, "0")}.txt`), "candidate\n");
	}
	const registry = new CandidateViewRegistry();
	const view = registry.create({ contributorRoot });
	registry.bind({ token: view.token, lineageId: "compact-scope", selectedLenses: ["review-risk"] });
	assert.equal(view.paths.length, 45);
	assert.equal(Object.keys(view.modes).length, 45);
	assert.equal(view.paths.includes("unchanged-000.txt"), false);
	const dispatch = { agent: "review-risk", task: "review", mode: "task" };
	assert.doesNotThrow(() => injectReviewCandidateView(dispatch, registry));
	assert.ok(dispatch.task.length <= 4_096);
	registry.cleanup(view.token);
});

test("candidate view derives deletion, rename, executable, and symlink scope from the frozen Git trees", (t) => {
	const contributorRoot = repository(t);
	writeFileSync(join(contributorRoot, "deleted.txt"), "delete me\n");
	writeFileSync(join(contributorRoot, "script.sh"), "#!/bin/sh\necho base\n");
	git(contributorRoot, "add", ".");
	git(contributorRoot, "-c", "user.name=Candidate Test", "-c", "user.email=candidate@example.invalid", "commit", "-m", "scope base");
	renameSync(join(contributorRoot, "tracked.txt"), join(contributorRoot, "renamed.txt"));
	rmSync(join(contributorRoot, "deleted.txt"));
	chmodSync(join(contributorRoot, "script.sh"), 0o755);
	// Windows 默认 core.filemode=false，chmod 的执行位对 git 不可见；
	// 索引层植入 100755 保证冻结树跨平台携带同一模式。
	git(contributorRoot, "update-index", "--chmod=+x", "script.sh");
	try {
		symlinkSync("script.sh", join(contributorRoot, "linked.sh"));
	} catch {
		t.skip("platform does not support symlinks");
		return;
	}
	const registry = new CandidateViewRegistry();
	const view = registry.create({ contributorRoot });
	try {
		// The rename source (tracked.txt) is frozen as a deletion next to its
		// destination: native STATUS projects the rename as both paths
		// (gentle-pi#518), and the reviewer scope carries the same identity.
		// core.filemode=false 的平台（Windows 默认）读不到 chmod 的执行位，
		// git 冻结树不会携带 100755——该 git 平台限制如实反映在期望里。
		const filemodeVisible = git(contributorRoot, "config", "core.filemode").trim() !== "false";
		assert.deepEqual(
			view.paths,
			filemodeVisible ? ["deleted.txt", "linked.sh", "renamed.txt", "script.sh", "tracked.txt"] : ["deleted.txt", "linked.sh", "renamed.txt", "tracked.txt"],
		);
		assert.deepEqual(view.deletedPaths, ["deleted.txt", "tracked.txt"]);
		assert.deepEqual(
			view.modes,
			filemodeVisible
				? { "linked.sh": "120000", "renamed.txt": "100644", "script.sh": "100755" }
				: { "linked.sh": "120000", "renamed.txt": "100644" },
		);
		registry.bind({ token: view.token, lineageId: "scope-kinds", selectedLenses: ["review-risk"] });
		const dispatch = { agent: "review-risk", task: "review", mode: "task" };
		injectReviewCandidateView(dispatch, registry);
		assert.match(dispatch.task, /Frozen changed scope by mode: .*"deleted":\["deleted\.txt","tracked\.txt"\]/);
		assert.doesNotMatch(dispatch.task, /Frozen paths:|Frozen modes:/);
		view.verify();
	} finally {
		registry.cleanup(view.token);
	}
});

// gentle-pi#518: native STATUS projects every path whose state changed between
// the frozen trees (Go diffs with --no-renames), so a staged exact rename is
// its source deletion plus its destination addition. The candidate view must
// project the same identity or ordinary START is rejected before native
// admission with candidate-target-projection-drift.
test("candidate view projects a staged exact rename as its source and destination, matching the native no-renames projection", (t) => {
	const contributorRoot = repository(t);
	mkdirSync(join(contributorRoot, "active"));
	writeFileSync(join(contributorRoot, "active", "document.md"), "line one\nline two\n");
	git(contributorRoot, "add", "active/document.md");
	git(contributorRoot, "-c", "user.name=Candidate Test", "-c", "user.email=candidate@example.invalid", "commit", "-m", "rename base");
	mkdirSync(join(contributorRoot, "archive"));
	git(contributorRoot, "mv", "active/document.md", "archive/document.md");
	writeFileSync(join(contributorRoot, "report.md"), "report\n");
	git(contributorRoot, "add", "-A");
	const view = createCandidateView({ contributorRoot });
	try {
		const nativeProjection = git(contributorRoot, "diff-tree", "--no-commit-id", "--name-only", "-r", "-z", "--no-renames", view.baseTree, view.candidateTree)
			.split("\0").filter((path) => path.length > 0).sort();
		assert.deepEqual(nativeProjection, ["active/document.md", "archive/document.md", "report.md"]);
		assert.deepEqual(view.paths, nativeProjection);
		assert.deepEqual(view.deletedPaths, ["active/document.md"]);
		assert.deepEqual(view.modes, { "archive/document.md": "100644", "report.md": "100644" });
		const manifest = deriveChangedPathManifest(contributorRoot, view.baseTree, view.candidateTree);
		assert.deepEqual(manifest.map((entry) => [entry.path, entry.status, entry.deleted]), [
			["active/document.md", "D", true],
			["archive/document.md", "A", false],
			["report.md", "A", false],
		]);
	} finally {
		view.cleanup();
	}
});

test("candidate view verifies unchanged tree entries even when they are absent from changed scope", (t) => {
	const contributorRoot = repository(t);
	writeFileSync(join(contributorRoot, "unchanged.txt"), "base\n");
	git(contributorRoot, "add", ".");
	git(contributorRoot, "-c", "user.name=Candidate Test", "-c", "user.email=candidate@example.invalid", "commit", "-m", "unchanged base");
	writeFileSync(join(contributorRoot, "tracked.txt"), "changed\n");
	const view = createCandidateView({ contributorRoot });
	try {
		assert.deepEqual(view.paths, ["tracked.txt"]);
		chmodSync(view.root, 0o755);
		chmodSync(join(view.root, "unchanged.txt"), 0o644);
		writeFileSync(join(view.root, "unchanged.txt"), "tampered\n");
		chmodSync(join(view.root, "unchanged.txt"), 0o444);
		chmodSync(view.root, 0o555);
		assert.throws(() => view.verify(), CandidateViewError);
	} finally {
		view.cleanup();
	}
});

test("candidate executable-mode validation accepts a readonly Git executable on Windows and rejects it on POSIX", () => {
	assert.equal(hasExpectedExecutableBits(0o444, "100755", "win32"), true);
	assert.equal(hasExpectedExecutableBits(0o444, "100755", "linux"), false);
	assert.equal(hasExpectedExecutableBits(0o555, "100755", "linux"), true);
	assert.equal(hasExpectedExecutableBits(0o555, "100644", "win32"), false);
});

test("candidate registry forwards explicit Windows mode validation to view verification", (t) => {
	mockWindowsAcl(t);
	const contributorRoot = repository(t);
	writeFileSync(join(contributorRoot, "unchanged-executable.sh"), "#!/bin/sh\necho base\n");
	git(contributorRoot, "add", "unchanged-executable.sh");
	git(contributorRoot, "update-index", "--chmod=+x", "unchanged-executable.sh");
	chmodSync(join(contributorRoot, "unchanged-executable.sh"), 0o755);
	git(contributorRoot, "-c", "user.name=Candidate Test", "-c", "user.email=candidate@example.invalid", "commit", "-m", "executable base");
	writeFileSync(join(contributorRoot, "tracked.txt"), "changed\n");
	const view = new CandidateViewRegistry(undefined, "win32").createOrReuse({ contributorRoot, baseRef: "HEAD" });
	try {
		assert.deepEqual(view.paths, ["tracked.txt"]);
		chmodSync(view.root, 0o755); chmodSync(join(view.root, "unchanged-executable.sh"), 0o444); chmodSync(view.root, 0o555);
		assert.doesNotThrow(() => view.verify());
	} finally {
		view.cleanup();
	}
});

test("candidate view compacts an oversized non-ASCII scope losslessly and deterministically", (t) => {
	const contributorRoot = repository(t);
	writeFileSync(join(contributorRoot, "deleted.txt"), "delete me\n");
	git(contributorRoot, "add", "deleted.txt");
	git(contributorRoot, "-c", "user.name=Candidate Test", "-c", "user.email=candidate@example.invalid", "commit", "-m", "deletion base");
	const baseCommit = git(contributorRoot, "rev-parse", "HEAD");
	const unicodePaths = Array.from({ length: 18 }, (_, index) => `changed-${String(index).padStart(2, "0")}-${"界".repeat(70)}.txt`);
	for (const path of unicodePaths) writeFileSync(join(contributorRoot, path), "candidate\n");
	const gitlinkCommit = "0123456789abcdef0123456789abcdef01234567";
	git(contributorRoot, "add", ...unicodePaths);
	git(contributorRoot, "update-index", "--add", "--cacheinfo", `160000,${gitlinkCommit},vendor/dependency`);
	git(contributorRoot, "-c", "user.name=Candidate Test", "-c", "user.email=candidate@example.invalid", "commit", "-m", "large scope");
	rmSync(join(contributorRoot, "deleted.txt"));
	git(contributorRoot, "add", "-u", "--", "deleted.txt");
	git(contributorRoot, "-c", "user.name=Candidate Test", "-c", "user.email=candidate@example.invalid", "commit", "-m", "delete scope path");
	const registry = new CandidateViewRegistry();
	const view = registry.create({ contributorRoot, baseRef: baseCommit, committedOnly: true });
	try {
		registry.bind({ token: view.token, lineageId: "oversized-scope", selectedLenses: ["review-risk"] });
		const first = { agent: "review-risk", task: "review", mode: "task" };
		const second = { agent: "review-risk", task: "review", mode: "task" };
		injectReviewCandidateView(first, registry);
		injectReviewCandidateView(second, registry);
		const compact = compactCandidateContextManifest(first.task);
		assert.deepEqual(compact, compactCandidateContextManifest(second.task));
		const decoded = decodeCandidateContextManifest(compact.encoded, compact.sha256);
		assert.deepEqual(decoded.manifest, {
			version: 1,
			scopeByMode: { "100644": unicodePaths, "160000": ["vendor/dependency"], deleted: ["deleted.txt"] },
			gitlinks: { "vendor/dependency": gitlinkCommit },
		});
		assert.equal(decoded.sha256, createHash("sha256").update(decoded.bytes).digest("hex"));
		assert.ok(JSON.stringify(decoded.manifest).length < 4_096, "UTF-16 code units alone must not decide the dispatch bound");
		assert.ok(decoded.bytes.length > 4_096, "the manifest must retain its full non-ASCII UTF-8 byte sequence");
		const actorEntries: Array<{ path: string; mode: string; gitlinkObjectId?: string }> = [];
		let cursor: number | undefined = 0;
		while (cursor !== undefined) {
			const page = readCandidateContextManifestPage(compact.encoded, compact.sha256, cursor);
			actorEntries.push(...page.entries);
			assert.ok(Buffer.byteLength(JSON.stringify(page), "utf8") <= 16 * 1024);
			cursor = page.nextCursor;
		}
		assert.deepEqual(actorEntries, [
			...unicodePaths.map((path) => ({ path, mode: "100644" })),
			{ path: "vendor/dependency", mode: "160000", gitlinkObjectId: gitlinkCommit },
			{ path: "deleted.txt", mode: "deleted" },
		]);
		assert.ok(Buffer.byteLength(first.task, "utf8") <= Buffer.byteLength("review", "utf8") + 4_096);
		assert.doesNotMatch(first.task, /Frozen changed scope by mode:/);
		assert.match(first.task, /Call `jero_review_scope`/);
		assert.throws(() => decodeCandidateContextManifest(compact.encoded, `${compact.sha256.slice(0, -1)}0`), /integrity/);
		assert.throws(() => readCandidateContextManifestPage(compact.encoded, compact.sha256, actorEntries.length + 1), /cursor/);
		const nonCanonicalBytes = Buffer.from(JSON.stringify({ gitlinks: decoded.manifest.gitlinks, scopeByMode: decoded.manifest.scopeByMode, version: 1 }), "utf8");
		assert.throws(
			() => decodeCandidateContextManifest(gzipSync(nonCanonicalBytes, CANONICAL_GZIP_OPTIONS).toString("base64url"), createHash("sha256").update(nonCanonicalBytes).digest("hex")),
			/canonical/,
		);
	} finally {
		registry.cleanup(view.token);
	}
});

test("candidate context manifest decoder accepts canonical numeric-looking gitlink paths", () => {
	const gitlinks = {
		"10": "0123456789abcdef0123456789abcdef01234567",
		"2": "89abcdef0123456789abcdef0123456789abcdef",
	};
	const bytes = Buffer.from(JSON.stringify({
		version: 1,
		scopeByMode: { "160000": ["10", "2"] },
		gitlinks,
	}), "utf8");
	const encoded = gzipSync(bytes, CANONICAL_GZIP_OPTIONS).toString("base64url");
	assert.deepEqual(decodeCandidateContextManifest(encoded, createHash("sha256").update(bytes).digest("hex")).manifest, {
		version: 1,
		scopeByMode: { "160000": ["10", "2"] },
		gitlinks,
	});
});

test("candidate context manifest decoder rejects noncanonical nonnumeric gitlink ordering", () => {
	const gitlinks = {
		zeta: "0123456789abcdef0123456789abcdef01234567",
		alpha: "89abcdef0123456789abcdef0123456789abcdef",
	};
	const bytes = Buffer.from(JSON.stringify({
		version: 1,
		scopeByMode: { "160000": ["alpha", "zeta"] },
		gitlinks,
	}), "utf8");
	assert.throws(
		() => decodeCandidateContextManifest(gzipSync(bytes, CANONICAL_GZIP_OPTIONS).toString("base64url"), createHash("sha256").update(bytes).digest("hex")),
		/canonical/,
	);
});

test("candidate context manifest decoder rejects noncanonical gzip transport for verified bytes", () => {
	const bytes = Buffer.from(JSON.stringify({ version: 1, scopeByMode: { "100644": ["file.ts"] }, gitlinks: {} }), "utf8");
	const sha256 = createHash("sha256").update(bytes).digest("hex");
	const canonical = gzipSync(bytes, CANONICAL_GZIP_OPTIONS);
	const noncanonical = Buffer.from(canonical);
	noncanonical[4] = (noncanonical[4]! + 1) & 0xff;
	assert.throws(() => decodeCandidateContextManifest(noncanonical.toString("base64url"), sha256), /canonical/);
});

test("candidate view fails closed when an incompressible compact scope exceeds 4096 UTF-8 bytes", (t) => {
	const contributorRoot = repository(t);
	for (let index = 0; index < 80; index += 1) {
		const entropy = createHash("sha512").update(`candidate-scope-${index}`).digest("hex");
		writeFileSync(join(contributorRoot, `changed-${String(index).padStart(3, "0")}-${entropy}.txt`), "candidate\n");
	}
	const registry = new CandidateViewRegistry();
	const view = registry.create({ contributorRoot });
	try {
		registry.bind({ token: view.token, lineageId: "incompressible-scope", selectedLenses: ["review-risk"] });
		assert.throws(
			() => injectReviewCandidateView({ agent: "review-risk", task: "review", mode: "task" }, registry),
			/candidate view context exceeds the bounded dispatch contract/,
		);
	} finally {
		registry.cleanup(view.token);
	}
});

test("candidate view accepts internal relative symlink targets and rejects unsafe lexical targets", (t) => {
	const acceptedRoot = repository(t);
	const acceptedTarget = "../../.agents/skills/example";
	const acceptedLink = join(acceptedRoot, ".agent", "skills", "example");
	mkdirSync(join(acceptedRoot, ".agents", "skills", "example"), { recursive: true });
	mkdirSync(join(acceptedRoot, ".agent", "skills"), { recursive: true });
	writeFileSync(join(acceptedRoot, ".agents", "skills", "example", "SKILL.md"), "example\n");
	try {
		symlinkSync(acceptedTarget, acceptedLink);
	} catch {
		t.skip("platform does not support symlinks");
		return;
	}
	const accepted = createCandidateView({ contributorRoot: acceptedRoot });
	try {
		assert.equal(lstatSync(acceptedLink).isSymbolicLink(), true);
		assert.equal(readFileSync(join(accepted.root, ".agent", "skills", "example", "SKILL.md"), "utf8"), "example\n");
		accepted.verify();
	} finally {
		accepted.cleanup();
	}

	for (const [name, target] of [
		["escape", "../escape"],
		["absolute", "/absolute-target"],
		["Windows drive absolute", "C:/absolute-target"],
		["lowercase Windows drive absolute", "c:/absolute-target"],
		["metadata", ".git"],
		["control", "unsafe\ntarget"],
		["backslash", "unsafe\\target"],
		["empty segment", "unsafe//target"],
	] as const) {
		// Windows 的 readlink 把 target 分隔符规范化为反斜杠后再读回，
		// 含字面反斜杠的 target 无法经文件系统区分——该拒绝分支仅在
		// 字节保真的平台上可测。
		if (name === "backslash" && process.platform === "win32") continue;
		const contributorRoot = repository(t);
		try {
			symlinkSync(target, join(contributorRoot, "candidate-link"));
		} catch {
			t.skip("platform does not support symlinks");
			return;
		}
		assert.throws(() => createCandidateView({ contributorRoot }), (error: unknown) => error instanceof CandidateViewError, name);
	}
});

test("candidate view detects symlink target-byte tampering after materialization", (t) => {
	const contributorRoot = repository(t);
	const link = join(contributorRoot, "candidate-link");
	try {
		symlinkSync("safe-target", link);
	} catch {
		t.skip("platform does not support symlinks");
		return;
	}
	const view = createCandidateView({ contributorRoot });
	try {
		const frozenLink = join(view.root, "candidate-link");
		chmodSync(view.root, 0o755);
		rmSync(frozenLink);
		symlinkSync("other-target", frozenLink);
		chmodSync(view.root, 0o555);
		assert.throws(() => view.verify(), CandidateViewError);
	} finally {
		view.cleanup();
	}
});

test("candidate view retains a valid dangling symlink through bind and finalize resolution", (t) => {
	const contributorRoot = repository(t);
	try {
		symlinkSync("missing-target", join(contributorRoot, "dangling-link"));
	} catch {
		t.skip("platform does not support symlinks");
		return;
	}
	const registry = new CandidateViewRegistry();
	const view = registry.create({ contributorRoot });
	try {
		registry.bind({ token: view.token, lineageId: "dangling-link", selectedLenses: ["review-reliability"] });
		const finalized = registry.resolveForFinalize("dangling-link");
		const link = join(finalized.root, "dangling-link");
		assert.equal(lstatSync(link).isSymbolicLink(), true);
		finalized.verify();
		chmodSync(finalized.root, 0o755);
		for (const target of ["other-target", "../escape"]) {
			rmSync(link);
			symlinkSync(target, link);
			assert.throws(() => finalized.verify(), CandidateViewError);
		}
		rmSync(link);
		assert.throws(() => finalized.verify(), CandidateViewError);
	} finally {
		registry.cleanup(view.token);
	}
});

test("candidate view represents an all-deletion candidate without requiring a candidate-tree entry", (t) => {
	const contributorRoot = repository(t);
	rmSync(join(contributorRoot, "tracked.txt"));
	const view = createCandidateView({ contributorRoot });
	try {
		assert.deepEqual(view.paths, ["tracked.txt"]);
		assert.deepEqual(view.deletedPaths, ["tracked.txt"]);
		assert.deepEqual(view.modes, {});
		view.verify();
	} finally {
		view.cleanup();
	}
});

test("current lineage binding selects its exact frozen tree despite overlapping historical 4R records", (t) => {
	const contributorRoot = repository(t);
	const registry = new CandidateViewRegistry();
	const lenses = ["review-risk", "review-resilience", "review-readability", "review-reliability"] as const;
	const historical = [] as string[];
	for (let index = 0; index < 3; index += 1) {
		writeFileSync(join(contributorRoot, "tracked.txt"), `historical-${index}\n`);
		const view = registry.create({ contributorRoot });
		registry.bind({ token: view.token, lineageId: `historical-${index}`, selectedLenses: lenses });
		historical.push(view.token);
	}
	writeFileSync(join(contributorRoot, "tracked.txt"), "current\n");
	const current = registry.create({ contributorRoot });
	registry.bindCurrent({ token: current.token, lineageId: "current", selectedLenses: lenses });
	try {
		for (const lens of lenses) {
			assert.equal(registry.resolveCurrentForLens(lens).candidateTree, current.candidateTree);
		}
		const single = { agent: "review-risk", task: "review", mode: "task" };
		const parallel = { agents: [...lenses], task: "review", mode: "task" };
		injectReviewCandidateView(single, registry);
		injectReviewCandidateView(parallel, registry);
		assert.match(single.task, /Controller-owned review lineage: `current`/);
		assert.match(parallel.task, new RegExp(`Frozen candidate tree: \`${current.candidateTree}\``));
		assert.throws(() => registry.resolveCurrentForLens("review-unknown"), CandidateViewError);
	} finally {
		for (const token of [...historical, current.token]) registry.cleanup(token);
	}
});

test("candidate views freeze gitlinks as immutable metadata without materializing them", (t) => {
	const contributorRoot = repository(t);
	const baseCommit = git(contributorRoot, "rev-parse", "HEAD");
	const gitlinkCommit = "0123456789abcdef0123456789abcdef01234567";
	git(contributorRoot, "update-index", "--add", "--cacheinfo", `160000,${gitlinkCommit},vendor/dependency`);
	git(contributorRoot, "-c", "user.name=Candidate Test", "-c", "user.email=candidate@example.invalid", "commit", "-m", "add gitlink");
	const view = new CandidateViewRegistry().create({ contributorRoot, baseRef: baseCommit, committedOnly: true });
	try {
		assert.deepEqual(view.paths, ["vendor/dependency"]);
		assert.deepEqual(view.modes, { "vendor/dependency": "160000" });
		assert.deepEqual(view.gitlinks, { "vendor/dependency": gitlinkCommit });
		assert.equal(lstatSync(join(view.root, "vendor", "dependency"), { throwIfNoEntry: false }), undefined);
		view.verify();
	} finally {
		view.cleanup();
	}
});

test("native projection reconstruction retains its selected untracked subset", (t) => {
	const contributorRoot = repository(t);
	writeFileSync(join(contributorRoot, "tracked.txt"), "tracked selection\n");
	writeFileSync(join(contributorRoot, "selected.txt"), "selected\n");
	writeFileSync(join(contributorRoot, "excluded.txt"), "excluded\n");
	const source = new CandidateViewRegistry();
	const selected = source.create({ contributorRoot, intendedUntracked: ["selected.txt"] });
	const restored = new CandidateViewRegistry();
	try {
		const view = restored.restoreForFinalizeFromNative("selected-native", contributorRoot, {
			baseTree: selected.baseTree,
			currentCandidateTree: selected.candidateTree,
			paths: selected.paths,
			intendedUntracked: ["selected.txt"],
			projection: "workspace",
		});
		assert.deepEqual(view.paths, ["selected.txt", "tracked.txt"]);
		assert.equal(lstatSync(join(view.root, "excluded.txt"), { throwIfNoEntry: false }), undefined);
		view.cleanup();
	} finally {
		selected.cleanup();
	}
});

test("native projections reconstruct symlink, intended-untracked, and gitlink identity from Git objects", (t) => {
	const contributorRoot = repository(t);
	const baseTree = git(contributorRoot, "rev-parse", "HEAD^{tree}");
	writeFileSync(join(contributorRoot, "new.txt"), "new\n");
	symlinkSync("new.txt", join(contributorRoot, "alias.txt"));
	git(contributorRoot, "add", "new.txt", "alias.txt");
	const gitlinkCommit = "89abcdef0123456789abcdef0123456789abcdef";
	git(contributorRoot, "update-index", "--add", "--cacheinfo", `160000,${gitlinkCommit},vendor/dependency`);
	const candidateTree = git(contributorRoot, "write-tree");
	const registry = new CandidateViewRegistry();
	registry.restoreProjectionFromNative("native-projection", contributorRoot, {
		baseTree,
		currentCandidateTree: candidateTree,
		paths: ["alias.txt", "new.txt", "vendor/dependency"],
		intendedUntracked: ["alias.txt", "new.txt"],
		projection: "workspace",
	});
	const projection = registry.resolveProjection("native-projection", contributorRoot);
	assert.deepEqual(projection.modes, { "alias.txt": "120000", "new.txt": "100644", "vendor/dependency": "160000" });
	assert.deepEqual(projection.gitlinks, { "vendor/dependency": gitlinkCommit });
});

test("native staged projections restore the exact current index over HEAD", (t) => {
	const contributorRoot = repository(t);
	const baseTree = git(contributorRoot, "rev-parse", "HEAD^{tree}");
	writeFileSync(join(contributorRoot, "tracked.txt"), "staged candidate\n");
	git(contributorRoot, "add", "tracked.txt");
	const candidateTree = git(contributorRoot, "write-tree");
	const registry = new CandidateViewRegistry();

	registry.restoreProjectionFromNative("staged-index-projection", contributorRoot, {
		baseTree,
		currentCandidateTree: candidateTree,
		paths: ["tracked.txt"],
		intendedUntracked: [],
		projection: "staged",
	});

	const projection = registry.resolveProjection("staged-index-projection", contributorRoot);
	assert.equal(projection.baseTree, baseTree);
	assert.equal(projection.candidateTree, candidateTree);
	assert.equal(projection.committedOnly, false);
});

test("native staged projections reject a workspace snapshot that differs from the current index", (t) => {
	const contributorRoot = repository(t);
	const baseTree = git(contributorRoot, "rev-parse", "HEAD^{tree}");
	writeFileSync(join(contributorRoot, "tracked.txt"), "workspace candidate\n");
	const workspace = new CandidateViewRegistry().create({ contributorRoot });
	try {
		assert.throws(
			() => new CandidateViewRegistry().restoreProjectionFromNative("workspace-as-staged", contributorRoot, {
				baseTree,
				currentCandidateTree: workspace.candidateTree,
				paths: ["tracked.txt"],
				intendedUntracked: [],
				projection: "staged",
			}),
			(error: unknown) => error instanceof CandidateViewError && error.reason === "projection-kind-drift",
		);
	} finally {
		workspace.cleanup();
	}
});

test("native projections recover a committed range base from its frozen tree", (t) => {
	const contributorRoot = repository(t);
	const baseCommit = git(contributorRoot, "rev-parse", "HEAD");
	const baseTree = git(contributorRoot, "rev-parse", "HEAD^{tree}");
	writeFileSync(join(contributorRoot, "tracked.txt"), "committed candidate\n");
	git(contributorRoot, "add", "tracked.txt");
	git(contributorRoot, "-c", "user.name=Candidate Test", "-c", "user.email=candidate@example.invalid", "commit", "-m", "candidate");
	const candidateTree = git(contributorRoot, "rev-parse", "HEAD^{tree}");
	const registry = new CandidateViewRegistry();
	registry.restoreProjectionFromNative("committed-projection", contributorRoot, {
		baseTree,
		currentCandidateTree: candidateTree,
		paths: ["tracked.txt"],
		intendedUntracked: [],
		// A committed range: HEAD moved past base with no dirty overlay.
		projection: "staged",
	});
	const projection = registry.resolveProjection("committed-projection", contributorRoot);
	assert.equal(projection.baseCommit, baseCommit);
	assert.equal(projection.committedOnly, true);
});

