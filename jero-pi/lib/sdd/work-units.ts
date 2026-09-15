// Deterministic work-unit graph validation for SDD tasks (jero-pi P1-B,
// conservative path). Parses the `### Work unit:` blocks that sdd-tasks
// emits and turns them into a verifiable boundary: labels are unique,
// dependencies exist and are acyclic, and file sets of independent units
// stay disjoint. The result is a serial topological order the orchestrator
// can launch without model self-assessment. Fail-closed: any malformed or
// contradictory input reports issues instead of a partial order.

export interface WorkUnit {
	label: string;
	files: string[];
	spec: string[];
	depends: string[];
	headingLine: number;
}

export type WorkUnitIssue =
	| { code: "duplicate-label"; label: string; line: number }
	| { code: "empty-label"; line: number }
	| { code: "empty-files"; label: string; line: number }
	| { code: "empty-spec"; label: string; line: number }
	| { code: "malformed-depends"; label: string; line: number; raw: string }
	| { code: "unknown-dependency"; label: string; depends: string }
	| { code: "self-dependency"; label: string }
	| { code: "cycle"; labels: string[] }
	| { code: "file-overlap"; file: string; labels: [string, string] };

export interface WorkUnitParseResult {
	units: WorkUnit[];
	issues: WorkUnitIssue[];
}

export interface WorkUnitValidation {
	ok: boolean;
	issues: WorkUnitIssue[];
	/** Deterministic topological order (first-appearance tie-break). Empty when not ok. */
	order: string[];
}

const HEADING = /^###\s+Work unit:\s*(.*)$/;
const DEPENDS = /^Depends:\s*(.*)$/;
const BULLET = /^-\s+(\S.*)$/;

// Repo-relative canonical form: forward slashes, no leading "./".
function normalizePath(raw: string): string {
	return raw.trim().replace(/\\/g, "/").replace(/^\.\//, "");
}

export function parseWorkUnits(markdown: string): WorkUnitParseResult {
	const units: WorkUnit[] = [];
	const issues: WorkUnitIssue[] = [];
	const lines = markdown.split(/\r?\n/);
	let current: WorkUnit | null = null;
	let field: "files" | "spec" | null = null;

	const closeUnit = () => {
		if (!current) return;
		if (current.files.length === 0) issues.push({ code: "empty-files", label: current.label, line: current.headingLine });
		if (current.spec.length === 0) issues.push({ code: "empty-spec", label: current.label, line: current.headingLine });
		current = null;
		field = null;
	};

	for (let index = 0; index < lines.length; index++) {
		const line = lines[index];
		const heading = HEADING.exec(line);
		if (heading) {
			closeUnit();
			const label = heading[1].trim();
			if (label === "") {
				issues.push({ code: "empty-label", line: index + 1 });
				continue;
			}
			current = { label, files: [], spec: [], depends: [], headingLine: index + 1 };
			units.push(current);
			field = null;
			continue;
		}
		// Any other heading ends the block; unit field lines never contain "#".
		if (/^#{1,6}\s/.test(line)) {
			closeUnit();
			continue;
		}
		if (!current) continue;
		if (line.startsWith("Files:")) {
			field = "files";
			continue;
		}
		if (line.startsWith("Spec:")) {
			field = "spec";
			continue;
		}
		const depends = DEPENDS.exec(line);
		if (depends) {
			field = null;
			const raw = depends[1].trim();
			if (raw === "" ) {
				issues.push({ code: "malformed-depends", label: current.label, line: index + 1, raw });
			} else if (raw.toLowerCase() === "none") {
				// no dependencies
			} else {
				for (const name of raw.split(",")) {
					const trimmed = name.trim();
					if (trimmed === "") issues.push({ code: "malformed-depends", label: current.label, line: index + 1, raw });
					else if (!current.depends.includes(trimmed)) current.depends.push(trimmed);
				}
			}
			continue;
		}
		const bullet = BULLET.exec(line);
		if (bullet && field) {
			const value = field === "files" ? normalizePath(bullet[1]) : bullet[1].trim();
			const list = field === "files" ? current.files : current.spec;
			if (!list.includes(value)) list.push(value);
			continue;
		}
		if (line.trim() !== "") field = null;
	}
	closeUnit();
	return { units, issues };
}

// Two units are dependency-connected when a Depends path exists in either
// direction; only independent units must keep disjoint file sets.
function connected(units: Map<string, WorkUnit>): (a: string, b: string) => boolean {
	const reach = (from: string, seen: Set<string> = new Set()): Set<string> => {
		if (seen.has(from)) return seen;
		seen.add(from);
		for (const next of units.get(from)?.depends ?? []) reach(next, seen);
		return seen;
	};
	return (a, b) => reach(a).has(b) || reach(b).has(a);
}

export function validateWorkUnitGraph(units: WorkUnit[]): WorkUnitValidation {
	const issues: WorkUnitIssue[] = [];
	const byLabel = new Map<string, WorkUnit>();
	for (const unit of units) {
		if (byLabel.has(unit.label)) issues.push({ code: "duplicate-label", label: unit.label, line: unit.headingLine });
		else byLabel.set(unit.label, unit);
	}
	for (const unit of units) {
		for (const depends of unit.depends) {
			if (depends === unit.label) issues.push({ code: "self-dependency", label: unit.label });
			else if (!byLabel.has(depends)) issues.push({ code: "unknown-dependency", label: unit.label, depends });
		}
	}

	// Cycle detection: DFS with an explicit stack; report one cycle per run.
	const state = new Map<string, "visiting" | "done">();
	const reportCycle = (path: string[]) => issues.push({ code: "cycle", labels: path });
	const visit = (label: string, stack: string[]) => {
		const mark = state.get(label);
		if (mark === "done") return;
		if (mark === "visiting") {
			const start = stack.indexOf(label);
			reportCycle([...stack.slice(start), label]);
			return;
		}
		state.set(label, "visiting");
		const next = byLabel.get(label)?.depends ?? [];
		for (const dependency of next) if (byLabel.has(dependency)) visit(dependency, [...stack, label]);
		state.set(label, "done");
	};
	for (const unit of units) visit(unit.label, []);

	// File-overlap: independent units may not claim the same edit boundary.
	if (issues.length === 0) {
		const isConnected = connected(byLabel);
		const owner = new Map<string, string>();
		for (const unit of units) {
			for (const file of unit.files) {
				const previous = owner.get(file);
				if (previous === undefined) {
					owner.set(file, unit.label);
					continue;
				}
				if (!isConnected(previous, unit.label)) {
					issues.push({ code: "file-overlap", file, labels: [previous, unit.label] });
				}
			}
		}
	}

	const ok = issues.length === 0;
	if (!ok) return { ok, issues, order: [] };

	// Kahn topological order with first-appearance tie-break keeps the
	// output stable across runs for the same tasks.md.
	const pending = new Map(units.map((unit) => [unit.label, new Set(unit.depends)]));
	const order: string[] = [];
	while (pending.size > 0) {
		const ready = units.filter((unit) => pending.has(unit.label) && pending.get(unit.label)!.size === 0).map((unit) => unit.label);
		// A stuck graph here means a cycle the DFS above already reported;
		// ok=true guarantees progress, but fail closed rather than loop.
		if (ready.length === 0) return { ok: false, issues: [...issues, { code: "cycle", labels: [...pending.keys()] }], order: [] };
		for (const label of ready) {
			order.push(label);
			pending.delete(label);
		}
		for (const deps of pending.values()) for (const label of ready) deps.delete(label);
	}
	return { ok, issues, order };
}
