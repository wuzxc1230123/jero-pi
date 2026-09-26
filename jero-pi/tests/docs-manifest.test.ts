// 文档清单门（scripts/check-docs-manifest.mjs）的行为测试：门必须在
// 当前仓库状态下通过（漂移 = 测试失败，本地 pnpm test 即可发现，不必等
// CI），且打包链必须包含该门——历史上命令/工具计数已经漂移过多次
//（22↔24↔25，subagent_continue 一度从文档消失），这是把单一事实源
// 从文档挪回注册点的钉子。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { checkDocsManifest } from "../scripts/check-docs-manifest.mjs";

const PACKAGE_ROOT = join(fileURLToPath(new URL("..", import.meta.url)));

test("docs manifest gate passes against the current repository state", () => {
	const verdict = checkDocsManifest();
	assert.equal(
		verdict.ok,
		true,
		`docs/jero-reference.md drifted from the registration points:\n- ${[...verdict.problems, ...verdict.failures].join("\n- ")}`,
	);
	assert.ok(verdict.counts!.commands > 0 && verdict.counts!.tools > 0 && verdict.counts!.skills > 0);
});

test("pack and publish chains include the docs manifest gate", () => {
	const pkg = JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8"));
	assert.match(pkg.scripts?.["check:docs-manifest"] ?? "", /check-docs-manifest\.mjs/);
	assert.match(pkg.scripts?.prepack ?? "", /check:docs-manifest/);
	assert.match(pkg.scripts?.prepublishOnly ?? "", /check:docs-manifest/);
});

test("the generated manifest block pins the historically drifted surfaces", () => {
	const doc = readFileSync(join(PACKAGE_ROOT, "docs", "jero-reference.md"), "utf8");
	const begin = doc.indexOf("<!-- jero:manifest:begin");
	const end = doc.indexOf("<!-- jero:manifest:end -->");
	assert.ok(begin !== -1 && end > begin, "the generated block must exist");
	const block = doc.slice(begin, end);
	assert.match(block, /`subagent_continue`/, "subagent_continue once vanished from the docs; the block must carry it");
	assert.match(block, /`\/jero:install-delegation` `\/jero:install-review` `\/jero:install-sdd`/, "the template-registered install commands must each count");
});
