// 伴生插件回归门（jero-pi P4/D5/D6）：九个伴生 pi-package 经 node_modules
// 路径进 pi manifest（"依赖存在即用"），全部精确钉版且清单引用不残留死路径；
// 被 rpiv-todo 替代的内置 todo 实现保持删除，且 jero 自有源码不再注册同名
// `todo` 工具（双实现禁令）。

import { default as assert } from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { default as test } from "node:test";
import { COMPANION_EXTENSION_REFS, COMPANION_SKILL_REFS, PACKAGE_ROOT, readPackageJson } from "./package-manifest-shared.ts";

// 审计过的伴生供应链面（设计 D5/R3：升级走单独 PR 全量测试）。任何版本
// 漂移都会在此失败，迫使升级连同本清单一起过评审，防止顺手漂浮升级。
const AUDITED_COMPANION_PINS: Record<string, string> = {
	"@heyhuynhgiabuu/pi-pretty": "0.6.14",
	"@juicesharp/rpiv-ask-user-question": "2.10.1",
	"@juicesharp/rpiv-todo": "2.10.1",
	"billion-context-pi": "0.1.75",
	"pi-cache-optimizer": "2.8.10",
	"pi-fovea": "0.27.0",
	"pi-hashline-edit-pro": "4.3.6",
	"pi-lens": "4.1.6",
	"pi-web-access": "0.29.0",
};

test("pi manifest node_modules references are exactly the declared companions (no stale refs)", () => {
	const packageJson = readPackageJson();
	const extensionRefs = (packageJson.pi?.extensions ?? []).filter((ref) => ref.startsWith("node_modules/"));
	assert.deepEqual(
		[...extensionRefs].sort(),
		[...Object.values(COMPANION_EXTENSION_REFS)].sort(),
		"every node_modules extension ref in the pi manifest must be a declared companion, and vice versa",
	);
	const skillRefs = (packageJson.pi?.skills ?? []).filter((ref) => ref.startsWith("node_modules/"));
	assert.deepEqual([...skillRefs].sort(), [...COMPANION_SKILL_REFS].sort());
});

test("audited companion pins stay frozen until a deliberate upgrade PR", () => {
	const packageJson = readPackageJson();
	for (const [name, version] of Object.entries(AUDITED_COMPANION_PINS)) {
		assert.equal(packageJson.dependencies?.[name], version, `companion ${name} drifted from its audited pin`);
	}
	const installedCompanions = Object.keys(packageJson.dependencies ?? {}).filter((name) => name in AUDITED_COMPANION_PINS);
	assert.deepEqual(
		installedCompanions.sort(),
		Object.keys(AUDITED_COMPANION_PINS).sort(),
		"the audited companion set must cover exactly the companion dependencies",
	);
});

test("retired built-in todo implementation stays deleted and is gated against reintroduction", () => {
	const verifier = readFileSync(join(PACKAGE_ROOT, "scripts", "verify-package-files.mjs"), "utf8");
	for (const retired of ["extensions/jero-todo.ts", "lib/shell-todo.ts"]) {
		assert.ok(
			!existsSync(join(PACKAGE_ROOT, ...retired.split("/"))),
			`${retired} must stay deleted: the rpiv-todo companion owns the todo tool`,
		);
		assert.match(verifier, new RegExp(`"${retired.replaceAll(".", "\\.")}"`), "package verification must forbid the retired file's return");
	}
});

test("jero extensions no longer register the todo tool the rpiv-todo companion provides", () => {
	const extensionsDir = join(PACKAGE_ROOT, "extensions");
	for (const entry of readdirSync(extensionsDir)) {
		if (!entry.endsWith(".ts")) continue;
		const source = readFileSync(join(extensionsDir, entry), "utf8");
		assert.doesNotMatch(
			source,
			/\bTODO_TOOL_NAME\b|name:\s*"todo"/,
			`${entry} must not re-register the todo tool; duplicate registration would collide with the rpiv-todo companion`,
		);
	}
});

test("rpiv-todo companion keeps the todo tool name so existing session history replays", () => {
	const toolTypes = readFileSync(join(PACKAGE_ROOT, "node_modules", "@juicesharp", "rpiv-todo", "tool", "types.ts"), "utf8");
	assert.match(toolTypes, /TOOL_NAME\s*=\s*"todo"/, "sessions written under the todo tool name must keep replaying after the switch");
});
