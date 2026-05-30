# Blueprint: IMPL-AUTH (Auth — TypeScript Implementation) — Architecture Research

**Source:** blueprint/rules/implementations/ts/auth-ts.yaml
**PRD:** docs/prd.md (present)
**Plan documents:** docs/plan.md
**Technical documents:** none found

## Summary

This blueprint governs the entire authentication and token-issuance surface for the platform. It is highly load-bearing because the PRD imposes strict role-scoped confidentiality (six application roles plus external partners who must see only their own deal participation) and a hard audit/approval mandate (§9: no commission amount reaches payroll without an authorized Finance Admin action, all changes permanently recorded). Plan Phase 1 explicitly commits to WebAuthn passkeys, HTTP-only Secure SameSite=Strict session cookies with JTI revocation, and six middleware-enforced roles — a near-verbatim adoption of this blueprint. The most consequential rules are the self-hosted passkey + DIY-JWT stack (IMPL-AUTH-002/005/026/028/031), the durable JTI revocation store with cache discipline (IMPL-AUTH-009/010/011/012/034), middleware-enforced authorization with deny-by-default scoping (IMPL-AUTH-017/019/020), and asymmetric ES256 algorithm pinning (IMPL-AUTH-005/006/033). Agent-token rules (IMPL-AUTH-013/014/015/016) map directly onto the Plan's network-isolated worker that writes only via the API with delegated scoped credentials. The recovery-shard rules (IMPL-AUTH-004/024/027) are applicable but not yet surfaced in the Plan and represent a gap to confirm.

## Rule Analysis

### IMPL-AUTH-001: auth-data-in-graph-model

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** All auth entities (user, passkey_credential, agent, recovery_shard) live in the primary application database (commission_app, per the Plan's three-DB model) as first-class entity types with their own schemas and sensitivity settings. Auth data does not go into commission_analytics or commission_audit.
- **Risk:** Scattering auth state outside commission_app fragments tenancy enforcement (org_id) and the audit trail mandated by §9, undermining the single governed source of truth.

### IMPL-AUTH-002: passkey-webauthn-fido2

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** WebAuthn (FIDO2) passkey-first authentication; server stores only public key + credential ID, no password hash. Plan Phase 1 already mandates "WebAuthn passkey registration and assertion (no passwords)."
- **Risk:** Introducing passwords reintroduces phishing/credential-stuffing exposure against a system holding firm-wide financial and compensation data, contradicting the explicit no-password commitment.

### IMPL-AUTH-003: challenge-response-flow

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** Server-generated random challenge, client signs with passkey, server verifies signature against stored public key. Implemented via the chosen WebAuthn library (see IMPL-AUTH-025).
- **Risk:** A static or replayable challenge enables replay attacks against accounts that approve payroll, breaking the §9 approval-integrity guarantee.

### IMPL-AUTH-004: bip39-recovery-shard

- **Type:** implementation
- **Applicable:** partial
- **Technology implication:** Key recovery uses a BIP-39 mnemonic encrypting a server-side recovery shard, gated by a second factor (backup-code via Argon2id, or hardware-key via credential ID lookup). Passkey-only auth makes account recovery essential, but the Plan does not yet list a recovery flow — a gap to confirm before Phase 1 closes.
- **Risk:** Without recovery, a lost passkey permanently locks out a Finance Admin or Executive, blocking commission close cycles (a core PRD goal) with no remediation path.

### IMPL-AUTH-005: es256-web-crypto-signing

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** Token signing uses ES256 (ECDSA P-256) via the Web Crypto API (crypto.subtle.sign/verify), DIY (~50 lines), no JWT library. Bun's runtime exposes Web Crypto natively, so no extra dependency is needed.
- **Risk:** Pulling in a heavyweight JWT library reintroduces the algorithm-confusion vulnerability class this blueprint exists to prevent.

### IMPL-AUTH-006: algorithm-pinning-es256

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** Verify the JWT header alg equals ES256 before any validation; reject every other value (including "none" and HS256) outright.
- **Risk:** Algorithm negotiation allows forged tokens (alg=none or HS256 with the public key as secret), letting an attacker impersonate a Finance Admin and approve fraudulent payouts.

### IMPL-AUTH-007: token-httponly-cookie

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** Tokens stored only in HTTP-only, Secure, SameSite=Strict cookies; never in response bodies, URLs, or client-accessible storage. Plan Phase 1 commits to this verbatim.
- **Risk:** Token exposure to JavaScript or via URLs enables session theft, granting access to confidential compensation and margin data the PRD restricts per role.

### IMPL-AUTH-008: token-expiry-1h-rotation

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** Default user token expiry of 1 hour; refresh uses rotation — a new token is issued on each refresh and the old token is invalidated immediately.
- **Risk:** Long-lived or non-rotating tokens widen the window for a stolen session to access payout and dispute data.

### IMPL-AUTH-009: jti-revocation-table

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** Every token carries a jti claim; a revocation table in commission_app is queried on every authenticated request. Plan Phase 1 lists "JTI revocation" explicitly.
- **Risk:** Without server-side revocation, logout and compromise response cannot invalidate active sessions, leaving privileged finance sessions usable after termination.

### IMPL-AUTH-010: revocation-cache-ttl-60s

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** In-memory caching of revoked jti values is permitted with a maximum 60-second TTL for standard revocations (e.g., logout). This is an optimization layer over the DB table, not a replacement.
- **Risk:** A longer TTL leaves logged-out sessions valid past the acceptable window; treating the cache as authoritative violates IMPL-AUTH-034.

### IMPL-AUTH-011: security-revocation-cache-bypass

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** Security-critical revocations (account compromise, passkey change) bypass the in-memory cache; middleware performs a direct DB read on the next request after such a revocation.
- **Risk:** Cache lag on a compromise event keeps an attacker's session alive against a system that approves payroll, a direct §9 integrity threat.

### IMPL-AUTH-012: revocation-entry-expiry-cleanup

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** Revocation entries expire from the table after the token's own exp timestamp; a scheduled job cleans up expired entries. This maps onto the Plan's Phase 1 PostgreSQL task queue / worker execution model.
- **Risk:** Unbounded growth of the revocation table degrades the per-request revocation lookup that sits on every authenticated path, hurting platform latency.

### IMPL-AUTH-013: agent-scoped-tokens

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** Agents (the Plan's network-isolated worker) receive scoped tokens carrying an explicit scopes claim (e.g., placement:read, commission:write) so they write only via the API with delegated scoped credentials.
- **Risk:** An unscoped worker token becomes a firm-wide write credential; a compromised guarantee/clawback job could alter any commission ledger entry, breaking the immutable-audit guarantee.

### IMPL-AUTH-014: agent-max-ttl-24h

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** Agent token maximum TTL is 24 hours; the worker re-authenticates daily. Aligns with the long-running guarantee-expiry/clawback/recalculation jobs in Phase 1's worker model.
- **Risk:** Indefinitely-lived worker credentials become a high-value persistent target with broad ledger-write reach.

### IMPL-AUTH-015: agent-dedicated-endpoint

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** Agent tokens are issued by a dedicated endpoint, separate from the user passkey login flow, located under packages/auth / apps/server/routes/auth.ts.
- **Risk:** Mixing agent issuance into the user login path blurs the human/agent boundary and complicates scope auditing.

### IMPL-AUTH-016: agent-kms-scoped-keys

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** Agents receive KMS-scoped keys that decrypt only data within their authorized scope. Integrates with Phase 1's per-entity-type GCP Cloud KMS keys and FieldEncryptor.
- **Risk:** A worker with broad KMS access could decrypt encrypted financial BYTEA fields outside its job scope, defeating field-level encryption and the §9.x confidentiality constraints.

### IMPL-AUTH-017: auth-middleware-single-function

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** A single auth middleware function extracts the cookie, verifies the JWT (pinned alg + expiry + jti revocation), and attaches the user or agent to the request context; applied to all protected routes. Plan Phase 1 enforces six roles "in middleware."
- **Risk:** Per-route ad hoc auth checks drift and leave gaps, allowing unauthorized access to role-restricted payout/margin endpoints.

### IMPL-AUTH-018: rate-limiting-auth-endpoints

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** Login and register endpoints are rate-limited (default 10 req/min per IP; production values reviewed deliberately). Note IP-based limiting degrades behind shared NAT.
- **Risk:** Unthrottled auth endpoints enable enumeration/abuse against accounts controlling firm financials.

### IMPL-AUTH-035: per-username-rate-limiting

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** Apply per-username rate limiting in addition to per-IP to cover shared-NAT blind spots — relevant since many firm employees may share an office egress IP.
- **Risk:** IP-only limiting lets attackers behind a busy NAT, or a single-IP corporate network, evade throttling.

### IMPL-AUTH-036: progressive-delay-backoff

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** Use progressive (exponential) backoff rather than a hard cutoff on auth endpoints, balancing abuse mitigation with legitimate-user lockout avoidance.
- **Risk:** A hard cutoff locks out legitimate finance/producer users at cycle close (a peak-usage moment), harming the close-cycle-time goal.

### IMPL-AUTH-019: scope-enforcement-middleware

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** Enforce scopes via a requireScope middleware declared at route registration; handlers contain no scope logic. This is the mechanism for the PRD's role-scoped visibility (External Partner sees only own deals; producers cannot see others' payouts; manager/exec scoped to hierarchy).
- **Risk:** Scope checks inside handlers are easy to forget or bypass, directly risking the cross-producer confidentiality the PRD treats as non-negotiable.

### IMPL-AUTH-020: missing-scope-is-misconfiguration

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** A route without requireScope is a misconfiguration (deny-by-default), not an open route; intentionally public routes use an explicit public() decorator.
- **Risk:** Fail-open routing exposes confidential commission/margin data when a developer forgets to attach a scope — exactly the leakage the PRD's confidentiality constraints forbid.

### IMPL-AUTH-021: package-structure-auth

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** Split auth into packages/auth (passkey, jwt, agent-auth, middleware), apps/server/routes/auth.ts (endpoints), and packages/core types (auth.ts, user.ts). Maps onto the Plan's Bun workspace layout (apps/server, packages/core, etc.); server auth primitives must never resolve in browser (apps/web) bundles.
- **Risk:** Auth primitives leaking into the web bundle expose verification logic/keys client-side (see IMPL-AUTH-032).

### IMPL-AUTH-022: passkey-credential-interface

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** PasskeyCredential interface: credentialId (string), publicKey (Uint8Array), userId (string), createdAt (number); stored server-side, no private key material. Lives in packages/core types.
- **Risk:** Storing any private key material server-side defeats the WebAuthn trust model.

### IMPL-AUTH-023: token-payload-interface

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** TokenPayload interface: sub, jti, scopes (string[]), exp, iat, kind ('user' | 'agent') — one unified format for both user and worker tokens, supporting the scope and revocation rules above.
- **Risk:** Divergent token shapes for users vs agents complicate the single middleware and create verification gaps.

### IMPL-AUTH-024: recovery-shard-interface

- **Type:** implementation
- **Applicable:** partial
- **Technology implication:** RecoveryShard interface: userId, encryptedShard (AES-256-GCM via HKDF from BIP-39 mnemonic), secondFactorKind ('backup-code' | 'hardware-key'), secondFactorVerifier (Argon2id hash or SHA-256 of credential ID). Applicable in principle but not yet in the Plan (same gap as IMPL-AUTH-004).
- **Risk:** Absent a defined recovery shard, lost-passkey lockout has no governed remediation for privileged finance roles.

### IMPL-AUTH-025: dep-simplewebauthn-server

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** Buy (depend on) @simplewebauthn/server for FIDO2 protocol handling — security-critical, full FIDO2 conformance, no native dependencies (compatible with Bun + distroless containers), actively maintained.
- **Risk:** A hand-rolled WebAuthn implementation risks subtle conformance/verification bugs in the security-critical login path.

### IMPL-AUTH-026: dep-jwt-diy-web-crypto

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** DIY JWT sign/verify (~50 lines) using Web Crypto crypto.subtle.sign with ECDSA; no JWT library dependency. Reinforces IMPL-AUTH-005/006.
- **Risk:** A general JWT library reopens algorithm-confusion attack surface and adds a dependency on the critical verification path.

### IMPL-AUTH-027: dep-scure-bip39

- **Type:** implementation
- **Applicable:** partial
- **Technology implication:** Buy (depend on) @scure/bip39 for BIP-39 mnemonic generation (standardized 2048-word list, audited, well-specified entropy). Applicable only when the recovery flow (IMPL-AUTH-004) is scheduled.
- **Risk:** A custom mnemonic generator risks weak entropy in the account-recovery path.

### IMPL-AUTH-028: dep-no-auth-saas

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** Do not adopt Auth SaaS (Auth0, Clerk) unless mandated; authentication is self-hosted. Consistent with the Plan's self-hosted GCP/k3s/distroless posture.
- **Risk:** A third-party auth dependency on the login path adds latency, per-user cost, and vendor lock-in, and externalizes control over a system bound by strict audit and confidentiality constraints.

### IMPL-AUTH-029: dep-rate-limit-diy

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** DIY rate limiting via a simple token bucket (~30 lines); no library dependency. Supports IMPL-AUTH-018/035/036.
- **Risk:** Minimal — adding an external rate-limit dependency is unnecessary weight, not a security hole, but custom code must still implement per-username + backoff correctly.

### IMPL-AUTH-030: anti-tokens-in-localstorage

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** Never store tokens in localStorage (or any JS-readable storage); rely solely on HTTP-only cookies (IMPL-AUTH-007). The apps/web client must not persist tokens.
- **Risk:** localStorage tokens are readable by any XSS payload, exposing sessions that can read confidential payout/margin data.

### IMPL-AUTH-031: anti-auth-saas-default

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** Do not default to Auth SaaS; the passkey + JWT flow is ~300 lines with Web Crypto. Reinforces IMPL-AUTH-028.
- **Risk:** Defaulting to SaaS moves debugging to a third-party dashboard and adds an external failure point on the login path of a finance-critical system.

### IMPL-AUTH-032: anti-auth-imports-in-browser

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** Never import server-side auth modules in apps/web; even type-only imports create paths that can lead to client-side runtime auth calls. Enforces the packages/auth vs apps/web boundary (IMPL-AUTH-021).
- **Risk:** Leaking verification/signing logic into the browser bundle exposes the credential-handling surface to the client.

### IMPL-AUTH-033: anti-symmetric-signing-hs256

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** Never use symmetric signing (HS256) for production tokens; ES256 asymmetric signing keeps the private key with the issuer only. Reinforces IMPL-AUTH-005/006.
- **Risk:** HMAC shared secrets distributed to every verifier multiply the compromise surface; a leaked secret lets any holder forge Finance Admin tokens.

### IMPL-AUTH-034: anti-in-memory-only-revocation

- **Type:** implementation
- **Applicable:** yes
- **Technology implication:** Never use in-memory-only revocation. The revocation table in commission_app is the source of truth; the in-memory cache (IMPL-AUTH-010) is a read optimization only. Matters because the Plan runs multiple processes (apps/server, apps/worker) and distroless containers on k3s that restart.
- **Risk:** An in-memory Set is lost on restart and unshared across processes/replicas, so a revoked session survives on another node — defeating logout and compromise response.

## Recommended Technology Choices

- **WebAuthn / FIDO2 passkey authentication, no passwords** — server stores public key + credential ID only (IMPL-AUTH-002, IMPL-AUTH-003, IMPL-AUTH-022).
- **@simplewebauthn/server** as the only bought auth dependency for FIDO2 protocol handling (IMPL-AUTH-025).
- **DIY JWT signing with ES256 (ECDSA P-256) via Bun's Web Crypto API**, ~50 lines, no JWT library, with strict algorithm pinning (IMPL-AUTH-005, IMPL-AUTH-006, IMPL-AUTH-026, IMPL-AUTH-033).
- **HTTP-only, Secure, SameSite=Strict session cookies** as the sole token transport; never localStorage (IMPL-AUTH-007, IMPL-AUTH-030).
- **1-hour user token expiry with refresh rotation**; **24-hour max agent/worker token TTL** (IMPL-AUTH-008, IMPL-AUTH-014).
- **Durable JTI revocation table in commission_app**, queried per request, with a ≤60s in-memory read cache, compromise-event cache bypass, and scheduled cleanup via the Phase 1 PostgreSQL task queue (IMPL-AUTH-009, IMPL-AUTH-010, IMPL-AUTH-011, IMPL-AUTH-012, IMPL-AUTH-034).
- **Single auth middleware + requireScope deny-by-default authorization** with an explicit public() decorator, enforcing the PRD's six roles and external-partner scoping (IMPL-AUTH-017, IMPL-AUTH-019, IMPL-AUTH-020, IMPL-AUTH-023).
- **Scoped, short-lived agent tokens with KMS-scoped keys** issued from a dedicated endpoint for the network-isolated worker (IMPL-AUTH-013, IMPL-AUTH-015, IMPL-AUTH-016).
- **DIY token-bucket rate limiting** with per-IP plus per-username limits and progressive backoff on login/register (IMPL-AUTH-018, IMPL-AUTH-029, IMPL-AUTH-035, IMPL-AUTH-036).
- **Self-hosted auth — no Auth0/Clerk/Auth SaaS** on the login path (IMPL-AUTH-028, IMPL-AUTH-031).
- **packages/auth + apps/server/routes/auth.ts + packages/core types** layout, with server auth primitives strictly excluded from the apps/web bundle (IMPL-AUTH-021, IMPL-AUTH-032).
- **BIP-39 recovery shard via @scure/bip39 + AES-256-GCM/HKDF with a second factor (Argon2id backup code or hardware key)** — recommended to schedule, currently a Plan gap (IMPL-AUTH-004, IMPL-AUTH-024, IMPL-AUTH-027).
