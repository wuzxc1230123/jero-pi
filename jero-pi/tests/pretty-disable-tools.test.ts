import assert from "node:assert/strict";
import test from "node:test";
import { mergePrettyDisableTools, PRETTY_CONFLICTING_TOOLS } from "../lib/pretty-disable-tools.ts";

test("the conflicting tool set is exactly the pi-pretty/hashline overlap", () => {
	assert.deepEqual(PRETTY_CONFLICTING_TOOLS, ["read", "grep"]);
});

test("mergePrettyDisableTools seeds an absent list with the conflicting tools", () => {
	assert.equal(mergePrettyDisableTools(undefined), "read,grep");
	assert.equal(mergePrettyDisableTools(""), "read,grep");
});

test("mergePrettyDisableTools preserves operator entries, trims and dedupes", () => {
	assert.equal(mergePrettyDisableTools("bash"), "bash,read,grep");
	assert.equal(mergePrettyDisableTools(" bash , read "), "bash,read,grep");
	assert.equal(mergePrettyDisableTools("grep,ls"), "grep,ls,read");
});
