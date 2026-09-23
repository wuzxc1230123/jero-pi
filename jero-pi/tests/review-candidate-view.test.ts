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
	t.after(() => setWindowsAclAuthorityForTesting());
	assert.throws(() => prepareCandidateOwnerParent(commonDir, "win32"), (error: unknown) => error instanceof WindowsOwnerValidationError && error.owner === "sid");
});

test("private candidate owner revalidates every Windows ancestor replacement boundary", (t) => {
	const cwd = repository(t), commonDir = join(cwd, ".git"), control = join(commonDir, "jero-review"), parent = join(control, "candidate-views");
	mkdirSync(parent, { recursive: true });
	const checked: string[] = [];
	setWindowsAclAuthorityForTesting((path) => checked.push(path));
	t.after(() => setWindowsAclAuthorityForTesting());
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
		if (scenario === "public-marker") chmodSync(marker, 0o644);
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
				if (race === "registration") return String(result).replace(`worktree ${view.root}`, `worktree ${view.root}.other`);
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

export function compactCandidateContextManifest(task: string): { encoded: string; sha256: string } {
	const match = /Frozen changed scope manifest \(gzip\+base64url\): `([A-Za-z0-9_-]+)`\.\nFrozen changed scope manifest SHA-256: `([0-9a-f]{64})`\./.exec(task);
	assert.ok(match, "expected a compact candidate context manifest");
	return { encoded: match[1]!, sha256: match[2]! };
}

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

// An unborn repository has a symbolic HEAD pointing at a branch with no
// commits yet; its review base is Git's repository-native empty tree, not a
// missing or malformed commit. `mktree` with empty input derives that empty
// tree object-format-aware (sha1 or sha256) without hardcoding the SHA-1 id.
export function emptyTreeOf(cwd: string): string {
	return execFileSync("git", ["-C", cwd, "mktree"], { encoding: "utf8", input: "" }).trim();
}

export function unbornRepository(t: test.TestContext, stage = true): string {
	const cwd = mkdtempSync(join(tmpdir(), "gentle-pi-candidate-view-unborn-"));
	t.after(() => rmSync(cwd, { recursive: true, force: true }));
	git(cwd, "init", "-b", "main");
	git(cwd, "config", "user.name", "Candidate Test");
	git(cwd, "config", "user.email", "candidate@example.invalid");
	if (stage) {
		writeFileSync(join(cwd, "staged.txt"), "first staged\n");
		git(cwd, "add", "staged.txt");
	}
	return cwd;
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

