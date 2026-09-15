# Review Orchestration Specification

## Purpose

Define bounded review orchestration.

## Requirements

### Requirement: Precision-gated ledger

Standard review MUST use one sweep; full 4R MUST use at most two per lens. Findings MUST evidence user impact. The merged ledger MUST be authoritative, with `refuted` terminal. WARNING/SUGGESTION MUST be one-time `info` rows and MUST NOT drive fixes. Persistence MUST use Engram or equivalent structured inline fallback.

#### Scenario: Precision limits

- GIVEN standard or full-4R review
- WHEN candidates are admitted
- THEN sweeps MUST be one or at most two respectively, and speculative candidates MUST be rejected

#### Scenario: Terminal rows

- GIVEN a `refuted`, WARNING, or SUGGESTION row
- WHEN orchestration reruns
- THEN `refuted` MUST remain terminal and WARNING/SUGGESTION MUST NOT schedule fixes

#### Scenario: Persistence fallback

- GIVEN Engram unavailable
- WHEN ledger is saved/read
- THEN all ledger fields/statuses MUST remain inline

### Requirement: Constant batched refutation and voting

Actor count MUST ignore finding count: zero without severe candidates, one general refuter for standard, and three full-4R refuters for correctness, impact/exploitability, and reproducibility. Every refuter MUST receive complete merged BLOCKER/CRITICAL list. In standard review, the general refuter's single per-finding verdict MUST decide: `refuted` MUST mark that finding terminal; `stands`, malformed, omitted, or missing MUST preserve it. Full 4R MUST vote independently per finding: at least two of three `refuted` verdicts MUST mark only that finding terminal; fewer MUST preserve it.

#### Scenario: Actor counts

- GIVEN no severe candidates, standard review, or full 4R
- WHEN refutation starts for any finding count
- THEN actor counts MUST respectively be zero, one general, or three fixed-role; every active actor MUST receive the complete list

#### Scenario: Mode-specific voting

- GIVEN the standard general refuter marks a finding `refuted`, or at least two full-4R refuters do
- WHEN verdicts merge
- THEN only that finding MUST become terminal `refuted`

#### Scenario: Fail-closed handling

- GIVEN a standard verdict is `stands`, malformed, omitted, or missing, or a full-4R finding receives fewer than two valid refutations
- WHEN verdicts merge
- THEN that finding MUST be preserved

### Requirement: Bounded convergence and Judgment Day

Only surviving BLOCKER/CRITICAL rows MAY drive up to two scoped fix/re-review rounds. Re-review MUST receive only ledger and fix diff; round-two survivors MUST escalate. Judgment Day MUST use two blind judges, zero refuters, informational warnings, and the same limit.

#### Scenario: Scoped re-review

- GIVEN a severe-finding fix completes
- WHEN re-review starts
- THEN reviewers MUST receive only ledger and fix diff, assessing affected rows and regressions

#### Scenario: Round limit

- GIVEN severe rows survive round two
- WHEN convergence is evaluated
- THEN a third round MUST NOT run; unresolved rows MUST escalate

#### Scenario: Judgment Day exception

- GIVEN Judgment Day runs
- WHEN adversarial review starts
- THEN exactly two blind judges and zero refuter actors MUST run

### Requirement: Installed refuter boundary

Installation/forced refresh MUST provide `review-refuter` with exactly `read`, `grep`, `find` and no mutation, shell, delegation, or memory-write permission. This guarantee MUST cover only isolated package-managed installs; explicit project/user overrides MAY shadow it and MUST NOT be rewritten or claimed compliant.

#### Scenario: Package permissions

- GIVEN package installation/forced refresh in an isolated agent home
- WHEN refuter identity, tools, and forbidden attempts are verified
- THEN the asset MUST exist, expose exactly `read`, `grep`, `find`, and deny every forbidden capability

#### Scenario: Explicit override

- GIVEN a project/user definition shadows the package refuter
- WHEN verified
- THEN verification MUST NOT modify the override or claim its permissions are package-compliant

### Requirement: No delivery or publication

Orchestration MAY implement and verify but MUST NOT commit, push, tag, release, publish, trigger publication, or make publication-only version changes.

#### Scenario: Verification stop

- GIVEN implementation and verification complete
- WHEN orchestration finishes
- THEN files MUST remain undelivered and unpublished

## Acceptance Criteria

All scenarios MUST pass automated tests.
