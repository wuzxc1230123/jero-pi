import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// 控制器帮助文案经拆分横跨装配区与评审参数模块，两处合并断言。
const CONTROLLER = [
	readFileSync("extensions/jero-ai.ts", "utf8"),
	readFileSync("lib/jero-ai-review-params.ts", "utf8"),
].join("\n");

test("controller help keeps authorization, blocked outcomes, and recovery boundaries explicit", () => {
	assert.match(CONTROLLER, /legacy quarantine and alias-repair routes are retired/is);
	assert.match(CONTROLLER, /unchanged_target,malformed_recovery_authorization/);
	assert.match(CONTROLLER, /provider-selected recovery disposition/);
	assert.match(CONTROLLER, /headlessly|headless/i);
	assert.match(CONTROLLER, /quarantine.*invalid recovery successor/i);
	assert.match(CONTROLLER, /never.*RESET or RECOVER/is);
});
