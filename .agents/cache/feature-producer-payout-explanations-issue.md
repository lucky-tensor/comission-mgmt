## Phase

Unplaced

## Issue type

feature

## Canonical docs

- `docs/prd.md`
- `docs/ux-review.md`

## Motivation

My Portal currently presents implementation details and contradictory payout state. A producer can see a card labeled Payable with $0.00 net while the explanation says payment is pending client collection, followed by raw plan-version and placement UUIDs. That fails the PRD requirement that producers understand payout derivation without finance assistance and makes the demo data look untrustworthy.

## Behaviour

Producer payout cards show concise business-language derivations whose amounts, status chip, hold reason, and payment trigger agree. Collection- and guarantee-gated records are presented as held or pending, not payable or released. Raw placement and plan-version IDs remain available as secondary trace metadata but are absent from the primary explanation. Existing persisted explanations and newly calculated records receive the same producer-facing treatment, confidential-placement masking remains intact, and commission arithmetic and ledger history are unchanged.

## Scope

In scope:
- Define a shared producer-facing payout presentation formatter for explanation text and effective display status.
- Remove raw plan-version and placement identifiers from primary explanation prose while retaining the existing metadata fields for traceability.
- Make collection, guarantee, and billing-phase hold language agree with status, hold_reason, blocked_phase, and net_payable.
- Update explanation golden fixtures and producer portal API/component tests for base-rate, tiered-rate, draw-offset, collection-held, guarantee-held, and legacy persisted explanations.
- Correct and test the seeded retained-search card that currently demonstrates the contradiction.

Out of scope:
- Changing commission calculation formulas, rates, split attribution, draw recovery, or hold-release business rules.
- Rewriting historical ledger rows or adding a database migration.
- Redesigning the rest of My Portal or other role surfaces.
- Removing placement_id or plan_version_id from authenticated API responses or audit records.

## Acceptance criteria

- [ ] packages/core/tests/explanation-engine.test.ts golden and edge-case tests assert producer explanation prose contains the applicable split, commission base, rate, gross amount, draw or hold reason, and net amount, and contains neither the placement ID nor plan-version ID.
- [ ] tests/api/producer-portal/producer-portal.test.ts supplies a legacy record with status=Payable, net_payable=0, and a collection hold and asserts both /me endpoints return a held/pending producer display state, never Payable or Released, without issuing a mutation query.
- [ ] tests/api/producer-portal/producer-portal.test.ts asserts placement_id and plan_version_id remain present as trace metadata while the returned producer explanation omits those raw identifier values.
- [ ] tests/component/CreditedPlacements.test.tsx and tests/component/PayoutStatement.test.tsx assert held records render an amber held/pending status, $0.00 net, and matching collection or guarantee wording, while an unheld positive-net record renders Payable or Released wording.
- [ ] tests/e2e/stories/producer.stories.e2e.ts asserts the seeded Chief Financial Officer retained-search card has mutually consistent status, net amount, and explanation and does not render a UUID inside the expanded explanation.
- [ ] Producer portal API and component tests assert confidential placements continue to render Confidential and do not expose position or client-identifying text through the revised explanation.

## Test plan

- [ ] bun --bun vitest run packages/core/tests/explanation-engine.test.ts covers deterministic explanation content, legacy trace removal, hold scenarios, and zero-net draw recovery.
- [ ] bun run test:producer-portal covers /me response invariants, trace metadata retention, no read-time ledger mutation, and confidential masking.
- [ ] bun --bun vitest run --config vitest.browser.config.ts tests/component/CreditedPlacements.test.tsx tests/component/PayoutStatement.test.tsx covers rendered status, amounts, hold wording, and absence of UUID prose.
- [ ] bun run test:browser -- tests/e2e/stories/producer.stories.e2e.ts covers the seeded retained-search regression in the real producer portal.
- [ ] bun run typecheck verifies the shared producer presentation contract across core, server, and web.

## Stage

**Current:** Specified
