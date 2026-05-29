# Recruiting Commission Operations Platform

## Goal
Build a deal-level economic ledger for recruiting and staffing firms that makes every placement's economics visible, governed, and finance-ready — covering attribution, commission calculation, approvals, collections, guarantee tracking, and payroll export. The initial focus is direct-hire and split-desk workflows for contingency and retained search firms.

## Non-goals
- Contract staffing gross profit engine (timesheet bill-rate/pay-rate calculations)
- Multi-currency support
- Automated unstructured contract ingestion
- Plan simulation / impact modeling
- Client-facing portal
- Direct native payroll integrations (export file is sufficient for MVP)

## Phases

### Phase 1 - Foundation
Goal: Establish the monorepo scaffold, CI pipeline, three-database schema, passkey auth, and field encryption that all later modules depend on. Tech stack: TypeScript + Bun, PostgreSQL 16, WebAuthn passkeys, distroless containers, k3s. Reference implementation: smart-crm.

- [ ] Dev-scout: commission domain data model, field encryption registry, tenancy approach, analytics/audit event taxonomy
- [ ] Monorepo scaffold — Bun workspace (apps/server, apps/web, apps/worker, packages/core, packages/db, packages/ui), multi-stage distroless Dockerfile, docker-compose, /healthz + /readyz endpoints, trace ID middleware, structured JSON logging
- [ ] Core schema — three PostgreSQL 16 databases (commission_app, commission_analytics, commission_audit), three DB roles (app_rw, analytics_w, audit_w), all placement-lifecycle entity tables with org_id tenancy column, packages/db migration runner
- [ ] Authentication and RBAC — WebAuthn passkey registration and assertion (no passwords), HTTP-only Secure SameSite=Strict session cookies with JTI revocation, six application roles enforced in middleware
- [ ] Field-level encryption and KMS — FieldEncryptor with per-entity-type KMS keys, DEK cache (5 min TTL), GCP Cloud KMS in production, dev stub, encrypted BYTEA columns for financial fields
- [ ] CI pipeline — per-suite GitHub Actions workflows (quality-gate, test-unit, test-api, test-migration, container build), branch protection requiring all checks green
- [ ] Sign-in page and passkey UX — Login.tsx with WebAuthn registration/assertion tabs, DEMO_MODE one-click persona buttons and ephemeral account creation via /api/demo/session
- [ ] Demo seed script — scripts/demo-seed.ts with 6 role personas, 8 placements across lifecycle states, commission records in all statuses, draw balance, exceptions, and one completed commission run with payroll export
- [ ] Deployment scripts — scripts/local-demo.ts (k3d + cloudflared tunnel + hot-reload watch loop), scripts/gcp/ (provision VPC/AlloyDB/VM, deploy with four-phase health-gated rollout, doctor), deploy.sh, k8s/ manifests for three environments

### Phase 2 - Placement Ledger and Attribution
Goal: Let Finance Admins create and manage complete placement records and let managers govern split attribution.

- [ ] Placement record creation — manual entry and CSV import covering client, job order, candidate, start date, fee agreement, and compensation base
- [ ] Placement completeness validation — blocking queue that surfaces missing required fields before commission calculation
- [ ] Contribution assignment — assign contributors with role and split percentage; track origination, account, job, candidate, delivery, manager override, and external partner roles
- [ ] Manager split approval workflow — approval gate before contribution splits are finalized, with attribution timeline evidence

### Phase 3 - Commission Rules Engine
Goal: Apply configurable plan logic to placements and produce explainable per-participant calculations.

- [ ] Commission plan configuration — support gross fee, net fee income, tiers, desk-cost thresholds, draw balance offset, manager overrides, team pools, holdback and clawback conditions, and plan versioning
- [ ] Commission calculation engine — apply plans to credited bases per contributor, with draw recovery, collection gating, and guarantee holdback support
- [ ] Plain-language calculation explainability — every payout statement includes a traceable explanation linking placement record, fee terms, split, plan version, and triggering events

### Phase 4 - Finance Close Workflow
Goal: Give Finance Admins a governed, approval-gated path from open placements to a payroll-ready export.

- [ ] Invoice and collection tracking — link placements to invoices; track issued, partially paid, paid, disputed, and written-off states; gate commission release on collection where configured
- [ ] Finance admin commission run and review queue — surface commission-ready placements, blocked placements, missing data, and flagged exceptions in a single pre-payroll review screen
- [ ] Exception request and approval workflow — custom splits, fee discounts, accelerated payouts, draw forgiveness, clawback waivers; each documented with reason code, attachment, and immutable audit trail
- [ ] Payroll-ready export — approved payout file per producer including commission, draw recovery, and clawback recovery amounts; no amount reaches export without explicit Finance Admin approval

### Phase 5 - Producer Payout Portal
Goal: Give producers real-time, explainable visibility into their credits and payouts, reducing finance questions and shadow spreadsheets.

- [ ] Producer payout statement — credited placements, role, split percentage, commissionable base, calculated amount, holdback status, payment trigger, and estimated payout cycle
- [ ] Tier progress display — current production toward next rate threshold
- [ ] Payout dispute and question submission — in-platform dispute request with documented resolution trail

### Phase 6 - Post-Placement Risk
Goal: Track and act on guarantee periods, candidate fallout, and clawback events with ledger-posted adjustments.

- [ ] Guarantee period tracking — calculate and surface guarantee expiration dates; flag placements inside the guarantee window
- [ ] Clawback and holdback event handling — record candidate departure or refund events; apply configured rule (clawback, holdback, refund, replacement); notify affected producers; post ledger adjustment; generate payroll recovery schedule

### Phase 7 - Leadership Visibility
Goal: Give managers and executives reliable margin, attribution, and commission liability visibility.

- [ ] Manager team view — team commission accruals, pending payouts, split approvals pending, and attribution timelines for dispute resolution
- [ ] Executive dashboard — gross fees, net fee income, commission accrued, commission payable, clawback exposure, exception rate, and profitability by client, recruiter, team, and practice
