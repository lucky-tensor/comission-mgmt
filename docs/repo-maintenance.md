# Repo Maintenance — Phase Scout

> Scout document for the Repo maintenance phase (#270).
> Documents the two integration seams the phase's fix issues will use. This
> phase exists because the natural home phases (Demo Polish, Producer Deal
> Simulator) are closed and frozen. **No behaviour change here** — this file only
> records where #268 and #269 hook in. Neither seam is fixed in this scout.

## Phase

Repo maintenance

## Canonical docs

- `docs/architecture.md` — worker.yaml scope/threat row (simulator CLI spawning)
- `docs/arbitration-simulation.md` — simulation-agent stub notes + #187 handoff
- `scripts/check-vitest-coverage.ts` — the existing config↔workflow self-check

## Baseline

The `phase/repo-maintenance` branch is cut from `main` with a clean baseline:

- `bun tsc --noEmit` passes (typecheck-clean).
- No runtime behaviour changes versus `main` — the only addition is this note.

The two seams below are documented but deliberately left unfixed so that #268
and #269 own the actual corrections.

## Seam 1 — packages/core/tests is orphaned from CI (fix: #268)

**Problem.** No `vitest.*.config.ts` include glob covers `packages/core/tests/`,
and CI never runs those suites, so they cannot gate a merge:

- `.github/workflows/test-suites.yml` runs only the root `vitest.*.config.ts`
  configs listed in its `postgres-suites` / `node-suites` matrices. None of
  those configs include `packages/core/tests/**`.
- `.github/workflows/test-unit.yml` globs `packages/*/tests/unit/**/*.test.ts`
  (note the `unit` subdirectory). The 12 core suites live directly in
  `packages/core/tests/*.test.ts`, with **no `unit/` subdirectory**, so the glob
  never matches them.
- The root `package.json` `test:unit` script does target `packages/core/tests`,
  but no workflow invokes that script.
- `scripts/check-vitest-coverage.ts` only verifies config↔workflow wiring (every
  on-disk config is referenced by a workflow and vice-versa). It does **not**
  verify test-file↔config coverage, so an orphaned test file is invisible to it.

**Consequence today.** All 12 suites under `packages/core/tests/`
(`calculation-engine`, `commission-calculation-engine`, `commission-run`,
`clawback-ledger`, `encryption`, `kms`, `explanation-engine`, `guarantee-state`,
`placement-state`, `contributor-role`, `logger-stdout`, `demo-placement-seam`)
never run in CI. The stale `demo-placement-seam.test.ts` assertions
(`expect(EXTRA_DEMO_PLACEMENTS).toEqual([])`) are dead code in CI and never turn
the build red even though they are now false (the seam holds 6 demo placements).

**Where #268 hooks in.**

1. Wire `packages/core/tests/` into CI via one of:
   - a dedicated root config (e.g. `vitest.core.config.ts` with
     `include: ['packages/core/tests/**/*.test.ts']`) referenced by a new matrix
     entry in `.github/workflows/test-suites.yml` (`node-suites` if no Postgres
     is needed; verify per suite), **or**
   - extend the `test-unit.yml` glob to include `packages/core/tests`.
   A new root config must also be added to the workflow so
   `check:vitest-coverage` stays green.
2. Fix the stale assertion + header comment in
   `packages/core/tests/demo-placement-seam.test.ts` to assert the populated
   `EXTRA_DEMO_PLACEMENTS` (6 entries) contract.
3. Optionally extend `scripts/check-vitest-coverage.ts` (or add a sibling check)
   to flag any test file matched by no executed config — closing the
   orphaned-test-file class that this self-check does not currently catch.

## Seam 2 — simulator doc drift (fix: #269)

PR #267 shipped the full Producer Deal Simulator pipeline (#262): the engine
spawns the local `claude` CLI via `runClaudeCli`
(`packages/db/src/claude-cli-engine.ts`), `apps/worker/src/agents/simulation.ts`
builds a real plan-context prompt and parses the forecast, and
`apps/server/src/api/simulations.ts` implements the real enqueue + delegated
result persistence. Two canonical docs still describe the prior scout/stub world
and now contradict the shipped code.

**Sections that contradict the shipped simulator.**

- `docs/architecture.md`, the `blueprints/worker.yaml` row (~line 239): its
  Deferred/Out-of-scope column states "vendor CLI binary spawning (no CLI binary
  invocations in scope)", but the simulator now spawns the `claude` CLI binary.
  The same row's `vendor-cli-data-exfiltration` threat is now an active surface,
  not theoretical.
- `docs/arbitration-simulation.md`:
  - the simulation-agent **STUB NOTE** (~line 255) saying the agent merely
    "accepts valid payloads and returns a structured response" and that the real
    implementation (#187) "will ... Call `callClaudeAPI()`" (~line 259) — the
    shipped path uses `runClaudeCli`, not `callClaudeAPI`;
  - the `Integration Handoff > Producer Deal Simulation (#187)` section
    ("Current scout seam" ~line 292, "Must implement" ~line 302), whose 501-stub
    seam and "Must implement" list (`callClaudeAPI` inside
    `executeSimulationTask`, API endpoint to accept predictions, integration
    tests) were all delivered by #267.
  - The lower "Implemented pipeline (issue #262)" table is already correct, so
    the file currently contradicts itself.
  - Note: the #186 arbitration STUB NOTE (~line 209) stays as-is — arbitration
    is not yet shipped, so only the simulation/#187 prose is stale.

**Where #269 hooks in.** Correct the architecture.md worker.yaml row (CLI binary
spawning is in scope/shipped; `vendor-cli-data-exfiltration` is active/mitigated)
and rewrite the arbitration-simulation.md stub/handoff prose to describe the
shipped `runClaudeCli` pipeline, consistent with the "Implemented pipeline
(#262)" table and PRD §5.9/§5.12. No simulator code behaviour changes; the
arbitration (#186) stub notes stay as-is.

## See Also

- `docs/demo-polish.md` — sibling scout doc (Demo Polish phase, #200)
- `docs/arbitration-simulation.md` — simulator/arbitration phase doc (#188/#263)
