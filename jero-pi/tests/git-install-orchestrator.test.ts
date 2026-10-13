import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// git: 安装编排壳的纪律测试（仓库根 package.json + .pi-git-install.mjs）。
// 背景：pi 的 git/本地安装只在安装根解析 pi 清单与执行依赖安装，包本体在
// jero-pi/ 子目录——根壳镜像子包清单 + postinstall 装子包依赖。镜像即重复，
// 漂移即静默半装载，故以测试钉住等价性；守卫的跳过路径一并钉住（无网络面）。

const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const REPO_ROOT = dirname(PACKAGE_ROOT);

function readJson(path: string): Record<string, unknown> {
	return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

test("根壳 pi 清单与子包清单零漂移（镜像唯一前缀差异）", () => {
	const root = readJson(join(REPO_ROOT, "package.json")).pi as Record<string, string[] | string>;
	const sub = readJson(join(PACKAGE_ROOT, "package.json")).pi as Record<string, string[] | string>;
	assert.deepEqual(Object.keys(root).sort(), Object.keys(sub).sort(), "清单键面必须一致");
	for (const key of Object.keys(sub)) {
		const subValue = sub[key];
		const rootValue = root[key];
		if (typeof subValue === "string") {
			assert.equal(rootValue, `jero-pi/${subValue}`, `镜像字段 ${key} 应带 jero-pi/ 前缀`);
			continue;
		}
		assert.deepEqual(
			rootValue,
			subValue.map((entry) => (entry.startsWith("./") ? `jero-pi/${entry.slice(2)}` : `jero-pi/${entry}`)),
			`镜像字段 ${key} 逐项等于子包值加 jero-pi/ 前缀`,
		);
	}
});

test("守卫跳过：jero-pi/node_modules 已有宿主时 postinstall 零动作", () => {
	const cwd = mkdtempSync(join(tmpdir(), "jero-pi-git-shell-"));
	try {
		mkdirSync(join(cwd, "jero-pi", "node_modules", "@earendil-works", "pi-coding-agent"), { recursive: true });
		const result = spawnSync(process.execPath, [join(REPO_ROOT, ".pi-git-install.mjs")], {
			cwd,
			encoding: "utf8",
			timeout: 30_000,
		});
		assert.ifError(result.error);
		assert.equal(result.status, 0, `stdout=${result.stdout} stderr=${result.stderr}`);
		assert.match(result.stdout, /跳过/, "守卫应明示跳过而非静默");
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});
