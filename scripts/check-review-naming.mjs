#!/usr/bin/env node
// jero-pi review-domain naming ratchet. The review domain is split across
// three naming families — a fossil of the staged gentle-pi port:
//
//   lib/authority/        the trust-boundary core (pure, no IO, gated by
//                         check-authority-boundary.mjs) — the destination
//                         for new review domain logic;
//   lib/review-*.ts       host-side review peripherals;
//   lib/jero-ai-review-*  jero-ai extension-adapter review helpers.
//
// Full-rename convergence is a tracked migration; until it lands, this gate
// freezes the two peripheral prefixes at their recorded maxima so the split
// cannot grow while nobody is looking. Decreases ratchet down via --update
// (same discipline as scripts/types-baseline.json). Growth must either move
// the code into lib/authority/ (preferred) or record an explicit decision by
// updating the baseline.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(fileURLToPath(new URL("..", import.meta.url)));
const BASELINE_PATH = join(root, "scripts", "review-naming-baseline.json");

// authority/ 是收敛目的地，不设上限；两个外围前缀钉住上限。
const PERIPHERAL_BUCKETS = ["review", "jeroAiReview"];

function collectCounts() {
	const lib = readdirSync(join(root, "lib"), { withFileTypes: true })
		.filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
		.map((entry) => entry.name);
	const authority = readdirSync(join(root, "lib", "authority"))
		.filter((name) => name.endsWith(".ts")).length;
	return {
		authority,
		review: lib.filter((name) => /^review-.*\.ts$/.test(name)).length,
		jeroAiReview: lib.filter((name) => /^jero-ai-review-.*\.ts$/.test(name)).length,
	};
}

function main() {
	const write = process.argv.includes("--update");
	const counts = collectCounts();
	const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
	const failures = [];
	for (const bucket of PERIPHERAL_BUCKETS) {
		const recorded = baseline[bucket];
		if (typeof recorded !== "number") {
			failures.push(`baseline is missing the ${bucket} bucket`);
			continue;
		}
		if (counts[bucket] > recorded) {
			failures.push(`${bucket} grew: ${counts[bucket]} files vs recorded maximum ${recorded}`);
		}
	}
	if (write) {
		writeFileSync(BASELINE_PATH, `${JSON.stringify(counts, null, "\t")}\n`, "utf8");
		console.log(`review naming baseline updated: authority=${counts.authority}, review=${counts.review}, jeroAiReview=${counts.jeroAiReview}.`);
		return;
	}
	if (failures.length > 0) {
		console.error("jero-pi review-domain naming ratchet tripped:");
		for (const failure of failures) console.error(`- ${failure}`);
		console.error("\nNew review logic belongs in lib/authority/ (pure domain) — or record the decision:");
		console.error("  node scripts/check-review-naming.mjs --update");
		process.exit(1);
	}
	console.log(`review naming within recorded maxima (authority=${counts.authority} destination, review=${counts.review}, jeroAiReview=${counts.jeroAiReview}).`);
}

const isMainModule = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
	main();
}

export { collectCounts };
