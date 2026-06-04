# E2E User Story Test Plan

## Approach

Every test in this plan follows the same harness:

1. **`beforeAll`** — seed the database via the real API (`seedViaHttp`) to establish the
   fixtures needed by the story. Use `SEEDED` IDs from `tests/e2e/fixtures/ids.ts` where
   they exist; add new fixture helpers for gaps.
2. **Mount the full `App`** — `createRoot(container).render(createElement(App))` — never
   a bare component. The NavShell, role-based routing, and `isPathPermitted` guard must
   all be live.
3. **Navigate to `'/'`** — `navigate('/')` — start from the login screen every time.
4. **Log in through the Login UI** — wait for `data-testid="demo-section"` to appear, then
   click `getByRole('button', { name: '<Role Label>' })` where the label is the
   `ROLE_LABELS` string from `demo-session.ts` (e.g. `'Finance Admin'`, `'Producer'`).
5. **Assert the redirect** — confirm `window.location.pathname` is the role's landing route
   and the NavShell role badge matches.
6. **Run all story steps** — every interaction is `userEvent.click` / `userEvent.fill` on
   real DOM elements; every assertion is `expect.element(...).toBeInTheDocument()` or
   `.toHaveTextContent(...)`.

**No direct `fetch()` calls for story assertions.** If a step cannot be verified through the
UI it is an explicit gap — document it and mark the checkbox `[~]` rather than paper over it
with an API call.

File location: `tests/e2e/stories/` (one file per role).

---

## Pre-conditions / Routing Gaps to Fix First

Before the Finance Admin stories for payroll export and adjustment ledger can be written,
the following routing fix is required:

- [ ] **Wire `FinanceAdminSurface` into `App.tsx`** — `AdjustmentLedger` and `PayrollExport`
      are built but the `/finance` route does not render them. Add them to the `ROUTES.FINANCE`
      case alongside `DataGapQueue`, `CommissionRunReview`, and `FinanceAdmin`. Without this
      the browser has no surface to drive for stories FA-3 and FA-5.

---

## Finance Admin

Login button label: `'Finance Admin'` → lands on `/finance`

### FA-1 — Data gap queue
_As a Finance Admin, I want to see all placements that are missing required fields so that I can resolve data gaps before running commissions._

- [ ] `data-testid="demo-section"` visible on `/`
- [ ] Click `'Finance Admin'` demo button → redirected to `/finance`
- [ ] `data-testid="data-gap-queue"` renders
- [ ] At least one `gap-row-{id}` is visible for the seeded incomplete placement
- [ ] `missing-field-tag-fee_amount` is visible on that row
- [ ] Click `resolve-btn-{id}` → inline form appears (`resolve-form-{id}`)
- [ ] `userEvent.fill` the `input-{id}-fee_amount` field with a valid amount
- [ ] Click `save-btn-{id}` → row is removed from the queue
- [ ] Queue shows zero incomplete rows (or an empty-state message)

### FA-2 — Commission run review and batch approval
_As a Finance Admin, I want to run a commission cycle, review each calculated payout, and approve the batch before it reaches payroll._

- [ ] Navigate to `/finance` as Finance Admin
- [ ] `data-testid="commission-run-review"` renders
- [ ] Fill period-start and period-end inputs and click the start-run button
- [ ] Run queue table renders with at least one record row
- [ ] Click the individual approve button on a record row → row transitions to approved state
- [ ] Click the batch approve / finalize button → finalized-state renders (not blocked state)

### FA-3 — Payroll-ready export
_As a Finance Admin, I want to export an approved, payroll-ready file so that payroll submission requires no manual rework._

**Depends on: routing gap fix above.**

- [ ] Navigate to `/finance` as Finance Admin (after a run is finalized from FA-2)
- [ ] `data-testid="export-generate-section"` renders
- [ ] `data-testid="generate-export-button"` is visible and enabled
- [ ] Click generate button → button transitions to `'Generating…'` (disabled)
- [ ] After generation: `data-testid="exports-list"` renders with at least one row
- [ ] Download link for the artifact is present in the DOM with correct `href`

### FA-4 — Invoice and collection tracking
_As a Finance Admin, I want to track invoice and collection status per placement and per billing phase._

- [ ] Navigate to `/finance` as Finance Admin
- [ ] `data-testid="finance-admin"` renders (placement picker)
- [ ] Select a seeded placement from the picker
- [ ] `InvoiceCollection` surface renders with billing phase rows (retainer / delivery)
- [ ] Invoice status badge is visible (e.g. `Issued` or `Paid`)
- [ ] Update an invoice status via the inline form → status badge updates

### FA-5 — Adjustment ledger (clawbacks, refunds, credit memos)
_As a Finance Admin, I want to apply adjustments as new ledger entries with an audit trail, so that history is never silently overwritten._

**Depends on: routing gap fix above.**

- [ ] Navigate to `/finance` as Finance Admin
- [ ] Select a seeded placement from the picker
- [ ] `data-testid="adjustment-ledger"` renders
- [ ] Existing adjustments (if any) are listed in the ledger table
- [ ] Open the new adjustment form → fill type, amount, reason fields
- [ ] Submit → new ledger row appears (append-only; original rows remain)

---

## Producer

Login button label: `'Producer'` → lands on `/portal`

### PR-1 — Credited placement detail
_As a Producer, I want to see the credit I received on each placement — my role, split %, commissionable base, and calculated amount._

- [ ] Click `'Producer'` demo button → redirected to `/portal`
- [ ] `data-testid="payout-table"` renders
- [ ] At least one row shows a payout amount cell (e.g. `$5,000.00`)
- [ ] Row contains the contributor role label (e.g. `CandidateOwner`)
- [ ] Row contains a split percentage value
- [ ] `data-testid="placements-list"` renders with credited placement detail

### PR-2 — Tier progress
_As a Producer, I want to see my current tier progress and the threshold to reach the next rate._

- [ ] `data-testid="tier-progress"` renders on `/portal`
- [ ] `data-testid="tier-production"` shows a production figure
- [ ] Current tier rate is displayed
- [ ] Next threshold amount is displayed (or at-cap message if max tier reached)

### PR-3 — Hold status and reason
_As a Producer, I want to see which of my payouts are held and why (collection gate, guarantee window, pending approval)._

- [ ] `data-testid="placements-list"` contains a held record
- [ ] Hold reason text is visible for a collection-gated record
      (`'Payment is pending client collection.'`)
- [ ] Hold reason text is visible for a guarantee-window record
      (`'Payment is held during the guarantee window.'` or equivalent)
- [ ] Hold reason text is visible for a pending-approval record

### PR-4 — Submit dispute
_As a Producer, I want to submit a question or dispute about a payout within the platform._

- [ ] `data-testid="dispute-form"` renders on `/portal`
- [ ] `data-testid="dispute-record"` select contains at least one commission record option
- [ ] Select a specific commission record from the dropdown
- [ ] `userEvent.fill` the `dispute-description` field
- [ ] Click `dispute-submit`
- [ ] `data-testid="dispute-confirmation"` renders
- [ ] `data-testid="dispute-state"` shows `'Submitted'`

---

## Manager

Login button label: `'Manager'` → lands on `/manager`

### MG-1 — Split approval
_As a Manager, I want to approve or modify split allocations for deals on my team before they are finalized._

- [ ] Click `'Manager'` demo button → redirected to `/manager`
- [ ] `data-testid="split-approval"` renders
- [ ] A pending deal row (`deal-row-{id}`) is visible
- [ ] Click `expand-btn-{id}` → `contributors-table-{id}` renders with split rows
- [ ] Each contributor row shows role, split %, and producer name
- [ ] Click `approve-btn-{id}` → deal row is removed from the pending list
- [ ] Empty-state or updated list confirms no remaining pending approvals

### MG-2 — Attribution timeline
_As a Manager, I want to see an attribution timeline for any deal to resolve ownership disputes with evidence._

- [ ] `data-testid="attribution-timeline"` renders on `/manager`
- [ ] `data-testid="timeline-idle"` shown before search
- [ ] `userEvent.fill` the `placement-id-input` with a valid placement ID
- [ ] Click `search-timeline-btn`
- [ ] `data-testid="timeline-events"` renders
- [ ] At least one `timeline-event-{id}` node is present with an actor and timestamp

### MG-3 — Team commission view
_As a Manager, I want to view my team's commission accruals, pending payouts, and exception requests._

- [ ] `data-testid="team-commission-view-heading"` renders on `/manager`
- [ ] `data-testid="placements-table"` renders with at least one seeded placement row
- [ ] Commission summary panel shows at least one producer row with accrual figures
- [ ] Exception requests section renders (empty-state or list)
- [ ] Team isolation: a placement from Manager 2's team is absent from Manager 1's view

### MG-4 — Split escalation
_As a Manager, I want to escalate a cross-team or contested split to a designated tiebreaker._

- [ ] `data-testid="escalation-form"` renders on `/manager`
- [ ] `data-testid="escalation-list"` shows the seeded open dispute
- [ ] `userEvent.fill` the `escalation-rationale` field
- [ ] Click `escalation-submit`
- [ ] `data-testid="escalation-confirmation"` renders
- [ ] `data-testid="escalation-state"` shows a recognised state (`Submitted` / `UnderReview`)

---

## Executive

Login button label: `'Executive'` → lands on `/executive`

### EX-1 — Firm financial position
_As an Executive, I want to see gross fees, net fee income, commission accrued, commission payable, and clawback exposure in one view._

- [ ] Click `'Executive'` demo button → redirected to `/executive`
- [ ] `data-testid="exec-financial-position"` renders
- [ ] Fill `period-start-input` and `period-end-input` with the seeded period
- [ ] `data-testid="period-stamp"` renders (not just empty-state)
- [ ] At least one named metric card is visible (gross fees, NFI, commission accrued,
      commission payable, or clawback exposure)
- [ ] Each visible metric card shows a non-blank numeric value

### EX-2 — Profitability analytics
_As an Executive, I want to see profitability by client, recruiter, team, and practice._

- [ ] Navigate to `/executive/profitability` via nav link
- [ ] `data-testid="exec-profitability"` renders
- [ ] `data-testid="dimension-switcher"` is present
- [ ] Click dimension `'Client'` → profitability table refreshes with client rows
- [ ] Click dimension `'Recruiter'` → table refreshes with recruiter rows
- [ ] Each row shows a margin or NFI figure

### EX-3 — Exception and dispute rate trends
_As an Executive, I want to see the exception rate and dispute rate over time to evaluate whether commission plan rules are working._

- [ ] Navigate to `/executive/trends` via nav link
- [ ] `data-testid="exec-trends"` renders (currently no E2E test exists at all)
- [ ] Fill period inputs and fetch
- [ ] Exception rate chart or table renders with seeded data
- [ ] Dispute rate chart or table renders with seeded data

### EX-4 — Escalated dispute final approval
_As an Executive, I want to act as the final approver on escalated attribution disputes._

- [ ] `data-testid="exec-dispute-approval"` renders on `/executive`
- [ ] Seeded `dispute-row-{id}` with state `UnderReview` is visible
- [ ] Click `review-btn-{id}` → `data-testid="dispute-detail"` renders
- [ ] `data-testid="attribution-timeline"` renders inside the detail view
- [ ] `data-testid="resolve-form"` and `rationale-input` are present
- [ ] `userEvent.fill` the rationale
- [ ] Click `resolve-btn`
- [ ] `data-testid="resolve-confirmation"` renders
- [ ] Reload the dispute list → resolved dispute no longer in `UnderReview` state

---

## HR / People Ops

Login button label: `'HR'` → lands on `/hr`

### HR-1 — Plan acknowledgment
_As an HR operator, I want producers to acknowledge their commission plan so there is a documented record._

- [ ] Click `'HR'` demo button → redirected to `/hr`
- [ ] `data-testid="plan-acknowledgment"` renders
- [ ] `data-testid="acknowledgment-table"` shows the seeded producer row as `Pending`
- [ ] Switch to Producer login (click `'Producer'` demo button from `/`) →
      redirected to `/portal`
- [ ] `data-testid="producer-plan-acknowledgment"` renders with plan name
- [ ] `data-testid="acknowledge-btn"` is present
- [ ] Click `acknowledge-btn` → `data-testid="acknowledge-confirmed"` renders,
      button disappears
- [ ] Switch back to HR login → `/hr` → `acknowledgment-table` shows the producer
      row as `Acknowledged` with a date value in the `acknowledged_at` cell

### HR-2 — Draw balance and recovery schedule
_As an HR operator, I want to view draw balances and recovery schedules for each producer._

- [ ] `data-testid="draw-balance-view"` renders on `/hr`
- [ ] `userEvent.fill` the `producer-id-input` with the seeded producer UUID
- [ ] Click `lookup-btn`
- [ ] `data-testid="draw-balance-panel"` renders
- [ ] `data-testid="outstanding-balance"` shows a numeric value (may be zero)
- [ ] Recovery schedule section renders (empty-state message or schedule rows)

---

## External Partner

Login button label: `'External Partner'` → lands on `/partner`

### EP-1 — Scoped payout visibility
_As an External Partner, I want to see the deals where I have a split agreement, the amounts owed to me, and the payment status._

- [ ] Click `'External Partner'` demo button → redirected to `/partner`
- [ ] `data-testid="partner-payout-view"` renders
- [ ] `data-testid="partner-placements-list"` renders
- [ ] Own placement row (`partner-placement-row-{partnerPlacementId}`) is visible
- [ ] `partner-placement-amount-owed` cell shows the correct seeded fee amount
- [ ] `partner-placement-payment-trigger` cell shows the placement start date
- [ ] `partner-placement-status` badge is present
- [ ] Unrelated placement row (`partner-placement-row-{unrelatedPlacementId}`) is absent
- [ ] Navigate to `/finance` via URL bar → `data-testid="forbidden-surface"` renders

---

## Summary Checklist

| Story | Steps to write | Routing fix needed |
|---|---|---|
| FA-1 Data gap queue | 9 | No |
| FA-2 Commission run review | 6 | No |
| FA-3 Payroll export | 6 | **Yes** |
| FA-4 Invoice tracking | 6 | No |
| FA-5 Adjustment ledger | 6 | **Yes** |
| PR-1 Credited placement detail | 6 | No |
| PR-2 Tier progress | 4 | No |
| PR-3 Hold status and reason | 4 | No |
| PR-4 Submit dispute | 7 | No |
| MG-1 Split approval | 7 | No |
| MG-2 Attribution timeline | 7 | No |
| MG-3 Team commission view | 5 | No |
| MG-4 Split escalation | 6 | No |
| EX-1 Firm financial position | 6 | No |
| EX-2 Profitability analytics | 6 | No |
| EX-3 Exception/dispute trends | 5 | No |
| EX-4 Escalated dispute approval | 8 | No |
| HR-1 Plan acknowledgment | 8 | No |
| HR-2 Draw balance | 6 | No |
| EP-1 Scoped payout visibility | 8 | No |
