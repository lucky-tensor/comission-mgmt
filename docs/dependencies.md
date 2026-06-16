# Dependencies Registry

> Shipped and planned dependencies with Buy/DIY justification, locked versions, and blueprint rule traceability.
> This registry fulfills ARCH-C-005/C-013 and IMPL-ARCH-023: every external dependency is recorded here with its
> rationale. Periodically audited against transitive trees and supply-chain risk.

## Shipped Production Dependencies

### Runtime Dependencies

| Package | Version | Category | Buy/DIY | Justification | Blueprint rules |
|---------|---------|----------|---------|---------------|-----------------|
| **`postgres` (npm)** | `^3.4.9` | Database client | **Buy** | PostgreSQL wire protocol implementation with tagged-template parameterization by default; single client for three pools. No ORM; parameterized queries are the multi-tenant injection defense. | IMPL-DATA-033 |
| **`@simplewebauthn/browser`** | `^13.3.0` | FIDO2 client | **Buy** | Client-side WebAuthn ceremony (credential creation, assertion); shared ceremony types on the client. Server-side verification is DIY via Web Crypto. | IMPL-AUTH-025 |
| **`@simplewebauthn/types`** | `^12.0.0` | FIDO2 types | **Buy** | Shared TypeScript types for WebAuthn ceremonies (client + server); prevents shape drift in credential encoding. | IMPL-AUTH-025 |

### UI Framework & Styling

| Package | Version | Category | Buy/DIY | Justification | Blueprint rules |
|---------|---------|----------|---------|---------------|-----------------|
| **`react`** | `^18.3.1` (root) / `^18.2.0` (web/ui) | UI framework | **Buy** | React hooks + minimal context for state; native `useState` forms; thin data-dense role-scoped surfaces (portal, review queue, dashboards). No Redux/MobX/Zustand. | IMPL-ARCH-003/004/005, IMPL-UX-008/009/011/013 |
| **`react-dom`** | `^18.3.1` (root) / `^18.2.0` (web) | React DOM binding | **Buy** | React rendering target for browser; required for any React app. | IMPL-ARCH-003 |
| **`tailwindcss`** | `4` | Utility-first CSS | **Buy** | Utility-first styling without CSS-in-JS; Tailwind v4 with design-token bridge from Atlas system. No Styled Components, no emotion. | IMPL-ARCH-004, IMPL-UX-008/009 |
| **`@tailwindcss/vite`** | `4` | Tailwind bundler plugin | **Buy** | Vite plugin for Tailwind v4 JIT compilation and design-token pipeline integration. Ships with tokens from the Atlas design system. | IMPL-UX-009 |
| **`@fontsource-variable/geist`** | `5` | Variable font | **Buy** | Geist variable font family for consistent cross-role UI typography; Atlas-coordinated typography system. | IMPL-UX-008 |
| **`@fontsource-variable/geist-mono`** | `5` | Monospace variable font | **Buy** | Geist Mono variable font for code display and data tables; Atlas-coordinated typography system. | IMPL-UX-008 |

### Design System

| Package | Version | Category | Buy/DIY | Justification | Blueprint rules |
|---------|---------|----------|---------|---------------|-----------------|
| **Atlas design system** | local (`packages/ui/design-system/atlas/`) | Token bridge | **Buy** | Figma-driven design-token bridge via `@tailwindcss/vite` to Tailwind config; centralized token source for all six role surfaces (producer portal, finance queue, manager, executive dashboard, HR, partner). No hardcoded colors or spacing. | IMPL-UX-008/009/013 |

## Development & Tooling Dependencies

### Testing

| Package | Version | Category | Buy/DIY | Justification | Blueprint rules |
|---------|---------|----------|---------|---------------|-----------------|
| **`vitest`** | `^2.0.0` | Test runner | **Buy** | Single test driver for unit, integration, and E2E suites; Vite-native; real PostgreSQL via DIY pg-container (no mocks except KMS boundary). | IMPL-TEST-001/002/021, TEST-D-001/D-006 |
| **`playwright`** | `1.60.0` | Browser automation | **Buy** | Headless Chromium provider for component + producer-portal E2E; never JSDOM (real browser semantics required). | IMPL-TEST-001/002/027 |

### Build & Bundling

| Package | Version | Category | Buy/DIY | Justification | Blueprint rules |
|---------|---------|----------|---------|---------------|-----------------|
| **`vite`** | `^5.1.0` | Module bundler | **Buy** | Single bundler for web app; native ES modules; HMR for dev; no Webpack. | IMPL-ARCH-002 |
| **`typescript`** | `^5.0.0` | Language | **Buy** | Strict, no `any` in contracts; single type system across web/server/worker/packages; TypeScript on Bun runtime. | IMPL-ARCH-001/002, IMPL-ENV-004/010 |

### Linting & Formatting

| Package | Version | Category | Buy/DIY | Justification | Blueprint rules |
|---------|---------|----------|---------|---------------|-----------------|
| **`eslint`** + **`@eslint/js`** | `^9.0.0` | Linter | **Buy** | Code quality gate; enforced by branch-protection ruleset; used by orchestrator in governance checks. | PROCESS-D-011, IMPL-PROCESS-001 |
| **`typescript-eslint`** | `^8.0.0` | TypeScript linter | **Buy** | TypeScript-aware ESLint rules; type-safe lint rules. | PROCESS-D-011 |
| **`prettier`** | `^3.0.0` | Code formatter | **Buy** | Deterministic formatting; enforced in CI; no style debates. | IMPL-PROCESS-001 |

### Type Definitions

| Package | Version | Category | Buy/DIY | Justification | Blueprint rules |
|---------|---------|----------|---------|---------------|-----------------|
| **`@types/react`** | `^18.3.0` / `^18.2.0` | React types | **Buy** | TypeScript definitions for React; required for strict typing of React code. | IMPL-ARCH-001 |
| **`@types/react-dom`** | `^18.3.0` / `^18.2.0` | React DOM types | **Buy** | TypeScript definitions for React DOM; required for strict typing of React DOM code. | IMPL-ARCH-001 |
| **`@types/node`** | `^25.9.1` / `^20.0.0` | Node.js types | **Buy** | TypeScript definitions for Node.js stdlib (server/worker compatibility); Bun is Node.js-compatible. | IMPL-ENV-004 |
| **`@types/bun`** | `^1.3.14` | Bun types | **Buy** | TypeScript definitions for Bun-specific APIs (test runner, bundler, package manager); augments Node.js types. | IMPL-ARCH-002 |
| **`bun-types`** | `^1.3.14` | Bun types (root) | **Buy** | Root-level Bun type definitions for workspace. | IMPL-ARCH-002 |

### Build & Plugin Configuration

| Package | Version | Category | Buy/DIY | Justification | Blueprint rules |
|---------|---------|----------|---------|---------------|-----------------|
| **`@vitejs/plugin-react`** | `^4.2.0` | Vite React plugin | **Buy** | React fast refresh for Vite; HMR support for dev server. | IMPL-ARCH-003 |
| **`jiti`** | `^2.7.0` | Runtime TypeScript loader | **Buy** | Dynamically loads and runs TypeScript files at runtime (used in scripts); alternative to ts-node. | IMPL-ARCH-002 |
| **`globals`** | `^15.0.0` | ESLint globals | **Buy** | Defines browser/Node.js global variables for ESLint; prevents false positives. | IMPL-PROCESS-001 |

## Server-Side Runtime Dependencies

| Package | Version | Category | Buy/DIY | Justification | Blueprint rules |
|---------|---------|----------|---------|---------------|-----------------|
| **`ajv`** | `^8.20.0` | JSON Schema validator | **Buy** | JSON Schema validation for API request/response contracts; ensures request shape before processing. | IMPL-ARCH-008/013/015 |
| **`croner`** | `^10.0.1` | Cron scheduler | **Buy** | Cron-expression parser for background job scheduling; used by task-queue system and recurring jobs. | WORKER-D-001 |

## Planned Dependencies (Not Yet Shipped)

| Package | Version | Category | Buy/DIY | Justification | Blueprint rules | Status |
|---------|---------|----------|---------|---------------|-----------------|--------|
| **`@scure/bip39`** | TBD | Mnemonic recovery | **Buy** | BIP-39 mnemonic generation for passkey account-recovery shard; gated by second factor (Argon2id or hardware key). Not yet implemented; will be added when passkey recovery lands. | IMPL-AUTH-004/024, AUTH-D-007/X-008 | **_(planned)_** |

## Workspace Internal Dependencies

| Package | Type | Purpose |
|---------|------|---------|
| **`core`** | Workspace internal | Shared types, auth middleware, crypto utilities; imported by `web`, `server`, `worker`, `db`, `ui`. |
| **`db`** | Workspace internal | Database access, schema, migrations; imported by `server`, `worker`, `core`. |
| **`ui`** | Workspace internal | Design system components, Tailwind config bridge; imported by `web`. |

## Buy-vs-DIY Framework (ARCH-D-002, IMPL-ARCH-022/025)

**Explicitly NOT bought (implemented DIY with primitive dependencies):**

- **Commission rules engine** — Custom business logic per tenant; no SaaS commission engine.
- **Split/attribution model** — DIY recursive CTE attribution; no external split vendor.
- **Draw recovery** — DIY advance-balance tracking and recovery logic.
- **Clawback/holdback logic** — DIY guarantee enforcement; no payment processor.
- **Explainability generation** — DIY audit-trail reconstruction for audit logs (PRD §9).
- **Append-only audit ledger** — DIY PostgreSQL journal; no external audit log SaaS.
- **JWT sign/verify** — ES256 via Web Crypto; no JWT library (algorithm-confusion risk); no Auth SaaS.
- **Field encryption** — AES-256-GCM/HKDF via Web Crypto; no encryption-as-a-service library.
- **Rate limiting** — DIY token-bucket implementation; no SaaS rate-limit service.
- **UUID v4 generation** — Built-in `crypto.randomUUID()` in Web Crypto; no UUID library.
- **CSV import/export** — DIY CSV parsing/generation; no bloated library.
- **Small UI components** — DIY React components; no component library (Shadcn/ui, Chakra, Material-UI forbidden).

## Transitive Dependencies & Audit Notes

- **`postgres` transitive chain:** Includes `@types/pg` for TypeScript; no other SQL-layer dependencies.
- **`@simplewebauthn` transitive chain:** Minimal; shared types only.
- **React ecosystem:** `react` + `react-dom` + `@vitejs/plugin-react` for HMR; no state management libraries (Redux, MobX, Zustand), no HTTP client (axios, superagent), no form libraries (react-hook-form, Formik).
- **Tailwind ecosystem:** `tailwindcss` + `@tailwindcss/vite` + Atlas design system; no CSS framework (Bootstrap, Chakra UI), no CSS-in-JS (emotion, styled-components).
- **Testing ecosystem:** `vitest` + `playwright`; no JSDOM, no Jest, no Cypress/Selenium.
- **Tooling:** `typescript` + `eslint` + `prettier`; no husky pre-commit hooks (Git hooks managed via `scripts/install-git-hooks.sh`).

**Periodically audited:** This registry is kept in sync with `package.json` files across the monorepo. Transitive trees are inspected for licensing, security, and supply-chain risk during:
- Every major version upgrade (tracked in issues tagged `#label:dependencies`).
- Security advisory responses (GitHub Dependabot, npm audit).
- Annual architecture audit (rule ARCH-C-013).

---

**Last audited:** 2026-06-16  
**Next audit:** Q3 2026 (per ARCH-C-013 yearly schedule)
