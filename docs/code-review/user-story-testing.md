# User Story E2E Test Coverage

Tracks whether each PRD user story (§4) is covered by a **browser-driven**
test — meaning the test mounts a real React component in headless Chromium,
interacts with it via `userEvent.click` / `userEvent.fill`, and asserts DOM
state via `page.getByTestId`. Tests that only call `fetch()` directly against
the API are marked accordingly.

Legend:
- `[x]` — Fully browser-driven: navigate → mount → click/fill → DOM assertion
- `[~]` — Partial: component mounts and renders, but the key interaction or
          result is verified via a direct `fetch()` call rather than through the UI
- `[ ]` — Not browser-tested: either API-only or no E2E coverage at all

Source files: `tests/e2e/*.e2e.ts`

---

## Finance Admin

> Stories: docs/prd.md §4, Finance Admin

- [x] **Data gap queue** — see all placements missing required fields and resolve
      gaps before running commissions.
      `finance-close.e2e.ts` — DataGapQueue renders, gap-row visible, resolve-btn
      click, fee_amount filled, save-btn click, row optimistically removed.

- [~] **Commission run review and batch approval** — run a commission cycle,
      review each calculated payout, and approve the batch before it reaches
      payroll.
      `finance-close.e2e.ts` — CommissionRunReview renders and is asserted present,
      but the finalize action is exercised via `fetch('/api/commission-runs/:id/finalize')`
      directly, not by clicking through the review UI.

- [ ] **Payroll-ready export** — export an approved, payroll-ready file so that
      payroll submission requires no manual rework.
      `finance-close.e2e.ts` steps 6–7 call `fetch('/api/commission-runs/:id/export')`
      directly. The `PayrollExport` component exists but is not wired into the
      `/finance` route and is never mounted in any E2E test.

- [ ] **Invoice and collection tracking** — track invoice and collection status
      per placement and per billing phase so that collection-gated commissions
      are released accurately.
      No E2E test exercises the `InvoiceCollection` component via browser
      interaction.

- [ ] **Adjustment ledger** — apply adjustments (refunds, credit memos,
      clawbacks) as new ledger entries with an audit trail so that history is
      never silently overwritten.
      The `AdjustmentLedger` component is not wired into the `/finance` route.
      It has no E2E coverage of any kind.

---

## Producer

> Stories: docs/prd.md §4, Producer

- [x] **Credited placement detail** — see the credit received on each placement
      (role, split %, commissionable base, calculated amount) without asking
      finance.
      `producer-portal.e2e.ts` — payout-table renders, `$5,000.00` cell asserted,
      placements-list renders with hold explanation text.

- [x] **Tier progress** — see current tier progress and the threshold to reach
      the next rate.
      `producer-portal.e2e.ts` — tier-progress and tier-production testids
      asserted in DOM.

- [~] **Hold status and reason** — see which payouts are held and why (collection
      gate, guarantee window, pending approval).
      `producer-portal.e2e.ts` — "Payment is pending client collection." text
      verified in placements-list. Guarantee-window and pending-approval hold
      reasons are not specifically tested by browser interaction.

- [x] **Submit dispute** — submit a question or dispute about a payout within
      the platform.
      `producer-portal.e2e.ts` — dispute-form renders, description filled via
      `userEvent.fill`, dispute-submit clicked, dispute-confirmation and
      dispute-state 'Submitted' asserted.

---

## Manager

> Stories: docs/prd.md §4, Manager

- [x] **Split approval** — approve or modify split allocations for deals on the
      team before they are finalized.
      `manager-flow.e2e.ts` — SplitApproval mounts, pending deal-row visible,
      expand-btn clicked, contributors-table rendered, approve-btn clicked,
      deal-row removed.

- [x] **Attribution timeline** — see an attribution timeline for any deal to
      resolve ownership disputes with evidence.
      `manager-flow.e2e.ts` — AttributionTimeline mounts, placement-id-input
      filled, search-timeline-btn clicked, timeline-events rendered, event nodes
      counted.

- [~] **Team commission view** — view team commission accruals, pending payouts,
      and exception requests.
      `manager-flow.e2e.ts` — TeamCommissionView mounts, heading and placements-
      table rendered. Commission summary panel heading asserted but encrypted
      `net_payable` values are explicitly acknowledged as possibly failing to
      decrypt. Exception requests view is not tested at all.

- [x] **Split escalation** — escalate a cross-team or contested split to a
      designated tiebreaker.
      `manager-flow.e2e.ts` — ManagerPortal mounts, escalation-form and
      escalation-list visible, rationale filled, escalation-submit clicked,
      escalation-confirmation and escalation-state asserted.

---

## Executive

> Stories: docs/prd.md §4, Executive

- [~] **Firm financial position** — see gross fees, net fee income, commission
      accrued, commission payable, and clawback exposure in one view.
      `executive-flow.e2e.ts` — ExecFinancialPosition mounts, heading and period
      inputs rendered, period dates filled. Data assertion is intentionally weak:
      "either period-stamp or empty-state or div has children." No specific metric
      values are verified.

- [~] **Profitability analytics** — see profitability by client, recruiter, team,
      and practice.
      `executive-flow.e2e.ts` — ExecProfitability mounts, exec-profitability and
      dimension-switcher testids asserted. No dimension-switch interaction or
      profitability data values are tested.

- [ ] **Exception and dispute rate trends** — see the exception rate and dispute
      rate over time to evaluate whether commission plan rules are working.
      `ExecTrends` component is never mounted in any E2E test.

- [x] **Escalated dispute final approval** — act as final approver on escalated
      attribution disputes.
      `executive-flow.e2e.ts` — ExecDisputeApproval mounts, review-btn clicked,
      dispute-detail and attribution-timeline rendered, resolve-form visible,
      rationale filled, resolve-btn clicked, resolve-confirmation asserted.
      Subsequent test verifies dispute no longer in UnderReview state (via fetch).

---

## HR / People Ops

> Stories: docs/prd.md §4, HR / People Ops

- [x] **Plan acknowledgment** — producers acknowledge their commission plan in
      the platform so there is a documented record of plan acceptance.
      `hr-flow.e2e.ts` — full forward-and-back flow: HR navigates to /hr,
      acknowledgment-table shows producer as Pending; producer mounts
      ProducerPlanAcknowledgment, acknowledge-btn clicked, acknowledge-confirmed
      rendered; HR reloads /hr, row shows Acknowledged with date cell.

- [x] **Draw balance and recovery schedule** — view draw balances and recovery
      schedules for each producer.
      `hr-flow.e2e.ts` — DrawBalanceView renders on /hr, producer-id-input
      filled with producer UUID, lookup-btn clicked, draw-balance-panel and
      draw-balance-summary rendered, outstanding-balance rendered, empty
      recovery-schedule state asserted.

---

## External Partner

> Stories: docs/prd.md §4, External Partner

- [x] **Scoped payout visibility** — see deals with a split agreement, amounts
      owed, and payment status without manual follow-up.
      `partner-flow.e2e.ts` — full flow: demo-login redirects to /partner,
      partner-placements-list renders, own placement row present with
      amount-owed, payment-trigger, and status cells asserted. Negative scope:
      unrelated placement row asserted absent. Forbidden surface asserted for
      non-partner SPA routes. API scope enforcement verified via fetch.

---

## Summary

| Role | Stories | Fully browser-tested | Partial | Not tested |
|---|---|---|---|---|
| Finance Admin | 5 | 1 | 1 | 3 |
| Producer | 4 | 3 | 1 | 0 |
| Manager | 4 | 3 | 1 | 0 |
| Executive | 4 | 1 | 2 | 1 |
| HR / People Ops | 2 | 2 | 0 | 0 |
| External Partner | 1 | 1 | 0 | 0 |
| **Total** | **20** | **11** | **5** | **4** |

### Untested stories requiring new E2E work

1. **Finance Admin — Payroll export UI** (`PayrollExport` component): the
   component must be wired into the `/finance` route before a browser test can
   exercise it.
2. **Finance Admin — Invoice and collection tracking** (`InvoiceCollection`):
   the component renders in the `/finance` route but no E2E test interacts with it.
3. **Finance Admin — Adjustment ledger** (`AdjustmentLedger`): component is not
   wired into any route; needs routing fix and a new E2E test.
4. **Executive — Exception and dispute rate trends** (`ExecTrends`): component
   exists and is routed at `/executive/trends` but is never mounted in E2E tests.

### Partial stories that need stronger browser assertions

- **Finance Admin — Commission run review**: finalize action should be clicked
  through the CommissionRunReview UI, not called via raw `fetch`.
- **Producer — Hold status reasons**: guarantee-window and pending-approval hold
  reasons should each have a dedicated browser assertion.
- **Manager — Team commission view**: exception requests panel should be
  explicitly tested; encrypted field decryption failure should be resolved or
  explicitly skipped with a documented reason.
- **Executive — Financial position**: at least one seeded metric value should be
  asserted in the DOM, not just "component did not crash."
- **Executive — Profitability**: dimension-switcher should be clicked and the
  resulting data change asserted.
