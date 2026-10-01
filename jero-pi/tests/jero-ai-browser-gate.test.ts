// jero-ai-browser-gate 单元测试：策略串解析（off/allow/deny/invalid 四态）、
// 域名匹配语义（裸域含子域、前导点仅子域）、fail-closed 边界（无法解析
// 主机名在 allow 模式阻断、配置写错按 invalid 阻断而非静默拆门）、门面
// 约定（仅 browser_ 前缀且携带非空字符串 url 的调用受门管辖）。

import assert from "node:assert/strict";
import test from "node:test";

import {
	browserCompanionEngineDiagnostic,
	evaluateBrowserDomainGate,
	parseBrowserDomainPolicy,
	resolveBrowserDomainPolicy,
	type BrowserDomainPolicy,
} from "../lib/jero-ai-browser-gate.ts";

const OFF: BrowserDomainPolicy = { mode: "off" };

test("unset or blank policy strings mean no gate", () => {
	assert.deepEqual(parseBrowserDomainPolicy(undefined), OFF);
	assert.deepEqual(parseBrowserDomainPolicy(""), OFF);
	assert.deepEqual(parseBrowserDomainPolicy("   "), OFF);
});

test("allow/deny lists parse with normalization across separators and case", () => {
	assert.deepEqual(parseBrowserDomainPolicy("allow:Example.COM"), { mode: "allow", domains: ["example.com"] });
	assert.deepEqual(parseBrowserDomainPolicy(" DENY : a.com , .B.org ;c.net "), {
		mode: "deny",
		domains: ["a.com", ".b.org", "c.net"],
	});
	assert.deepEqual(parseBrowserDomainPolicy("allow:localhost"), { mode: "allow", domains: ["localhost"] });
});

test("malformed policy strings fail closed as invalid, never silently off", () => {
	assert.deepEqual(parseBrowserDomainPolicy("banana"), { mode: "invalid", raw: "banana" });
	assert.deepEqual(parseBrowserDomainPolicy("allow:"), { mode: "invalid", raw: "allow:" });
	assert.deepEqual(parseBrowserDomainPolicy("allow:,, "), { mode: "invalid", raw: "allow:,," });
	assert.deepEqual(parseBrowserDomainPolicy("allow:a..com"), { mode: "invalid", raw: "allow:a..com" });
	assert.deepEqual(parseBrowserDomainPolicy("deny:*. wildcard"), { mode: "invalid", raw: "deny:*. wildcard" });
});

test("policy resolution reads the injected environment", () => {
	assert.deepEqual(resolveBrowserDomainPolicy({}), OFF);
	assert.deepEqual(
		resolveBrowserDomainPolicy({ JERO_PI_BROWSER_DOMAINS: "allow:corp.example" }),
		{ mode: "allow", domains: ["corp.example"] },
	);
});

test("gate scope: only browser_-prefixed tools with a non-empty string url are judged", () => {
	const allow = parseBrowserDomainPolicy("allow:example.com")!;
	assert.equal(evaluateBrowserDomainGate(allow, "web_fetch", { url: "https://evil.example" }).action, "ignore");
	assert.equal(evaluateBrowserDomainGate(allow, "browser_take_snapshot", {}).action, "ignore");
	assert.equal(evaluateBrowserDomainGate(allow, "browser_navigate_page", { url: "" }).action, "ignore");
	assert.equal(evaluateBrowserDomainGate(allow, "browser_navigate_page", { url: 42 }).action, "ignore");
	assert.equal(evaluateBrowserDomainGate(allow, "browser_navigate_page", "not-a-record").action, "ignore");
});

test("off policy ignores every navigation", () => {
	assert.equal(evaluateBrowserDomainGate(OFF, "browser_navigate_page", { url: "https://evil.example" }).action, "ignore");
});

test("allow mode: bare entry matches apex and subdomains, leading-dot entry only subdomains", () => {
	const bare = parseBrowserDomainPolicy("allow:example.com")!;
	assert.equal(evaluateBrowserDomainGate(bare, "browser_navigate_page", { url: "https://example.com/x" }).action, "ignore");
	assert.equal(evaluateBrowserDomainGate(bare, "browser_new_page", { url: "https://app.example.com/" }).action, "ignore");
	// 端口不属于主机名判定面。
	assert.equal(evaluateBrowserDomainGate(bare, "browser_navigate_page", { url: "https://example.com:8443/x" }).action, "ignore");
	const blocked = evaluateBrowserDomainGate(bare, "browser_navigate_page", { url: "https://evil.example.net/" });
	assert.equal(blocked.action, "block");
	assert.match(blocked.reason, /evil\.example\.net 不在允许清单内/);

	const dotted = parseBrowserDomainPolicy("allow:.example.com")!;
	assert.equal(evaluateBrowserDomainGate(dotted, "browser_navigate_page", { url: "https://app.example.com/" }).action, "ignore");
	const apexBlocked = evaluateBrowserDomainGate(dotted, "browser_navigate_page", { url: "https://example.com/" });
	assert.equal(apexBlocked.action, "block");
});

test("allow mode fails closed on navigation targets without a parseable host", () => {
	const allow = parseBrowserDomainPolicy("allow:example.com")!;
	const decision = evaluateBrowserDomainGate(allow, "browser_navigate_page", { url: "just some search words" });
	assert.equal(decision.action, "block");
	assert.match(decision.reason, /无法解析出主机名/);
});

test("deny mode blocks listed hosts and lets unlisted or hostless targets through", () => {
	const deny = parseBrowserDomainPolicy("deny:evil.example,.tracker.net")!;
	const hit = evaluateBrowserDomainGate(deny, "browser_navigate_page", { url: "https://sub.evil.example/payload" });
	assert.equal(hit.action, "block");
	assert.match(hit.reason, /命中拒绝清单/);
	const tracker = evaluateBrowserDomainGate(deny, "browser_new_page", { url: "https://sub.tracker.net/pixel" });
	assert.equal(tracker.action, "block");
	// 前导点条目仅匹配子域：裸域 tracker.net 不在拒绝面上。
	assert.equal(evaluateBrowserDomainGate(deny, "browser_new_page", { url: "https://tracker.net/pixel" }).action, "ignore");
	assert.equal(evaluateBrowserDomainGate(deny, "browser_navigate_page", { url: "https://good.example/" }).action, "ignore");
	assert.equal(evaluateBrowserDomainGate(deny, "browser_navigate_page", { url: "search terms" }).action, "ignore");
});

test("invalid policy blocks browser navigation with a format hint instead of disabling the gate", () => {
	const invalid = parseBrowserDomainPolicy("allow:typo..com")!;
	const decision = evaluateBrowserDomainGate(invalid, "browser_navigate_page", { url: "https://example.com/" });
	assert.equal(decision.action, "block");
	assert.match(decision.reason, /JERO_PI_BROWSER_DOMAINS/);
	assert.match(decision.reason, /allow:example\.com/);
	assert.equal(evaluateBrowserDomainGate(invalid, "bash", { command: "ls" }).action, "ignore");
});

test("hostnames are compared case-insensitively through URL parsing", () => {
	const deny = parseBrowserDomainPolicy("deny:Evil.Example")!;
	const decision = evaluateBrowserDomainGate(deny, "browser_navigate_page", { url: "https://SUB.EVIL.EXAMPLE/x" });
	assert.equal(decision.action, "block");
});

test("engine diagnostic warns only when the browser companion is installed below its Node floor", () => {
	assert.equal(browserCompanionEngineDiagnostic(25, true), undefined);
	assert.equal(browserCompanionEngineDiagnostic(24, true), undefined);
	assert.equal(browserCompanionEngineDiagnostic(22, false), undefined, "uninstalled companion never warns");
	const warning = browserCompanionEngineDiagnostic(22, true);
	assert.match(warning!, /^warn: Companion pi-browser-use requires Node >=24/);
	assert.match(warning!, /current major is 22/);
	assert.match(warning!, /dependency-exit-plan/);
});
