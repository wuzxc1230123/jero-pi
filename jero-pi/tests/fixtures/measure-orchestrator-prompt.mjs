// Standalone entry point spawned as a fresh Node process by
// tests/orchestrator-budget.test.ts's realistic-path-length budget test.
//
// extensions/jero-ai.ts memoizes getOrchestratorPrompt()'s production return
// value in a module-level cache (first-read-wins for the process lifetime).
// Measuring a fixture render at a second, longer assets path therefore uses the
// test-only render helper in a genuinely separate process rather than relying
// on ambient environment variables or a second dynamic import of the same
// module specifier in an already-imported test process.
//
// Reads the fixture assets path from argv[2], imports extensions/jero-ai.ts
// fresh, and prints the rendered prompt's UTF-8 byte length to stdout.

import { join } from "node:path";
import { pathToFileURL } from "node:url";

// Windows absolute paths are not valid ESM specifiers (the default loader
// rejects the bare drive-letter protocol); always import through file URLs.
const { __testing } = await import(pathToFileURL(join(import.meta.dirname, "..", "..", "extensions", "jero-ai.ts")).href);
const assetsDir = process.argv[2];
if (!assetsDir) {
	throw new Error("usage: measure-orchestrator-prompt.mjs <assets-dir>");
}
const rendered = __testing.renderOrchestratorPrompt(assetsDir);
process.stdout.write(String(Buffer.byteLength(rendered, "utf8")));
