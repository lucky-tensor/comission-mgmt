# Next Agent Prompt — Fix E2E User Story Tests

## Context

This is a commission management platform (TypeScript/Bun, React SPA, PostgreSQL).
Working directory: `/home/lucas/superfield/demos/comission-mgmt`
Active branch: `e2e-user-story-harness`

We have written a new E2E user-story test harness in `tests/e2e/stories/` — one file per
role, 20 stories total. Every test mounts the full `App` component (not bare components),
navigates to `/`, logs in by clicking the demo button in the Login UI, then drives the
story via `userEvent`. No `fetch()` calls for story assertions.

The tests were written as a harness first (to define coverage), and they are **not yet
passing**. Your job is to make them pass — fixing the tests where they reference wrong
testids or wrong selectors, fixing seed data where required, and fixing any app routing
gaps that block a story surface from rendering.

Run the browser test suite with: `bun run test:browser`
It runs in headless Chromium with a real ephemeral Postgres. Takes ~2–3 minutes.
All 304 existing tests (component + e2e) must stay green. Add new story tests on top.

---

## Rules

1. **No fakes.** Every story step must go through the real UI. No `fetch()` calls inside
   test assertions. No skipping a step with `if (!id) return`.
2. **Full workflow.** Each story must exercise the complete user journey described in the
   test plan (`docs/code-review/test-plan.md`). Reading data is not enough — mutation
   steps (approve, submit, resolve, acknowledge, generate) must be clicked through.
3. **Fix tests to match real testids**, not the other way around, unless a testid is
   genuinely missing from a component — in that case add the testid to the component.
4. **Fix one story at a time.** Run the suite after each fix to confirm no regressions.

---

## Known Gaps — Fix These In Order

### 1. FA-2 — Finalize button never clicked
**File:** `tests/e2e/stories/finance-admin.stories.e2e.ts`

The "finalize succeeds" test navigates to `/reconciliation`, acknowledges, then navigates
back to `/finance` and asserts `finalized-state` — but never loads a run into
CommissionRunReview and clicks the Finalize button. Fix:

- After navigating back to `/finance`, the test must:
  1. Fill `period-start-input` / `period-end-input` with `2025-05-01` / `2025-05-31`
  2. Click `start-run-button` (NOT `start-run-btn` — check CommissionRunReview.tsx)
  3. Wait for `queue-table`
  4. Click `batch-approve-button`
  5. Wait for `batch-approved-state`
  6. Click `finalize-button`
  7. Assert `finalized-state`

The seeded run in `closeRunId` (from `/__e2e_fixture__`) is already approved, so it might
be loadable by ID rather than starting fresh. Investigate CommissionRunReview to see if
it accepts an existing run ID input, or whether the test should start a new run.

Real testids in `CommissionRunReview.tsx`:
- `start-run-button` (NOT `start-run-btn`)
- `period-start-input`, `period-end-input`
- `queue-table`
- `approve-record-${commission_record_id}` (per-record approve)
- `batch-approve-button`
- `finalize-button`
- `finalized-state`
- `finalize-blocked`

### 2. FA-4 — Missing invoice status update step
**File:** `tests/e2e/stories/finance-admin.stories.e2e.ts`

The FA-4 tests only assert that `invoice-collection` and `phase-rows` render. Add a test
that actually updates an invoice status through the UI:

1. Select a placement with a seeded invoice
2. Find an invoice row with an update control (check `InvoiceCollection.tsx` for the
   actual update form/button testids)
3. Change the status (e.g. mark as Paid)
4. Assert the status badge updates

Check `apps/web/src/components/finance/InvoiceCollection.tsx` for the correct testids.

### 3. FA-3 and FA-5 — Routing gap (FinanceAdminSurface not wired)
**File:** `apps/web/src/App.tsx`

`AdjustmentLedger` and `PayrollExport` are built components but `FinanceAdminSurface`
(which composes them) is not rendered in the `/finance` route. The `ROUTES.FINANCE` case
in `App.tsx` currently renders:
```tsx
<DataGapQueue />
<CommissionRunReview />
<FinanceAdmin />
```

Fix: add `<FinanceAdminSurface />` to the `ROUTES.FINANCE` case. The component is at
`apps/web/src/components/finance/FinanceAdminSurface.tsx` — it renders `AdjustmentLedger`
(with a placement picker) and `PayrollExport` (with a run ID input or run-state prop).

After wiring, FA-3 and FA-5 tests should find their surfaces. Verify testids match:
- FA-3 needs: `export-generate-section`, `generate-export-button`, `exports-list`
- FA-5 needs: `adjustment-ledger`, `add-adjustment-btn`, `adjustment-form`,
  `adjustment-type-select`, `adjustment-amount-input`, `adjustment-reason-input`,
  `adjustment-submit-btn`, `adjustment-rows`

Check the actual components for these testids before writing tests.

### 4. PR-3 — Guarantee-window and pending-approval hold reasons not seeded
**File:** `tests/e2e/stories/producer.stories.e2e.ts`
**Seed:** `tests/e2e/fixtures/seed-producer.ts`

The producer seed only creates a collection-gated record. The tests assert these texts:
- `'guarantee window'` — no placement in GuaranteeActive state seeded
- `'pending approval'` — no record in PendingApproval state seeded

Fix options (choose one):
a) Add two more seeded commission records in `seedViaHttp` — one with status `Held` and
   `hold_reason` containing `'guarantee window'`, one with status `PendingApproval`.
b) Assert only what the seed actually provides. If only collection-gated hold is seeded,
   test only that and remove the other two assertions.

Option (a) is preferred — it validates the full story. Check `core/` types for valid
`status` values and `hold_reason` strings, then add seed records via the API.

The hold reason text the component renders is the raw `hold_reason` field from the API.
Check `apps/web/src/components/portal/CreditedPlacements.tsx` and `PayoutStatement.tsx`
to confirm exactly what string is rendered for each hold type.

### 5. MG-3 — Exception requests panel not tested
**File:** `tests/e2e/stories/manager.stories.e2e.ts`

Story MG-3 says: "view my team's commission accruals, pending payouts, and exception
requests". The test checks accruals and placements but not exceptions. Add:

1. Check that an exceptions section renders on the manager page
2. Either assert the empty-state message (if nothing seeded), or assert a seeded
   exception row appears

Check `apps/web/src/components/manager/ManagerHome.tsx` for whether exceptions are
rendered and what testids are used. If the section is missing from the component, add it.

### 6. EX-1 — Wrong testid for metric cards container
**File:** `tests/e2e/stories/executive.stories.e2e.ts`

The test asserts `page.getByTestId('metric-cards')` — this testid does not exist.
The actual metric cards in `ExecFinancialPosition.tsx` have individual testids:
- `metric-gross-fees` / `metric-gross-fees-value`
- `metric-commission-accrued` / `metric-commission-accrued-value`
- `metric-commission-payable` / `metric-commission-payable-value`
- `metric-clawback-exposure` / `metric-clawback-exposure-value`

Fix: replace the `metric-cards` assertion with assertions on individual metric value
testids. Assert that at least one `-value` element contains a `$` currency string.

### 7. EX-2 — Wrong nav selector and dimension button selectors
**File:** `tests/e2e/stories/executive.stories.e2e.ts`

Two problems:

**Nav link:** The test uses `getByRole('link', { name: /profitability/i })`.
NavShell renders nav items as elements with `data-testid="nav-item-executive-profitability"`.
Fix: `page.getByTestId('nav-item-executive-profitability')` (click it to navigate).

**Dimension buttons:** The test uses `getByRole('button', { name: 'Client' })`.
ExecProfitability renders dimension buttons as `data-testid="dim-btn-client"`,
`data-testid="dim-btn-recruiter"`, etc.
Fix: `page.getByTestId('dim-btn-client')`, `page.getByTestId('dim-btn-recruiter')`.

The `profitability-table` testid is correct — it exists in the component.
Note: `team` and `practice` dimensions show a `dimension-unavailable` state
(data not yet present in analytics). Use `client` and `recruiter` only.

### 8. EX-3 — Wrong testids throughout
**File:** `tests/e2e/stories/executive.stories.e2e.ts`

All testids in the EX-3 tests are wrong. Real testids in `ExecTrends.tsx`:
- Root: `exec-trends`
- Nav: `data-testid="nav-item-executive-trends"` (NavShell)
- Form: `trends-range-form`
- Start input: `trends-range-start-input` (NOT `trends-period-start`)
- End input: `trends-range-end-input` (NOT `trends-period-end`)
- Fetch button: `trends-fetch-button` (NOT `trends-fetch-btn`)
- Table: `trends-table`
- Empty state: `trends-empty`
- Per-row: `trends-row-${bucket.period_start}`
- Per-row exception rate: `exception-rate-${bucket.period_start}`
- Per-row dispute rate: `dispute-rate-${bucket.period_start}`

There is NO `exception-rate-chart` or `dispute-rate-chart` testid.

Fix the EX-3 tests to use the correct testids. To assert data rendered, fill the period
to cover the seed range (`2025-05-01` / `2025-05-31`), click `trends-fetch-button`,
wait for `trends-table`, then assert `trends-empty` is NOT present (meaning data loaded).
If the seed produces at least one bucket, assert `trends-row-${period}` exists.

Also fix the nav link: use `page.getByTestId('nav-item-executive-trends')`.

### 9. HR-1 — Ordering dependency between describe blocks
**File:** `tests/e2e/stories/hr.stories.e2e.ts`

The three HR-1 describe blocks have an ordering dependency: "HR sees Acknowledged"
depends on the producer acknowledgment test having run first. If tests are re-ordered
or run in isolation this will fail.

Fix: collapse the three HR-1 describe blocks into a single describe with tests that run
sequentially within one mounted App session:

1. Mount App, login as HR → assert `acknowledgment-table` shows producer row as `Pending`
2. Unmount, login as Producer → assert `producer-plan-acknowledgment` renders,
   click `acknowledge-btn`, assert `acknowledge-confirmed`
3. Unmount, login as HR → assert `acknowledgment-table` shows `Acknowledged` with date

Each step unmounts and re-mounts — the session switches via the login UI, not via fetch.

---

## Correct Testid Reference (summary)

| Component | Key testids |
|---|---|
| CommissionRunReview | `start-run-button`, `period-start-input`, `period-end-input`, `queue-table`, `approve-record-{id}`, `batch-approve-button`, `finalize-button`, `finalized-state`, `finalize-blocked` |
| ExecFinancialPosition | `exec-financial-position`, `period-start-input`, `period-end-input`, `period-stamp`, `metric-gross-fees-value`, `metric-commission-accrued-value`, `metric-commission-payable-value`, `metric-clawback-exposure-value` |
| ExecProfitability | `exec-profitability`, `dimension-switcher`, `dim-btn-client`, `dim-btn-recruiter`, `dim-btn-team`, `dim-btn-practice`, `profitability-table`, `profitability-row`, `dimension-unavailable` |
| ExecTrends | `exec-trends`, `trends-range-form`, `trends-range-start-input`, `trends-range-end-input`, `trends-fetch-button`, `trends-table`, `trends-empty`, `trends-row-{period_start}`, `exception-rate-{period_start}`, `dispute-rate-{period_start}` |
| NavShell (Executive) | `nav-item-executive`, `nav-item-executive-profitability`, `nav-item-executive-trends` |

---

## How to Run

```bash
# Full browser suite (component + e2e + stories)
bun run test:browser

# While iterating, you can filter to just the stories
bun run test:browser -- tests/e2e/stories/finance-admin.stories.e2e.ts
bun run test:browser -- tests/e2e/stories/executive.stories.e2e.ts
# etc.
```

Exit code 0 = all pass. Fix issues one file at a time and re-run.

---

## Files You Will Touch

**Tests (primary work):**
- `tests/e2e/stories/finance-admin.stories.e2e.ts`
- `tests/e2e/stories/producer.stories.e2e.ts`
- `tests/e2e/stories/manager.stories.e2e.ts`
- `tests/e2e/stories/executive.stories.e2e.ts`
- `tests/e2e/stories/hr.stories.e2e.ts`

**App routing fix:**
- `apps/web/src/App.tsx` (add `FinanceAdminSurface` to `ROUTES.FINANCE` case)

**Seed fix (if option a chosen for PR-3):**
- `tests/e2e/fixtures/seed-producer.ts`

**Do not touch:**
- `tests/e2e/stories/partner.stories.e2e.ts` — already correct and passing
- `tests/component/` — component tests are separate concern
- `tests/deprecated/` — reference only, do not modify
- Any `vitest.*.config.ts` files
