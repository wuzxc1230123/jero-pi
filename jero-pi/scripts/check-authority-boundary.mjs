#!/usr/bin/env node
// jero-pi authority module-boundary gate (design §9.1): lib/authority/ is the
// in-process review authority — its trust boundary is enforced structurally,
// not by convention. This replaces the per-review manual greps with a CI gate:
//   1. no import reaches extensions/ (authority must not depend on the
//      presentation layer, in either direction of control);
//   2. no process.env read (authority takes typed inputs only — environment
//      is the caller's business);
//   3. no domainHashV1 (upstream gentle-ai identity namespace — jero
//      identities use jeroDomainHash in canonical.ts exclusively).
// Plain regexes over source text: the modules are TypeScript, but the
// forbidden patterns are simple enough that a parser would add a dependency
// for no additional safety.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL("..", import.meta.url)), "lib", "authority");
const files = readdirSync(root).filter((name) => name.endsWith(".ts")).sort();

const rules = [
	// Static and dynamic imports both count: a presentation-layer dependency
	// smuggled through `await import("../extensions/x")` is the same breach.
	{ pattern: /(?:from\s+"(?:\.\.\/)*extensions\/|import\(\s*["'](?:\.\.\/)*extensions\/)/, message: "imports extensions/ (presentation layer)" },
	{ pattern: /\bprocess\.env\b/, message: "reads process.env" },
	{ pattern: /\bdomainHashV1\b/, message: "uses upstream domainHashV1 (gentle-ai identity namespace)" },
];

const violations = [];
for (const file of files) {
	// Comment-only lines are documentation ("never use domainHashV1"), not
	// usage. Inline block comments are stripped BEFORE the line filter so the
	// same-line form `/* note */ const v = process.env.X;` is still checked —
	// the line no longer hides behind a `/*` prefix.
	const code = readFileSync(join(root, file), "utf8")
		.replace(/\/\*[\s\S]*?\*\//g, " ")
		.split("\n")
		.filter((line) => !/^\s*(?:\/\/|\*)/.test(line))
		.join("\n");
	for (const rule of rules) {
		if (rule.pattern.test(code)) violations.push(`${file}: ${rule.message}`);
	}
}

if (violations.length > 0) {
	console.error("lib/authority/ boundary violations (design §9.1):");
	for (const violation of violations) console.error(`- ${violation}`);
	process.exit(1);
}

console.log(`lib/authority/ boundary clean (${files.length} modules checked).`);
