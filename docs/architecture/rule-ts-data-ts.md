# Blueprint: IMPL-DATA (Data — TypeScript Implementation) — Architecture Research

**Source:** blueprint/rules/implementations/ts/data-ts.yaml
**PRD:** docs/prd.md (present)
**Plan documents:** docs/plan.md
**Technical documents:** none found

## Summary

This blueprint is highly load-bearing for the commission management platform because the product's core value proposition is a *governed, auditable, explainable* economic record of every placement. The most consequential rules are the audit-logging cluster (IMPL-DATA-021 through 026, 031, 043) which directly implement the PRD's Constraint §9 ("all changes must be permanently recorded — never silently overwritten"); the three-database/three-role/three-pool separation (001–004, 027) which the Plan explicitly adopts (commission_app, commission_analytics, commission_audit; app_rw/analytics_w/audit_w); and the field-encryption cluster (010–014, 028–029, 042, 045, 046) which protects financial fields (commissionable base, payout amounts, draw balances) the PRD scopes as confidential. The encryption envelope/key-version and key-per-type rules map to the Plan's "FieldEncryptor with per-entity-type KMS keys, GCP Cloud KMS in production." The parameterized-SQL/no-ORM decisions (009, 032, 033, 035, 039) govern the entire data-access layer. The analytics-tier rules (015–020, 030, 040, 044) are partially applicable: the Plan defines an analytics database and event taxonomy, but the PRD's analytics needs are internal leadership dashboards rather than end-user behavioral telemetry, so pseudonymization and differential-privacy rules apply more weakly than in a consumer product. Note: the blueprint uses `calypso_*` database names while this project renames them to `commission_*`; the structural rules transfer directly, only the names differ.

## Rule Analysis

### IMPL-DATA-001: postgresql-from-first-commit

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** PostgreSQL is the database from commit zero. Plan Phase 1 specifies PostgreSQL 16. No SQLite, no deferred DB choice. A core `commission_app` database holds the transactional graph.
- **Risk:** Choosing a lighter store first and migrating later would force a costly rewrite of the ledger, encryption, and audit layers that the entire product depends on.

### IMPL-DATA-002: three-table-property-graph

- **Type:** implementation
- **Applicable:** partial
- **Technology implication:** The blueprint prescribes a generic three-table property graph (entities, relations, entity_types with schema/sensitive/kms_key_id). The Plan instead describes "all placement-lifecycle entity tables" — a more relational, domain-specific schema. The Dev-scout task (Phase 1) must decide whether the commission domain (placements, contributions, commissions, invoices, guarantees, draw balances, exceptions, plan versions) is modeled as the generic property graph or as explicit tables. The entity_types registry concept (sensitive fields + kms_key_id per type) remains valuable regardless.
- **Risk:** A pure property-graph model may make the complex relational commission calculations (tiers, pools, splits, draw offsets) awkward; a fully ad-hoc relational schema loses the registry-driven encryption and validation the later rules assume. The Dev-scout must reconcile this explicitly.

### IMPL-DATA-003: roles-and-privileges

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** Three DB roles — app_rw (RW on commission_app), analytics_w (INSERT-only on commission_analytics), audit_w (INSERT-only on commission_audit). The Plan's Core schema task names exactly these three roles. No role crosses database boundaries.
- **Risk:** If app_rw could touch the audit DB, a compromised app could erase the very approval/change history the PRD requires to be tamper-proof, destroying the product's trust guarantee.

### IMPL-DATA-004: three-connection-pools

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** apps/server holds three separate connection pools (app_rw, analytics_w, audit_w). Plan's packages/db (and apps/server db.ts per IMPL-DATA-027) must instantiate three distinct pools, each bound to its role's credentials.
- **Risk:** A single shared pool would collapse the role isolation, allowing audit/analytics writes to share the transactional credential and defeating IMPL-DATA-003/043.

### IMPL-DATA-005: dev-environment-k3d

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** k3d runs a PostgreSQL StatefulSet (k8s/dev/postgres.yaml); init SQL scripts in scripts/dev-postgres-init/ create the three databases and three roles on first start; secrets via ConfigMap (k8s/dev/dev-secrets.yaml). Local dev is launched via `bun run local-demo` (scripts/local-demo.ts).
- **Risk:** Without init SQL provisioning all three DBs/roles, local dev would diverge from the production three-database topology, hiding role-isolation bugs until deployment.

### IMPL-DATA-006: initial-migration

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** Core tables in an initial migration (blueprint: 0001_initial_graph.sql). Plan provides a packages/db migration runner. For this project the initial migration must establish the placement-lifecycle tables plus org_id tenancy. The blueprint's claim that JSONB rarely needs further DDL holds only if the property-graph model (002) is adopted.
- **Risk:** If the domain is modeled relationally rather than as JSONB, this project WILL need ongoing DDL migrations — the migration runner is therefore mandatory, not optional.

### IMPL-DATA-007: schema-evolution-via-registry

- **Type:** implementation
- **Applicable:** partial
- **Technology implication:** Blueprint: add entity types/properties via INSERT/UPDATE on entity_types, audited and revertible, no DDL. Applicability depends on the Dev-scout's data-model decision (002). Commission plan versioning (PRD §6 Plan Version lifecycle, Phase 3 "plan versioning") is a strong candidate for registry/data-driven evolution rather than DDL.
- **Risk:** If business-model changes (new contributor roles, new plan rule types) require DDL each time, the platform cannot adapt to per-customer plan configurability — a PRD goal (Open Question 4). Data-driven schema where feasible reduces that friction.

### IMPL-DATA-008: application-layer-validation

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** Validation occurs in the application layer against JSON Schema in the entity_types registry before SQL execution. This directly supports the PRD's Data Completeness Gating (§9) and Phase 2 "Placement completeness validation" — required-field enforcement lives in the app layer.
- **Risk:** Relying solely on DB constraints would miss the rich required-field/blocking-queue semantics the PRD demands; app-layer validation is where the completeness gate is enforced.

### IMPL-DATA-009: parameterized-sql-no-orm

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** All queries via the `postgres` client tagged template literal API; no ORM; no string concatenation. Governs every data-access function in packages/db and the calculation engine.
- **Risk:** With multi-tenant financial data (org_id), any SQL-injection path is catastrophic — cross-tenant data exposure of payouts and draw balances. Parameterization at the call site is the primary defense.

### IMPL-DATA-010: aes-256-gcm-web-crypto

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** Field encryption uses AES-256-GCM via Web Crypto (crypto.subtle). Plan Phase 1 "Field-level encryption" with "encrypted BYTEA columns for financial fields." Bun supports Web Crypto.
- **Risk:** Financial fields (commissionable base, payout amounts, draw balances, fee terms) are the platform's most sensitive data; weak or hand-rolled crypto would expose them. AES-256-GCM via the platform primitive is the mandated choice.

### IMPL-DATA-011: key-per-type-from-registry

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** entity_types registry declares which properties are sensitive and which kms_key_id protects them. Plan: "FieldEncryptor with per-entity-type KMS keys." One key compromise exposes only one entity type (e.g., draw balances separate from payouts).
- **Risk:** A single shared key for all financial fields means one compromise exposes every producer's compensation across all entity types — blast radius far exceeds the product's confidentiality constraint (§9).

### IMPL-DATA-012: field-encryptor-intercept

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** A FieldEncryptor intercepts writes, consults the registry, and encrypts sensitive keys in the JSONB (or BYTEA) blob before storage; decrypts after read. Centralizes encryption so individual queries don't handle plaintext-vs-ciphertext.
- **Risk:** Without a single interceptor, developers may forget to encrypt a sensitive field on one of many write paths (placement, exception, adjustment), leaking PII/financials.

### IMPL-DATA-013: ciphertext-envelope-format

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** Encrypted fields stored as base64url(keyVersion 4B || iv 12B || ciphertext+tag). keyVersion enables rotation; random IV per call; 16-byte GCM tag. Defines the on-disk format for every encrypted financial field.
- **Risk:** Omitting keyVersion forces full-table re-encryption cutover on rotation (see 046); omitting random IV breaks GCM (see 045). Either undermines long-lived storage of compensation data.

### IMPL-DATA-014: key-rotation-background-job

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** KMS issues a new key version; new writes use it immediately; a background job re-encrypts old rows (parse keyVersion, decrypt old, re-encrypt new); old key retained read-only until zero rows remain. Maps to Plan Phase 1 task queue / worker ("foundation for ... event-driven recalculation jobs") which can host this re-encryption job.
- **Risk:** A single-transaction rotation would lock the financial tables and risk downtime during a commission cycle. The background approach keeps the close workflow available.

### IMPL-DATA-015: analytics-write-only-role

- **Type:** implementation
- **Applicable:** partial
- **Technology implication:** Events written to commission_analytics via analytics_w with no read path back to commission_app. Plan defines the analytics DB and an "analytics/audit event taxonomy" (Dev-scout). Applies to whatever operational/usage events feed leadership dashboards (PRD §2 metrics, Phase 7).
- **Risk:** If the analytics role could read commission_app, the (lower-trust) analytics tier becomes a side channel into confidential per-producer payouts.

### IMPL-DATA-016: session-pseudonym-attribution

- **Type:** implementation
- **Applicable:** partial
- **Technology implication:** Events attributed to a rotating session pseudonym, not a user ID. Relevant if behavioral/usage analytics are collected (PRD adoption metrics: "% of credited producers actively viewing payout statements"). Less central than in a consumer product, but the taxonomy decision should follow this.
- **Risk:** Storing raw user IDs in the analytics tier would let aggregate analytics re-identify individual producers' activity, conflicting with the confidentiality constraint.

### IMPL-DATA-017: pseudonym-mapping-not-exported

- **Type:** implementation
- **Applicable:** partial
- **Technology implication:** The pseudonym↔identity mapping lives only in commission_app, never exported to analytics. Reinforces 016 for any usage-event pipeline.
- **Risk:** Exporting the mapping defeats pseudonymization entirely, exposing who viewed/disputed what.

### IMPL-DATA-018: differential-privacy-laplace

- **Type:** implementation
- **Applicable:** partial
- **Technology implication:** Laplace noise on aggregation exports; per-dataset epsilon budget tracked in commission_app; atomic check-and-decrement; exhaustion returns structured error. Applicability is weak: the PRD's executive dashboards (Phase 7) are internal, authorized leadership views of the firm's own data, not privacy-preserving releases to untrusted parties. DP may be unnecessary for internal margin reporting; the Dev-scout should explicitly scope whether any export crosses a trust boundary (e.g., External Partner view, PRD §5.10).
- **Risk:** Over-applying DP would add noise to finance numbers that must be exact (payroll). Under-applying it on any externally shared aggregate could leak individual compensation. The trust-boundary determination drives this.

### IMPL-DATA-019: analytics-event-hmac-signature

- **Type:** implementation
- **Applicable:** partial
- **Technology implication:** Events signed with a session-derived HMAC key via HKDF, validated server-side before storage. Matters only if events originate at a client/edge. If analytics events are emitted server-side (likely for this internal tool), edge signing is less critical.
- **Risk:** Unsigned client-emitted events could be forged to skew adoption metrics; low impact for server-emitted events.

### IMPL-DATA-020: idempotent-analytics-writes

- **Type:** implementation
- **Applicable:** partial
- **Technology implication:** INSERT ... ON CONFLICT (event_id) DO NOTHING for at-least-once idempotency. Directly relevant to the Plan's PostgreSQL task queue / worker model, which is at-least-once and will emit events for guarantee-expiry and recalculation jobs.
- **Risk:** Without idempotent writes, retried worker jobs double-count events, corrupting the leadership metrics in Phase 7.

### IMPL-DATA-021: audit-log-before-access

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** Every sensitive data access is logged before it executes; if the audit write fails, the read is denied. This is the strongest expression of the PRD's audit constraint and applies to producer payout views, partner access, and finance reads of confidential financials.
- **Risk:** Logging after access (or best-effort) leaves a window where confidential payout data is read without a record — directly violating §9 "all changes ... permanently recorded" and the product's auditability promise.

### IMPL-DATA-022: audit-insert-only-role

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** Audit log written via audit_w: INSERT only, no UPDATE/DELETE/TRUNCATE. Plan names the audit_w role. Enforces §9 "never silently overwritten."
- **Risk:** If the audit table could be updated/deleted, attribution and approval history could be rewritten — the exact failure the product exists to prevent.

### IMPL-DATA-023: audit-separate-encryption-key

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** Audit log uses a separate encryption key from the data it audits. Adds to the per-type KMS key set (011) a dedicated audit key.
- **Risk:** Sharing the app key means a single compromise exposes both the financial data and its audit trail, removing independent corroboration.

### IMPL-DATA-024: audit-writer-credential-isolation

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** audit_w credentials held only by the audit writer module (packages/data audit per 027); no other code path can obtain them.
- **Risk:** If audit credentials leak into general app code, the insert-only guarantee is bypassable, weakening tamper-resistance.

### IMPL-DATA-025: audit-entry-fields

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** Entries include action, actorId, actorKind, resourceType, resourceId, timestamp, result. Maps to PRD §9 requirement for "timestamp, actor, and reason" on every change and to the escalation/exception audit trails (§5.4).
- **Risk:** Missing actor or result fields makes dispute and exception history unprovable, undermining the documented-resolution requirement.

### IMPL-DATA-026: audit-backup-independent

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** Audit log backed up independently of commission_app; app backups never include the audit log; replication to append-only cold storage required. Reinforces the separate-database topology (003) at the backup/DR layer.
- **Risk:** A shared backup lets an actor who can restore/manipulate app backups also alter audit history; cold-storage immutability is the long-term tamper-evidence the PRD's compliance posture relies on.

### IMPL-DATA-027: package-structure

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** packages/data with db / crypto / kms / analytics / audit submodules; apps/server with migrations/ and db.ts; k8s/dev/ with Postgres StatefulSet + init SQL; packages/core/types/data.ts for record/event types. Plan's monorepo names packages/db, packages/core, apps/server/worker — close but not identical; the project should reconcile packages/data vs packages/db naming during scaffold.
- **Risk:** Scattering crypto/audit/analytics across packages erodes the credential-isolation (024) and interceptor (012) guarantees that depend on clear module boundaries.

### IMPL-DATA-028: kms-client-interface

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** KMSClient interface — encrypt(plaintext, keyId), decrypt(ciphertext, keyId), rotateKey(keyId); keys from env vars injected by scoped k8s Secrets. Plan: "GCP Cloud KMS in production, dev stub" — the interface allows the GCP impl and the dev stub to be swapped behind one abstraction. (Note tension with 037, below.)
- **Risk:** Without the interface boundary, production GCP KMS and the local dev stub cannot share call sites, forcing environment-specific branches in encryption code.

### IMPL-DATA-029: field-encryptor-interface

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** FieldEncryptor interface — encryptField(value, table)/decryptField(ciphertext, table); fresh random IV; fetches current key version from KMS; supports current- and old-key ciphertext for rotation. Pairs with Plan's "DEK cache (5 min TTL)."
- **Risk:** Without dual-key support the rotation job (014) cannot decrypt in-flight old-version rows, breaking reads during rotation.

### IMPL-DATA-030: analytics-event-interface

- **Type:** implementation
- **Applicable:** partial
- **Technology implication:** AnalyticsEvent — type, payload, sessionPseudonym, eventId (UUIDv4 for idempotent insert), timestamp, signature (HMAC-SHA256/HKDF). Shapes the event taxonomy the Dev-scout defines. eventId/idempotency (see 020) is the most directly applicable part for the worker pipeline.
- **Risk:** Omitting eventId removes the idempotency key the at-least-once worker queue needs.

### IMPL-DATA-031: audit-entry-interface

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** AuditEntry — action, actorId, actorKind (user|agent|system), entityType, entityId, timestamp, result (allowed|denied). actorKind including `agent`/`system` matters because the worker (guarantee-expiry, clawback, recalculation) acts as a non-user actor and its actions must be auditable.
- **Risk:** Without actorKind, system/worker-initiated ledger adjustments (clawbacks) are indistinguishable from human actions in the audit trail, weakening dispute defensibility.

### IMPL-DATA-032: typed-query-function-pattern

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** QueryFn<TParams, TResult> alias for typed parameterized query functions returning Promise<TResult[]>. Standardizes the data-access layer in packages/db with TypeScript type safety over raw SQL.
- **Risk:** Untyped query functions invite shape mismatches between SQL results and the financial domain types, causing calculation bugs.

### IMPL-DATA-033: postgres-npm-client

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** Use the `postgres` npm package (Buy decision). Tagged template literals produce parameterized queries by default. This is the concrete client library for all three pools.
- **Risk:** A client without safe-by-default parameterization reintroduces injection risk for multi-tenant financial queries.

### IMPL-DATA-034: web-crypto-aes-hkdf

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** AES-256-GCM and HKDF via Web Crypto (crypto.subtle); no external crypto library (DIY decision). Confirms no node-forge/libsodium dependency for field encryption.
- **Risk:** Pulling in a third-party crypto lib adds supply-chain surface for the most sensitive code path with no functional gain over the platform primitive.

### IMPL-DATA-035: no-orm

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** No Prisma/TypeORM/Drizzle (Do-not-buy decision). Agents write SQL directly. Constrains the entire Plan's data layer and the calculation engine's queries.
- **Risk:** An ORM would add a generation step and runtime abstraction over the bespoke property-graph/financial schema, and obscure the parameterization guarantee (039).

### IMPL-DATA-036: dp-diy-implementation

- **Type:** implementation
- **Applicable:** partial
- **Technology implication:** Laplace noise (~20 lines) and epsilon budget tracking (~100 lines, DB-backed in commission_app) implemented in-house, no library. Applicable only to the extent DP itself is in scope (see 018).
- **Risk:** Adopting a heavyweight DP library for minimal internal-analytics needs would be over-engineering; building it only if/when an external trust boundary requires it.

### IMPL-DATA-037: kms-sdk-buy-when-needed

- **Type:** implementation
- **Applicable:** partial
- **Technology implication:** Blueprint says no KMS SDK is needed — k3s encrypts Secrets at rest and the app reads keys from env vars. This conflicts with Plan Phase 1's explicit "GCP Cloud KMS in production." For THIS project the Plan's decision (GCP Cloud KMS via the KMSClient interface, 028) takes precedence over the blueprint's "secrets-as-env-vars-only" stance; the env-var/k8s-Secret path applies to the dev stub and to the master/wrapping key delivery, not to envelope DEK management.
- **Risk:** Resolve the conflict explicitly in the Dev-scout: treating GCP KMS as unnecessary would contradict the Plan; treating env-var secrets as the only mechanism would lose KMS-managed rotation. The KMSClient interface is what reconciles both.

### IMPL-DATA-038: no-bun-sqlite

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** bun:sqlite is not used (Do-not-use). Even though the stack is Bun, the database is PostgreSQL only. Reinforces 001.
- **Risk:** Using bun:sqlite for any tier (even tests/local) would fork the data model away from the production three-database PostgreSQL topology.

### IMPL-DATA-039: antipattern-orm-safety-blanket

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** Do not adopt an ORM "for safety." Parameterization is enforced at the call site by the postgres tagged-template syntax. Pairs with 035.
- **Risk:** False sense of safety from an ORM plus the temptation to drop to raw concatenation for complex commission queries would reintroduce injection risk.

### IMPL-DATA-040: antipattern-shared-db-browser

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** Do not import a DB utility into the browser bundle (apps/web) for types. Record/event types belong in packages/core/types/data.ts (027), imported by web without dragging in DB runtime code.
- **Risk:** A DB import path in the producer/partner web bundle could ship database call code (or credentials) to the client and bloat/break the bundle.

### IMPL-DATA-041: antipattern-logging-decrypted

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** Do not log decrypted objects in error handlers; log IDs and error codes only. Applies to the Plan's "structured JSON logging" and trace-ID middleware.
- **Risk:** A `catch(e){ log(payout) }` would dump decrypted compensation/PII into logs, breaching the confidentiality constraint and creating an un-audited copy of sensitive financials.

### IMPL-DATA-042: antipattern-env-var-keys

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** Encryption keys exist only in the containers that need them, via scoped k8s Secrets; ENCRYPTION_MASTER_KEY mounted only on DB pods, never on API/worker pods. Shapes the k8s/ manifests (Plan deployment scripts) and the network-isolated worker model.
- **Risk:** Mounting the master key on the worker (which runs clawback/recalc jobs) would widen the key's exposure to the least-trusted compute tier.

### IMPL-DATA-043: antipattern-single-role-app-audit

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** Do not use one DB role for app and audit. The audit_w role exists precisely so app_rw cannot write/alter audit rows. Reinforces 003/022.
- **Risk:** A compromised app under a shared role could "cover its tracks," erasing the attribution/approval history that is the product's reason to exist.

### IMPL-DATA-044: antipattern-analytics-same-db

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** Do not co-locate analytics and transactional tables, even in separate schemas. Separation enforced at the database level (commission_app vs commission_analytics). Reinforces 003/015.
- **Risk:** A single missing REVOKE could let analytics queries reach raw per-producer financials — a cross-boundary leak of confidential data.

### IMPL-DATA-045: antipattern-static-iv

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** Always generate crypto.getRandomValues(new Uint8Array(12)) per encryption call; never a static/deterministic IV. Hard requirement of the FieldEncryptor (029).
- **Risk:** A reused IV breaks AES-GCM authentication entirely, exposing encrypted financial fields — catastrophic for the most sensitive data in the system.

### IMPL-DATA-046: antipattern-no-key-version

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** Never store raw ciphertext without a keyVersion prefix (013); the prefix turns rotation into a background migration (014).
- **Risk:** Without keyVersion, every key rotation requires a full table re-encryption cutover, forcing downtime during which the commission ledger is unavailable.

## Recommended Technology Choices

- **PostgreSQL 16 as the sole datastore, from the first commit** — three physical databases commission_app / commission_analytics / commission_audit (IMPL-DATA-001, 038, 044).
- **Three database roles with no cross-database privileges** — app_rw, analytics_w (INSERT-only), audit_w (INSERT-only) (IMPL-DATA-003, 022, 043).
- **Three separate connection pools in apps/server, one per role** (IMPL-DATA-004).
- **`postgres` npm client with tagged-template parameterized queries; no ORM** (IMPL-DATA-033, 035, 039); typed via QueryFn<TParams, TResult> (IMPL-DATA-032).
- **Registry-driven schema + application-layer JSON Schema validation** to power the data-completeness gate, with the Dev-scout reconciling property-graph vs relational modeling for the commission domain (IMPL-DATA-002, 007, 008).
- **Migration runner in packages/db with an initial migration** establishing placement-lifecycle tables and org_id tenancy (IMPL-DATA-006).
- **Field-level encryption with AES-256-GCM + HKDF via Web Crypto (crypto.subtle), no external crypto library** (IMPL-DATA-010, 034); centralized in a FieldEncryptor interceptor (IMPL-DATA-012, 029).
- **Per-entity-type encryption keys driven by the registry** (IMPL-DATA-011); ciphertext envelope = base64url(keyVersion 4B || random IV 12B || ciphertext+tag) (IMPL-DATA-013, 045, 046).
- **KMSClient abstraction with GCP Cloud KMS in production and a dev stub**, keys delivered via scoped k8s Secrets (master key on DB pods only) (IMPL-DATA-028, 037, 042); background key-rotation job hosted on the worker queue (IMPL-DATA-014).
- **Audit-log-first enforcement**: write audit entry before any sensitive access, deny on audit-write failure; audit_w credentials isolated to the audit module; separate audit encryption key; independent backup to append-only cold storage (IMPL-DATA-021, 023, 024, 025, 026, 031) — the direct implementation of PRD §9.
- **Analytics tier as INSERT-only, idempotent (ON CONFLICT (event_id) DO NOTHING), with pseudonymized attribution**; differential privacy and edge HMAC signing applied only if an export crosses an external trust boundary, decided by the Dev-scout (IMPL-DATA-015, 016, 017, 018, 019, 020, 030, 036).
- **Monorepo data packaging**: packages/data (db/crypto/kms/analytics/audit), shared record/event types in packages/core, never importing DB runtime into the apps/web bundle; never log decrypted objects (IMPL-DATA-027, 040, 041) — reconcile packages/data vs the Plan's packages/db naming at scaffold time.
- **Local dev via Docker Compose + init.sql** provisioning all three databases and roles on a distroless PostgreSQL image (IMPL-DATA-005).
