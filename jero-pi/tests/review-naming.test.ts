// 评审域命名棘轮（scripts/check-review-naming.mjs）的行为测试：两个外围
// 前缀（review-*、jero-ai-review-*）钉在基线最大值上只降不升，authority/
// 是收敛目的地不设上限；打包链必须包含该门。命名三分是 gentle-pi 分阶段
// 移植的化石，此门保证它在收敛迁移落地前不再悄悄生长。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { collectCounts } from "../scripts/check-review-naming.mjs";

const PACKAGE_ROOT = join(fileURLToPath(new URL("..", import.meta.url)));

test("peripheral review naming prefixes stay within the recorded maxima", () => {
	const counts = collectCounts();
	const baseline = JSON.parse(readFileSync(join(PACKAGE_ROOT, "scripts", "review-naming-baseline.json"), "utf8"));
	for (const bucket of ["review", "jeroAiReview"] as const) {
		assert.ok(
			counts[bucket] <= baseline[bucket],
			`${bucket} grew to ${counts[bucket]} files (baseline maximum ${baseline[bucket]}) — move the code into lib/authority/ or record the decision with --update`,
		);
	}
	assert.ok(counts.authority > 0, "the authority destination bucket must keep resolving");
});

test("pack and publish chains include the review naming ratchet", () => {
	const pkg = JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8"));
	assert.match(pkg.scripts?.["check:review-naming"] ?? "", /check-review-naming\.mjs/);
	assert.match(pkg.scripts?.prepack ?? "", /check:review-naming/);
	assert.match(pkg.scripts?.prepublishOnly ?? "", /check:review-naming/);
});
