# Blueprint: DATA — Architecture Research

**Source:** blueprint/rules/blueprints/data.yaml
**PRD:** docs/prd.md (present)
**Plan documents:** docs/plan.md
**Technical documents:** none found

## Summary

This blueprint is the most load-bearing in the entire project: the commission platform is, structurally, a governed economic ledger holding financial PII (payouts, draw balances, fee agreements, payment tokens), and its single most important non-negotiable constraint — "all changes permanently recorded, never silently overwritten, with timestamp, actor, and reason" (PRD §9) — maps directly onto this blueprint's three-database separation (DATA-A-001), append-only business journal (DATA-D-004), audit-log-first ordering (DATA-D-010/DATA-P-008), and journal-vs-audit distinction (DATA-D-009). The plan already commits to the blueprint's exact baseline architecture: three PostgreSQL 16 databases (commission_app / commission_analytics / commission_audit), three scoped roles (app_rw / analytics_w / audit_w), per-entity-type field encryption via a KMS, distroless containers, and a network-isolated worker that writes only through the API. The blueprint's property-graph-on-PostgreSQL principle (DATA-P-003/DATA-P-004/DATA-D-002) is the schema strategy that lets the platform absorb highly variable, per-customer commission plan structures without DDL churn, while a dedicated relational business journal carries the integrity-critical commission/clawback transitions. Layered, key-per-type encryption (DATA-P-002/DATA-D-005) with KMS-held keys (DATA-P-007) protects the financial fields the plan already flags as encrypted BYTEA, and per-tenant key isolation (DATA-A-002/DATA-C-017) is the production target given the explicit `org_id` multi-tenancy and confidentiality requirements. Analytics-tier separation, pseudonymization, and differential privacy (DATA-P-001/DATA-D-006/7/8) govern the executive dashboards and profitability analytics so leadership reporting never queries raw payout records.

## Rule Analysis

### DATA-T-001: backup-exfiltration

- **Type:** threat
- **Applicable:** yes
- **Technology implication:** Backups of commission_app must contain ciphertext. Combine field-level encryption (encrypted BYTEA for financial fields, already planned) with disk/DB encryption so an exfiltrated backup of payouts, draws, and fee agreements yields ciphertext.
- **Risk:** A stolen backup exposes every producer's compensation, every client's fee terms, and payment tokens — catastrophic for a trust-centered finance product whose core promise is a governed, confidential economic record.

### DATA-T-002: compromised-db-credentials

- **Type:** threat
- **Applicable:** yes
- **Technology implication:** Sensitive financial fields must be encrypted at the application layer (FieldEncryptor) so the app_rw role alone cannot read plaintext compensation data. Keys come from KMS, not the DB.
- **Risk:** A leaked app_rw connection string would otherwise expose all payout amounts, draw balances, and margin data in plaintext.

### DATA-T-003: server-root-access-key-exposure

- **Type:** threat
- **Applicable:** yes
- **Technology implication:** Encryption keys must live in GCP Cloud KMS (production) and never in env vars or on the app host. Only short-lived DEKs may be cached in memory (the plan's 5-min TTL DEK cache satisfies the <=5 min rule); KEKs never leave the KMS.
- **Risk:** Root on the app VM would otherwise yield both ciphertext and keys, collapsing the entire encryption scheme.

### DATA-T-004: rogue-admin-raw-access

- **Type:** threat
- **Applicable:** yes
- **Technology implication:** Every read of sensitive commission data must be audit-logged (commission_audit, audit-before-read), and analytics/agent consumers must be confined to aggregated views, never commission_app.
- **Risk:** A rogue finance/ops admin could silently pull all producer payouts and firm margin; without log-first audit this access is untraceable, defeating PRD §9's "never silently overwritten, with actor and reason" mandate.

### DATA-T-005: analytics-reidentification

- **Type:** threat
- **Applicable:** partial
- **Technology implication:** Executive profitability-by-recruiter and dispute-rate analytics (Phase 7) must run on pseudonymized aggregates with differential privacy on export, since per-recruiter slices are low-cardinality and re-identifiable.
- **Risk:** A "profitability by recruiter" query over a small team effectively discloses individual compensation through the analytics tier, bypassing confidentiality scoping in PRD §9.

### DATA-T-006: agent-raw-data-access

- **Type:** threat
- **Applicable:** yes
- **Technology implication:** The planned worker (guarantee-expiry, clawback, recalculation jobs) is network-isolated and writes only through the API with delegated scoped credentials — it must not connect directly to commission_app. Any analytics/agent consumer reads the analytics tier only.
- **Risk:** A compromised worker or agent with direct commission_app access could exfiltrate or corrupt every placement's economics.

### DATA-T-007: single-key-compromise-blast-radius

- **Type:** threat
- **Applicable:** yes
- **Technology implication:** Use per-entity-type KMS keys (already in the plan) so compromise of, e.g., the draw-balance key does not expose fee agreements or payout records.
- **Risk:** One leaked key would expose all financial categories at once.

### DATA-T-008: key-compromise-no-rotation

- **Type:** threat
- **Applicable:** yes
- **Technology implication:** Key rotation must be implemented and tested end-to-end (keyVersion lookup so old rows stay readable, new writes use the new key). GCP Cloud KMS supports versioned keys.
- **Risk:** Without tested rotation, a suspected key compromise has no remediation path short of re-encrypting everything under emergency conditions.

### DATA-T-009: ransomware-backup-recovery

- **Type:** threat
- **Applicable:** yes
- **Technology implication:** Configure encrypted, immutable, off-host backups with point-in-time recovery (AlloyDB/managed PostgreSQL PITR is implied by the plan's GCP provisioning).
- **Risk:** Ransomware on the production DB without immutable off-host backups could force ransom payment or permanent loss of the ledger of record.

### DATA-T-010: pii-in-application-logs

- **Type:** threat
- **Applicable:** yes
- **Technology implication:** The plan's structured JSON logging must pass through a scrubbing layer with a field deny-list (email, name, amounts, tokens) and pattern matching; error handlers log IDs/codes only.
- **Risk:** Decrypted payout amounts or PII leaking into logs creates a second, unencrypted copy of the protected data outside the audit/encryption controls.

### DATA-T-011: schema-migration-data-loss

- **Type:** threat
- **Applicable:** yes
- **Technology implication:** The packages/db migration runner must support tested rollback; destructive operations require explicit confirmation. The property-graph model minimizes DDL by treating type changes as registry data, shrinking this surface.
- **Risk:** A bad migration could corrupt or drop the placement/commission ledger — the irreplaceable source of truth.

### DATA-P-001: separate-analytics-from-transactional

- **Type:** principle
- **Applicable:** yes
- **Technology implication:** commission_analytics is a distinct database with its own role (analytics_w) and no FK path to commission_app. Executive dashboards and profitability analytics (Phase 7) read the analytics tier on pseudonymous aggregated events, not raw placements.
- **Risk:** Reporting directly against commission_app would turn every dashboard query into a confidentiality-violation vector and couple analytics availability to transactional integrity.

### DATA-P-002: layered-encryption

- **Type:** principle
- **Applicable:** yes
- **Technology implication:** Apply disk encryption, DB-level encryption, application field encryption (FieldEncryptor on financial fields), and KMS-held keys. The plan already commits to field encryption + KMS; disk/DB encryption come from the managed PostgreSQL/AlloyDB layer.
- **Risk:** Relying on any single layer (e.g., disk only) leaves compensation data exposed to the other three threat models.

### DATA-P-003: schema-as-data

- **Type:** principle
- **Applicable:** yes
- **Technology implication:** Model the commission domain as a property graph (entities/relations/entity_types) so that variable, per-customer plan structures, contributor roles, and split types are registry/data changes, not DDL. Keep dedicated relational tables for the integrity-critical commission/clawback journal, nonce stores, and replay checkpoints.
- **Risk:** A rigid static schema would make every new plan rule or contributor role a migration, killing the "configurable to replace spreadsheets" goal (PRD Open Q4) and risking migration data loss.

### DATA-P-004: postgresql-with-graph-patterns

- **Type:** principle
- **Applicable:** yes
- **Technology implication:** PostgreSQL 16 (already chosen) across all three stores, using JSONB for flexible plan/placement properties and recursive CTEs for traversal (org hierarchies, attribution timelines, team-pool rollups).
- **Risk:** Introducing a separate graph DB would add operational surface with no benefit; abandoning JSONB flexibility would reintroduce migration churn.

### DATA-P-005: data-minimization

- **Type:** principle
- **Applicable:** yes
- **Technology implication:** Justify and retain only fields the workflows need; enforce retention with automated deletion. PRD's import reconciliation queue (§5.9) and confidentiality scoping argue against hoarding raw ATS payloads.
- **Risk:** Storing speculative ATS/CRM fields enlarges the breach blast radius and complicates compliance for a product holding compensation PII.

### DATA-P-006: agents-on-bounded-data

- **Type:** principle
- **Applicable:** yes
- **Technology implication:** The worker's PostgreSQL role grants SELECT on task-queue views only, filtered to its task type; it has no arbitrary commission_app access and writes through the API. Any analytics agent uses the DP analytics tier.
- **Risk:** An over-privileged worker becomes a single exfiltration point for the entire economic ledger.

### DATA-P-007: keys-separate-from-data

- **Type:** principle
- **Applicable:** yes
- **Technology implication:** GCP Cloud KMS is a hard dependency in production (dev stub locally). DEKs cached <=5 min in memory, never persisted; KEKs never cached. The plan matches this exactly.
- **Risk:** Keys colocated with data (env vars/config) mean one host compromise yields plaintext compensation data.

### DATA-P-008: audit-precedes-access

- **Type:** principle
- **Applicable:** yes
- **Technology implication:** Reads of sensitive commission/PII data write a commission_audit entry (separate key, separate DB) before the read executes; failed audit write denies the read. No batching.
- **Risk:** Post-hoc or async audit can be suppressed by an attacker, breaking PRD §9's permanent, attributable record requirement.

### DATA-P-009: journal-and-audit-are-distinct

- **Type:** principle
- **Applicable:** yes
- **Technology implication:** Maintain an append-only business journal (accepted commission facts, clawback/refund compensations, ledger adjustments) separate from commission_audit (who read/approved/denied/exported). PRD distinguishes "ledger entries with audit trail" (§5.4) from access governance (§9) — two stores, two consumers.
- **Risk:** Conflating the two would make it impossible to answer either "what economic facts changed" or "who accessed/approved what," undermining dispute resolution and compliance.

### DATA-P-010: deterministic-gate-enforcement

- **Type:** principle
- **Applicable:** yes
- **Technology implication:** Encode machine-checkable gates in CI (the plan's per-suite GitHub Actions): journal append-only, audit-before-access, encryption-boundary, analytics-isolation, privacy-budget, and twin-isolation checks.
- **Risk:** Unenforced policy regresses silently; for a finance ledger, a regression in append-only or audit ordering is a compliance failure.

### DATA-D-001: encrypt-before-insert

- **Type:** design_pattern
- **Applicable:** yes
- **Technology implication:** FieldEncryptor encrypts financial fields before INSERT; DB stores ciphertext (encrypted BYTEA per the plan); decryption happens in-app on read. Encrypted fields are not DB-searchable — provide non-sensitive derived indexes (e.g., hashed lookup keys, status enums) for filtering/sorting commission queues.
- **Risk:** Plaintext financial columns expose data to anyone with DB/backup/file access and break the layered-encryption guarantee.

### DATA-D-002: property-graph-on-postgresql

- **Type:** design_pattern
- **Applicable:** yes
- **Technology implication:** Three core tables — entities (typed JSONB nodes: placements, contributors, plans, invoices, draws), relations (typed edges: credited-on, split-of, invoices, reports-to), entity_types (JSON Schema + sensitivity metadata + KMS key IDs). JSON Schema validation and partial unique indexes replace native column constraints; recursive CTEs for attribution timelines and org rollups.
- **Risk:** Without the registry/JSONB approach, the highly variable commission plan and split model forces constant migrations and loses configurability.

### DATA-D-003: type-registry-validation

- **Type:** design_pattern
- **Applicable:** yes
- **Technology implication:** Application validates every write against entity_types JSON Schema; the registry also drives FieldEncryptor's per-property encryption decisions and supports versioned plan schema evolution without DDL — aligning with PRD plan versioning (Draft -> Active -> Superseded).
- **Risk:** Schema-less JSONB without registry validation invites silent data corruption in financial records.

### DATA-D-004: append-only-business-journal

- **Type:** design_pattern
- **Applicable:** yes
- **Technology implication:** A dedicated relational append-only journal records consequential commission facts and links compensations (clawbacks, refunds, credit memos, draw forgiveness) to the entries they reverse, with deterministic replay of materialized payout state. This is the integrity backbone for the Commission and Guarantee/Clawback lifecycles (PRD §6) and "new ledger entries, never silently overwritten" (§5.4).
- **Risk:** Modeling consequential financial transitions only as mutable graph state loses total ordering, compensation linkage, and replay — making disputes and clawback recoveries unprovable.

### DATA-D-005: key-per-type-encryption

- **Type:** design_pattern
- **Applicable:** yes
- **Technology implication:** entity_types declares sensitive properties and their kms_key_id; FieldEncryptor encrypts specific JSONB keys per type. Rotation is per-type with keyVersion lookup. Plan's per-entity-type KMS keys implement this directly.
- **Risk:** A single flat key exposes all commission categories on one compromise and prevents independent rotation.

### DATA-D-006: aggregation-tier-separation

- **Type:** design_pattern
- **Applicable:** yes
- **Technology implication:** commission_analytics is populated by pseudonymous, aggregated events emitted from the transactional tier (the plan's analytics event taxonomy / event pipeline), with no FK back to commission_app and no de-pseudonymization. At-least-once delivery with idempotent writes; events failing pseudonymization are dropped with a structured log entry. Baseline pipeline may be in-process (DATA-A-001), upgraded to an async worker+queue later.
- **Risk:** Letting dashboards query commission_app directly turns every analyst/agent into a path to raw payouts.

### DATA-D-007: session-pseudonymization

- **Type:** design_pattern
- **Applicable:** partial
- **Technology implication:** Analytics events use session-scoped rotating pseudonyms; the permanent-ID-to-pseudonym map stays in the transactional tier. Note: legitimate per-producer/per-recruiter leadership reporting (Phase 7) is inherently longitudinal and identified — that must be served from the audit-controlled transactional/reporting path, not the pseudonymous analytics tier, which suits cohort/firm-level trend metrics (exception rate, dispute rate over time).
- **Risk:** Permanent pseudonyms in analytics enable cross-session re-identification of individual compensation.

### DATA-D-008: differential-privacy-on-export

- **Type:** design_pattern
- **Applicable:** partial
- **Technology implication:** For aggregated analytics exports (trend/cohort metrics, dispute/exception rates), apply a DP mechanism with per-query-class epsilon budgets tracked persistently and decremented atomically; budget exhaustion returns a structured rejection (no silent noise reduction). This is a Phase 7+/production-maturity control, and applies to the pseudonymous analytics tier — not to a producer viewing their own exact payout (DATA-A-002 marks full DP as the regulated-platform target).
- **Risk:** Un-noised low-cardinality aggregates (small teams) leak individual compensation; the executive "profitability by recruiter" view is the prime offender.

### DATA-D-009: signed-analytics-at-edge

- **Type:** design_pattern
- **Applicable:** no
- **Technology implication:** Optional hardening. The platform's analytics events are predominantly server-side derivations of placement/commission state rather than untrusted client-emitted telemetry, so client-side event signing is not a core requirement. Adopt only if/when client-generated analytics events are introduced.

### DATA-D-010: audit-log-first

- **Type:** design_pattern
- **Applicable:** yes
- **Technology implication:** The access path writes an append-only commission_audit entry (separate key, separate DB/backend, includes accessor identity, timestamp, data accessed, justification) before the read; audit-write failure denies the read; no batching. Directly implements PRD §9 audit/approval governance.
- **Risk:** Without log-first ordering, sensitive reads (payouts, margins, draws) can occur unlogged, violating the non-negotiable permanent-record constraint.

### DATA-D-011: sandboxed-digital-twins

- **Type:** design_pattern
- **Applicable:** partial
- **Technology implication:** Useful for safely previewing consequential transitions (clawback application, recalculation, payroll-run effects) on a short-lived isolated clone running the same validators with separate credentials and hard write isolation, all twin actions audit-marked as sandbox. Note PRD explicitly lists "plan simulation" as out of scope, so twins are for operational previews/testing, not customer-facing what-if modeling.
- **Risk:** Running clawback/recalculation experiments against production could corrupt the live ledger; absent twins, such testing is unsafe or unrealistic.

### DATA-D-012: pii-scrubbing-log-pipeline

- **Type:** design_pattern
- **Applicable:** yes
- **Technology implication:** A scrubbing layer at the log sink with a field deny-list (email, name, address, token, amounts) and pattern list; error handlers log IDs/codes only, never raw objects/rows/request bodies; verified by adversarial tests before each gate. Integrates with the plan's structured JSON logging + trace-ID middleware.
- **Risk:** Error-path logging of decrypted financial objects creates an unprotected secondary copy of compensation PII.

### DATA-A-001: three-database-single-instance

- **Type:** architecture
- **Applicable:** yes
- **Technology implication:** This is the project's day-one baseline, already adopted in the plan: one PostgreSQL 16 instance hosting commission_app / commission_analytics / commission_audit, three roles (app_rw, analytics_w insert-only, audit_w insert-only), KMS as a separate dependency, in-process pseudonymizing event pipeline, and local dev via Docker Compose / k3d containers (app not on host).
- **Risk:** Deviating (e.g., a single DB with logical separation) collapses the structural isolation that enforces analytics/audit boundaries; instance-level failure affecting all three is the accepted pre-production tradeoff, upgraded to independent managed DBs at SLA time.

### DATA-A-002: multi-tenant-encrypted-platform

- **Type:** architecture
- **Applicable:** yes
- **Technology implication:** Production target. The plan's `org_id` tenancy column and PRD's per-customer hierarchy/confidentiality requirements point to per-tenant key hierarchies, HSM-backed KMS, independent managed databases (AlloyDB), async event pipeline with durable queue, row-level security, and audit replicated to immutable cold storage. Schema and encryption envelope stay unchanged from Architecture A.
- **Risk:** Without per-tenant key isolation and RLS, one customer's key compromise or a query bug exposes another firm's compensation data — unacceptable for a multi-tenant finance platform.

### DATA-C-001: three-databases-provisioned

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Provision commission_app, commission_analytics, commission_audit (plan's Core schema task names them exactly).
- **Risk:** Missing separation breaks every downstream isolation guarantee.

### DATA-C-002: three-roles-created

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** app_rw (RW on commission_app only), analytics_w (insert-only on analytics), audit_w (insert-only on audit, no UPDATE/DELETE/TRUNCATE) — exactly as planned.
- **Risk:** Over-broad roles defeat structural access control and audit immutability.

### DATA-C-003: property-graph-tables-initialized

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Initialize entities, relations, entity_types in commission_app.
- **Risk:** Absent the registry, encryption and validation metadata have no home.

### DATA-C-004: local-dev-containerized

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Local dev runs app + PostgreSQL via k3d (`bun run local-demo`), not on host — matches the local-demo (k3d) script and k8s/dev manifests.
- **Risk:** Host-run dev diverges from production isolation and masks role/network constraints.

### DATA-C-005: parameterized-queries-only

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** All queries parameterized; no string concatenation (especially around JSONB property filters).
- **Risk:** SQL injection against a financial ledger is a direct path to data theft/corruption.

### DATA-C-006: application-layer-encryption-active

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** FieldEncryptor active on sensitive JSONB/BYTEA financial properties.
- **Risk:** Inactive field encryption leaves compensation data exposed to DB-credential and backup threats.

### DATA-C-007: kms-integrated-no-config-keys

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** GCP Cloud KMS integrated; no keys in config/env (dev stub acceptable locally).
- **Risk:** Config-resident keys collapse the key-separation guarantee.

### DATA-C-008: audit-logging-operational

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Audit logging for all auth events and sensitive entity reads.
- **Risk:** Gaps make PRD §9 attributability incomplete.

### DATA-C-009: audit-log-first-ordering

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Enforce write-audit-before-read with a deterministic test.
- **Risk:** Out-of-order audit can be suppressed; compliance failure.

### DATA-C-010: analytics-store-separated

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Analytics queries never touch commission_app; verified.
- **Risk:** Any analytics->transactional path is a confidentiality breach surface.

### DATA-C-011: analytics-pseudonymized

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Events carry session-scoped pseudonyms, not producer/user IDs.
- **Risk:** Identified analytics events enable re-identification of compensation.

### DATA-C-012: no-pii-in-logs

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Adversarial test suite asserts no plaintext PII/financial values in logs.
- **Risk:** Logged PII is an unprotected secondary copy.

### DATA-C-013: core-migration-applied

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** A single core migration establishes the graph tables (plan's migration runner).
- **Risk:** N/A beyond setup correctness.

### DATA-C-014: point-in-time-recovery-configured

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Configure and test PITR on managed PostgreSQL/AlloyDB.
- **Risk:** No PITR means no recovery from ransomware or accidental corruption of the ledger.

### DATA-C-015: differential-privacy-active

- **Type:** checklist
- **Applicable:** partial
- **Technology implication:** DP on analytics exports with per-query-class epsilon; exhaustion rejects queries. Maturity/Phase 7+ control on the analytics tier.
- **Risk:** Un-noised small-group aggregates leak individual pay.

### DATA-C-016: key-rotation-tested

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Test per-type key rotation with keyVersion lookup (old rows readable, new writes use new key).
- **Risk:** Untested rotation = no remediation path for key compromise.

### DATA-C-017: per-tenant-key-isolation

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Multi-tenant (org_id) -> implement per-tenant key isolation; verify one tenant's key compromise does not expose another's data.
- **Risk:** Shared keys across firms make a single compromise cross-customer.

### DATA-C-018: backup-restoration-tested

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Test restore from encrypted backup to clean env; verify integrity and decryption.
- **Risk:** Untested backups may be unrecoverable when needed most.

### DATA-C-019: rate-limiting-on-data-endpoints

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Rate-limit data-access endpoints (payout portal, partner access, reporting APIs).
- **Risk:** Unthrottled endpoints enable scraping/enumeration of compensation data.

### DATA-C-020: migration-rollback-tested

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Test apply+rollback with no data loss; the migration runner must support it.
- **Risk:** Irreversible migrations risk corrupting the ledger of record.

### DATA-C-021: pseudonym-rotation-verified

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Verify pseudonyms rotate per session/configured interval.
- **Risk:** Non-rotating pseudonyms degrade to permanent identifiers.

### DATA-C-022: audit-log-tamper-resistance

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Verify audit_w cannot UPDATE/DELETE existing entries.
- **Risk:** Mutable audit defeats the permanent-record constraint (PRD §9).

### DATA-C-023: kms-hsm-backed

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Production KMS HSM-backed (GCP Cloud KMS HSM protection level); no software-only keys in prod.
- **Risk:** Software-only key storage weakens key protection for a finance platform.

### DATA-C-024: automated-key-rotation

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Automated scheduled rotation with zero-downtime rekeying verified under load.
- **Risk:** Manual-only rotation tends not to happen, leaving stale keys.

### DATA-C-025: immutable-audit-cold-storage

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Replicate audit log to immutable cold storage with enforced retention (production).
- **Risk:** Without immutable replication, audit history can be destroyed, failing compliance.

### DATA-C-026: business-journal-operational

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Operational append-only commission journal with verified replay and compensation (clawback/refund) — central to Phases 3, 4, 6.
- **Risk:** No verifiable journal means commission/clawback history is not provably reconstructable.

### DATA-C-027: journal-audit-independent

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Journal and audit independently queryable/retained.
- **Risk:** Conflation breaks both economic-fact and access-governance answers.

### DATA-C-028: digital-twin-creation-tested

- **Type:** checklist
- **Applicable:** partial
- **Technology implication:** If twins are adopted for clawback/recalculation previews, verify fast clone of production-relevant state.
- **Risk:** Slow/heavy cloning makes safe preview impractical, pushing tests onto production.

### DATA-C-029: digital-twin-isolation-verified

- **Type:** checklist
- **Applicable:** partial
- **Technology implication:** If twins are adopted, verify sandbox writes cannot mutate commission_app/analytics/audit.
- **Risk:** Leaky twin isolation corrupts the live ledger.

### DATA-C-030: full-dp-pipeline-active

- **Type:** checklist
- **Applicable:** partial
- **Technology implication:** Production maturity: noise calibration + budget tracking + exhaustion rejection across analytics.
- **Risk:** Partial DP still leaks via untracked budgets.

### DATA-C-031: agent-access-restricted-to-analytics

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Verify (architecture review + integration test) no code path from worker/agent processes to commission_app; workers write via API with scoped credentials.
- **Risk:** A hidden worker->transactional path is a full-ledger exfiltration risk.

### DATA-C-032: penetration-test-completed

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Pen-test the data layer (production-readiness); remediate findings.
- **Risk:** Unfound vulnerabilities in a compensation-PII system.

### DATA-C-033: data-retention-automation

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Automated, verified deletion on schedule for expired data (subject to financial-record retention requirements).
- **Risk:** Indefinite retention enlarges breach exposure and compliance burden.

### DATA-C-034: log-pipeline-pii-free-adversarial

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Verify log pipeline PII-free under error paths, stack traces, serialization edge cases.
- **Risk:** Error-path leaks are the most common PII-in-logs vector.

### DATA-C-035: cross-tenant-isolation-verified

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Automated test suite verifies cross-tenant (org_id) isolation across all stores and the analytics/audit tiers.
- **Risk:** Tenant bleed exposes one firm's compensation data to another.

### DATA-X-001: privacy-policy-as-technical-control

- **Type:** antipattern
- **Applicable:** yes
- **Technology implication:** Do not substitute a privacy/confidentiality promise for the encryption + separation architecture. Confidentiality (PRD §9) must be structural.
- **Risk:** The promise/implementation gap is the breach surface for compensation data.

### DATA-X-002: disk-encryption-as-data-privacy

- **Type:** antipattern
- **Applicable:** yes
- **Technology implication:** Do not treat AlloyDB/disk encryption as sufficient; field-level + KMS layers are required.
- **Risk:** Disk encryption alone does nothing against compromised DB credentials or exfiltrated backups.

### DATA-X-003: analytics-on-transactional-store

- **Type:** antipattern
- **Applicable:** yes
- **Technology implication:** Never run executive/manager analytics (Phase 7) against commission_app; use the separated analytics tier.
- **Risk:** Every dashboard query becomes a confidentiality-violation vector.

### DATA-X-004: frontier-crypto-as-default

- **Type:** antipattern
- **Applicable:** yes
- **Technology implication:** Do not reach for FHE/ZK/MPC; field encryption + tier separation + DP solve this product's needs.
- **Risk:** Unnecessary operational risk and complexity with no requirement justifying it.

### DATA-X-005: collecting-data-just-in-case

- **Type:** antipattern
- **Applicable:** yes
- **Technology implication:** Import only fields the workflows need; route ambiguous fields to the reconciliation queue (PRD §5.9), do not hoard raw ATS payloads.
- **Risk:** Speculative fields enlarge breach blast radius and compliance scope.

### DATA-X-006: keys-alongside-data

- **Type:** antipattern
- **Applicable:** yes
- **Technology implication:** No keys in env vars / config / same backup as data; KMS only.
- **Risk:** One host compromise yields both ciphertext and keys.

### DATA-X-007: single-flat-key-for-all-tables

- **Type:** antipattern
- **Applicable:** yes
- **Technology implication:** Use per-entity-type keys (already planned), not one global key.
- **Risk:** One key compromise exposes all financial categories.

### DATA-X-008: pii-in-error-logs

- **Type:** antipattern
- **Applicable:** yes
- **Technology implication:** Error handlers must log IDs/codes, never raw rows/request objects/decrypted fields.
- **Risk:** Error logs become a secondary copy of compensation PII.

### DATA-X-009: pseudonymization-without-rotation

- **Type:** antipattern
- **Applicable:** yes
- **Technology implication:** Analytics pseudonyms must rotate (session/interval); no permanent per-user pseudonym in the analytics tier.
- **Risk:** Permanent pseudonyms enable longitudinal re-identification of pay.

## Recommended Technology Choices

- **PostgreSQL 16 as the sole database engine across all three stores** (DATA-P-004, DATA-A-001) — already chosen; JSONB for flexible plan/placement properties, recursive CTEs for attribution timelines and org/team-pool rollups.
- **Three-database, three-role baseline: commission_app / commission_analytics / commission_audit with app_rw / analytics_w (insert-only) / audit_w (insert-only, no UPDATE/DELETE/TRUNCATE)** (DATA-A-001, DATA-C-001/002) — structural isolation of transactional, analytics, and audit data.
- **Property-graph schema (entities / relations / entity_types) with JSON Schema validation in the app tier** (DATA-D-002, DATA-D-003, DATA-P-003) — absorbs variable commission plans, contributor roles, and split types without DDL migrations.
- **Dedicated relational append-only business journal for consequential commission/clawback/refund transitions, distinct from the audit log** (DATA-D-004, DATA-D-009, DATA-C-026/027) — the integrity backbone for the Commission, Guarantee, and Invoice lifecycles.
- **FieldEncryptor with per-entity-type KMS keys, encrypt-before-insert into encrypted BYTEA/JSONB, in-app decrypt on read, non-sensitive derived indexes for queues** (DATA-D-001, DATA-D-005, DATA-P-002, DATA-C-006) — protects compensation PII against DB-credential and backup threats.
- **GCP Cloud KMS (HSM-backed in production), dev stub locally, <=5-min in-memory DEK cache, no KEK caching, tested + automated per-type key rotation with keyVersion lookup** (DATA-P-007, DATA-C-007/016/023/024) — keys never colocated with data.
- **Audit-log-first access path: write to commission_audit (separate key + backend) before any sensitive read, deny on audit-write failure, no batching, immutable audit replicated to cold storage in production** (DATA-D-010, DATA-P-008, DATA-C-008/009/022/025) — implements PRD §9's permanent, attributable record mandate.
- **Separated analytics tier fed by an event pipeline emitting session-pseudonymized, aggregated events with at-least-once idempotent delivery; in-process baseline, async worker+durable-queue in production** (DATA-D-006, DATA-D-007, DATA-P-001, DATA-C-010/011/021) — powers leadership dashboards without touching raw payouts.
- **Differential privacy on analytics exports with per-query-class epsilon budgets (Phase 7+/production)** (DATA-D-008, DATA-C-015/030) — prevents re-identification in low-cardinality profitability-by-recruiter slices.
- **Per-tenant key hierarchies, row-level security, and independent managed databases (AlloyDB) as the production multi-tenant target** (DATA-A-002, DATA-C-017/035) — given the `org_id` tenancy and cross-firm confidentiality requirements.
- **Network-isolated worker with a task-queue-scoped PostgreSQL role that writes only through the API** (DATA-P-006, DATA-T-006, DATA-C-031) — for guarantee-expiry, clawback, and recalculation jobs without raw transactional access.
- **PII-scrubbing log sink with deny-list + pattern matching, adversarially tested, on top of structured JSON logging** (DATA-D-012, DATA-T-010, DATA-C-012/034) — prevents compensation PII leaking through error paths.
- **Containerized dev (Docker Compose / k3d) and distroless production containers on k3s; PITR, tested encrypted-backup restoration, rate-limited data endpoints, and parameterized-queries-only** (DATA-A-001, DATA-C-004/005/014/018/019) — operational hardening for the ledger of record.
- **Sandboxed digital twins (optional, operational previews only — not customer-facing plan simulation, which is out of scope)** (DATA-D-011, DATA-C-028/029) — for safe clawback/recalculation testing if adopted.
