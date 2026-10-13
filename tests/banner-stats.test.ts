import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExecFileException } from "node:child_process";
import {
	countPackageExtensions,
	countSddAgents,
	currentIntroMode,
	readGitBranch,
} from "../lib/banner-stats.ts";

// banner-stats 域测试：intro 模式、SDD 代理计数（目录注入）、包扩展计数
// （npm 目录注入 + 规格解析分支）与 git 分支读取（runner 注入三分支）。

test("currentIntroMode 返回三态之一（非 TTY 下为 skip）", () => {
	const mode = currentIntroMode();
	assert.ok(["full", "minimal", "skip"].includes(mode));
	if (process.stdout.rows === undefined) assert.equal(mode, "skip");
});

test("countSddAgents：只数 sdd-*.md 文件，目录与无关文件不计", async () => {
	const dir = mkdtempSync(join(tmpdir(), "jero-banner-agents-"));
	try {
		writeFileSync(join(dir, "sdd-apply.md"), "");
		writeFileSync(join(dir, "sdd-verify.md"), "");
		writeFileSync(join(dir, "jero-worker.md"), "");
		writeFileSync(join(dir, "sdd-notes.txt"), "");
		mkdirSync(join(dir, "sdd-subdir.md"));
		assert.equal(await countSddAgents(dir), 2);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
	assert.equal(await countSddAgents(join(tmpdir(), "jero-banner-nope-404")), 0);
});

test("countPackageExtensions：规格解析 + pi.extensions 计数 + 缺失容忍", async () => {
	const npmDir = mkdtempSync(join(tmpdir(), "jero-banner-npm-"));
	try {
		const writePkg = (name: string, extensions: unknown) => {
			mkdirSync(join(npmDir, name), { recursive: true });
			writeFileSync(
				join(npmDir, name, "package.json"),
				JSON.stringify(extensions === undefined ? { name } : { name, pi: { extensions } }),
			);
		};
		writePkg("plain-pkg", ["./a", "./b", "./c"]);
		writePkg("scoped", ["./d"]);
		writePkg("no-pi-section", undefined);

		const total = await countPackageExtensions(
			[
				"plain-pkg",
				"npm:scoped@1.2.3",
				"@scope/thing@0.9.0",
				"no-pi-section",
				"never-installed-pkg",
				42,
				"",
			],
			npmDir,
		);
		// plain 3 + scoped(@scope/thing 规格解析到 @scope/thing 目录，1 个扩展) = 4；
		// no-pi-section / 未安装 / 非字符串 / 空串全部静默跳过。
		assert.equal(total, 4);
		assert.equal(await countPackageExtensions([], npmDir), 0);
	} finally {
		rmSync(npmDir, { recursive: true, force: true });
	}
});

test("readGitBranch：错误→Not a git repo，空输出→Detached HEAD，分支→On branch", async () => {
	const failing = (() => {
		const fn = (_cmd: string, _args: string[], _opts: unknown, callback: (error: ExecFileException | null, stdout?: string) => void) => {
			callback(Object.assign(new Error("spawn failed"), { code: 128 }) as ExecFileException);
		};
		return fn as unknown as typeof import("node:child_process").execFile;
	})();
	assert.equal(await readGitBranch("D:\\nowhere", failing), "Not a git repo");

	const detached = (() => {
		const fn = (_cmd: string, _args: string[], _opts: unknown, callback: (error: null, stdout?: string) => void) => {
			callback(null, "\n");
		};
		return fn as unknown as typeof import("node:child_process").execFile;
	})();
	assert.equal(await readGitBranch("anywhere", detached), "Detached HEAD");

	const branched = (() => {
		const fn = (_cmd: string, _args: string[], _opts: unknown, callback: (error: null, stdout?: string) => void) => {
			callback(null, "feature/x\n");
		};
		return fn as unknown as typeof import("node:child_process").execFile;
	})();
	assert.equal(await readGitBranch("anywhere", branched), "On branch feature/x");
});
