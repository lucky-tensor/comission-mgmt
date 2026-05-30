# Product Requirements Document

## 1. Problem Statement

Direct-hire and retained search firms produce hiring outcomes through a chain of contributors — business development, account ownership, sourcing, research, candidate qualification, process management, offer negotiation, invoicing, and post-placement risk management. The economics attached to each placement are multi-party, variable by business model, and subject to change after the hire. (Contract and temp staffing economics — timesheet-driven gross profit — are not the initial customer profile; see §8.)

Today, firms manage these economics through a combination of spreadsheets, ATS fields, accounting exports, emails, and manager judgment. The result is a fragmented record that no single stakeholder fully trusts: attribution disputes go unresolved, commission calculations are opaque to producers, finance teams spend cycles reconstructing deal history, clawback exposure is poorly tracked, and leadership lacks reliable margin visibility.

The core problem is not that commissions are hard to calculate. It is that the full economic lifecycle of a placement — who contributed, what revenue was created, what risk remains, and who should be paid when — has no governed, auditable home. When that record does not exist, trust breaks down, disputes escalate, and the commission process becomes a recurring operational and cultural liability.

The initial buying trigger is commission-close pain: firms adopt the platform to **close commissions faster, with fewer disputes and less finance rework**. Payout transparency and split-dispute resolution are the felt symptoms that drive the purchase. The broader "governed economic ledger for every placement" capability deepens from that beachhead rather than being the opening pitch.

---

## 2. Goals and Success Metrics

### Goals

1. Give every placement a complete, governed economic record that all stakeholders agree is the source of truth.
2. Reduce the time and manual effort required to close a commission cycle.
3. Give producers continuously updated, explainable visibility into their expected payouts, reflecting the latest placement, invoice, and approval data.
4. Give finance accurate, approval-gated, payroll-ready commission output.
5. Give executives and managers reliable margin, liability, and dispute-rate visibility.

### Success Metrics

**Operational (customer-level)**
- Commission close cycle time reduced
- Manual payroll adjustments per cycle reduced
- Disputed commissions per cycle reduced
- Finance hours spent reconstructing deal history reduced
- Producer questions to finance per cycle reduced
- Placements blocked by incomplete data reduced

**Product adoption**
- Time from account activation to first approved commission run
- Percentage of placements with complete attribution data
- Percentage of credited producers actively viewing payout statements
- Number of disputes initiated and resolved within the platform
- Number of payroll exports generated per period

**Strategic**
- Reduction in commission overpayment as a share of revenue
- Improvement in net fee income and gross profit visibility
- Reduction in exception rate over time (as plans stabilize)

Baseline values for operational metrics are captured during onboarding so that improvement is measured against each customer's own starting point.

---

## 3. User Roles

| Role | Description |
|---|---|
| **Finance Admin** | Controllers, commission accountants, and operations staff who manage placements, run commission calculations, approve payout runs, and export to payroll. |
| **Producer** | Recruiters, account managers, business development producers, and sourcers who are credited on placements and want visibility into their compensation. |
| **Manager** | Delivery leads, recruiting managers, and practice leads who oversee team production, approve splits, and resolve attribution disputes. |
| **Executive** | COOs, CFOs, CEOs, and managing partners who need margin, liability, dispute, and producer concentration visibility. |
| **HR / People Ops** | HR and people operations staff who manage plan acknowledgments, draw balances, and termination payout rules. |
| **External Partner** | External split partners and affiliate recruiters who participate in specific deals and need limited visibility into their own payouts. |

---

## 4. User Stories

### Finance Admin
- As a Finance Admin, I want to see all placements that are missing required fields so that I can resolve data gaps before running commissions.
- As a Finance Admin, I want to run a commission cycle, review each calculated payout, and approve the batch before it reaches payroll, so that no unreviewed amounts are disbursed.
- As a Finance Admin, I want to export an approved, payroll-ready file at the end of each commission cycle so that I can submit it to payroll without manual rework.
- As a Finance Admin, I want to track invoice and collection status per placement and per billing phase so that collection-gated commissions are released accurately at the phase level and a paid retainer does not release held delivery commission prematurely.
- As a Finance Admin, I want to apply adjustments — refunds, credit memos, clawbacks — as new ledger entries with an audit trail, so that history is never silently overwritten.

### Producer
- As a Producer, I want to see the credit I received on each placement — my role, the split percentage, the commissionable base, and the calculated amount — so that I do not need to ask finance how my payout was determined.
- As a Producer, I want to see my current tier progress and the threshold I need to reach the next rate, so that I can make informed decisions about my pipeline.
- As a Producer, I want to see which of my payouts are held, and why (collection gate, guarantee window, pending approval), so that I know when to expect payment.
- As a Producer, I want to submit a question or dispute about a payout within the platform so that I have a documented record of the resolution.

### Manager
- As a Manager, I want to approve or modify split allocations for deals on my team before they are finalized, so that credit disputes are resolved upstream of payroll.
- As a Manager, I want to see an attribution timeline for any deal so that I can resolve ownership disputes with evidence rather than memory.
- As a Manager, I want to view my team's commission accruals, pending payouts, and exception requests so that I can manage performance with accurate data.
- As a Manager, I want to escalate a cross-team or contested split to a designated tiebreaker so that disputes spanning teams have a defined resolution path rather than a stalemate.

### Executive
- As an Executive, I want to see gross fees, net fee income, commission accrued, commission payable, and clawback exposure in one view so that I can assess the firm's financial position.
- As an Executive, I want to see profitability by client, recruiter, team, and practice so that I can identify margin concentration and low-margin relationships.
- As an Executive, I want to see the exception rate and dispute rate over time so that I can evaluate whether commission plan rules are working.
- As an Executive, I want to act as the final approver on escalated attribution disputes so that contested credit is resolved with documented authority.

### HR / People Ops
- As an HR operator, I want producers to acknowledge their commission plan in the platform so that there is a documented record of plan acceptance.
- As an HR operator, I want to view draw balances and recovery schedules for each producer so that I can answer questions about compensation without relying on spreadsheets.

### External Partner
- As an External Partner, I want to see the deals where I have a split agreement, the amounts owed to me, and the payment status, so that I do not need to follow up manually.

---

## 5. Core Workflows

*A day in the life — month-end commission close.* At month-end, a Finance Admin imports the period's placements and their current invoice and collection status. Managers review and approve the split allocations on their teams' deals. Incomplete records and flagged exceptions surface in a review queue and are resolved. Producers watch their expected payouts update as placement and collection data lands. Once every placement in the cycle is reviewed and approved, finance generates an approved, payroll-ready export and hands it to payroll. This recurring close — not a one-time setup — is the workflow the product is built around. The subsections below detail each step.

### 5.1 Placement Ledger Creation

A placement record is created either by import from a connected applicant tracking system or by manual entry. The record captures the client, job order, candidate, start date, fee agreement, compensation base, and placed compensation (base salary, bonus, and other compensation components). The platform is the system of record for placed compensation data — it is not sourced from the ATS or the financial system. The record is incomplete — and blocked from commission calculation — until all required fields are present.

For retained searches, the placement carries named billing phases — typically **retainer** and **delivery** — each representing a distinct invoicing event with its own projected, billed, and received amounts. Contributor credit assignments (originator, converter, delivery) may differ between phases; commission for each phase is calculated against the revenue credited to that phase independently (see §5.3, §5.5).

### 5.2 Contribution Assignment

Contributors are assigned to the placement with their role (client originator, account owner, job owner, candidate sourcer, candidate owner, delivery credit, manager override, external partner), their practice, and their split credit (percentage or point allocation). Practice is a configurable organizational grouping — typically a team or industry vertical — that drives reporting rollups, visibility scoping, and management hierarchy. Split assignments are subject to manager approval before finalization.

### 5.3 Commission Calculation

The commission rules engine applies the plan associated with each contributor to their credited base. Each search carries a named fee rate structure — expressed as a percentage of placed compensation, a fractional share of gross fee, or a flat amount — which determines the commissionable base before plan rates are applied. Fee rate structures are customer-configurable. Calculations further account for: tiers and thresholds, desk cost recovery, draw balance offset, manager overrides, team pool allocations, retainer milestone treatment, and holdback or clawback conditions. Every calculated payout includes a plain-language explanation traceable to the deal record, fee rate structure, plan version, and triggering event.

### 5.4 Approval and Exception Handling

Finance Admins review the commission run before it is finalized. Placements with missing data, disputed attribution, or flagged exceptions are surfaced in a review queue. Exceptions — custom splits, fee discounts, accelerated payouts, manual overrides, draw forgiveness, clawback waivers — are requested, documented with a reason, and approved or rejected with a full audit trail.

Attribution disputes that cannot be resolved at the producer and manager level are escalated to a designated approver — manager, practice lead, or executive, per the customer's configured hierarchy. The escalation, the deciding actor, and the rationale are recorded in the audit trail. A disputed split blocks the affected placement from the commission run until it is resolved.

### 5.5 Invoice and Collection Tracking

Each placement is linked to one or more invoices. For retained searches, invoices belong to a named billing phase (retainer or delivery), and each phase is tracked independently through its own Projected → Billed → Received lifecycle. Invoice status (issued, partially paid, paid, disputed, written off) is updated by import or manual entry.

For commission plans that gate payout on cash collection, collection gating applies at the phase level: commission credited to the retainer phase is held until the retainer invoice is marked paid; commission credited to the delivery phase is held until the delivery invoice is marked paid. A paid retainer does not release held delivery commission. Producers can see which payouts are blocked, at which phase, and why.

### 5.6 Guarantee Monitoring

The platform tracks the guarantee expiration date for each placement. Placements inside the guarantee window are flagged. If a candidate departure or refund event is recorded, the platform applies the applicable rule (clawback, holdback, refund, replacement search) and posts a ledger adjustment. Affected producers are notified, and a payroll recovery schedule is generated if needed.

### 5.7 Commission Close and Payroll Export

After all placements in a cycle are reviewed and approved, Finance Admins generate a payroll-ready export containing each producer's approved payout, draw recovery amounts, and clawback recoveries. The export is produced in the import format expected by the customer's payroll system so that submission requires no manual reformatting or re-keying. The export is the final step before payroll submission; no commission amount reaches payroll without prior approval.

### 5.8 Financial Reconciliation

Finance Admins generate a reconciliation report that cross-checks billed and received amounts in the commission ledger against the firm's financial system of record. The report surfaces discrepancies — amounts present in one system but not the other, or timing gaps between billed and received dates — so that errors can be identified and corrected before commissions are finalized. This reconciliation is a required step in the month-end close, not an optional audit tool.

### 5.9 Producer Payout Portal

Producers access a personal view showing their credited placements, commission calculations, tier progress, holdback status, payment trigger, estimated payout cycle, and historical payouts. Each payout figure reflects the most recent placement and collection data and is stamped with the data it was derived from, so producers understand how current it is. Producers can submit questions or disputes from this view.

### 5.10 Onboarding and Data Import

Customers onboard through a guided import that maps existing applicant tracking, CRM, and accounts receivable data to the placement ledger. Records with missing or ambiguous required fields — including attribution and split credit that were never captured in structured ATS fields — are routed to a reconciliation queue for assisted resolution rather than silently dropped. The platform supports assisted import of historical placements so that early commission runs can reference prior deal history. Data completeness gating (§9) applies to imported records identically to manually entered records.

### 5.11 External Partner Access

External partners receive scoped, in-platform access limited to the deals where they hold a split agreement. They see the amounts owed to them, the payment trigger, and the payment status for those deals. Partners cannot view other contributors' credit, internal margin, draw balances, or any firm-wide data.

---

## 6. Entity Lifecycle

### Placement

`Created` → `Contributors Assigned` → `Pending Approval` → `Active` → `Invoiced` → `Collected` → `Guarantee Active` → `Guarantee Expired` → `Closed`

Alternate paths: `Active` → `Refunded` or `Disputed`; `Guarantee Active` → `Clawback Triggered`

### Commission (per participant)

`Accrued` → `Pending Approval` → `Approved` → `Held` (collection gate or guarantee window) → `Payable` → `Paid`

Alternate paths: `Paid` → `Clawback Initiated` → `Recovered`

### Invoice

`Issued` → `Partially Paid` → `Paid`

Alternate paths: `Issued` → `Disputed`; `Issued` → `Written Off` / `Credit Memo Applied`

### Guarantee Period

`Active` → `Expired (Clean)`

Alternate path: `Active` → `Triggered` (candidate departure or refund event) → `Clawback / Holdback Applied`

### Draw Balance

`Active` → `Partially Recovered` → `Fully Recovered`

Alternate path: `Active` → `Forgiven`

### Exception

`Requested` → `Under Review` → `Approved` / `Rejected`

### Plan Version

`Draft` → `Active` → `Superseded`

### Practice

`Active` → `Inactive`

A practice is a configurable organizational grouping (team, industry vertical, or business unit) to which contributors belong. It appears on every contributor line, drives reporting aggregation by practice, and determines the management hierarchy used for visibility scoping and dispute escalation.

---

## 7. Integration Needs

### Applicant Tracking and CRM Data

The platform ingests placement, job order, candidate, submission, and contributor data from applicant tracking and CRM systems. The ATS is the source of search and contributor identity data; the commission record itself originates in this platform, not in the ATS. Business event triggers: placement record created or updated, offer accepted, candidate submitted, ownership assigned.

ATS platforms in this segment undergo periodic re-platforming. The integration layer must tolerate API and schema changes without requiring full re-implementation — adapters should be versioned and decoupled from the core data model.

### Accounts Receivable and Invoice Data

The platform receives invoice issuance, payment, partial payment, credit memo, and write-off events from the firm's financial system of record. This data drives collection-gated commission release and feeds the financial reconciliation workflow (§5.8). The platform also produces a reconciliation report for cross-checking billed and received amounts against the financial system. Business event triggers: invoice issued, payment recorded, credit memo applied.

### Payroll System Export

The platform delivers approved, payroll-ready payout output for submission to a payroll system. Business event trigger: Finance Admin approves a commission run and initiates the handoff to payroll.

### Document and File Storage

The platform stores commission plan documents, exception attachments, and audit evidence. Business event triggers: plan version published and acknowledged, exception submitted with supporting document.

---

## 8. Out of Scope

The following are explicitly out of scope:

- **Contract staffing gross profit engine** — timesheet-based calculations using bill rate, pay rate, hours, burden, and overtime adjustments are not supported. The platform calculates commissions for direct-hire and retained search placements; hybrid firms manage their direct-hire and retained desks on the platform.
- **Multi-currency** — the platform operates in a single currency.
- **Automated contract ingestion** — structured fee terms are entered manually or imported in a structured format. Automated parsing of unstructured contract documents is not included.
- **Plan simulation** — modeling the impact of plan changes before rollout is not supported.
- **Client-facing portal** — clients do not have access to any part of the platform.
- **Direct payroll integration** — the platform does not maintain native two-way connections to payroll systems. Approved payout output is produced as a payroll-ready export for downstream submission.

---

## 9. Constraints

### Audit and Compliance
- All changes to placement records, commission calculations, split assignments, and approvals must be permanently recorded — never silently overwritten — with timestamp, actor, and reason.
- Commission plan versions must be versioned, date-stamped, and linked to producer acknowledgments.
- No commission amount may reach payroll without an explicit approval action by an authorized Finance Admin.

### Explainability
- Every calculated payout must produce a plain-language explanation traceable to the placement record, fee terms, split assignment, plan version, and any triggering events (collection, guarantee expiration, clawback).
- Producers must be able to see the full derivation of their payout without assistance from finance.

### Data Completeness Gating
- A commission run cannot be approved if any included placement has required fields missing. The platform surfaces a blocking queue of incomplete records before the run can proceed.

### Data Security and Need-to-Know Access
- All placement, commission, and contributor data is encrypted at the database level. Encryption is not conditional on record sensitivity — it is the baseline posture for all data in the system.
- Field-level access is governed by role and placement relationship. A user is authorized to see only the data their role and credited involvement entitle them to; access to any record or field is denied by default and granted explicitly, not inherited by proximity to adjacent records.
- Placements carry a confidential flag set by Finance Admin at the time of record creation. When set, the position title and client-identifying details are masked in producer-facing payout statements, external partner views, and any export or report that surfaces placement-level detail. Confidential status does not affect the commission calculation, approval workflow, or audit trail — it controls only what identifying information is presented in stakeholder-facing views.

### Visibility and Confidentiality
- A producer sees the full derivation of their own credit on any placement, including co-contributors' roles where that is required to explain a split, but does not see other producers' payout amounts, plan assignments, draw balances, or firm-wide financials.
- Manager and executive visibility is scoped to their team, practice, or organization per the customer's configured hierarchy.
- External partner visibility is limited to their own participation (see §5.11).

### Employment Law
- Clawback and draw recovery terms are configured by the customer. The platform surfaces balances, schedules, and adjustments. Legal enforceability of specific terms under applicable employment law is the responsibility of the customer and their counsel.

---

## 10. Open Questions

1. **Segment priority** — Within the direct-hire and retained search ICP (§8), which segment has the most acute near-term pain: contingency search, retained search, or hybrid (contingency + retained) firms? This determines MVP data model scope.
2. **ATS integration priority** — Which applicant tracking systems represent the highest concentration in the target segment and should be prioritized for the first live integrations?
3. **Configurability threshold** — How much plan configurability is required for initial customers to replace their spreadsheets? Specifically: are retroactive tiers, draw recovery, and team pools required at launch, or can they be deferred?
4. **Plan acknowledgment workflow** — Is digital plan acknowledgment by producers a requirement for initial customers, or a later compliance add-on?
5. **Buyer title** — Which title most commonly signs the check: COO, CFO, CEO, or managing partner? The commission-close wedge (§1) presumes an operations-accountable buyer (most likely the COO), but the specific signing title still affects sales motion and remains to be validated.
6. **Pricing model** — Is per-producer-per-month pricing the strongest fit, or do customers respond better to per-placement or commission-volume-based pricing?
