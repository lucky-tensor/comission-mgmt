# Product Requirements Document

## 1. Problem Statement

Recruiting and staffing firms produce hiring outcomes through a chain of contributors — business development, account ownership, sourcing, research, candidate qualification, process management, offer negotiation, invoicing, and post-placement risk management. The economics attached to each placement are multi-party, variable by business model, and subject to change after the hire.

Today, firms manage these economics through a combination of spreadsheets, ATS fields, accounting exports, emails, and manager judgment. The result is a fragmented record that no single stakeholder fully trusts: attribution disputes go unresolved, commission calculations are opaque to producers, finance teams spend cycles reconstructing deal history, clawback exposure is poorly tracked, and leadership lacks reliable margin visibility.

The core problem is not that commissions are hard to calculate. It is that the full economic lifecycle of a placement — who contributed, what revenue was created, what risk remains, and who should be paid when — has no governed, auditable home. When that record does not exist, trust breaks down, disputes escalate, and the commission process becomes a recurring operational and cultural liability.

---

## 2. Goals and Success Metrics

### Goals

1. Give every placement a complete, governed economic record that all stakeholders agree is the source of truth.
2. Reduce the time and manual effort required to close a commission cycle.
3. Give producers real-time, explainable visibility into their expected payouts.
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
- As a Finance Admin, I want to track invoice and collection status per placement so that collection-gated commissions are released accurately.
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

### Executive
- As an Executive, I want to see gross fees, net fee income, commission accrued, commission payable, and clawback exposure in one view so that I can assess the firm's financial position.
- As an Executive, I want to see profitability by client, recruiter, team, and practice so that I can identify margin concentration and low-margin relationships.
- As an Executive, I want to see the exception rate and dispute rate over time so that I can evaluate whether commission plan rules are working.

### HR / People Ops
- As an HR operator, I want producers to acknowledge their commission plan in the platform so that there is a documented record of plan acceptance.
- As an HR operator, I want to view draw balances and recovery schedules for each producer so that I can answer questions about compensation without relying on spreadsheets.

### External Partner
- As an External Partner, I want to see the deals where I have a split agreement, the amounts owed to me, and the payment status, so that I do not need to follow up manually.

---

## 5. Core Workflows

### 5.1 Placement Ledger Creation

A placement record is created either by import from a connected applicant tracking system or by manual entry. The record captures the client, job order, candidate, start date, fee agreement, and compensation base. The record is incomplete — and blocked from commission calculation — until all required fields are present.

### 5.2 Contribution Assignment

Contributors are assigned to the placement with their role (client originator, account owner, job owner, candidate sourcer, candidate owner, delivery credit, manager override, external partner) and their split credit (percentage or point allocation). Split assignments are subject to manager approval before finalization.

### 5.3 Commission Calculation

The commission rules engine applies the plan associated with each contributor to their credited base. Calculations account for: percentage of gross fee or net fee income, tiers and thresholds, desk cost recovery, draw balance offset, manager overrides, team pool allocations, retainer milestone treatment, and holdback or clawback conditions. Every calculated payout includes a plain-language explanation traceable to the deal record, plan version, and triggering event.

### 5.4 Approval and Exception Handling

Finance Admins review the commission run before it is finalized. Placements with missing data, disputed attribution, or flagged exceptions are surfaced in a review queue. Exceptions — custom splits, fee discounts, accelerated payouts, manual overrides, draw forgiveness, clawback waivers — are requested, documented with a reason, and approved or rejected with a full audit trail.

### 5.5 Invoice and Collection Tracking

Each placement is linked to one or more invoices. Invoice status (issued, partially paid, paid, disputed, written off) is updated by import or manual entry. For commission plans that gate payout on cash collection, commission is held until the linked invoice is marked paid. Producers can see which payouts are blocked and why.

### 5.6 Guarantee Monitoring

The platform tracks the guarantee expiration date for each placement. Placements inside the guarantee window are flagged. If a candidate departure or refund event is recorded, the platform applies the applicable rule (clawback, holdback, refund, replacement search) and posts a ledger adjustment. Affected producers are notified, and a payroll recovery schedule is generated if needed.

### 5.7 Commission Close and Payroll Export

After all placements in a cycle are reviewed and approved, Finance Admins generate a payroll-ready export containing each producer's approved payout, draw recovery amounts, and clawback recoveries. The export is the final step before payroll submission; no commission amount reaches payroll without prior approval.

### 5.8 Producer Payout Portal

Producers access a personal view showing their credited placements, commission calculations, tier progress, holdback status, payment trigger, estimated payout cycle, and historical payouts. Producers can submit questions or disputes from this view.

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

---

## 7. Integration Needs

### Applicant Tracking and CRM Data

The platform ingests placement, job order, candidate, submission, and contributor data from applicant tracking and CRM systems. Business event triggers: placement record created or updated, offer accepted, candidate submitted, ownership assigned. Early implementations may use file-based import in place of a live connection.

### Accounts Receivable and Invoice Data

The platform receives invoice issuance, payment, partial payment, credit memo, and write-off events from accounting and AR systems. This data drives collection-gated commission release. Business event triggers: invoice issued, payment recorded, credit memo applied.

### Payroll System Export

The platform produces an approved, structured payout file for import into a payroll system. Business event trigger: Finance Admin approves a commission run and initiates export. Early implementations may use a structured file export in place of a direct integration.

### Document and File Storage

The platform stores commission plan documents, exception attachments, and audit evidence. Business event triggers: plan version published and acknowledged, exception submitted with supporting document.

---

## 8. Out of Scope

The following are explicitly out of scope for the initial release:

- **Contract staffing gross profit engine** — timesheet-based calculations using bill rate, pay rate, hours, burden, and overtime adjustments are not supported. Direct-hire and retained search placements are the initial focus.
- **Multi-currency** — the platform supports a single operating currency. Multi-currency support is a future capability.
- **Automated contract ingestion** — structured fee terms are entered manually or imported in a structured format. Automated parsing of unstructured contract documents is not included.
- **Plan simulation** — modeling the impact of plan changes before rollout is not supported in the initial release.
- **Client-facing portal** — clients do not have access to any part of the platform.
- **Direct payroll integration** — the initial release produces a payroll-ready export file. Native two-way payroll system connections are a future capability.

---

## 9. Constraints

### Audit and Compliance
- All changes to placement records, commission calculations, split assignments, and approvals must be recorded in an immutable audit log with timestamp, actor, and reason.
- Commission plan versions must be versioned, date-stamped, and linked to producer acknowledgments.
- No commission amount may reach payroll without an explicit approval action by an authorized Finance Admin.

### Explainability
- Every calculated payout must produce a plain-language explanation traceable to the placement record, fee terms, split assignment, plan version, and any triggering events (collection, guarantee expiration, clawback).
- Producers must be able to see the full derivation of their payout without assistance from finance.

### Data Completeness Gating
- A commission run cannot be approved if any included placement has required fields missing. The platform surfaces a blocking queue of incomplete records before the run can proceed.

### Employment Law
- Clawback and draw recovery terms are configured by the customer. The platform surfaces balances, schedules, and adjustments. Legal enforceability of specific terms under applicable employment law is the responsibility of the customer and their counsel.

---

## 10. Open Questions

1. **Segment priority** — Which segment has the most acute near-term pain: contingency search, retained search, hybrid search, or staffing firms with gross profit models? This determines MVP data model scope.
2. **Primary wedge** — Is the strongest buying trigger finance commission close efficiency, attribution and split dispute reduction, recruiter payout transparency, or guarantee/clawback risk management?
3. **ATS integration priority** — Which applicant tracking systems represent the highest concentration in the target segment and should be prioritized for the first live integrations?
4. **Configurability threshold** — How much plan configurability is required for initial customers to replace their spreadsheets? Specifically: are retroactive tiers, draw recovery, and team pools required at launch, or can they be deferred?
5. **External partner access** — How important is external partner portal access for early customers? Do split partners need in-platform visibility at launch, or is a payout statement emailed to them sufficient?
6. **Plan acknowledgment workflow** — Is digital plan acknowledgment by producers a requirement for initial customers, or a later compliance add-on?
7. **Buyer title** — Which title most commonly signs the check: COO, CFO, CEO, or managing partner? This affects positioning and sales motion.
8. **Contract staffing timeline** — At what point does the absence of a gross profit engine become a deal-blocker for target customers?
9. **Data quality risk** — How much of the target segment's ATS data is clean enough to support automated calculation? Will a concierge-assisted import phase be required for most early customers?
10. **Pricing model** — Is per-producer-per-month pricing the strongest fit, or do customers respond better to per-placement or commission-volume-based pricing?
