// 重平衡分片：自 review-candidate-view.test.ts 按顶层语句边界对半机械平移（语义零改动）。
// node --test 只在文件间并行；重用例扎堆单文件会抬高整套件并行的下限。

import { default as assert } from "node:assert/strict";
import { default as childProcess, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	chmodSync, default as fs, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync,
	readFileSync, realpathSync, renameSync, rmSync, symlinkSync, utimesSync, writeFileSync
} from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
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
import {
	git, mockOwnerProbe, mockWindowsAcl, noopWindowsAclAuthority, orphanFixture, ownerMarker,
	repository, useRealWindowsAclAuthority
} from "./review-candidate-view-shared.ts";

test("owner fsync failure prevents worktree registration", (t) => {
	const cwd = repository(t);
	let adds = 0;
	t.mock.method(fs, "fsyncSync", () => { throw new Error("fixture fsync failure"); });
	syncBuiltinESMExports();
	t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
	const registry = new CandidateViewRegistry((file, args, options) => {
		if (args[0] === "worktree" && args[1] === "add") adds++;
		return execFileSync(file, args, options);
	});
	assert.throws(
		() => registry.create({ contributorRoot: cwd }),
		(error: unknown) => error instanceof CandidateViewError && error.reason === "candidate-owner-preparation-failed" && error.cause instanceof Error && /fsync/.test(error.cause.message),
	);
	assert.equal(adds, 0);
});

test("ordinary cleanup preserves mismatched owner and cleanupAll continues other records", (t) => {
	const cwd = repository(t);
	const registry = new CandidateViewRegistry();
	const first = registry.create({ contributorRoot: cwd });
	const second = registry.create({ contributorRoot: cwd });
	const marker = ownerMarker(first.root);
	const bytes = readFileSync(marker, "utf8");
	writeFileSync(marker, JSON.stringify({ ...JSON.parse(bytes), token: "00000000-0000-4000-8000-000000000000" }));
	registry.cleanupAll();
	assert.equal(existsSync(first.root), true);
	assert.equal(existsSync(marker), true);
	assert.equal(existsSync(second.root), false);
	writeFileSync(marker, bytes);
	registry.cleanupAll();
	assert.equal(existsSync(first.root), false);
});

for (const race of ["root", "registration", "lock"] as const) {
	test(`orphan reaper preserves a ${race} replacement at the Git race boundary`, (t) => {
		const { cwd, view, marker } = orphanFixture(t);
		mockOwnerProbe(t, "ESRCH");
		let lists = 0;
		const registry = new CandidateViewRegistry((file, args, options) => {
			const result = execFileSync(file, args, options);
			if (args.includes("list") && ++lists === 2) {
				if (race === "root") { renameSync(view.root, `${view.root}.saved`); mkdirSync(view.root); }
				// porcelain 在 Windows 上输出正斜杠路径；view.root 用平台分隔符，
				// 直接 replace 永不命中，竞态注入就会静默失效。
				const porcelainRoot = view.root.split(sep).join("/");
				if (race === "registration") return String(result).replace(`worktree ${porcelainRoot}`, `worktree ${view.root}.other`);
				if (race === "lock") writeFileSync(`${view.root}.reaper-lock`, "replacement");
			}
			return result;
		});
		registry.sweepOrphans(cwd);
		assert.equal(existsSync(view.root), true);
		assert.equal(existsSync(marker), true);
		if (race === "lock") assert.equal(readFileSync(`${view.root}.reaper-lock`, "utf8"), "replacement");
	});
}

test("ordinary cleanup never unlinks a replaced sidecar after Git removal", (t) => {
	const cwd = repository(t);
	let marker = "";
	const registry = new CandidateViewRegistry((file, args, options) => {
		const result = execFileSync(file, args, options);
		if (args[0] === "worktree" && args[1] === "remove") {
			const bytes = readFileSync(marker);
			renameSync(marker, `${marker}.saved`);
			writeFileSync(marker, bytes, { mode: 0o600 });
		}
		return result;
	});
	const view = registry.create({ contributorRoot: cwd });
	marker = ownerMarker(view.root);
	assert.throws(() => view.cleanup(), /ownership changed/i);
	assert.equal(existsSync(marker), true);
});

test("candidate view Git commands classify bounded timeouts and block materialization before worktree execution", (t) => {
	const calls: Array<{ arguments: readonly string[]; timeout: number | undefined; maxBuffer: number | undefined }> = [];
	const executor: CandidateGitExecutor = (_file, arguments_, options) => { calls.push({ arguments: arguments_, timeout: options.timeout, maxBuffer: options.maxBuffer }); throw Object.assign(new Error("timed out"), { code: "ETIMEDOUT", killed: true }); };
	let failure: unknown;
	try {
		new CandidateViewRegistry(executor).create({ contributorRoot: repository(t) });
	} catch (error) {
		failure = error;
	}
	assert.ok(failure instanceof CandidateViewError);
	assert.equal(failure.reason, "candidate-view-timeout");
	assert.deepEqual((failure as CandidateViewError & { diagnostics?: unknown }).diagnostics, {
		phase: "candidate-view",
		category: "timeout",
		git_subcommand: "rev-parse",
		timeout_ms: 10_000,
		max_buffer_bytes: 64 * 1024 * 1024,
		message: "candidate-view Git command rev-parse timed out after 10000ms; inspect the candidate state before any new START",
	});
	assert.deepEqual(calls, [{ arguments: ["rev-parse", "--git-common-dir"], timeout: 10_000, maxBuffer: 64 * 1024 * 1024 }]);
	assert.equal(calls.some((call) => call.arguments[0] === "worktree"), false);
});

test("candidate-view Git timeouts use a bounded strict-decimal override with safe fallback", (t) => {
	const withTimeout = <T>(value: string | undefined, callback: () => T): T => {
		const previous = process.env.JERO_PI_CANDIDATE_GIT_TIMEOUT_MS;
		try {
			if (value === undefined) delete process.env.JERO_PI_CANDIDATE_GIT_TIMEOUT_MS;
			else process.env.JERO_PI_CANDIDATE_GIT_TIMEOUT_MS = value;
			return callback();
		} finally {
			if (previous === undefined) delete process.env.JERO_PI_CANDIDATE_GIT_TIMEOUT_MS;
			else process.env.JERO_PI_CANDIDATE_GIT_TIMEOUT_MS = previous;
		}
	};
	for (const [name, value, expected] of [
		["default", undefined, 10_000],
		["valid override", "45000", 45_000],
		...(["", "0", "0010", "-1", "1.5", "not-a-number", "120001", "Infinity"] as const).map((value) => [`invalid override ${JSON.stringify(value)}`, value, 10_000] as const),
	] as const) {
		const timeouts: Array<number | undefined> = [];
		let failure: unknown;
		withTimeout(value, () => {
			try {
				new CandidateViewRegistry((_file, _arguments, options) => {
					timeouts.push(options.timeout);
					throw Object.assign(new Error("timed out"), { code: "ETIMEDOUT" });
				}).create({ contributorRoot: repository(t) });
			} catch (error) {
				failure = error;
			}
		});
		assert.ok(failure instanceof CandidateViewError, name);
		assert.equal(timeouts[0], expected, name);
		assert.equal((failure as CandidateViewError & { diagnostics?: { timeout_ms?: unknown } }).diagnostics?.timeout_ms, expected, name);
	}
});

test("explicit base resolution preserves structured for-each-ref output-limit diagnostics", (t) => {
	const contributorRoot = repository(t);
	const executor: CandidateGitExecutor = (file, arguments_, options) => {
		if (arguments_[0] === "for-each-ref") throw Object.assign(new Error("sensitive base-reference output"), { code: "ENOBUFS", killed: true, stderr: Buffer.from("sensitive base-reference output") });
		return execFileSync(file, arguments_, options);
	};
	let failure: unknown;
	try {
		new CandidateViewRegistry(executor).create({ contributorRoot, baseRef: "refs/heads/main", committedOnly: true });
	} catch (error) {
		failure = error;
	}
	assert.ok(failure instanceof CandidateViewError);
	assert.equal(failure.reason, "candidate-view-output-limit");
	assert.deepEqual(failure.diagnostics, {
		phase: "candidate-view",
		category: "output-limit",
		git_subcommand: "for-each-ref",
		timeout_ms: 10_000,
		max_buffer_bytes: 64 * 1024 * 1024,
		message: "candidate-view Git command for-each-ref exceeded the 67108864-byte output limit; inspect the candidate state before any new START",
	});
	assert.doesNotMatch(failure.message, /sensitive base-reference output/);
});

test("every synchronous candidate-view Git command receives the explicit 64 MiB output limit", (t) => {
	const calls: Array<{ arguments: readonly string[]; maxBuffer: number | undefined }> = [];
	const executor: CandidateGitExecutor = (file, arguments_, options) => {
		calls.push({ arguments: arguments_, maxBuffer: options.maxBuffer });
		return execFileSync(file, arguments_, options);
	};
	const view = new CandidateViewRegistry(executor).create({ contributorRoot: repository(t) });
	try {
		assert.ok(calls.length > 1);
		assert.ok(calls.every((call) => call.maxBuffer === 64 * 1024 * 1024), JSON.stringify(calls));
	} finally {
		view.cleanup();
	}
});

test("candidate view classifies both Node synchronous-process output-limit errors ahead of killed state without exposing process output", (t) => {
	const attemptedOutputBytes = 64 * 1024 * 1024 + 1;
	for (const code of ["ENOBUFS", "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"]) {
		let failure: unknown;
		try {
			new CandidateViewRegistry((_file, _arguments, options) => {
				assert.ok((options.maxBuffer ?? 0) < attemptedOutputBytes, code);
				throw Object.assign(new Error("sensitive stderr and candidate bytes"), { code, killed: true, stderr: Buffer.from("sensitive stderr and candidate bytes") });
			}).create({ contributorRoot: repository(t) });
		} catch (error) {
			failure = error;
		}
		assert.ok(failure instanceof CandidateViewError, code);
		assert.equal(failure.reason, "candidate-view-output-limit", code);
		assert.deepEqual((failure as CandidateViewError & { diagnostics?: unknown }).diagnostics, {
			phase: "candidate-view",
			category: "output-limit",
			git_subcommand: "rev-parse",
			timeout_ms: 10_000,
			max_buffer_bytes: 64 * 1024 * 1024,
			message: "candidate-view Git command rev-parse exceeded the 67108864-byte output limit; inspect the candidate state before any new START",
		}, code);
		assert.doesNotMatch(failure.message, /sensitive stderr|candidate bytes/, code);
	}
});

test("candidate Git accepts deterministic output above 1 MiB up to its explicit bound", () => {
	const row = `:100644 100644 ${"a".repeat(40)} ${"b".repeat(40)} M\0tracked.txt\0`;
	const copies = Math.ceil((1024 * 1024 + 1) / Buffer.byteLength(row));
	const output = Buffer.from(row.repeat(copies));
	assert.ok(output.length > 1024 * 1024);
	assert.ok(output.length < 64 * 1024 * 1024);
	const calls: Array<{ maxBuffer: number | undefined }> = [];
	const manifest = deriveChangedPathManifest("/candidate", "a".repeat(40), "b".repeat(40), (_file, arguments_, options) => {
		assert.deepEqual(arguments_.slice(0, 2), ["diff", "--raw"]);
		calls.push({ maxBuffer: options.maxBuffer });
		return output;
	});
	assert.equal(manifest.length, copies);
	assert.ok(manifest.every((entry) => entry.path === "tracked.txt" && entry.status === "M"));
	assert.deepEqual(calls, [{ maxBuffer: 64 * 1024 * 1024 }]);
});

test("committed-only candidate views scope an explicit base to committed changes and exclude dirty worktree files", (t) => {
	const contributorRoot = repository(t);
	const baseCommit = git(contributorRoot, "rev-parse", "HEAD");
	writeFileSync(join(contributorRoot, "committed-after-base.txt"), "committed after base\n");
	git(contributorRoot, "add", "committed-after-base.txt");
	git(contributorRoot, "-c", "user.name=Candidate Test", "-c", "user.email=candidate@example.invalid", "commit", "-m", "committed after base");
	writeFileSync(join(contributorRoot, "tracked.txt"), "dirty after base\n");
	writeFileSync(join(contributorRoot, "untracked.txt"), "untracked after base\n");
	const view = new CandidateViewRegistry().create({ contributorRoot, baseRef: baseCommit, committedOnly: true });
	try {
		assert.deepEqual(view.paths, ["committed-after-base.txt"]);
		assert.equal(view.committedOnly, true);
		assert.equal(view.baseCommit, baseCommit);
		assert.equal(view.baseTree, git(contributorRoot, "rev-parse", `${baseCommit}^{tree}`));
		assert.equal(readFileSync(join(view.root, "tracked.txt"), "utf8"), "base\n");
		assert.equal(lstatSync(join(view.root, "untracked.txt"), { throwIfNoEntry: false }), undefined);
	} finally {
		view.cleanup();
	}
});

test("explicit base refs reject ambiguous DWIM names even when they resolve identically, while full refs stay valid", (t) => {
	const contributorRoot = repository(t);
	const baseCommit = git(contributorRoot, "rev-parse", "HEAD");
	git(contributorRoot, "branch", "same-commit", baseCommit);
	git(contributorRoot, "tag", "same-commit", baseCommit);
	git(contributorRoot, "update-ref", "refs/remotes/origin/main", baseCommit);
	assert.throws(
		() => new CandidateViewRegistry().create({ contributorRoot, baseRef: "same-commit" }),
		(error: unknown) => error instanceof CandidateViewError && error.reason === "base-ref-ambiguous",
	);
	for (const [baseRef, expectedCommit] of [
		["refs/heads/same-commit", baseCommit],
		["refs/tags/same-commit", baseCommit],
		["origin/main", baseCommit],
		[baseCommit, baseCommit],
	] as const) {
		const view = new CandidateViewRegistry().create({ contributorRoot, baseRef });
		try {
			assert.equal(view.baseCommit, expectedCommit);
		} finally {
			view.cleanup();
		}
	}
	commitFileAfterBase(contributorRoot);
	const tipCommit = git(contributorRoot, "rev-parse", "HEAD");
	git(contributorRoot, "branch", "different-commit", baseCommit);
	git(contributorRoot, "tag", "different-commit", baseCommit);
	git(contributorRoot, "branch", "-f", "different-commit", tipCommit);
	assert.throws(
		() => new CandidateViewRegistry().create({ contributorRoot, baseRef: "different-commit" }),
		(error: unknown) => error instanceof CandidateViewError && error.reason === "base-ref-ambiguous",
	);
	for (const [baseRef, expectedCommit] of [
		["refs/heads/different-commit", tipCommit],
		["refs/tags/different-commit", baseCommit],
	] as const) {
		const view = new CandidateViewRegistry().create({ contributorRoot, baseRef });
		try {
			assert.equal(view.baseCommit, expectedCommit);
		} finally {
			view.cleanup();
		}
	}
});

test("candidate view defaults its frozen base identity to HEAD", (t) => {
	const contributorRoot = repository(t);
	commitFileAfterBase(contributorRoot);
	writeFileSync(join(contributorRoot, "tracked.txt"), "dirty after HEAD\n");
	const view = new CandidateViewRegistry().create({ contributorRoot });
	try {
		assert.equal(view.baseCommit, git(contributorRoot, "rev-parse", "HEAD"));
		assert.equal(view.baseTree, git(contributorRoot, "rev-parse", "HEAD^{tree}"));
		assert.deepEqual(view.paths, ["tracked.txt"]);
	} finally {
		view.cleanup();
	}
});

test("candidate view rejects invalid or moving base refs and restores the frozen base tree after reload", (t) => {
	const contributorRoot = repository(t);
	const baseCommit = git(contributorRoot, "rev-parse", "HEAD");
	commitFileAfterBase(contributorRoot);
	writeFileSync(join(contributorRoot, "tracked.txt"), "dirty after base\n");
	assert.throws(
		() => new CandidateViewRegistry().create({ contributorRoot, baseRef: "refs/heads/missing-base" }),
		(error: unknown) => error instanceof CandidateViewError && error.reason === "base-ref-unresolvable",
	);
	git(contributorRoot, "branch", "moving-base", baseCommit);
	let baseResolutions = 0;
	const movingExecutor: CandidateGitExecutor = (file, arguments_, options) => {
		if (arguments_.at(-1) === "moving-base^{commit}" && ++baseResolutions === 2) git(contributorRoot, "branch", "-f", "moving-base", "HEAD");
		return execFileSync(file, arguments_, options);
	};
	assert.throws(
		() => new CandidateViewRegistry(movingExecutor).create({ contributorRoot, baseRef: "moving-base" }),
		(error: unknown) => error instanceof CandidateViewError && error.reason === "base-ref-moved",
	);
	const source = new CandidateViewRegistry();
	const frozen = source.create({ contributorRoot, baseRef: baseCommit, committedOnly: true });
	const state = {
		lineageId: "restored-explicit-base",
		contributorRoot,
		baseCommit: frozen.baseCommit,
		baseTree: frozen.baseTree,
		candidateTree: frozen.candidateTree,
		committedOnly: true,
		paths: frozen.paths,
		modes: frozen.modes,
		deletedPaths: frozen.deletedPaths,
		selectedLenses: ["review-reliability"],
	};
	const restored = new CandidateViewRegistry();
	try {
		restored.restoreCurrentFromAuthoritativeReviewingStates(contributorRoot, [state]);
		const view = restored.resolveCurrentForLens("review-reliability");
		assert.equal(view.baseCommit, baseCommit);
		assert.equal(view.baseTree, git(contributorRoot, "rev-parse", `${baseCommit}^{tree}`));
		assert.equal(view.committedOnly, true);
		assert.deepEqual(view.paths, ["committed-after-base.txt"]);
	} finally {
		source.cleanup(frozen.token);
		const restoredView = restored.resolveCurrentForLens("review-reliability");
		restored.cleanup(restoredView.token);
	}
});

export function commitFileAfterBase(cwd: string): void {
	writeFileSync(join(cwd, "committed-after-base.txt"), "committed after base\n");
	git(cwd, "add", "committed-after-base.txt");
	git(cwd, "-c", "user.name=Candidate Test", "-c", "user.email=candidate@example.invalid", "commit", "-m", "committed after base");
}

test("candidate view materializes exact tracked and initially-untracked content while contributor diverges", (t) => {
	const contributorRoot = repository(t);
	writeFileSync(join(contributorRoot, "tracked.txt"), "frozen tracked\n");
	writeFileSync(join(contributorRoot, "new.txt"), "frozen new\n");
	const view = createCandidateView({ contributorRoot });
	t.after(() => view.cleanup());
	assert.equal(readFileSync(join(view.root, "tracked.txt"), "utf8"), "frozen tracked\n");
	assert.equal(readFileSync(join(view.root, "new.txt"), "utf8"), "frozen new\n");
	assert.deepEqual(view.paths, ["new.txt", "tracked.txt"]);
	assert.deepEqual(view.modes, { "new.txt": "100644", "tracked.txt": "100644" });
	assert.equal(lstatSync(view.root).isSymbolicLink(), false);
	writeFileSync(join(contributorRoot, "tracked.txt"), "live divergence\n");
	assert.equal(readFileSync(join(view.root, "tracked.txt"), "utf8"), "frozen tracked\n");
	view.verify();
	view.cleanup();
});

test("candidate view preserves staged additions with explicit intended-untracked selection in its private index", (t) => {
	const contributorRoot = repository(t);
	writeFileSync(join(contributorRoot, "tracked.txt"), "tracked selection\n");
	writeFileSync(join(contributorRoot, "staged-addition.txt"), "staged addition\n");
	git(contributorRoot, "add", "staged-addition.txt");
	git(contributorRoot, "update-index", "--split-index");
	writeFileSync(join(contributorRoot, "selected.txt"), "selected\n");
	writeFileSync(join(contributorRoot, "excluded.txt"), "excluded\n");
	const indexBefore = readFileSync(join(contributorRoot, ".git", "index"));
	const all = createCandidateView({ contributorRoot });
	const excluded = createCandidateView({ contributorRoot, intendedUntracked: [] });
	const selected = createCandidateView({ contributorRoot, intendedUntracked: ["selected.txt"] });
	try {
		assert.deepEqual(all.paths, ["excluded.txt", "selected.txt", "staged-addition.txt", "tracked.txt"]);
		assert.deepEqual(excluded.paths, ["staged-addition.txt", "tracked.txt"]);
		assert.deepEqual(selected.paths, ["selected.txt", "staged-addition.txt", "tracked.txt"]);
		assert.equal(readFileSync(join(selected.root, "staged-addition.txt"), "utf8"), "staged addition\n");
		assert.equal(lstatSync(join(selected.root, "excluded.txt"), { throwIfNoEntry: false }), undefined);
		assert.deepEqual(readFileSync(join(contributorRoot, ".git", "index")), indexBefore);
	} finally {
		all.cleanup();
		excluded.cleanup();
		selected.cleanup();
	}
});

test("candidate view detects a same-stat tracked rewrite with selected untracked content when trustctime is disabled", (t) => {
	const contributorRoot = repository(t);
	const tracked = join(contributorRoot, "tracked.txt");
	const index = join(contributorRoot, ".git", "index");
	// A fractional timestamp exposes Date-based timestamp restoration, which can
	// collapse the private index onto the live index's racy-clean boundary.
	const fixedTimestampSeconds = 946_684_800.654_321;
	git(contributorRoot, "config", "core.trustctime", "false");
	writeFileSync(tracked, "fixed\n");
	utimesSync(tracked, fixedTimestampSeconds, fixedTimestampSeconds);
	git(contributorRoot, "add", "tracked.txt");
	git(contributorRoot, "-c", "user.name=Candidate Test", "-c", "user.email=candidate@example.invalid", "commit", "-m", "fixed timestamp base");
	writeFileSync(tracked, "other\n");
	utimesSync(tracked, fixedTimestampSeconds, fixedTimestampSeconds);
	utimesSync(index, fixedTimestampSeconds, fixedTimestampSeconds);
	const liveIndexMtimeNs = lstatSync(index, { bigint: true }).mtimeNs;
	if (liveIndexMtimeNs % 1_000_000n === 0n) t.diagnostic("filesystem does not retain sub-millisecond index mtimes; retaining the same-stat rewrite assertion");
	else assert.notEqual(liveIndexMtimeNs % 1_000_000_000n, 0n, "sub-millisecond filesystem must retain the requested non-whole-second index mtime");
	writeFileSync(join(contributorRoot, "selected.txt"), "selected\n");

	let privateIndexMtimeNs: bigint | undefined;
	const registry = new CandidateViewRegistry((file, arguments_, options) => {
		if (arguments_[0] === "add" && privateIndexMtimeNs === undefined) {
			const privateIndexPath = options.env?.GIT_INDEX_FILE;
			assert.equal(typeof privateIndexPath, "string", "private candidate index must be set before Git refreshes tracked entries");
			privateIndexMtimeNs = lstatSync(privateIndexPath, { bigint: true }).mtimeNs;
		}
		return execFileSync(file, arguments_, options);
	});
	const view = registry.create({ contributorRoot, intendedUntracked: ["selected.txt"] });
	try {
		assert.notEqual(privateIndexMtimeNs, undefined, "private index timestamp must be observed before Git add");
		assert.ok(privateIndexMtimeNs! < liveIndexMtimeNs, "private index must be strictly earlier than the live index");
		assert.ok(liveIndexMtimeNs - privateIndexMtimeNs! >= 1_000_000_000n, "private index must leave a bounded racy-clean safety interval");
		assert.deepEqual(view.intendedUntracked, ["selected.txt"]);
		assert.deepEqual(view.paths, ["selected.txt", "tracked.txt"]);
		assert.notEqual(view.candidateTree, view.baseTree);
		assert.equal(readFileSync(join(view.root, "tracked.txt"), "utf8"), "other\n");
		assert.equal(readFileSync(join(view.root, "selected.txt"), "utf8"), "selected\n");
	} finally {
		view.cleanup();
	}
});
