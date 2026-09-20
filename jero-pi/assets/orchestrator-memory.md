# Orchestrator — Memory Detail (lazy-loaded)

Bind this to the parent Pi session only, on SDD phase memory reads/writes. Not always-on; loaded on demand from `assets/orchestrator.md`'s `## Memory Contract` pointer.

### SDD phases

Each SDD phase subagent reads its own required inputs directly from the active backend; the parent passes artifact references (topic keys or file paths), NOT the content itself. Phase subagents persist their artifact before returning.

| Phase          | Reads                                                   | Writes           |
| -------------- | ------------------------------------------------------- | ---------------- |
| `sdd-explore`  | nothing                                                 | `explore`        |
| `sdd-research` | exploration                                             | `research` + `preproposal` |
| `sdd-proposal` | exploration (optional)                                  | `proposal`       |
| `sdd-spec`     | proposal (required)                                     | `spec`           |
| `sdd-design`   | proposal (required)                                     | `design`         |
| `sdd-tasks`    | spec + design (required)                                | `tasks`          |
| `sdd-apply`    | tasks + spec + design + `apply-progress` (if it exists) | `apply-progress` |
| `sdd-verify`   | spec + tasks + `apply-progress`                         | `verify-report`  |
| `sdd-sync`     | proposal + spec + design + tasks + `verify-report`      | `sync-report`    |
| `sdd-archive`  | all artifacts                                           | `archive-report` |
| `sdd-status`   | change artifacts (read-only)                            | nothing          |

- SDD artifact keys: in memory/hybrid mode, phase artifacts use stable topic keys such as `sdd/<change>/proposal`, `sdd/<change>/spec`, `sdd/<change>/design`, `sdd/<change>/tasks`, `sdd/<change>/apply-progress`, `sdd/<change>/verify-report`, `sdd/<change>/sync-report`, and `sdd/<change>/archive-report`.
- When the optional research lane is selected, `sdd-research` uses the additional topic keys `sdd/<change>/research` and `sdd/<change>/preproposal` (openspec: `openspec/changes/<change>/research.md`).
- If memory tools are unavailable, do not pretend persistence exists; return artifacts inline and/or write OpenSpec files.

Memory lifecycle rule (jero-pi's built-in memory has no lifecycle tooling):

- jero-pi's `mem_*` store carries no review lifecycle metadata or tools: each topic holds one snapshot with a `saved_at` frontmatter, and saving the same topic again replaces the entry (last write wins).
- At session start or before architecture-sensitive work, list the current project's topics with `mem_list` (for example prefix `sdd/<change>/`) so stale context is visible before it is relied on.
- An entry is only as current as its `saved_at` stamp and the evidence behind it. Treat out-of-date memories as stale context, not trusted facts.
- When a retrieved memory looks stale relative to the work at hand, surface that stale context to the user and verify it against current evidence before relying on it.
- There is no `mark_reviewed` action and no memory maintenance command; never claim to have marked, reviewed, promoted, or expired a memory entry.
