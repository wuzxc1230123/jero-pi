// review-candidate-view 测试第 1 段（留守原文件名）（共 3 段；夹具在 review-candidate-view-shared.ts）。
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

test("candidate ownership is private and durable before worktree add; ordinary cleanup removes its marker", (t) => {
	const cwd = repository(t);
	let observed = false;
	let syncs = 0;
	const fsync = fs.fsyncSync;
	t.mock.method(fs, "fsyncSync", (fd: number) => { syncs++; fsync(fd); });
	syncBuiltinESMExports();
	t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
	const registry = new CandidateViewRegistry((file, args, options) => {
		if (args[0] === "worktree" && args[1] === "add") {
			const root = args[args.length - 2]!;
			const marker = ownerMarker(root);
			const owner = JSON.parse(readFileSync(marker, "utf8"));
			assert.equal(owner.root, root);
			assert.equal(owner.pid, process.pid);
			assert.match(owner.token, /^[0-9a-f-]{36}$/);
			if (process.platform !== "win32") assert.equal(lstatSync(marker).mode & 0o777, 0o600);
			assert.equal(existsSync(root), false);
			assert.ok(syncs >= (process.platform === "win32" ? 1 : 4), "marker and every newly created ancestor must be durable before add");
			observed = true;
		}
		return execFileSync(file, args, options);
	});
	const view = registry.create({ contributorRoot: cwd });
	assert.equal(observed, true);
	view.cleanup();
	assert.equal(existsSync(view.root), false);
	assert.equal(existsSync(ownerMarker(view.root)), false);
});

test("private candidate owner accepts safe Windows artifacts", (t) => {
	mockWindowsAcl(t);
	const view = new CandidateViewRegistry(undefined, "win32").create({ contributorRoot: repository(t) });
	try {
		assert.equal(lstatSync(ownerMarker(view.root)).isFile(), true);
		assert.doesNotThrow(() => view.verify());
	} finally {
		view.cleanup();
	}
});

test("private candidate owner accepts a canonical Windows worktree registration spelling", { skip: process.platform !== "win32" }, (t) => {
	let root: string | undefined;
	const registry = new CandidateViewRegistry((file, arguments_, options) => {
		const output = execFileSync(file, arguments_, options);
		if (root !== undefined && arguments_[0] === "worktree" && arguments_[1] === "list" && typeof output === "string") {
			return output.replace(`worktree ${root}\0`, `worktree \\\\?\\${root}\0`);
		}
		return output;
	}, "win32");
	const view = registry.create({ contributorRoot: repository(t) });
	root = view.root;
	view.cleanup();
	assert.equal(existsSync(root), false);
});

test("private candidate owner rejects an untrusted conditional Windows allow ACE", () => {
	assert.throws(
		() => validatePrivateWindowsDacl("D:P(A;OICI;FA;;;S-1-5-21-1)(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)(XA;OICI;FA;;;S-1-5-21-2)", "S-1-5-21-1", true),
		(error: unknown) => error instanceof WindowsDaclValidationError && error.reason === "ace-type" && !error.message.includes("S-1-5-21-2"),
	);
});

test("private candidate owner reports bounded Windows DACL mismatch reasons", () => {
	const dacl = "D:P(A;OICI;FA;;;S-1-5-21-1)(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)";
	for (const [reason, invalid] of [["ace-flags", dacl.replace("OICI", "OI")], ["ace-rights", dacl.replace("FA", "FR")], ["ace-reserved-fields", dacl.replace(";;;S-1-5-21-1", ";object;;S-1-5-21-1")], ["ace-trustee", dacl.replace("S-1-5-21-1", "S-1-5-21-2")], ["ace-duplicate", `${dacl}(A;OICI;FA;;;SY)`], ["ace-count", dacl.replace("(A;OICI;FA;;;BA)", "")]] as const) {
		assert.throws(() => validatePrivateWindowsDacl(invalid, "S-1-5-21-1", true), (error: unknown) => error instanceof WindowsDaclValidationError && error.reason === reason && error.message === `Windows DACL validation failed: ${reason}${reason === "ace-trustee" ? " (sid)" : ""}`);
	}
});

test("private candidate owner reports bounded Windows DACL mismatch reasons for trustees", () => {
	const dacl = "D:P(A;OICI;FA;;;S-1-5-21-1)(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)";
	for (const [trustee, classification] of [["OW", "OW"], ["CO", "CO"], ["BU", "BU"], ["AU", "AU"], ["WD", "WD"], ["LA", "LA"], ["S-1-5-21-999-888-777-666", "sid"], ["unknown", "other"], ["", "missing"]] as const) {
		assert.throws(() => validatePrivateWindowsDacl(dacl.replace("S-1-5-21-1", trustee), "S-1-5-21-1", true), (error: unknown) => error instanceof WindowsDaclValidationError && error.reason === "ace-trustee" && error.trustee === classification && error.message === `Windows DACL validation failed: ace-trustee (${classification})` && (trustee === classification || trustee === "" || !error.message.includes(trustee)));
	}
});

test("private candidate owner accepts LA for the exact local Administrator SID", () => {
	assert.doesNotThrow(() => validatePrivateWindowsDacl("D:P(A;OICI;FA;;;LA)(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)", "S-1-5-21-1-2-3-500", true, "S-1-5-21-1-2-3-500"));
});

test("private candidate owner rejects LA for a non-local RID-500 current user when the local Administrator differs", () => {
	assert.throws(() => validatePrivateWindowsDacl("D:P(A;OICI;FA;;;LA)(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)", "S-1-5-21-1-2-3-500", true, "S-1-5-21-4-5-6-500"), (error: unknown) => error instanceof WindowsDaclValidationError && error.reason === "ace-trustee" && error.trustee === "LA");
});

test("private candidate owner rejects raw and LA local Administrator grants as duplicates", () => {
	assert.throws(() => validatePrivateWindowsDacl("D:P(A;OICI;FA;;;S-1-5-21-1-2-3-500)(A;OICI;FA;;;LA)(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)", "S-1-5-21-1-2-3-500", true, "S-1-5-21-1-2-3-500"), (error: unknown) => error instanceof WindowsDaclValidationError && error.reason === "ace-duplicate");
});

test("private candidate owner fails closed when local Administrator resolution is unavailable", () => {
	assert.throws(() => validatePrivateWindowsDacl("D:P(A;OICI;FA;;;LA)(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)", "S-1-5-21-1-2-3-500", true), (error: unknown) => error instanceof WindowsDaclValidationError && error.reason === "ace-trustee" && error.trustee === "LA");
});

test("private candidate owner accepts only trusted Windows owners", () => {
	for (const owner of ["S-1-5-21-1-2-3-1001", "S-1-5-18", "S-1-5-32-544"]) assert.doesNotThrow(() => validatePrivateWindowsOwner(owner, "S-1-5-21-1-2-3-1001"));
	assert.throws(() => validatePrivateWindowsOwner("S-1-5-21-4-5-6-1002", "S-1-5-21-1-2-3-1001"), (error: unknown) => error instanceof WindowsOwnerValidationError && !error.message.includes("S-1-5-21-4-5-6-1002"));
});

test("private candidate owner fails closed when Windows owner resolution is unavailable", () => {
	assert.throws(() => validatePrivateWindowsOwner(undefined, "S-1-5-21-1-2-3-1001"), WindowsOwnerValidationError);
});

test("private candidate owner rejects a different Windows owner at the ancestor replacement boundary", (t) => {
	const cwd = repository(t), commonDir = join(cwd, ".git"), control = join(commonDir, "jero-review"), parent = join(control, "candidate-views");
	mkdirSync(parent, { recursive: true });
	setWindowsAclAuthorityForTesting((path) => {
		if (path === control) validatePrivateWindowsOwner("S-1-5-21-4-5-6-1002", "S-1-5-21-1-2-3-1001");
	});
	t.after(() => setWindowsAclAuthorityForTesting(noopWindowsAclAuthority));
	assert.throws(() => prepareCandidateOwnerParent(commonDir, "win32"), (error: unknown) => error instanceof WindowsOwnerValidationError && error.owner === "sid");
});

test("private candidate owner revalidates every Windows ancestor replacement boundary", (t) => {
	const cwd = repository(t), commonDir = join(cwd, ".git"), control = join(commonDir, "jero-review"), parent = join(control, "candidate-views");
	mkdirSync(parent, { recursive: true });
	const checked: string[] = [];
	setWindowsAclAuthorityForTesting((path) => checked.push(path));
	t.after(() => setWindowsAclAuthorityForTesting(noopWindowsAclAuthority));
	assert.equal(assertCandidateOwnerParent(commonDir, "win32"), parent);
	assert.deepEqual(checked, [commonDir, control, parent]);
});

test("private candidate owner rejects a controlled foreign Windows owner", { skip: process.platform !== "win32" }, (t) => {
	const path = mkdtempSync(join(tmpdir(), "gentle-pi-foreign-owner-"));
	t.after(() => rmSync(path, { recursive: true, force: true }));
	try {
		execFileSync(realpathSync.native("\\\\?\\GLOBALROOT\\SystemRoot\\System32\\icacls.exe"), [path, "/setowner", "*S-1-5-32-545"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
	} catch {
		if (process.env.GITHUB_ACTIONS === "true" || process.env.CI === "true") assert.fail("Windows CI could not assign BUILTIN\\Users as the controlled temporary directory owner");
		t.skip("Current Windows token cannot assign BUILTIN\\Users as the controlled temporary directory owner");
		return;
	}
	assert.throws(() => assertTrustedWindowsOwner(path, "directory"), (error: unknown) => error instanceof WindowsOwnerValidationError && error.owner === "sid");
});

test("private candidate owner reads trusted Windows directory and marker file owners", { skip: process.platform !== "win32" }, (t) => {
	useRealWindowsAclAuthority(t);
	const cwd = repository(t), commonDir = join(cwd, ".git"), parent = join(commonDir, "jero-review", "candidate-views");
	const view = new CandidateViewRegistry().create({ contributorRoot: cwd });
	try {
		assert.doesNotThrow(() => assertTrustedWindowsOwner(parent, "directory"));
		assert.doesNotThrow(() => assertTrustedWindowsOwner(ownerMarker(view.root), "file"));
		assert.doesNotThrow(() => view.verify());
	} finally {
		view.cleanup();
	}
});

test("private candidate owner removes unrelated explicit Windows grants during enforcement", { skip: process.platform !== "win32" }, (t) => {
	useRealWindowsAclAuthority(t);
	const cwd = repository(t), commonDir = join(cwd, ".git"), parent = join(commonDir, "jero-review", "candidate-views");
	const initial = new CandidateViewRegistry().create({ contributorRoot: cwd });
	initial.cleanup();
	const system = process.env.SystemRoot!;
	execFileSync(`${system}\\System32\\icacls.exe`, [parent, "/grant", "*S-1-5-32-545:(OI)(CI)F"], { encoding: "utf8" });
	const archive = ".candidate-owner-acl.txt";
	try {
		execFileSync(`${system}\\System32\\icacls.exe`, [parent, "/save", archive, "/c"], { cwd: parent, encoding: "utf8" });
		const before = readFileSync(join(parent, archive), "utf16le").match(/D:[^\r\n]+/)?.[0];
		assert.ok(before);
		assert.match(before, /;;;(?:BU|S-1-5-32-545)\)/i);
		assert.doesNotThrow(() => prepareCandidateOwnerParent(commonDir));
		execFileSync(`${system}\\System32\\icacls.exe`, [parent, "/save", archive, "/c"], { cwd: parent, encoding: "utf8" });
		const after = readFileSync(join(parent, archive), "utf16le").match(/D:[^\r\n]+/)?.[0];
		assert.ok(after);
		assert.doesNotMatch(after, /;;;(?:BU|S-1-5-32-545)\)/i);
	} finally {
		rmSync(join(parent, archive), { force: true });
	}
});

test("candidate contributor root accepts canonical Windows Git path spelling", { skip: process.platform !== "win32" }, (t) => {
	const contributorRoot = repository(t);
	let useCanonicalSpelling = false;
	const registry = new CandidateViewRegistry((file, arguments_, options) => {
		const output = execFileSync(file, arguments_, options);
		if (!useCanonicalSpelling || typeof output !== "string" || arguments_[0] !== "rev-parse") return output;
		if (arguments_[1] === "--show-toplevel") return output.toUpperCase();
		if (arguments_[1] === "--git-common-dir") return resolve(contributorRoot, output).toUpperCase();
		return output;
	}, "win32");
	mockWindowsAcl(t);
	const view = registry.create({ contributorRoot });
	try {
		useCanonicalSpelling = true;
		assert.doesNotThrow(() => view.verify());
	} finally {
		view.cleanup();
	}
});

test("private candidate owner ignores a spoofed SystemRoot when invoking Windows ACL tools", { skip: process.platform !== "win32" }, (t) => {
	useRealWindowsAclAuthority(t);
	const originalSystemRoot = process.env.SystemRoot;
	const spoofedSystemRoot = join(tmpdir(), "gentle-pi-spoofed-SystemRoot");
	process.env.SystemRoot = spoofedSystemRoot;
	t.after(() => {
		if (originalSystemRoot === undefined) delete process.env.SystemRoot;
		else process.env.SystemRoot = originalSystemRoot;
	});
	const execFile = childProcess.execFileSync;
	const aclExecutables: string[] = [];
	t.mock.method(childProcess, "execFileSync", (file, arguments_, options) => {
		if (typeof file === "string" && /\\(?:whoami|icacls)\.exe$/i.test(file)) {
			aclExecutables.push(file);
			assert.equal(file.toLowerCase().startsWith(spoofedSystemRoot.toLowerCase()), false);
		}
		return execFile(file, arguments_, options);
	});
	syncBuiltinESMExports();
	t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
	const view = new CandidateViewRegistry().create({ contributorRoot: repository(t) });
	try {
		view.verify();
		assert.ok(aclExecutables.length > 0);
	} finally {
		view.cleanup();
	}
});

test("private candidate owner reads back a restrictive Windows DACL before worktree materialization", { skip: process.platform !== "win32" }, (t) => {
	useRealWindowsAclAuthority(t);
	const system = process.env.SystemRoot!;
	const view = new CandidateViewRegistry().create({ contributorRoot: repository(t) });
	try {
		const parent = join(view.root, ".."), archive = ".candidate-owner-acl.txt";
		execFileSync(`${system}\\System32\\icacls.exe`, [parent, "/save", archive, "/c"], { cwd: parent, encoding: "utf8" });
		const sddl = readFileSync(join(parent, archive), "utf16le");
		rmSync(join(parent, archive));
		const dacl = sddl.match(/D:[^\r\n]+/)?.[0];
		assert.ok(dacl);
		assert.doesNotThrow(() => view.verify());
	} finally {
		view.cleanup();
	}
});

export function publicationFailure(t: test.TestContext, phase: "write" | "fsync" | "directory"): void {
	mockWindowsAcl(t);
	if (phase === "directory") {
		const descriptor = Object.getOwnPropertyDescriptor(process, "platform")!;
		Object.defineProperty(process, "platform", { configurable: true, value: "linux" });
		t.after(() => Object.defineProperty(process, "platform", descriptor));
	}
	const cwd = repository(t), parent = join(cwd, ".git", "jero-review", "candidate-views");
	let adds = 0;
	if (phase === "write") t.mock.method(fs, "writeFileSync", () => { throw new Error("fixture marker write failure"); });
	if (phase === "fsync") t.mock.method(fs, "fsyncSync", () => { throw new Error("fixture marker fsync failure"); });
	if (phase === "directory") {
		const fsync = fs.fsyncSync;
		let syncs = 0;
		t.mock.method(fs, "fsyncSync", (fd: number) => {
			if (++syncs === 1) return fsync(fd);
			throw new Error("fixture marker directory sync failure");
		});
	}
	syncBuiltinESMExports();
	t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
	const registry = new CandidateViewRegistry((file, args, options) => {
		if (args[0] === "worktree" && args[1] === "add") adds++;
		return execFileSync(file, args, options);
	}, "win32");
	assert.throws(
		() => registry.create({ contributorRoot: cwd }),
		(error: unknown) => error instanceof CandidateViewError && error.reason === "candidate-owner-preparation-failed",
	);
	assert.equal(adds, 0);
	assert.deepEqual(readdirSync(parent).filter((name) => name.endsWith(".owner.json") || name.endsWith(".reaper-lock")), []);
}

for (const [phase, label] of [["write", "marker write"], ["fsync", "marker fsync"], ["directory", "post-marker directory sync"]] as const) {
	test(`candidate owner publication rolls back after ${label} failure`, (t) => publicationFailure(t, phase));
}

test("candidate owner publication never removes a replaced marker", (t) => {
	mockWindowsAcl(t);
	const cwd = repository(t), parent = join(cwd, ".git", "jero-review", "candidate-views");
	const write = fs.writeFileSync;
	t.mock.method(fs, "fsyncSync", () => {
		const marker = readdirSync(parent).find((name) => name.endsWith(".owner.json"));
		assert.ok(marker);
		renameSync(join(parent, marker!), join(parent, `${marker}.saved`));
		write(join(parent, marker!), "replacement", { mode: 0o600 });
		throw new Error("fixture marker fsync failure after replacement");
	});
	syncBuiltinESMExports();
	t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
	let adds = 0;
	const registry = new CandidateViewRegistry((file, args, options) => {
		if (args[0] === "worktree" && args[1] === "add") adds++;
		return execFileSync(file, args, options);
	}, "win32");
	assert.throws(() => registry.create({ contributorRoot: cwd }), CandidateViewError);
	assert.equal(adds, 0);
	const marker = readdirSync(parent).find((name) => name.endsWith(".owner.json"));
	assert.ok(marker);
	assert.equal(readFileSync(join(parent, marker!), "utf8"), "replacement");
	assert.equal(readdirSync(parent).some((name) => name.endsWith(".reaper-lock")), false);
});

test("candidate owner rejects an absent POSIX getuid before worktree creation", { skip: process.platform === "win32" }, (t) => {
	const originalGetuid = process.getuid;
	Object.defineProperty(process, "getuid", { configurable: true, value: undefined });
	t.after(() => Object.defineProperty(process, "getuid", { configurable: true, value: originalGetuid }));
	assert.throws(
		() => new CandidateViewRegistry().create({ contributorRoot: repository(t) }),
		(error: unknown) => error instanceof CandidateViewError && error.reason === "candidate-owner-preparation-failed",
	);
});

test("candidate owner rejects a POSIX UID mismatch before worktree creation", { skip: process.platform === "win32" }, (t) => {
	const uid = process.getuid?.();
	assert.equal(typeof uid, "number");
	const originalGetuid = process.getuid;
	Object.defineProperty(process, "getuid", { configurable: true, value: () => uid! + 1 });
	t.after(() => Object.defineProperty(process, "getuid", { configurable: true, value: originalGetuid }));
	assert.throws(
		() => new CandidateViewRegistry().create({ contributorRoot: repository(t) }),
		(error: unknown) => error instanceof CandidateViewError && error.reason === "candidate-owner-preparation-failed",
	);
});

test("marked registered definitively dead candidate is reclaimed before another materialization", (t) => {
	const { cwd, view, marker } = orphanFixture(t);
	mockOwnerProbe(t, "ESRCH");
	const next = new CandidateViewRegistry().create({ contributorRoot: cwd });
	assert.equal(existsSync(view.root), false);
	assert.equal(existsSync(marker), false);
	assert.ok(!git(cwd, "worktree", "list", "--porcelain").includes(view.root));
	next.cleanup();
});

for (const scenario of ["self", "live", "EPERM", "unknown", "malformed", "foreign-host", "unknown-host", "invalid-pid", "extra-key", "legacy", "unregistered", "root-symlink", "marker-symlink", "parent-symlink", "escape", "unknown-lock", "public-marker", "locked", "backlink", "admin-symlink", "missing-root"] as const) {
	test(`orphan sweep preserves ${scenario} ownership`, (t) => {
		const { cwd, view, marker, owner } = orphanFixture(t);
		mockOwnerProbe(t, scenario === "live" ? undefined : scenario === "EPERM" ? "EPERM" : scenario === "unknown" ? "EIO" : "ESRCH");
		if (scenario === "self") owner.pid = process.pid;
		if (scenario === "foreign-host") owner.host = "another-host";
		if (scenario === "unknown-host") owner.host = null;
		if (scenario === "invalid-pid") owner.pid = -1;
		if (scenario === "extra-key") owner.extra = true;
		if (scenario === "escape") owner.root = cwd;
		writeFileSync(marker, scenario === "malformed" ? "{" : JSON.stringify(owner));
		if (scenario === "legacy") rmSync(marker);
		if (scenario === "public-marker") {
			// POSIX：chmod 0o644 即失去属主私有。Windows 的 chmod 不改
			// DACL——用 icacls 给 Everyone 追加显式授权才构成"公开标记"。
			// 该场景的真义就是真实 DACL 校验拒绝公开标记，故 win32 上
			// 用例期间恢复真实 ACL 权威。
			if (process.platform === "win32") useRealWindowsAclAuthority(t);
			if (process.platform === "win32") execFileSync("icacls", [marker, "/grant", "*S-1-1-0:(R)"], { windowsHide: true });
			else chmodSync(marker, 0o644);
		}
		if (scenario === "locked") git(cwd, "worktree", "lock", view.root);
		if (scenario === "backlink" || scenario === "admin-symlink") {
			const admin = readFileSync(join(view.root, ".git"), "utf8").slice(8).trim();
			if (scenario === "backlink") writeFileSync(join(admin, "gitdir"), `${cwd}/.git\n`);
			else { renameSync(admin, `${admin}.saved`); symlinkSync(`${admin}.saved`, admin); }
		}
		if (scenario === "missing-root") renameSync(view.root, `${view.root}.saved`);
		if (scenario === "unknown-lock") writeFileSync(`${view.root}.reaper-lock`, "unknown");
		if (scenario === "unregistered") {
			execFileSync("chmod", ["-R", "u+rwx", view.root]);
			git(cwd, "worktree", "remove", "--force", view.root);
			mkdirSync(view.root);
			writeFileSync(join(view.root, "preserve.txt"), "unregistered");
		}
		if (scenario === "root-symlink") { renameSync(view.root, `${view.root}.saved`); symlinkSync(`${view.root}.saved`, view.root); }
		if (scenario === "marker-symlink") { renameSync(marker, `${marker}.saved`); symlinkSync(`${marker}.saved`, marker); }
		if (scenario === "parent-symlink") {
			const parent = join(view.root, "..");
			renameSync(parent, `${parent}.saved`);
			symlinkSync(`${parent}.saved`, parent);
		}
		new CandidateViewRegistry().sweepOrphans(cwd);
		assert.equal(existsSync(view.root), scenario !== "missing-root");
		assert.equal(existsSync(marker), scenario !== "legacy");
		assert.equal(readFileSync(join(cwd, "tracked.txt"), "utf8"), "base\n");
	});
}

test("reaper lock excludes concurrent sweeps and rechecks marker identity before removal", (t) => {
	const { cwd, view, marker, owner } = orphanFixture(t);
	mockOwnerProbe(t, "ESRCH");
	let lists = 0;
	const racing = new CandidateViewRegistry((file, args, options) => {
		if (args.includes("list")) {
			lists++;
			new CandidateViewRegistry().sweepOrphans(cwd);
			if (lists === 2) writeFileSync(marker, JSON.stringify({ ...owner, token: "00000000-0000-4000-8000-000000000000" }));
		}
		return execFileSync(file, args, options);
	});
	racing.sweepOrphans(cwd);
	assert.ok(lists >= 2);
	assert.equal(existsSync(view.root), true);
	assert.equal(existsSync(`${view.root}.reaper-lock`), false);
});

test("failed Git removal preserves owned candidate and marker without recursive fallback", (t) => {
	const cwd = repository(t);
	const registry = new CandidateViewRegistry((file, args, options) => {
		if (args.includes("remove")) throw new Error("fixture removal failure");
		return execFileSync(file, args, options);
	});
	const view = registry.create({ contributorRoot: cwd });
	assert.throws(() => view.cleanup());
	assert.equal(existsSync(view.root), true);
	assert.equal(existsSync(ownerMarker(view.root)), true);
});

test("failed creation retains a recoverable marker when Git removal also fails", (t) => {
	const cwd = repository(t);
	let root = "";
	const registry = new CandidateViewRegistry((file, args, options) => {
		if (args[0] === "worktree" && args[1] === "add") root = args[args.length - 2]!;
		if (args.includes("remove") || (args[0] === "read-tree" && options.cwd === root)) throw new Error("fixture failure");
		return execFileSync(file, args, options);
	});
	assert.throws(() => registry.create({ contributorRoot: cwd }));
	assert.equal(existsSync(root), true);
	const owner = JSON.parse(readFileSync(ownerMarker(root), "utf8"));
	writeFileSync(ownerMarker(root), JSON.stringify({ ...owner, pid: 2147483000 }));
	mockOwnerProbe(t, "ESRCH");
	new CandidateViewRegistry().sweepOrphans(cwd);
	assert.equal(existsSync(root), false);
});

test("materialization rejects a symlinked owner ancestor without creating an external store", (t) => {
	const cwd = repository(t);
	const outside = join(cwd, "outside");
	mkdirSync(outside);
	symlinkSync(outside, join(cwd, ".git", "jero-review"));
	assert.throws(() => new CandidateViewRegistry().create({ contributorRoot: cwd }));
	assert.equal(existsSync(join(outside, "candidate-views")), false);
});
