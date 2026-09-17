import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reviewGitEnvironment } from "../review-repository.ts";
import { jeroDomainHash } from "./canonical.ts";
import type { JeroAuthorityContextV1 } from "./review.ts";
import type { JeroFixApplicationV1 } from "./finalize.ts";
import { readJeroSnapshotRecordV1 } from "./snapshots.ts";

// `authority.fix.derive` (Q-B): the bounded-edit application facts for the
// CURRENT worktree, authored against the ORIGINAL review tree so the budget
// is charged relative to the reviewed candidate (F5). The worktree is never
// mutated — the correction is staged into an isolated GIT_INDEX_FILE whose
// objects land in the snapshot's isolated store, making the fix tree visible
// to finalize's own re-derivation (deriveJeroCorrectionLinesV1) without any
// caller-declared fact being trusted (§9.2: actor output is untrusted data).

export type JeroFixApplicationOutcomeV1 =
	| { readonly kind: "ok"; readonly fix: JeroFixApplicationV1 }
	| { readonly kind: "refused"; readonly code: "lineage-missing" | "corrupted" | "not-fixing" | "derivation-failed"; readonly detail?: string };

export function deriveJeroFixApplicationV1(context: JeroAuthorityContextV1, lineageId: string, repositoryRoot: string): JeroFixApplicationOutcomeV1 {
	const loaded = context.lineages.load(lineageId);
	if (loaded.kind === "missing") return { kind: "refused", code: "lineage-missing", detail: `lineage ${lineageId} does not exist` };
	if (loaded.kind === "corrupted") return { kind: "refused", code: "corrupted", detail: loaded.detail };
	const state = loaded.record.state;
	if (state.state !== "fixing") return { kind: "refused", code: "not-fixing", detail: `fix derivation requires the fixing state (lineage is in ${state.state})` };
	const snapshot = readJeroSnapshotRecordV1(context.store.store_root, state.snapshot.identity);
	const staging = mkdtempSync(join(tmpdir(), "jero-fix-application-"));
	const delimiter = process.platform === "win32" ? ";" : ":";
	const run = (args: readonly string[], environment: NodeJS.ProcessEnv): string =>
		execFileSync("git", [...args], { cwd: repositoryRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...reviewGitEnvironment(), ...environment } }).trim();
	try {
		const indexEnvironment = {
			GIT_INDEX_FILE: join(staging, "index"),
			GIT_OBJECT_DIRECTORY: snapshot.object_store.object_directory,
			GIT_ALTERNATE_OBJECT_DIRECTORIES: snapshot.object_store.alternate_object_directory,
		};
		run(["read-tree", state.initial_review_tree], indexEnvironment);
		run(["add", "-A", "--", "."], indexEnvironment);
		const tree = run(["write-tree"], indexEnvironment);
		const diffEnvironment = { GIT_ALTERNATE_OBJECT_DIRECTORIES: `${snapshot.object_store.object_directory}${delimiter}${snapshot.object_store.alternate_object_directory}` };
		const numstat = run(["diff", "--numstat", "--no-renames", state.initial_review_tree, tree], diffEnvironment);
		let lines = 0;
		const paths: string[] = [];
		for (const line of numstat.split(/\r?\n/).filter(Boolean)) {
			const [added, deleted, path] = line.split("\t");
			lines += Number.parseInt(added ?? "0", 10) + Number.parseInt(deleted ?? "0", 10);
			if (path !== undefined) paths.push(path);
		}
		return {
			kind: "ok",
			fix: {
				candidate_tree: tree,
				fix_delta_hash: jeroDomainHash("fix-delta", { base: state.initial_review_tree, tree }),
				correction_paths: paths,
				actual_correction_lines: lines,
			},
		};
	} catch (error) {
		return { kind: "refused", code: "derivation-failed", detail: error instanceof Error ? error.message : String(error) };
	} finally {
		rmSync(staging, { recursive: true, force: true });
	}
}
