# Review Routing Specification

## Purpose

Define deterministic review depth and runtime behavior without turning review advice into a workflow gate or weakening command safety.

## Requirements

### Requirement: Deterministic route classification

The system MUST classify a diff as `trivial`, `standard`, or `full-4R`. Triviality MUST require objective evidence that every change is documentation, comments, formatting, or a string typo and that no executable or configuration content changed. Standard routing MUST select exactly one dominant-risk lens, defaulting to readability only when no stronger signal exists.

#### Scenario: Objectively trivial diff

- GIVEN every changed line is objectively trivial and no executable or configuration content changed
- WHEN the diff is classified
- THEN the route MUST be `trivial` and request zero review lenses

#### Scenario: Ambiguous executable or configuration diff

- GIVEN executable or configuration content changed and triviality cannot be proven
- WHEN the diff is classified
- THEN the route MUST fail conservatively to `standard` with exactly one dominant-risk lens

#### Scenario: Ordinary non-trivial diff

- GIVEN a non-trivial, non-hot-path diff does not require full 4R
- WHEN the diff is classified
- THEN the route MUST be `standard` with exactly one highest-impact applicable lens

### Requirement: Size and hot-path escalation

After objective-triviality evaluation, the system MUST route non-trivial hot-path diffs or diffs strictly greater than 400 changed lines to `full-4R` with risk, resilience, readability, and reliability lenses.

#### Scenario: 399 and 400 line boundaries

- GIVEN an ordinary non-trivial diff has 399 or exactly 400 changed lines
- WHEN size routing is evaluated
- THEN size alone MUST yield `standard`, not `full-4R`

#### Scenario: 401 line boundary

- GIVEN a non-trivial diff has 401 changed lines
- WHEN size routing is evaluated
- THEN the route MUST be `full-4R` with exactly four lenses

#### Scenario: Hot path

- GIVEN a hot-path diff is not objectively trivial
- WHEN risk routing is evaluated
- THEN the route MUST be `full-4R` regardless of line count

#### Scenario: Objectively trivial hot-path edit

- GIVEN the entire hot-path diff satisfies the objective triviality rule
- WHEN the diff is classified
- THEN the route MUST remain `trivial` with zero lenses

### Requirement: Pre-commit and pre-push ceiling

Pre-commit and pre-push events MUST NOT run full 4R; a non-trivial event that would otherwise be full MUST be capped at standard with one dominant-risk lens.

#### Scenario: Large or hot pre-delivery diff

- GIVEN a pre-commit or pre-push diff is non-trivial, hot-path, or greater than 400 lines
- WHEN review routing runs
- THEN it MUST request exactly one lens and MUST NOT request full 4R

### Requirement: Non-blocking safety composition

Review routing MUST emit advice without pausing, denying, or requiring a receipt. Unrelated dangerous-command confirmation MUST remain independently authoritative.

#### Scenario: Review advice does not gate a command

- GIVEN a command produces any review route and has no independent safety block
- WHEN the runtime emits review advice
- THEN command execution MUST continue without review completion or retry state

#### Scenario: Dangerous-command confirmation is preserved

- GIVEN an unrelated safety rule requires confirmation for a dangerous command
- WHEN review routing also emits advice
- THEN the safety confirmation MUST still control execution and MUST NOT be bypassed by routing

### Requirement: Delivery boundary

Review routing MUST NOT create hard workflow gates or initiate commits, pushes, tags, releases, publication triggers, publishing, or publication-only version changes.

#### Scenario: Routing completes without delivery

- GIVEN routing has produced its review advice
- WHEN the routing interaction completes
- THEN it MUST perform no delivery or publication action

## Acceptance Criteria

All scenarios MUST be independently verifiable through automated routing and runtime safety-composition tests.
