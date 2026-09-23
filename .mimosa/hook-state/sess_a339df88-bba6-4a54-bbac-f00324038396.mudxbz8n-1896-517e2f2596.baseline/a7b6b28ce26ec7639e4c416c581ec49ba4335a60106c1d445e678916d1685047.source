import assert from "node:assert/strict";
import test from "node:test";
import { __testing } from "../extensions/jero-ai.ts";

// These tests assert that the composed main-agent prompt (built by buildGentlePrompt)
// keeps the two persona language modes single-channel: neutral mode carries the
// neutral/professional Simplified Chinese register with its explicit
// slang/meme/dialect prohibition and never the gentleman-only "natural,
// idiomatic" clause, while gentleman mode carries that clause and never leaks
// the neutral-only prohibition. (The persona prompts themselves are
// Simplified Chinese since the i18n pass.)

const GENTLEMAN_CLAUSE = /用户使用中文时，用自然、地道的简体中文回答/;
const NEUTRAL_PROHIBITION = /不使用网络俚语/;

test("neutral mode composed prompt does not instruct to answer in natural, idiomatic Chinese", () => {
	const prompt = __testing.buildGentlePrompt("neutral");
	// The neutral prompt must never tell the model to USE the gentleman register
	assert.doesNotMatch(
		prompt,
		GENTLEMAN_CLAUSE,
		"neutral prompt must not carry the gentleman-only natural-Chinese clause",
	);
	assert.doesNotMatch(
		prompt,
		/用自然、地道的简体中文回答/,
		"neutral prompt must not describe natural Chinese as the language mode to use",
	);
});

test("neutral mode composed prompt has no positive natural-Chinese instruction and includes explicit prohibition", () => {
	const prompt = __testing.buildGentlePrompt("neutral");
	// Any sentence that affirmatively tells the model to answer in natural,
	// idiomatic Chinese must be absent. The prohibition line ("不使用网络俚语、梗或方言表达")
	// is the only allowed register restriction, and it must remain present so
	// the model knows which register to avoid.
	assert.doesNotMatch(
		prompt,
		/语言：用户使用中文时，用自然、地道的简体中文/,
		"neutral prompt must not contain a positive natural-Chinese language-boundary directive",
	);
	assert.match(
		prompt,
		NEUTRAL_PROHIBITION,
		"neutral prompt must explicitly prohibit internet slang, memes, and dialect expressions",
	);
});

test("gentleman mode composed prompt contains the natural-Chinese clause", () => {
	const prompt = __testing.buildGentlePrompt("gentleman");
	assert.match(
		prompt,
		GENTLEMAN_CLAUSE,
		"gentleman prompt must reference natural, idiomatic Simplified Chinese",
	);
});

test("gentleman mode composed prompt does not leak the neutral-only prohibition", () => {
	const prompt = __testing.buildGentlePrompt("gentleman");
	assert.doesNotMatch(
		prompt,
		NEUTRAL_PROHIBITION,
		"gentleman prompt must not carry the neutral-only slang prohibition",
	);
});

test("neutral mode composed prompt explicitly states active mode is neutral", () => {
	const prompt = __testing.buildGentlePrompt("neutral");
	assert.match(
		prompt,
		/Current persona mode: neutral/i,
		"neutral prompt must state active mode is neutral",
	);
});

test("gentleman mode composed prompt explicitly states active mode is gentleman", () => {
	const prompt = __testing.buildGentlePrompt("gentleman");
	assert.match(
		prompt,
		/Current persona mode: gentleman/i,
		"gentleman prompt must state active mode is gentleman",
	);
});

test("neutral mode composed prompt explicitly forbids slang, memes, and dialect expressions", () => {
	const prompt = __testing.buildGentlePrompt("neutral");
	// The neutral persona prompt must explicitly forbid casual-register markers
	assert.match(
		prompt,
		NEUTRAL_PROHIBITION,
		"neutral prompt must explicitly forbid casual register markers",
	);
});

test("neutral and gentleman modes produce different language-boundary text", () => {
	const neutralPrompt = __testing.buildGentlePrompt("neutral");
	const gentlemanPrompt = __testing.buildGentlePrompt("gentleman");

	// The language-boundary section must differ between modes
	assert.notEqual(
		neutralPrompt,
		gentlemanPrompt,
		"neutral and gentleman prompts must differ",
	);

	// Neutral must not include the gentleman language-boundary line
	assert.doesNotMatch(
		neutralPrompt,
		/语言：用户使用中文时，用自然、地道的简体中文/,
		"neutral prompt must not contain the gentleman natural-Chinese language-boundary instruction",
	);

	// Gentleman must contain the natural-Chinese language-boundary line
	assert.match(
		gentlemanPrompt,
		/语言：用户使用中文时，用自然、地道的简体中文回答。/,
		"gentleman prompt must contain the natural-Chinese language-boundary instruction",
	);
});
