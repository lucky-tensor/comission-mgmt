# Demo Polish — Seed Data Seam

> Scout document for the Demo Polish phase (#200).
> Establishes the additive placement seam and the fixture-ID safety contract
> that demo seed feature work (#196) must follow. No feature behavior here —
> the seam is a no-op until #196 populates it.

## Phase

Demo Polish

## Canonical docs

- `docs/prd.md` §5.1, §5.5 — collection gating and phase-level billing
- `scripts/shared-seed/demo-placement-seam.ts` — the seam contract (source of truth for types)

## Seed pipeline overview

The demo seed runs in two phases (see `scripts/local-demo.ts`):

1. **Phase 1 — identities** (`scripts/demo-seed.ts` → `scripts/shared-seed/identities.ts`)
   - Runs migrations, then seeds `orgs`, `users`, `org_memberships`.
   - Unencrypted, pre-server. Guarded by `DEMO_MODE=true`.
   - Uses the stable IDs in `tests/e2e/fixtures/ids.ts` (`SEEDED`).

2. **Phase 2 — encrypted commission data** (`scripts/phase2-seed.ts` → `scripts/shared-seed/encrypted.ts`)
   - Runs AFTER the app server is up; seeds via the HTTP API as the admin persona.
   - Creates plans, lifecycle placements, and the E2E fixture placements
     (PR-1, MG-1..4, FA-1..5, EP-1, EX-4) plus their runs, disputes, and invoices.
   - Returns a `SharedSeedFixture` consumed by callers.

## The placement seam

`scripts/shared-seed/demo-placement-seam.ts` exposes a declarative, additive
extension point:

- `DemoPlacementDef` / `DemoContributorDef` / `DemoPlacementStatus` — the shape
  of a demo placement (job, comp, fee, start, guarantee, target status,
  contributor splits, whether to calculate).
- `EXTRA_DEMO_PLACEMENTS` — currently `[]`. **Empty in the scout**, so wiring it
  into `seedEncrypted` does nothing yet.
- `extraDemoPlacements()` — returns that list.

#196 fills `EXTRA_DEMO_PLACEMENTS` and wires a loop in `encrypted.ts` that turns
each def into the same `POST /placements` → status flip → contributors →
optional `calculate` sequence already used inline, appended after the existing
fixture sections.

## Fixture-ID safety contract

Adding demo placements MUST NOT perturb the existing E2E fixtures. The browser
E2E suite imports `SEEDED` / `CLOSE` / `PARTNER` from `tests/e2e/fixtures/ids.ts`
and asserts against persona scoping, fixture amounts, and run/dispute state.

1. **Never** change any value in `tests/e2e/fixtures/ids.ts`. The seed writes
   these IDs and the Chromium bundle reads them.
2. New placements use fresh `crypto.randomUUID()` for candidate/client IDs and
   reuse existing `SEEDED.*` producer/manager/partner IDs for contributors.
3. Append new placements **after** the numbered fixture blocks (§3–§12) in
   `encrypted.ts` — or via the seam, once wired. Do not insert between fixture
   blocks; their relative ordering drives run-approval and dispute state.
4. Do not rename or remove fields on the `SharedSeedFixture` return shape; add
   fields rather than break callers.

## Verification (scout)

- `bun run scripts/demo-seed.ts` (with `DEMO_MODE=true`) — Phase 1 compiles and runs.
- `bun run test:e2e` — existing E2E fixtures still pass on the phase branch.
- The seam test (`packages/core/tests/demo-placement-seam.test.ts`) asserts the
  no-op and the contract compiles.
