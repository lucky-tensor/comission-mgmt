# Blueprint: AUTH — Architecture Research

**Source:** blueprint/rules/blueprints/auth.yaml
**PRD:** docs/prd.md (present)
**Plan documents:** docs/plan.md
**Technical documents:** none found

## Summary

This product is a multi-tenant commission ledger whose entire value proposition rests on a governed, auditable, trustworthy economic record — exactly the surface AUTH is built to protect. The most load-bearing rules are passkey-first authentication (AUTH-P-001, AUTH-D-001), HTTP-only cookie sessions (AUTH-P-002, AUTH-D-008), pinned-algorithm token verification (AUTH-P-009, AUTH-D-002), JTI-keyed durable revocation (AUTH-D-009), and scoped short-lived agent/worker credentials (AUTH-P-003, AUTH-D-003) — all four are already named explicitly in Plan Phase 1 (WebAuthn passkeys, HTTP-only Secure SameSite=Strict cookies with JTI revocation, network-isolated worker writing via the API with delegated scoped credentials). Dual attribution (AUTH-P-006, AUTH-D-004) is strongly motivated because the PRD's core promise — answering "who had authority?" vs "which automation executed it?" for every commission action — is precisely dual attribution applied to a financial ledger. M-of-N privileged-operation control (AUTH-P-007, AUTH-D-006) is partial-to-applicable given bulk payroll exports and signing-key rotation. Digital-twin sandbox credentials (AUTH-D-005) have no product surface and are not applicable. Together these imply a self-hosted, agent-aware auth gateway architecture (AUTH-A-003) backed by an HSM/KMS key store (GCP Cloud KMS is already chosen for field encryption), with deterministic deployment-time auth config.

## Rule Analysis

### AUTH-T-001: phished-or-stolen-credentials

- **Type:** threat
- **Applicable:** yes
- **Technology implication:** Finance Admins, Executives, and HR operators handle payroll-ready financial data; credential theft must be eliminated at the protocol level via passkeys (no passwords to phish or steal).
- **Risk:** A stolen producer or finance credential exposes payout amounts, draw balances, and firm-wide margin — directly breaking the PRD's confidentiality constraint (§9 Visibility).

### AUTH-T-002: algorithm-confusion-in-token-verification

- **Type:** threat
- **Applicable:** yes
- **Technology implication:** Session tokens (Plan Phase 1) must be verified with a single pinned algorithm; the `alg` header is never read.
- **Risk:** A forged token grants access to commission records and payroll exports, undermining the auditable source-of-truth guarantee.

### AUTH-T-003: compromised-admin-account

- **Type:** threat
- **Applicable:** yes
- **Technology implication:** The Finance Admin role can approve payout runs and export to payroll; this privileged surface needs passkey auth plus M-of-N gating on the most catastrophic operations (key rotation, bulk export).
- **Risk:** A single compromised Finance Admin could approve fraudulent payroll runs or export all producer compensation data.

### AUTH-T-004: rogue-agent-exceeding-scope

- **Type:** threat
- **Applicable:** yes
- **Technology implication:** The Plan's worker (guarantee-expiry, clawback, recalculation jobs) writes only via the API with delegated scoped credentials; scope must be validated per request.
- **Risk:** A worker exceeding scope could post unauthorized ledger adjustments or clawbacks, corrupting the financial record.

### AUTH-T-005: replay-of-intercepted-tokens

- **Type:** threat
- **Applicable:** yes
- **Technology implication:** WebAuthn challenge-response (unique, time-bound challenges) plus token expiry prevent replay.
- **Risk:** Replayed sessions could re-trigger commission approvals or exports.

### AUTH-T-006: credential-stuffing-brute-force

- **Type:** threat
- **Applicable:** partial
- **Technology implication:** Passkeys structurally eliminate credential stuffing (no passwords), but auth endpoints (registration, assertion, refresh) still need rate limiting and progressive lockout (AUTH-C-014, AUTH-C-024).
- **Risk:** Unthrottled assertion endpoints permit enumeration/DoS against login availability.

### AUTH-T-007: single-insider-privileged-operation

- **Type:** threat
- **Applicable:** partial
- **Technology implication:** Bulk payout export and signing-key rotation are the privileged operations here; they warrant M-of-N approval. Note the PRD already mandates that no commission amount reaches payroll without explicit Finance Admin approval (§9), which is a single-actor business gate distinct from cryptographic M-of-N.
- **Risk:** A single insider could export all compensation data or rotate signing keys unilaterally.

### AUTH-T-008: external-auth-provider-outage

- **Type:** threat
- **Applicable:** partial
- **Technology implication:** Auth is self-hosted passkey-based (Plan Phase 1), so there is no external login dependency to fail. Becomes fully applicable only if enterprise SSO federation is later added.
- **Risk:** If a SaaS IdP were ever made the sole login path, an outage would lock finance out during a commission close cycle.

### AUTH-T-009: session-token-xss-exfiltration

- **Type:** threat
- **Applicable:** yes
- **Technology implication:** Session tokens must be HTTP-only/Secure/SameSite=Strict cookies (already in Plan Phase 1), never in localStorage or JS-readable storage.
- **Risk:** An XSS payload in the producer portal or finance UI could otherwise steal a session and read payout/margin data.

### AUTH-T-010: agent-credential-leaked-in-logs

- **Type:** threat
- **Applicable:** yes
- **Technology implication:** Worker/delegated credentials must be scoped and short-lived (≤24h) so a leak into the structured JSON logs (Plan Phase 1) is bounded by scope and TTL.
- **Risk:** A long-lived worker credential in logs would grant standing write access to the ledger.

### AUTH-P-001: passkey-first-password-never

- **Type:** principle
- **Applicable:** yes
- **Technology implication:** WebAuthn (FIDO2) is the sole primary credential; passwords are never offered. Directly stated in Plan Phase 1 ("no passwords").
- **Risk:** Offering any password path would bound the whole system's security by the weakest credential, defeating the auditable-trust premise.

### AUTH-P-002: tokens-opaque-to-browsers

- **Type:** principle
- **Applicable:** yes
- **Technology implication:** HTTP-only, Secure, SameSite=Strict session cookies; application JavaScript never handles the token. Explicit in Plan Phase 1.
- **Risk:** Browser-accessible tokens make XSS equal to full session compromise across producer/finance/executive views.

### AUTH-P-003: agent-credentials-scoped-and-short-lived

- **Type:** principle
- **Applicable:** yes
- **Technology implication:** The Plan's worker uses delegated scoped credentials; per-task delegated tokens expire within 24h. Worker daemon service identity is a distinct, separately-lifecycled credential class.
- **Risk:** Broad long-lived worker tokens would give automation standing authority to mutate the financial ledger.

### AUTH-P-004: credential-domains-stay-separate

- **Type:** principle
- **Applicable:** partial
- **Technology implication:** Maintain distinct classes: end-user sessions (six application roles), worker service credentials (the daemon), and delegated authority tokens (per-task worker writes). Twin credentials are not used. These must not collapse into one another.
- **Risk:** Collapsing worker service identity into user sessions would defeat dual attribution and blur audit accountability.

### AUTH-P-005: auth-policy-enforced-through-deterministic-gates

- **Type:** principle
- **Applicable:** yes
- **Technology implication:** Accepted credential classes, signing algorithm, revocation behavior, and approval requirements are machine-checkable — fits the Plan's per-suite GitHub Actions gates and branch protection.
- **Risk:** Prose-only policy drifts; a regression in cookie flags or algorithm pinning would ship undetected.

### AUTH-P-006: authority-and-execution-are-separate-facts

- **Type:** principle
- **Applicable:** yes
- **Technology implication:** The ledger must record both the authorizing principal and the executing actor for consequential actions (commission approvals, clawback postings, exception approvals). The PRD's audit constraint (timestamp, actor, reason) and worker-via-API model make this load-bearing.
- **Risk:** Attributing a worker-posted clawback solely to the user (or vice versa) breaks the PRD's forensic-accountability and dispute-resolution promises.

### AUTH-P-007: no-single-actor-authorizes-privileged-operations

- **Type:** principle
- **Applicable:** partial
- **Technology implication:** Signing-key rotation and bulk data export should require M-of-N operator approval via secret sharing. The per-run payroll approval (§9) is a business single-actor gate, not the cryptographic M-of-N this rule governs.
- **Risk:** A single compromised operator could rotate keys or bulk-export all compensation data.

### AUTH-P-008: authentication-is-self-hosted

- **Type:** principle
- **Applicable:** yes
- **Technology implication:** Credential verification, token issuance, and session creation run on team-owned infrastructure (k3s/distroless, Plan Phase 1). External IdPs may only ever be a federated path, never the sole one.
- **Risk:** Outsourcing the login path would make a vendor outage lock finance out mid-close.

### AUTH-P-009: algorithm-pinned-not-negotiated

- **Type:** principle
- **Applicable:** yes
- **Technology implication:** Exactly one signing algorithm configured at deployment (deployment config, not runtime API); never read from the token header. Applies to session tokens and to any consequential ledger/transaction signatures.
- **Risk:** Algorithm negotiation enables token forgery against the financial system.

### AUTH-D-001: passkey-authentication

- **Type:** design_pattern
- **Applicable:** yes
- **Technology implication:** WebAuthn registration + assertion: device generates the keypair, server stores only the public key and credential ID, verifies signed random challenges. Smart-crm is the reference implementation per the Plan.
- **Risk:** Any shared-secret fallback reintroduces phishing/stuffing/replay against finance accounts.

### AUTH-D-002: pinned-algorithm-token-verification

- **Type:** design_pattern
- **Applicable:** yes
- **Technology implication:** Verifier ignores the token `alg` field and uses one configured algorithm; mismatched tokens rejected without inspection. Signing key type and verification algorithm are a matched, deployment-fixed pair.
- **Risk:** Algorithm confusion (e.g. HS256/RS256 substitution) yields forged sessions.

### AUTH-D-003: scoped-agent-tokens

- **Type:** design_pattern
- **Applicable:** yes
- **Technology implication:** A dedicated issuance path mints worker tokens with explicit scope claims (e.g. `commission:recalculate`, `ledger:write`), max 24h TTL, validated by middleware on every request. Worker registration is a human-operator action; no self-registration or scope escalation.
- **Risk:** Without scoping, a compromised recalculation worker has the same blast radius as an admin.

### AUTH-D-004: delegated-transaction-authority-dual-attribution

- **Type:** design_pattern
- **Applicable:** yes
- **Technology implication:** Consequential ledger entries (clawback postings, recalculations, approvals carried out by the worker) record a delegated credential binding the authorizing principal plus the separately-recorded executing worker identity; validation checks both. Directly supports the PRD audit trail and the worker-writes-via-API model.
- **Risk:** Single-identity attribution makes disputes and clawback events unprovable, the exact failure the product exists to eliminate.

### AUTH-D-005: sandbox-credentials-for-digital-twins

- **Type:** design_pattern
- **Applicable:** no
- **Technology implication:** No digital-twin or simulation surface exists; the PRD explicitly puts plan simulation out of scope (§8). No sandbox credential class is required.

### AUTH-D-006: m-of-n-privileged-operations

- **Type:** design_pattern
- **Applicable:** partial
- **Technology implication:** Use Shamir secret sharing for signing-key rotation (and optionally bulk compensation export). Recommended 3-of-5, minimum 2-of-3; shard assembly logged, OOB-notified, time-bounded, single-use. Pairs with the HSM/KMS key store.
- **Risk:** Single-operator key rotation or bulk export is one compromised account away from total breach of all payout data.

### AUTH-D-007: key-recovery-without-passwords

- **Type:** design_pattern
- **Applicable:** partial
- **Technology implication:** Passkey-only login (Plan Phase 1) implies a recovery path: enrollment-time recovery passphrase encrypting a server-held shard, recovery requires passphrase + second factor and re-enrolls a new passkey, with device notifications. No email magic-link reset. Not yet itemized in the Plan but follows necessarily from passkey-only.
- **Risk:** Without it, a finance user losing all devices is permanently locked out of the commission system; an email-reset shortcut would reintroduce phishing.

### AUTH-D-008: http-only-session-cookies

- **Type:** design_pattern
- **Applicable:** yes
- **Technology implication:** Session token issued only as an HTTP-only, Secure, SameSite=Strict cookie; never in response bodies, URLs, or JS. For the web app (apps/web) and server (apps/server) keep them same-origin or use a same-origin relay. Explicit in Plan Phase 1.
- **Risk:** Tokens in JS-accessible storage are exfiltrable via XSS across all role portals.

### AUTH-D-009: token-revocation-store

- **Type:** design_pattern
- **Applicable:** yes
- **Technology implication:** Every token carries a `jti`; a shared, durable revocation store (PostgreSQL — the project already runs three PG16 DBs) is checked on every request; revoked jti → 401; entries expire at the token's `exp`; middleware fails closed if the store is unreachable. JTI revocation is named in Plan Phase 1.
- **Risk:** No revocation means a logged-out or compromised finance session stays valid until natural expiry.

### AUTH-A-001: single-application-passkey-auth

- **Type:** architecture
- **Applicable:** partial
- **Technology implication:** A viable baseline: passkey store as typed entities in PostgreSQL, token issuer using an HSM/KMS-backed signing key, auth middleware on every protected route within apps/server. Simplest to deploy; superseded by A-003 because this platform has first-class automation (workers/agents).
- **Risk:** Choosing this alone leaves no clean separation for the agent/worker credential path.

### AUTH-A-002: federated-identity-self-hosted-fallback

- **Type:** architecture
- **Applicable:** no
- **Technology implication:** No enterprise SSO requirement appears in the PRD or Plan (the External Partner role gets scoped in-platform access, not SSO). Defer unless an enterprise tenant later demands SAML/OIDC; if added, the self-hosted passkey path must remain the fallback.

### AUTH-A-003: agent-aware-auth-gateway

- **Type:** architecture
- **Applicable:** yes
- **Technology implication:** Recommended target architecture: an auth gateway routing human users through the passkey flow and the worker/automation through a registry + scope validator, both emitting the same token format validated uniformly by middleware. A registry restricts worker registration to human operators; mutations are audit-logged and revoke affected tokens. Matches the Plan's "network-isolated worker that writes only via the API with delegated scoped credentials."
- **Risk:** Without a clean agent path, worker writes either over-privilege the automation or get bolted onto human sessions, collapsing credential domains (AUTH-P-004).

### AUTH-C-001: passkey-registration-flow

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Users enroll a platform authenticator or hardware key — Plan Phase 1 "WebAuthn passkey registration."
- **Risk:** No enrollment path means no usable passkey-only system.

### AUTH-C-002: passkey-assertion-flow

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Login via enrolled passkey — Plan Phase 1 "assertion."
- **Risk:** Users cannot authenticate.

### AUTH-C-003: token-signing-algorithm-pinned

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Algorithm pinned in deployment config; unexpected-algorithm tokens rejected.
- **Risk:** Unpinned verification permits forgery (AUTH-T-002).

### AUTH-C-004: session-tokens-httponly-cookies

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** HTTP-only/Secure/SameSite=Strict cookies — Plan Phase 1.
- **Risk:** XSS session theft.

### AUTH-C-005: token-expiry-enforced

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Expiry checked on every request; expired → 401.
- **Risk:** Stale tokens remain usable against the ledger.

### AUTH-C-006: token-revocation-checked

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** `jti` + revocation list checked every request — Plan Phase 1 JTI revocation.
- **Risk:** Logout/compromise cannot invalidate live sessions.

### AUTH-C-007: auth-middleware-all-protected-routes

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Middleware on every protected route; no unprotected route serves user data. The PRD's strict per-role visibility/confidentiality (§9) depends on this.
- **Risk:** An unguarded route leaks payout/margin data across tenants or roles.

### AUTH-C-008: agent-scoped-tokens-implemented

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Worker tokens carry explicit scope claims.
- **Risk:** Unscoped worker tokens = admin-equivalent blast radius.

### AUTH-C-009: agent-scope-validated-every-request

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Scope validated by middleware on every request, not just issuance.
- **Risk:** Issuance-only checks allow scope drift across a token's life.

### AUTH-C-010: agent-token-ttl-24h-max

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Delegated worker token TTL ≤ 24h.
- **Risk:** Long-lived tokens widen leak blast radius (AUTH-T-010).

### AUTH-C-011: dual-attribution-supported

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Ledger schema records principal authority and executing actor separately for consequential commission actions. Pairs with PRD §9 audit (timestamp, actor, reason).
- **Risk:** Disputes/clawbacks become unattributable.

### AUTH-C-012: transaction-signature-algorithm-pinned

- **Type:** checklist
- **Applicable:** partial
- **Technology implication:** If consequential ledger entries (e.g. payroll export approvals) are cryptographically signed, pin the algorithm per domain/deployment and reject request-level negotiation. Applies only if such signatures are implemented.
- **Risk:** Negotiable transaction signatures permit approval forgery.

### AUTH-C-013: sandbox-credentials-implemented

- **Type:** checklist
- **Applicable:** no
- **Technology implication:** No digital twin surface (PRD §8 plan simulation out of scope); not required.

### AUTH-C-014: rate-limiting-auth-endpoints

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Rate limit registration, assertion, and token refresh endpoints.
- **Risk:** Unthrottled endpoints allow enumeration/DoS (AUTH-T-006).

### AUTH-C-015: auth-events-audit-log

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Login/logout/failed-attempt/registration events to the audit log — the project's dedicated `commission_audit` DB (Plan Phase 1) is the natural home.
- **Risk:** No auth audit trail undercuts the PRD's auditability promise.

### AUTH-C-016: key-recovery-flow-tested

- **Type:** checklist
- **Applicable:** partial
- **Technology implication:** Passphrase + second factor re-enrolls a new passkey; needed because login is passkey-only. Not yet itemized in the Plan.
- **Risk:** Device-loss lockout for finance/HR users.

### AUTH-C-017: recovery-events-notify-devices

- **Type:** checklist
- **Applicable:** partial
- **Technology implication:** Recovery triggers OOB notification to enrolled devices (depends on recovery flow being built).
- **Risk:** Silent account takeover via recovery.

### AUTH-C-018: token-refresh-rotation

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Each refresh issues a new token and invalidates the old one (pairs with the JTI revocation store).
- **Risk:** Non-rotating refresh tokens widen replay windows.

### AUTH-C-019: m-of-n-approval-tested

- **Type:** checklist
- **Applicable:** partial
- **Technology implication:** Document and test M-of-N for at least signing-key rotation. Tied to AUTH-D-006; not yet itemized in the Plan.
- **Risk:** Untested approval flow fails when first needed in an incident.

### AUTH-C-020: shard-assembly-logged-time-bounded

- **Type:** checklist
- **Applicable:** partial
- **Technology implication:** Shard assembly logged, time-bounded, single-use (only if M-of-N is implemented).
- **Risk:** An assembled key reused beyond one operation becomes a standing master key.

### AUTH-C-021: pentest-security-review-completed

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Structured security review/pentest of the auth surface before handling real compensation data.
- **Risk:** Unreviewed auth on a financial system invites breach.

### AUTH-C-022: agent-re-registration-tested

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Test revoking and re-issuing worker credentials with new scopes (worker registry per AUTH-A-003).
- **Risk:** No clean re-scope path forces over-broad worker tokens.

### AUTH-C-023: auth-config-deployment-managed

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Algorithm, TTLs, and scope definitions in deployment config (k8s manifests / env), not a runtime API. Fits the Plan's k8s-manifests-per-environment approach.
- **Risk:** Runtime-mutable auth config is an attack surface and a drift source.

### AUTH-C-024: progressive-delays-lockout

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Progressive delay/temporary lockout on failed auth attempts.
- **Risk:** Enables online brute-force/DoS against assertion.

### AUTH-C-025: automated-credential-rotation

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Automated signing-key rotation; no manual rotation. Builds on GCP Cloud KMS (already chosen for field encryption in Plan Phase 1).
- **Risk:** Manual rotation gets skipped; stale keys accumulate.

### AUTH-C-026: session-revocation-immediate

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Revoking a session immediately blocks further access (no grace period) — implies the durable JTI store, not a TTL cache, for security-critical revocations.
- **Risk:** A grace window lets a compromised finance session keep approving runs.

### AUTH-C-027: agent-re-auth-daily

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Worker re-authentication enforced daily; verified in monitoring (ties to the ≤24h TTL).
- **Risk:** Standing worker auth defeats the short-lived-credential containment.

### AUTH-C-028: immutable-auth-audit-log

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Append-only auth audit log; entries cannot be modified/deleted. Reinforced by the separate `commission_audit` DB with a write-only `audit_w` role (Plan Phase 1) and the PRD's never-silently-overwritten constraint (§9).
- **Risk:** Mutable logs destroy forensic and compliance value.

### AUTH-C-029: audit-log-cold-storage

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Scheduled export of the audit log to append-only cold storage (e.g. GCS object-lock bucket given the GCP target).
- **Risk:** Loss of long-term audit history for compliance/disputes.

### AUTH-C-030: incident-response-runbook-tested

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Tested runbooks for signing-key, worker-credential, admin-account compromise, and mass session invalidation.
- **Risk:** An untested response delays containment on a financial breach.

### AUTH-C-031: federated-identity-tested

- **Type:** checklist
- **Applicable:** no
- **Technology implication:** No federated/enterprise-SSO requirement in PRD or Plan; not applicable unless AUTH-A-002 is later adopted.

### AUTH-C-032: generic-auth-error-messages

- **Type:** checklist
- **Applicable:** yes
- **Technology implication:** Generic auth errors; no leakage of account existence or credential validity.
- **Risk:** Account enumeration aids targeted attacks on finance/executive users.

### AUTH-X-001: password-default-passkey-optional

- **Type:** antipattern
- **Applicable:** yes
- **Technology implication:** Forbids offering passwords alongside passkeys — Plan Phase 1 "no passwords" already complies.
- **Risk:** Any password path bounds the system's security by the weakest credential.

### AUTH-X-002: algorithm-negotiation-in-verification

- **Type:** antipattern
- **Applicable:** yes
- **Technology implication:** Forbids reading `alg` from the token to select the verification algorithm.
- **Risk:** Root cause of algorithm-confusion forgery (AUTH-T-002).

### AUTH-X-003: long-lived-broad-agent-tokens

- **Type:** antipattern
- **Applicable:** yes
- **Technology implication:** Forbids multi-resource, multi-week worker tokens; enforce per-scope ≤24h tokens.
- **Risk:** A leaked broad token equals a leaked admin credential against the ledger.

### AUTH-X-004: auth-saas-sole-login-path

- **Type:** antipattern
- **Applicable:** yes
- **Technology implication:** Forbids an external provider as the only login path — the self-hosted passkey flow must always exist.
- **Risk:** Vendor outage locks finance out during a commission close.

### AUTH-X-005: tokens-in-localstorage

- **Type:** antipattern
- **Applicable:** yes
- **Technology implication:** Forbids localStorage/sessionStorage tokens; use HTTP-only cookies only (Plan Phase 1 compliant).
- **Risk:** XSS-exfiltrable sessions.

### AUTH-X-006: single-person-privileged-approval

- **Type:** antipattern
- **Applicable:** partial
- **Technology implication:** Forbids a single admin rotating root keys, exporting data, or changing auth config unilaterally — motivates M-of-N (AUTH-D-006) for key rotation and bulk export.
- **Risk:** One compromised admin account away from total breach of compensation data.

### AUTH-X-007: shared-credentials-between-agents

- **Type:** antipattern
- **Applicable:** yes
- **Technology implication:** Each worker/automation gets its own credential, scope, and lifecycle — no shared token/API key.
- **Risk:** Revoking or compromising one worker affects all; defeats containment.

### AUTH-X-008: email-based-password-reset-fallback

- **Type:** antipattern
- **Applicable:** yes
- **Technology implication:** Forbids email magic-link recovery; recovery must require proof of possession + second factor (shapes the AUTH-D-007 recovery design).
- **Risk:** Security bounded by email inbox security.

### AUTH-X-009: in-memory-revocation-multi-process

- **Type:** antipattern
- **Applicable:** yes
- **Technology implication:** Forbids an in-memory revoked-jti set; the revocation store must be shared/durable/consistent (PostgreSQL) — critical because the Plan deploys multi-instance on k3s/k3d.
- **Risk:** In multi-instance deployment a token revoked on one instance stays valid on others.

## Recommended Technology Choices

- WebAuthn / FIDO2 passkeys as the sole primary credential mechanism, no passwords; smart-crm as reference implementation (AUTH-P-001, AUTH-D-001, AUTH-X-001).
- HTTP-only, Secure, SameSite=Strict session cookies issued same-origin between apps/web and apps/server; never localStorage (AUTH-P-002, AUTH-D-008, AUTH-X-005).
- Single signing algorithm pinned in deployment config (k8s manifests/env), verifier ignores the token `alg` header (AUTH-P-009, AUTH-D-002, AUTH-C-003, AUTH-C-023, AUTH-X-002).
- JTI-keyed revocation store in PostgreSQL (shared/durable across k3s instances), checked every request, fail-closed, entries expiring at token `exp`; refresh rotation invalidates old tokens (AUTH-D-009, AUTH-C-006, AUTH-C-018, AUTH-C-026, AUTH-X-009).
- Agent-aware auth gateway architecture: passkey path for the six human roles plus a worker registry + scope validator emitting a uniform token format, with auth middleware on every protected route (AUTH-A-003, AUTH-C-007).
- Scoped, ≤24h delegated worker credentials minted per task; human-operator-only worker registration; per-request scope validation; daily re-auth; no shared credentials (AUTH-P-003, AUTH-D-003, AUTH-C-008/009/010/022/027, AUTH-X-003, AUTH-X-007).
- Dual-attribution ledger schema recording authorizing principal and executing actor separately for consequential commission/clawback/approval actions (AUTH-P-006, AUTH-D-004, AUTH-C-011).
- HSM/KMS-backed signing key store using GCP Cloud KMS (already selected for field encryption) with automated key rotation (AUTH-A-001 key store, AUTH-C-025).
- M-of-N (Shamir, 3-of-5 target / 2-of-3 minimum) approval for signing-key rotation and bulk compensation export, with logged, time-bounded, single-use shard assembly (AUTH-P-007, AUTH-D-006, AUTH-C-019/020, AUTH-X-006).
- Passkey key-recovery flow: enrollment recovery passphrase + second factor re-enrolling a new passkey, device notifications, no email reset (AUTH-D-007, AUTH-C-016/017, AUTH-X-008).
- Self-hosted login path on team-owned k3s/distroless infrastructure; any future enterprise SSO is federated-only with passkey fallback (AUTH-P-008, AUTH-X-004; AUTH-A-002 deferred).
- Rate limiting and progressive lockout on registration/assertion/refresh; generic auth error messages (AUTH-C-014, AUTH-C-024, AUTH-C-032).
- Immutable, append-only auth audit logging in the dedicated `commission_audit` DB (write-only `audit_w` role), exported to append-only cold storage (e.g. GCS object lock) on a schedule (AUTH-C-015/028/029).
- Pre-launch structured security review/pentest of the auth surface plus tested incident-response runbooks (AUTH-C-021, AUTH-C-030).
