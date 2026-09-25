import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	BANNER_COLORS,
	type BannerConfig,
	normalizeAscii,
	padLines,
	paletteColor,
	readBannerConfig,
	rgb,
	writeBannerConfig,
} from "../lib/banner-config.ts";

test("normalizeAscii strips common indent and trailing whitespace", () => {
	assert.deepEqual(normalizeAscii(["    rose", "    bloom", "   "]), ["rose", "bloom", ""]);
	assert.deepEqual(normalizeAscii(["  a", "b"]), ["  a", "b"], "uncommon indent is preserved");
	assert.deepEqual(normalizeAscii([]), []);
});

test("padLines evens lines to the widest entry", () => {
	assert.deepEqual(padLines(["a", "ccc"]), { lines: ["a  ", "ccc"], width: 3 });
});

test("palette helpers emit 24-bit ANSI wrapping", () => {
	assert.equal(rgb(1, 2, 3, "x"), "\x1b[38;2;1;2;3mx\x1b[39m");
	assert.equal(paletteColor("cyan", "rose", "R"), rgb(95, 210, 255, "R"));
	assert.deepEqual(BANNER_COLORS, ["pink", "cyan", "yellow", "green"]);
});

test("banner config round-trips through the config home and falls back to defaults", async () => {
	const previous = process.env.JERO_PI_CONFIG_HOME;
	const home = mkdtempSync(join(tmpdir(), "jero-banner-config-"));
	process.env.JERO_PI_CONFIG_HOME = home;
	try {
		assert.deepEqual(await readBannerConfig(), { showRose: true, showTextLogo: true, color: "pink" }, "missing file falls back to defaults");

		const config: BannerConfig = { showRose: false, showTextLogo: true, color: "cyan" };
		await writeBannerConfig(config);
		assert.deepEqual(await readBannerConfig(), config);

		await writeBannerConfig({ showRose: true, showTextLogo: false, color: "nope" as BannerConfig["color"] });
		assert.deepEqual(await readBannerConfig(), { showRose: true, showTextLogo: false, color: "pink" }, "unknown colors fall back to pink");
	} finally {
		if (previous === undefined) delete process.env.JERO_PI_CONFIG_HOME;
		else process.env.JERO_PI_CONFIG_HOME = previous;
		rmSync(home, { recursive: true, force: true });
	}
});
