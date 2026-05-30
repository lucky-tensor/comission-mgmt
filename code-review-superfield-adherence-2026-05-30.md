# Superfield Adherence Review — Recruiting Commission Operations Platform

**Date:** 2026-05-30
**Reviewer:** Claude Code (8 parallel domain auditors + spot verification)
**Rule source:** `~/superfield/brain/rules` (blueprints + TypeScript implementations)
**Subject:** `comission-mgmt` @ `3723870` (main), Phases 1–7 sprint output
**Method:** One auditor per rule domain read the authoritative `.yaml` rule file(s) and graded the *actual shipped code* (not `docs/architecture.md`'s claims) with file:line evidence. The two highest-severity findings were re-verified by hand.

---

## Verdict

**Partially conformant. Not release-grade. The sprint built strong structural bones but ships real security defects and a systematically over-stated architecture document.**

The skeleton the Superfield blueprints care about is genuinely present: three physically separated PostgreSQL databases with insert-only roles, DIY ES256 JWT with a structurally pinned algorithm, hand-rolled WebAuthn, a faithful single-table Postgres task queue, AES-256-GCM envelope encryption, distroless multi-stage images, and a high-substance real-Postgres test core with zero domain mocks. Dependency discipline is exemplary (3 runtime deps).

But conformance breaks on **load-bearing rules**, not cosmetic ones:

- A genuine, exploitable **SQL-injection surface** across the data layer (`sql.unsafe()` with unescaped, caller-supplied interpolation).
- The **worker pod is handed `DATABASE_URL` *and* the field-encryption master key** — the single most important WORKER prohibition, inverted.
- **Security controls that exist but are never wired in** (CSRF, rate limiting) — dead code presenting as protection.
- **Process governance is aspirational**: no branch-protection ruleset, admin bypass enabled, 2 required checks instead of the claimed set, and most test suites are not gated by CI at all.
- The **frontend is ~5% built** (a login screen) against a doc that describes six finished role surfaces.

The throughline across every domain: **`docs/architecture.md` describes a target state as though it shipped.** It maps beautifully to rule IDs, then claims `requireScope`, `@simplewebauthn/server`, BIP-39 recovery, stdout logging, image signing, NetworkPolicy DB isolation, a merge queue, Playwright, and a ledger-replay suite — none of which exist in code. The doc's own self-grade ("arch.yaml: 37 of 38 rules applied") is not earned.

### Scorecard

| Domain | Score | One-line |
|---|---|---|
| ARCH | 6/10 | Runtime separation + dep minimalism strong; shared-type spine missing, layout over-claimed |
| AUTH | 6/10 | Crypto primitives solid; CSRF/rate-limit unwired, orphaned password module, `SameSite=Lax` in prod |
| DATA | **4/10** | 3-DB/encryption skeleton good; **SQL injection**, tenancy gap, swallowed audit failures |
| DEPLOY + ENV | 5/10 | Container/rollout faithful; broken readiness probe, file-only logs, no env fail-fast |
| PROCESS | **4/10** | One-PR discipline real; **no ruleset, admin bypass on, 2 checks, no `.gitattributes`** |
| TEST | 5/10 | Real-Postgres core excellent; **no browser/E2E, no replay suite, most suites not in CI** |
| UX | **3/10** | No banned libs; **frontend is a login page only — 0 of 6 role surfaces, CSS-in-JS not Tailwind** |
| WORKER + TASK-QUEUE + PRUNE | 5/10 | Queue 8/10; **Worker 3/10 (DB creds in pod)**; PRUNE 2/10 (no instrumentation, no annotations) |

**Aggregate posture:** ~4.8/10. Conformant *in shape*, non-conformant *in the guarantees the blueprints exist to enforce* (injection safety, key isolation, worker containment, enforced process gates).

---

## P0 — Must fix before this can be called conformant

### 1. SQL injection across the data-access layer  ·  DATA  ·  *verified by hand*
`sql.unsafe()` is called with SQL strings built from unescaped, caller-supplied values.

- `packages/db/src/placements.ts:166-185` — `createPlacement` interpolates `orgId`, `candidateId`, `clientEntityId`, and **user free-text `jobTitle`** raw into the INSERT (`'${input.jobTitle}'`, no escaping).
- `packages/db/src/placements.ts:272-336` — `updatePlacement` interpolates `candidateId`, `status`, `startDate`, `guaranteeExpiryDate` raw (only `jobTitle` is hand-escaped here, inconsistently).
- `packages/db/src/commission-records.ts:147-165,335` and `packages/db/src/billing-phases.ts:174-308` — same pattern.

Violates DATA-C-005, IMPL-DATA-009/033/035/039 (tagged-template parameterization is the *named multi-tenant injection defense* in `architecture.md`). Hand-rolled `replace(/'/g,"''")` (used for `explanation`, `before_json`/`after_json` in ~9 API modules) is the exact anti-pattern the blueprint forbids — one missed field is injectable.
**Fix:** convert every `sql.unsafe()` identifier/value to a bound `$n` parameter or tagged template. Add a CI grep-gate banning raw interpolation into `.unsafe(`.

### 2. Worker pod holds `DATABASE_URL` and the encryption master key  ·  WORKER/DATA  ·  *verified by hand*
`k8s/worker.yaml:41-53` injects `DATABASE_URL` **and** `ENCRYPTION_MASTER_KEY` into the worker container — under a comment that says "worker must not write directly to the DB." The blueprint is explicit: the credential *is* the vulnerability (WORKER-X-009, WORKER-C-002, WORKER-P-001), and "read-only intent" does not excuse possession. The master key on a non-DB pod additionally violates DATA-P-007/X-006 ("keys mounted on DB pods only, never API/worker"). `schema.sql:151-177` even provisions an `agent_rw` role + `claimable_tasks` view as the worker's DB read path — itself forbidden (WORKER-P-008).

This directly contradicts `architecture.md:39,95-96` ("Zero DB write grants… network policy blocks worker→DB"). The worker *source* is clean (HTTP-only, no `postgres` import in runtime) — the violation is entirely in the manifest + schema role.
**Fix:** remove both env vars from `worker.yaml`; drop `agent_rw`/`claimable_tasks`; add the `apps/worker/src/startup-guard.ts` (IMPL-TQ-TS-008) that aborts if `DATABASE_URL`/`PG*` is present; remove `db`/`postgres` from `apps/worker/package.json:9-13`.

### 3. CSRF and rate limiting are written but never invoked  ·  AUTH
`apps/server/src/auth/csrf.ts` (double-submit `verifyCsrf`) and `apps/server/src/security/rate-limiter.ts` (all limiters) are fully implemented and **only re-exported** — no call site in the request path (`index.ts:125,127`). Login/register never set the CSRF cookie. Combined with **`SameSite=Lax` cookies in production** (`cookie-config.ts:40`, vs the documented/blueprint `Strict`), state-mutating cross-site requests are undefended at the app layer. Auth endpoints have no brute-force protection. Violates AUTH-C-014/C-024, IMPL-AUTH-007/018/029.
**Fix:** wire `verifyCsrf` into mutating routes and set the cookie on login; invoke the limiters on `/auth/*`; set `SameSite=Strict` in prod.

---

## P1 — Conformance gaps that undermine a blueprint guarantee

### Data integrity / audit
- **Tenancy gap:** `updatePlacement` keys on `WHERE id = $n` with no `org_id` — a guessed placement id permits cross-tenant write (`placements.ts:325-328`). Other modules scope correctly, so this is an inconsistency, not a pattern.
- **Audit-write failures are swallowed** as "non-fatal" (`placements.ts:110,141-143`), violating the log-or-deny rule (DATA-D-010, IMPL-DATA-021). The blueprint's defining **audit-log-*before*-sensitive-read** ordering (DATA-P-008/D-010) is **not implemented at all** — audit rows are written only on mutations, never before reads.
- **Append-only is convention-only:** all three DBs are `OWNER app_rw` (`01-databases.sql`), so the app role can `UPDATE/DELETE/TRUNCATE` the audit DB and `commission_journal`. No triggers/REVOKE enforce immutability — a compromised app role can erase its tracks.
- **Encryption envelope drift:** stored as raw `IV|ct|tag` with **no `keyVersion` prefix** (`encryption.ts:14,141`), so the documented zero-downtime key rotation (IMPL-DATA-013/014) cannot work; no rotation job exists. "Per-entity-type KMS keys" is one KMS key wrapping per-type DEKs — weaker blast-radius isolation than claimed.

### Deploy / runtime (two real deploy-breakers)
- **Readiness probe points at a non-existent path:** `k8s/app.yaml:82` / `deploy-production.yaml:83` probe `/health/ready`, but the server serves `/readyz` + `/healthz`. Readiness never passes → every rollout stalls and rolls back.
- **Worker NetworkPolicy is a no-op:** `worker-network-policy.yaml` lives in namespace `commission` (never created) and targets `app: commission-server` (actual label `commission-app`). The DB-isolation claim is unenforced.
- **Logs go to files, never stdout** (`packages/core/logger.ts` `appendFileSync` only) — contradicts the stdout claim and risks total log loss on an ephemeral distroless FS (DEPLOY-C-005/006).
- **No env-var validation / fail-fast;** a hardcoded `postgres://app_rw:app_rw_password@localhost` default lets a misconfigured prod pod boot with insecure defaults (`index.ts:133-134`).
- **Claimed-but-absent:** image signing + admission verify, pre-migration DB snapshots, browser→server→PG trace propagation (server leg only), browser-error forwarding to `/api/logs`, non-root `securityContext`.

### Process (governance not enforced)
- **No branch-protection ruleset** (`gh api …/rulesets` → `[]`); **`enforce_admins:false`** (admin bypass on) — directly violates PROCESS-P-009/D-011/D-016 and the `bypass_actors:[]` claim.
- **Only 2 required checks** (`quality-gate`, single-issue) vs the claimed build/coverage/e2e/integration/unit/depends-on set. No merge queue, no `.gitattributes` (`merge=binary` claim is false), no `Depends-on` ordering, no PR template in-repo.
- Two **direct-to-main web-UI commits** (`72aee28`, `0992c75` "Add files via upload") bypassed the PR flow entirely.

### Test (good tests, weak gating)
- **No Playwright / headless Chromium / component / E2E tests at all** (TEST-D-004, IMPL-TEST-002) — the largest single gap; claimed as shipped.
- **Most domain suites never run in CI:** `test-api.yml` includes only `placements/**` + `plans/**`; the other ~19 API suites and the 22 root `vitest.*.config.ts` are referenced by no workflow. `test-unit.yml`'s glob `packages/*/tests/unit` misses `packages/core/tests` + `packages/db/tests`. `test-migration.yml` guards a config path that doesn't exist → silent green no-op. Excellent tests that cannot gate a merge.
- **No ledger-replay/recovery suite** (TEST-D-006) despite being claimed.

### Frontend (essentially unbuilt)
- The entire web app is 4 files rendering a login screen; **0 of 6 claimed role surfaces** exist (producer portal, finance queue, manager view, exec dashboard, admin, partner). `App.tsx` hard-renders `<Login/>`; post-login navigates to `/` (a dead-end).
- **CSS-in-JS, not Tailwind:** no `tailwind.config.*`, zero `className`, all inline `React.CSSProperties` — violating the architecture's own "no CSS-in-JS" guarantee. The `packages/ui` design system is one unused `Button`. The claimed thin typed `fetch` wrapper doesn't exist (raw `fetch` duplicated 7×).

### Pruning / observability
- **Zero `DORMANT_BY_DESIGN` annotations** anywhere, despite abundant cross-phase dormant code (clawback, guarantee-expiry, worker agents) that the doc says carries them — the pruning pipeline would flag all of it as false-positive dead code (PRUNE-C-003).
- **No usage instrumentation:** `commission_events` is written only by a migration test; no route/surface emits a usage event (PRUNE-P-006/C-001), so the analytics DB is write-dead.

---

## P2 — Cleanups & latent risks

- **Orphaned password module** `apps/server/src/auth/password.ts` (full PBKDF2) + password-reset rate-limiter stubs in a passkey-only system — delete (AUTH-X-001 latent re-intro risk).
- **`packages/core` is not a pure-types module** — it re-exports runtime logic (`encryption`, `kms`, `calculation-engine`…), and domain types (`Placement`, `Contributor`) live in `packages/db`, not `core`. 56 request/response contracts are defined locally in `apps/server/src/api/*`, shared by neither side. The single-source-of-truth contract spine (ARCH-D-001/D-004, IMPL-ARCH-014) is structurally unmet.
- **`docs/dependencies.md` does not exist** despite being cited as the Buy/DIY justification ledger (ARCH-C-005, IMPL-ARCH-023); `ajv`/`croner` are unjustified.
- **Session TTL is 7 days**, not the 1h + refresh-rotation spec (IMPL-AUTH-008); no refresh endpoint. No auth-event audit logging.
- **RBAC uses unbounded `startsWith` prefix matching** (`core/auth.ts:176`) — can silently over-grant as routes grow.
- **Payload denylist omits PII keys** the checklist names (`email`, `name`, `address`, `ssn`…) — `{email:…}` passes (TQ-C-004 partial).
- **Stray `console.*`** bypass the structured logger in cron/clawback/me/worker.
- **`/readyz` returns `{status:'ok'}` in its 503 failure body** — misleading to consumers.

---

## What the sprint got genuinely right

Worth stating plainly, because the bones are good and several choices are *more* conformant than the doc:

- **Exemplary dependency discipline** — 3 runtime deps; JWT, field encryption, COSE/WebAuthn verification, rate-limiting all DIY via Web Crypto (ARCH buy-vs-DIY).
- **Physical runtime separation holds** — `apps/web` resolves zero server/db imports; the worker source is genuinely HTTP-only.
- **JWT algorithm pinning is structurally correct** — `verifyJwt` never reads the header `alg`; `alg:none`/`HS256` confusion is impossible (`jwt.ts:223-279`, test-covered).
- **Durable, fail-closed JTI revocation**; single-use, scope-bound, ≤24h delegated worker tokens with dual attribution.
- **Three real databases, three insert-only-where-applicable roles, three pools** — verified by `migration.test.ts` (audit_w UPDATE/DELETE actually fail).
- **A faithful single-table Postgres task queue** — `FOR UPDATE SKIP LOCKED` atomic claim, idempotency key, bounded retry + dead-letter, exponential-backoff lease recovery, opaque-payload denylist on financial keys (TASK-QUEUE 8/10).
- **Distroless multi-stage images** (pinned digests, array ENTRYPOINT, frozen lockfile, no secrets baked in) and an ordered, health-gated, eager-rollback `deploy.sh`.
- **A high-substance real-systems test core** — real `postgres:16` containers, real migrations, ~1,524 assertions across the commission domain, **zero domain mocks** (only a real AES-GCM KMS dev adapter at the permitted boundary).

---

## Recommended path to conformance (ordered)

1. **Kill the injection surface** — parameterize every `sql.unsafe()`; add a CI grep-gate. *(P0-1)*
2. **Strip the worker manifest** — remove `DATABASE_URL` + `ENCRYPTION_MASTER_KEY`, drop `agent_rw`/`claimable_tasks`, add the startup guard. *(P0-2)*
3. **Wire the controls you already wrote** — CSRF + rate limiting into the request path; `SameSite=Strict`. *(P0-3)*
4. **Close the deploy-breakers** — fix the `/readyz` probe path and the NetworkPolicy namespace/label; route logs to stdout; add env fail-fast. *(P1)*
5. **Make CI actually gate** — every test suite in a workflow; fix the silent-skip guards; add the missing required checks; create the branch-protection ruleset with `bypass_actors:[]` and `enforce_admins:true`. *(P1)*
6. **Enforce the ledger guarantees** — audit-before-read ordering, deny-on-audit-failure, DB-level append-only (triggers/REVOKE, non-`app_rw` ownership of audit/analytics). *(P1)*
7. **Reconcile `docs/architecture.md` with reality** — either build the claimed items (`requireScope`, `keyVersion` envelope, stdout logging, image signing, replay suite, the six role surfaces) or relabel them as *planned/dormant*. An architecture doc that overstates conformance is itself the highest-leverage process defect here.
8. **Add `DORMANT_BY_DESIGN` annotations and usage instrumentation** so the pruning pipeline can tell intentional seams from dead code. *(P1/P2)*

---

### Auditing notes / confidence
- Domains audited against the canonical rule YAML, graded on code: ARCH, AUTH, DATA, DEPLOY, ENV, PROCESS, TEST, UX, WORKER, TASK-QUEUE, PRUNE. ETL/IMAP-ETL excluded (no email/contract ingestion — explicit PRD non-goals).
- P0-1 and P0-2 were re-verified by hand against `placements.ts` and `k8s/worker.yaml`; both confirmed.
- Branch-protection state was checked server-side via authenticated `gh api` (rulesets `[]`, classic protection, `enforce_admins:false`). What is *not* verifiable locally: whether each required check was green at each historical merge moment.
- "Dormant by design" was credited where in-file prose names a dependent phase, even though the parseable `DORMANT_BY_DESIGN` token is absent — distinguishing intentional Phase-1 seams from real violations throughout.
