// review-candidate-view 测试第 5 段（共 5 段；夹具在 review-candidate-view-shared.ts）。
// 2026-10-14 机械平移自 z2（语义零改动）：z2 单文件 102s 是并行链天花板，
// 按既有分片模式对半再分；本地 helper 随唯一使用者迁入本段。

import { default as assert } from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, lstatSync, mkdirSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { default as test } from "node:test";
import { gzipSync } from "node:zlib";
import {
	CandidateViewError, CandidateViewRegistry, CANONICAL_GZIP_OPTIONS,
	createCandidateView, decodeCandidateContextManifest, hasExpectedExecutableBits,
	injectReviewCandidateView, readCandidateContextManifestPage
} from "../lib/authority/review-candidate-view.ts";
import { git, mockWindowsAcl, repository } from "./review-candidate-view-shared.ts";

// 机械平移自分片 2：仅本段使用，且分片互相导入会令被导入分片的顶层
// test() 注册在导入方进程里重跑一遍，故就地本地化而不 import 分片 2。
function compactCandidateContextManifest(task: string): { encoded: string; sha256: string } {
	const match = /Frozen changed scope manifest \(gzip\+base64url\): `([A-Za-z0-9_-]+)`.\nFrozen changed scope manifest SHA-256: `([0-9a-f]{64})`./.exec(task);
	assert.ok(match, "expected a compact candidate context manifest");
	return { encoded: match[1]!, sha256: match[2]! };
}

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
		// Windows 上 rmSync 对悬空符号链接是静默 no-op（实测含 force/recursive），
		// 换新链接会 EEXIST；unlinkSync 才真正删除链接本体。
		unlinkSync(frozenLink);
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
			// 同上：被删对象是悬空符号链接，Windows 必须用 unlinkSync。
			unlinkSync(link);
			symlinkSync(target, link);
			assert.throws(() => finalized.verify(), CandidateViewError);
		}
		unlinkSync(link);
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
