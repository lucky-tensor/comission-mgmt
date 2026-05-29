# Canonical Document 2: Product Hypotheses

## Recruiting Commission Operations Platform

### Purpose

This document captures product hypotheses for a SaaS product serving recruiting, search, headhunting, and staffing firms. Unlike the industry background document, this document is intentionally speculative. It should evolve through customer discovery, workflow observation, prototype testing, and willingness-to-pay validation.

The central hypothesis is that recruiting firms do not merely need commission calculation. They need deal-level economic observability: a governed system that explains who contributed to a placement, what economics apply, what risk remains, and who should be paid when.

---

# 1. Product Thesis

Recruiting firms suffer from opaque deal economics. Every successful hire contains a hidden chain of contribution, ownership, risk, finance events, and compensation rules. Today, much of that chain is managed through spreadsheets, ATS fields, emails, manager judgment, accounting exports, and payroll files.

The product opportunity is to create a recruiting-native commission operations platform that becomes the trusted economic ledger for every placement, search, assignment, and payout.

The product should answer:

1. Who contributed to this deal?
2. What did each participant do?
3. What revenue was created?
4. What deductions, splits, refunds, or costs apply?
5. What is the commissionable base?
6. Which commission plan applies?
7. What is payable now?
8. What is held, accrued, disputed, or clawback-exposed?
9. What has already been paid?
10. Can finance, leadership, and the producer all understand the same answer?

---

# 2. Primary Product Hypothesis

## Hypothesis 1: Recruiting firms need a commission ledger, not a commission calculator.

A generic commission calculator computes payouts. A recruiting commission ledger records the full economic lifecycle of a placement.

It should include:

* Placement record
* Client and job order
* Candidate and submission history
* Fee agreement
* Compensation base
* Gross fee
* External splits
* Internal credit allocation
* Net fee income
* Gross profit, when applicable
* Commission plan
* Participant-level calculations
* Invoice and collection status
* Guarantee exposure
* Holdbacks
* Clawbacks
* Adjustments
* Approvals
* Payroll status
* Audit log

Validation questions:

* How many systems does the firm currently use to determine one commission payout?
* How often does finance need to reconstruct deal history?
* How often do recruiters dispute payout math?
* What percentage of placements require manual adjustment?
* Does the COO or CFO have a trusted view of commission liability?

---

# 3. Target Customers

## 3.1 Ideal Early Customer Profile

The strongest early customers may be firms with:

* 20–500 recruiters or producers
* Multiple commission plans
* Split-desk or team-based recruiting
* Mix of contingency and retained search
* External split partners
* Meaningful finance or payroll workload
* Regular commission disputes
* Growth, acquisition, or multi-office complexity
* COO, CFO, or RevOps owner actively trying to standardize operations

## 3.2 Less Ideal Early Customers

The product may be less urgent for:

* Very small founder-led firms with 1–5 producers
* Pure solo recruiters
* Firms with simple one-person, one-fee commission plans
* Firms with no base salary and informal partner economics
* Clients that only need simple payroll exports
* Internal corporate recruiting teams with no agency commission economics

## 3.3 Customer Segments to Test

Segments:

1. Contingency recruiting agencies
2. Retained executive search firms
3. Hybrid retained/contingency search firms
4. Contract staffing firms
5. Healthcare staffing firms
6. Technology recruiting firms
7. Professional services staffing firms
8. Split-placement networks
9. Multi-office recruiting firms
10. Private-equity-backed recruiting platforms

Key segmentation hypothesis:

The pain is highest where contribution is multi-party, commission plans are variable, and finance must reconcile payouts against collections, guarantees, and margin.

---

# 4. Buyer, User, and Influencer Map

## 4.1 Economic Buyer

Likely buyers:

* COO
* CFO
* CEO / founder
* Managing partner
* VP Operations
* Head of Finance

Buyer pain:

* Lack of control
* Too many exceptions
* Slow commission close
* Margin leakage
* Producer disputes
* Weak auditability
* Poor scalability
* M&A readiness concerns

## 4.2 Daily Admin Users

Likely admin users:

* Controller
* Commission accountant
* Finance operations
* Payroll
* RevOps
* SalesOps
* ATS admin

Admin pain:

* Manual calculations
* Missing data
* Spreadsheet maintenance
* Last-minute payroll changes
* Reconciliation work
* Explaining payouts
* Handling credit memos and clawbacks

## 4.3 Producer Users

Likely producer users:

* Recruiters
* Sourcers
* Account managers
* Business development producers
* Practice leads
* External split partners

Producer pain:

* Unclear credit
* Delayed payouts
* No visibility into payout status
* Tier confusion
* Clawback uncertainty
* Lack of trust in finance
* Shadow spreadsheets

## 4.4 Executive Users

Likely executive users:

* CEO
* COO
* CFO
* Practice leader
* Board or investors

Executive needs:

* Margin by client, desk, and practice
* Commission liability
* Revenue quality
* Producer concentration
* Dispute rate
* Forecasted payout obligations
* Clawback exposure
* Plan performance

---

# 5. Core Jobs To Be Done

## 5.1 COO Job

“When a placement happens, I want the full economic workflow to be standardized and auditable so that the company can scale without every commission cycle becoming a dispute cycle.”

## 5.2 CFO Job

“When we book, invoice, collect, refund, or adjust revenue, I want commission liability to update correctly so that we do not overpay, underpay, or misstate margin.”

## 5.3 Recruiter Job

“When I contribute to a placement, I want to know what credit I received, how my commission was calculated, when I will be paid, and what could change.”

## 5.4 Manager Job

“When my team collaborates on a deal, I want clear rules for splits and exceptions so that I can manage performance instead of arbitrating politics.”

## 5.5 Finance Job

“When commissions are due, I want a clean, approved, payroll-ready file with calculations that can be traced back to deals, invoices, collections, and plan rules.”

## 5.6 CEO Job

“When the firm grows, I want compensation to reinforce collaboration, profitability, and trust rather than becoming a bottleneck or cultural liability.”

---

# 6. Pain Hypotheses

## Hypothesis 2: The most painful problem is not calculation; it is attribution.

Recruiting commissions become contentious because multiple people can credibly claim contribution.

Common attribution questions:

* Who originated the client?
* Who owns the account?
* Who owns the job order?
* Who sourced the candidate?
* Who first contacted the candidate?
* Who qualified the candidate?
* Who submitted the candidate?
* Who closed the offer?
* Who receives manager or practice override?
* Does an external partner receive part of the fee?

Validation questions:

* How often are split disputes escalated?
* Who has final authority to resolve attribution?
* What evidence is used?
* Are ownership rules written, enforced, or informal?
* Do producers maintain personal proof outside official systems?

## Hypothesis 3: Finance is absorbing the cost of upstream data ambiguity.

Finance often becomes the final reconciliation layer for incomplete ATS, CRM, and deal records.

Validation questions:

* How many placements are blocked by missing fields?
* How long does monthly commission close take?
* How often does finance ask recruiters or managers to clarify deal data?
* How many manual payroll adjustments happen each cycle?
* What are the most common causes of commission rework?

## Hypothesis 4: Recruiter trust is a product problem.

If producers cannot understand their commission, they create shadow spreadsheets, distrust finance, resist collaboration, and escalate disputes.

Validation questions:

* Do recruiters have real-time visibility into expected commission?
* Can they see why a payout changed?
* Can they track tier progress?
* Can they see guarantee or clawback exposure?
* How many payout questions does finance receive per cycle?

## Hypothesis 5: Guarantee and clawback workflows are under-managed.

Guarantee periods, candidate fallout, refunds, credits, and replacement searches materially change economics after the placement.

Validation questions:

* How are guarantee windows tracked today?
* Are commissions held until the guarantee expires?
* Are clawbacks common?
* How are partial refunds handled?
* Can finance easily identify commission at risk?

## Hypothesis 6: Contract terms are not operationalized.

Fee percentages, ownership windows, payment terms, refund rights, and replacement obligations often live in agreements but not in workflow systems.

Validation questions:

* Where are client fee terms stored?
* Are terms machine-readable?
* Who checks fee terms before invoicing?
* How are client-specific exceptions handled?
* How often are incorrect fee terms applied?

## Hypothesis 7: Margin visibility is weak.

Many firms know gross billings but have weak visibility into net fee income, gross profit, commission burden, external splits, write-offs, and client-level profitability.

Validation questions:

* Can leadership see profitability by client, recruiter, team, and practice?
* Are commissions calculated on gross or net economics?
* Does the firm model plan changes before rollout?
* Are low-margin clients visible?
* Are external split costs tracked consistently?

---

# 7. Product Principles

## 7.1 Recruiting-Native, Not Generic Sales Comp

The product must understand recruiting-specific entities:

* Candidate
* Job order
* Search
* Submission
* Interview
* Offer
* Placement
* Start date
* Guarantee period
* Candidate ownership
* Client ownership
* External split partner
* Retainer milestone
* Contract assignment
* Timesheet
* Bill rate
* Pay rate
* Gross profit

## 7.2 Explainability Over Black-Box Automation

Every calculated payout should be explainable in plain language.

Example explanation:

“You received 50% candidate-side credit on a $30,000 placement. Your credited base was $15,000. Your current quarterly tier rate is 20%, producing $3,000 commission. Payment is pending client collection. The placement is inside a 90-day guarantee window until August 15.”

## 7.3 Ledger, Not Mutable Spreadsheet

Approved deal economics should be posted as ledger entries. Adjustments should be recorded as new entries, not silent overwrites.

## 7.4 Workflow Before Analytics

Analytics are only trusted if the underlying workflow creates reliable data. The product must first make placements, splits, approvals, collections, and payout statuses operationally clean.

## 7.5 Exceptions Are First-Class

Recruiting firms will always have exceptions. The product should not assume perfect standardization. It should make exceptions explicit, approved, auditable, and measurable.

## 7.6 Trust for Producers, Control for Finance

The product must serve both emotional and financial needs:

* Producers need visibility and fairness.
* Finance needs accuracy and control.
* Executives need margin and risk visibility.

---

# 8. Proposed Product Modules

## 8.1 Deal Ledger

The core record for each placement, search, assignment, or commissionable event.

Capabilities:

* Store gross fee, net fee income, gross profit, and commissionable base
* Record all contributors and their roles
* Record split percentages or point allocations
* Track invoices, collections, refunds, and credit memos
* Track guarantee windows and clawback exposure
* Show payout history
* Preserve audit trail

## 8.2 Contribution Graph

A timeline and graph of who did what.

Contribution events:

* Client originated
* Account assigned
* Job order created
* Role qualified
* Candidate sourced
* Candidate contacted
* Candidate qualified
* Candidate submitted
* Candidate interviewed
* Offer negotiated
* Placement closed
* Invoice issued
* Cash collected
* Guarantee expired

Hypothesis:

Visual attribution will reduce disputes and help firms standardize what counts as commissionable work.

## 8.3 Commission Rules Engine

Configurable plan logic.

Required rules:

* Percentage of gross fee
* Percentage of net fee income
* Percentage of gross profit
* Fixed bounty
* Tiered commission
* Thresholds and desk costs
* Draw recovery
* Manager overrides
* Team pools
* Point-based allocations
* External split deductions
* Retainer milestone treatment
* Cash-collected gating
* Guarantee holdbacks
* Clawbacks
* Plan versioning
* Role-based eligibility
* Retroactive versus marginal tiers
* Currency conversion

## 8.4 Contract Terms Engine

A structured representation of client fee terms.

Fields:

* Fee percentage
* Compensation base
* Payment terms
* Guarantee period
* Refund or replacement rule
* Ownership window
* Candidate consent requirement
* Exclusivity
* Expenses
* Retainer milestones
* Client entity
* Geography or practice restrictions
* Special exceptions

Hypothesis:

Converting contracts into operational rules will reduce fee leakage, invoice disputes, and guarantee errors.

## 8.5 Candidate Ownership Ledger

A record of candidate representation and submission evidence.

Capabilities:

* Track first contact
* Track consent
* Track source
* Track submission timestamp
* Track role and client submitted to
* Track ownership expiration
* Track duplicate submissions
* Track conflicting claims
* Store evidence

Hypothesis:

Ownership transparency is one of the strongest wedges because disputes are painful, frequent, and high-emotion.

## 8.6 Guarantee and Clawback Monitor

Post-placement risk workflow.

Capabilities:

* Track start date
* Calculate guarantee expiration
* Flag placements inside guarantee window
* Track candidate fallout
* Apply refund, credit, replacement, or clawback rules
* Notify participants
* Post ledger adjustment
* Generate payroll recovery schedule

## 8.7 Collections Bridge

Integration with accounting and AR systems.

Capabilities:

* Match placement to invoice
* Track invoice status
* Track partial payment
* Track cash collection
* Track credit memos
* Gate commission release
* Show blocked payouts
* Reconcile payable commission to cash

## 8.8 Participant Portal

Producer-facing transparency layer.

Capabilities:

* Expected commission
* Credited role
* Deal math
* Tier progress
* Payment trigger
* Payment status
* Holdback status
* Clawback exposure
* Historical payouts
* Draw balance
* Dispute or question workflow

Hypothesis:

A participant portal can reduce finance questions, increase trust, and improve adoption.

## 8.9 Exception Workflow

Governance for nonstandard treatment.

Examples:

* Custom split
* Fee discount
* Accelerated payout
* Manual override
* House account exception
* Draw forgiveness
* Clawback waiver
* Special partner agreement
* Post-termination payout exception

Capabilities:

* Request
* Approve
* Reject
* Reason code
* Attachment
* Audit trail
* Impact calculation
* Exception reporting

## 8.10 Executive Dashboard

Leadership visibility.

Metrics:

* Gross fees booked
* Net fee income
* Gross profit
* Commission accrued
* Commission payable
* Commission paid
* Commission held
* Clawback exposure
* Guarantee exposure
* Disputed commission
* Manual adjustment rate
* Exception rate
* Average time to commission close
* Recruiter production
* Client profitability
* Practice profitability
* Producer concentration
* Aging invoice impact on commissions
* Plan cost as percentage of revenue or gross profit

---

# 9. MVP Hypotheses

## MVP Hypothesis A: Start with direct-hire contingency and split-desk commission workflows.

Rationale:

* Direct-hire placements are discrete events.
* Split disputes create urgent pain.
* Gross fee and NFI calculations are easier than staffing GP.
* Recruiting-native attribution differentiates from generic commission tools.

MVP scope:

* Import or create placements
* Define fee, compensation base, and client terms
* Assign contributors and split credit
* Apply simple commission plans
* Track invoice and collection status manually or via lightweight integration
* Generate payout statements
* Provide approval workflow and audit trail
* Export payroll-ready file

Out of scope initially:

* Full contract staffing timesheet GP engine
* Complex multi-currency
* Automated contract ingestion
* Advanced plan simulation
* Full client portal

## MVP Hypothesis B: The wedge is finance close plus recruiter transparency.

Rationale:

A product that only helps finance may be seen as back-office tooling. A product that also reduces producer mistrust has broader organizational pull.

MVP must show:

* Finance saves time
* Recruiters ask fewer questions
* Managers resolve fewer disputes manually
* COO gets better visibility
* CFO sees lower overpayment risk

## MVP Hypothesis C: The first “aha” moment is a placement ledger that everyone agrees is true.

The product should make one placement legible:

* What was sold
* Who contributed
* What the client owes
* What the firm keeps
* Who gets paid
* Why they get paid
* When they get paid
* What could change

---

# 10. Discovery Questions

## 10.1 For COO

1. Walk me through what happens from placement to commission payout.
2. Where does the process break most often?
3. Who resolves commission disputes?
4. How many exceptions happen each cycle?
5. How long does commission close take?
6. What data do you wish you had but do not trust today?
7. How do you define client ownership, candidate ownership, and job ownership?
8. What happens when a candidate leaves during the guarantee period?
9. How do you know whether a commission plan is working?
10. What would make this problem urgent enough to buy software?

## 10.2 For CFO / Controller

1. Are commissions paid on booked, invoiced, collected, gross, net, or GP?
2. How are commission accruals calculated?
3. How do you reconcile placements to invoices?
4. How often are commissions overpaid or clawed back?
5. How are credit memos handled?
6. How do you forecast commission liability?
7. What is the most manual part of the process?
8. What payroll system do you use?
9. What accounting system do you use?
10. What would an audit-ready process look like?

## 10.3 For Recruiters

1. Do you know how your commission is calculated?
2. Do you maintain your own commission tracker?
3. What payout questions do you ask most often?
4. Have you ever disputed credit?
5. What evidence did you need?
6. Do clawbacks affect your behavior?
7. Do you avoid split deals?
8. Do you know when a placement becomes payable?
9. Do you trust the current process?
10. What would you want to see in a payout portal?

## 10.4 For Managers

1. How do you decide splits?
2. What disputes repeat?
3. What rules are written versus informal?
4. How do you handle house accounts?
5. Do commission rules encourage collaboration?
6. Do they create hoarding?
7. Can you see team profitability?
8. How often do you override standard rules?
9. How do you coach based on production economics?
10. What would reduce escalations?

## 10.5 For HR / People Ops

1. Are commission plans versioned and acknowledged?
2. What happens when employees change roles mid-period?
3. What happens when employees leave before commission is paid?
4. How are draws tracked?
5. How are disputes documented?
6. Are clawbacks enforceable under plan documents?
7. Where do employees see plan terms?
8. How often do compensation issues become HR issues?

---

# 11. Prototype Concepts

## 11.1 Placement Ledger Prototype

A single page showing:

* Client
* Job
* Candidate
* Start date
* Fee agreement
* Gross fee
* Net fee income
* Contributors
* Split allocation
* Commission calculation
* Invoice status
* Collection status
* Guarantee status
* Payout status
* Audit log

Goal:

Test whether users say, “This is the truth we are missing.”

## 11.2 Recruiter Payout Statement Prototype

A producer-facing page showing:

* Expected commission
* Credited role
* Base amount
* Rate
* Tier
* Holdbacks
* Payment trigger
* Estimated payout cycle
* Clawback exposure
* Explanation in plain English

Goal:

Test whether transparency reduces anxiety and questions.

## 11.3 Finance Close Dashboard Prototype

A finance-facing page showing:

* Commission-ready placements
* Blocked placements
* Missing data
* Uncollected invoices
* Guarantee holds
* Disputed deals
* Exceptions awaiting approval
* Payroll export

Goal:

Test whether this saves finance close time.

## 11.4 Attribution Timeline Prototype

A timeline of client, job, candidate, submission, and offer events.

Goal:

Test whether managers can resolve disputes faster with evidence.

## 11.5 Executive Margin Dashboard Prototype

A leadership page showing:

* Revenue
* Net fee income
* Gross profit
* Commission burden
* Client profitability
* Recruiter profitability
* Practice profitability
* Clawback exposure
* Producer concentration
* Exception rate

Goal:

Test whether executives see this as strategic operating infrastructure.

---

# 12. Integration Hypotheses

## 12.1 ATS / CRM Integrations

Likely systems:

* Bullhorn
* Greenhouse
* Lever
* JobAdder
* Loxo
* Vincere
* Salesforce
* HubSpot
* Crelate
* Recruit CRM
* Tracker
* Zoho Recruit

Needed data:

* Clients
* Contacts
* Jobs
* Candidates
* Submissions
* Interviews
* Offers
* Placements
* Owners
* Sources
* Activity timestamps

Hypothesis:

ATS integrations are necessary for scale, but early pilots may begin with CSV or manual import if the ledger value is high.

## 12.2 Accounting Integrations

Likely systems:

* QuickBooks
* Xero
* NetSuite
* Sage Intacct
* Microsoft Dynamics
* FreshBooks

Needed data:

* Invoice
* Payment
* Credit memo
* Customer
* Amount
* Date
* Currency
* AR status

Hypothesis:

Collection-gated commission workflows require accounting integration or at least reliable payment status import.

## 12.3 Payroll Integrations

Likely systems:

* ADP
* Gusto
* Paychex
* Rippling
* UKG
* Workday
* Deel
* Justworks

Needed data:

* Approved payout
* Employee
* Pay period
* Commission amount
* Draw recovery
* Clawback recovery
* Bonus code
* Tax category

Hypothesis:

Payroll export may be enough for early MVP; deep payroll integration can come later.

---

# 13. Competitive Positioning Hypotheses

## 13.1 Against Spreadsheets

Message:

“Spreadsheets can calculate commissions, but they cannot govern attribution, approvals, collections, guarantees, clawbacks, and audit history across the placement lifecycle.”

## 13.2 Against Generic Sales Commission Tools

Message:

“Sales commission tools understand opportunities. Recruiting firms need a system that understands candidates, submissions, start dates, ownership windows, guarantees, split placements, retainers, gross profit, and external partners.”

## 13.3 Against ATS Commission Features

Message:

“ATS commission fields are not a finance-grade ledger. They do not fully reconcile to invoices, collections, clawbacks, payroll, and executive margin reporting.”

## 13.4 Against Accounting Systems

Message:

“Accounting systems know invoices and payments. They do not know who sourced the candidate, who owned the job, what split applies, or why the payout is fair.”

---

# 14. Pricing and Packaging Hypotheses

Possible pricing models:

1. Per producer per month
2. Per admin plus per producer viewer
3. Percentage of commission volume processed
4. Per placement processed
5. Platform fee plus usage tier
6. Enterprise annual contract by recruiter headcount
7. Add-on modules for staffing GP, retained search, partner portal, or advanced analytics

Early pricing hypothesis:

The strongest packaging may be annual SaaS based on number of producers, with premium modules for accounting integration, contract staffing, advanced analytics, and enterprise controls.

Value metrics to test:

* Number of producers
* Monthly placements
* Commission volume
* Number of entities/offices
* Complexity of plans
* Accounting/payroll integrations
* Need for audit controls

---

# 15. Success Metrics

## 15.1 Customer Operational Metrics

* Commission close time reduced
* Manual adjustments reduced
* Disputed commissions reduced
* Payroll errors reduced
* Finance questions reduced
* Missing placement data reduced
* Time to approve commission reduced
* Clawback leakage reduced
* Collection-to-payout visibility improved

## 15.2 Business Metrics for the Product

* Activation: first placement ledger created
* Time to first approved commission run
* Percentage of placements with complete data
* Percentage of producers viewing payout statements
* Number of disputes resolved in product
* Number of payroll exports generated
* Retention by firm size and complexity
* Expansion into more offices or practices

## 15.3 Strategic Value Metrics

* Reduction in commission as percentage of revenue due to leakage control
* Increased margin visibility
* Better plan compliance
* Higher recruiter trust
* Improved M&A readiness
* Lower key-person operational dependency

---

# 16. Key Risks and Unknowns

## 16.1 Workflow Complexity Risk

Recruiting firms may have deeply idiosyncratic plans. A rules engine could become too complex.

Mitigation:

Start with common patterns, support exceptions, and avoid overbuilding before segment focus is validated.

## 16.2 Integration Risk

ATS, accounting, and payroll integrations may be fragmented and messy.

Mitigation:

Begin with import/export workflows and prioritize integrations based on early design partners.

## 16.3 Data Quality Risk

If ATS data is poor, automated calculations will be wrong.

Mitigation:

Build validation, missing-data queues, and commission-driven data completion workflows.

## 16.4 Trust Risk

If the product produces one wrong commission, users may lose trust.

Mitigation:

Make calculations explainable, reviewable, and approval-based before payroll.

## 16.5 Buyer Urgency Risk

Some firms may tolerate spreadsheets longer than expected.

Mitigation:

Target firms with high dispute rate, multi-office complexity, PE ownership, or finance pain.

## 16.6 Category Risk

The category may be perceived as too narrow.

Mitigation:

Position as recruiting deal economics, commission operations, and margin governance rather than payout calculation only.

---

# 17. Recommended Discovery Sequence

## Phase 1: Problem Interviews

Goal:

Validate pain frequency, severity, current workflows, and buyer urgency.

Interview:

* 5 COOs
* 5 CFOs/controllers
* 5 recruiters
* 3 recruiting managers
* 3 founders/managing partners
* 2 payroll or HR operators

Output:

* Pain ranking
* Current workflow map
* Buying trigger map
* MVP wedge decision

## Phase 2: Artifact Collection

Ask design partners for redacted examples:

* Commission plan
* Commission spreadsheet
* Placement record
* Invoice
* Payout statement
* Split dispute
* Guarantee clause
* Clawback example
* Payroll export
* Recruiter shadow tracker

Output:

* Real rule library
* Data model requirements
* Exception taxonomy
* Integration needs

## Phase 3: Prototype Testing

Test five prototypes:

1. Placement ledger
2. Recruiter payout statement
3. Finance close dashboard
4. Attribution timeline
5. Executive margin dashboard

Output:

* Which page creates strongest “I need this” response
* Which user has strongest urgency
* Which workflow creates willingness to pay

## Phase 4: Concierge MVP

Manually process commission runs for 2–3 design partners using lightweight tooling.

Goal:

Learn actual complexity before building full automation.

Measure:

* Time saved
* Errors found
* Disputes prevented
* Data gaps identified
* Buyer willingness to renew
* Producer trust response

## Phase 5: Productized MVP

Build core modules:

* Placement ledger
* Participant credits
* Plan rules
* Approval workflow
* Finance close queue
* Payout statement
* Payroll export
* Audit log

---

# 18. Initial Product Positioning

## Short Positioning

A commission operations platform for recruiting firms.

## Expanded Positioning

Recruiting firms lose time, margin, and trust when placement economics live in spreadsheets, ATS notes, emails, and finance systems that do not agree. The platform creates a deal-level economic ledger for every placement, showing who contributed, what revenue was created, what risk remains, and who should be paid when.

## COO Message

“Standardize how placements become payouts.”

## CFO Message

“Control commission liability, collections, clawbacks, and margin.”

## Recruiter Message

“See what you earned, why, when it pays, and what could change.”

## CEO Message

“Turn commission operations from tribal knowledge into scalable infrastructure.”

---

# 19. Product Narrative

Recruiting firms do not lose trust because commissions are complicated. They lose trust because commissions are invisible.

Every placement has a story: someone found the client, someone qualified the role, someone sourced the candidate, someone managed the process, someone closed the offer, someone invoiced the client, and someone carried the risk if the hire failed. Today, that story is scattered across systems and memories.

The product makes that story visible, governed, and finance-ready.

It gives producers transparency, finance control, managers evidence, and executives margin visibility.

---

# 20. Open Questions

1. Which segment has the most acute pain: contingency search, retained search, contract staffing, or hybrid firms?
2. Is the wedge attribution, finance close, collections gating, or recruiter transparency?
3. How much configurability is needed for MVP?
4. Do customers want this inside their ATS, or as a separate system of record?
5. Who signs the check: COO, CFO, CEO, or managing partner?
6. Is willingness to pay driven by time savings, dispute reduction, margin protection, or recruiter retention?
7. How often do firms change commission plans?
8. Are firms willing to standardize plans to use software, or must software support every exception?
9. How important is contract ingestion?
10. How important is external partner support?
11. Does candidate consent/ownership create a separate wedge?
12. Does contract staffing require a separate product track?
13. What data quality problems block automation?
14. What payroll integrations are required?
15. What proof is needed to justify ROI?

---

# 21. Summary

The product hypothesis is that recruiting firms need a trusted economic operating layer between ATS, accounting, payroll, and human judgment.

The product should begin by making one placement economically legible. From there, it can expand into rules, approvals, collections, guarantees, clawbacks, payroll, analytics, and plan simulation.

The most important discovery task is to identify the highest-urgency wedge:

1. Attribution and split disputes
2. Finance commission close
3. Recruiter payout transparency
4. Guarantee and clawback risk
5. Margin and executive observability

The winning product will not simply calculate commissions. It will make recruiting deal economics visible, explainable, auditable, and scalable.
