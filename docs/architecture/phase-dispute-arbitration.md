# Phase: Dispute Arbitration Engine - Scout Decision Record

> **Dev-scout record for Plan issue #186.**
> Captures the stub-only arbitration seam, schema reservation, and downstream
> integration risks while the actual Claude-backed resolution flow remains unimplemented.

---

## Scope

This phase reserves the dispute-arbitration result contract without wiring the live
enqueue/result path into the router. The shared worker/task-queue seam already exists from the
arbitration/simulation infrastructure scout; this record isolates the dispute-specific pieces
that must stay consistent when the feature team lands the live implementation.

---

## Stubs created

| File | Purpose |
|---|---|
| `packages/db/src/arbitration-results.ts` | Shared arbitration result row and recommendation types |
| `apps/server/src/api/dispute-arbitration.ts` | Reserved `POST /disputes/:id/arbitrate` and `POST /disputes/:id/arbitration-result` handlers returning 501 |
| `packages/db/schema.sql` | `arbitration_results` table and `disputes.arbitration_result_id` column |

---

## Shared contract

The arbitration result payload is intentionally narrow so future worker output remains auditable:

```typescript
{
  recommendation: string;
  reasoning: string;
  edge_cases: string[];
  payout_adjustment: number;
}
```

This contract is mirrored in the shared database type surface and in the route-level validator so
the eventual Claude result parser does not invent a second shape.

---

## Decision - one dispute, one arbitration result

**Question:** Should arbitration output be embedded back into `disputes`, stored in an append-only
result table, or split across both?

**Decision:** Store the recommendation in a dedicated `arbitration_results` table and link the
dispute row back to it via `disputes.arbitration_result_id`.

**Rationale:**

1. **Auditability.** A dedicated row keeps the recommendation, reasoning, and edge cases
   immutable once recorded.
2. **Idempotency.** A unique `dispute_id` constraint on `arbitration_results` gives the future
   worker a database-enforced exactly-one-result boundary.
3. **Low coupling.** The `disputes` row remains the canonical workflow record, while the result
   table owns the recommendation payload.

---

## Integration seams

### Seam 1 - Queue task to result record

The worker task still begins with the `task_queue_view_arbitration` seam from the shared worker
infrastructure scout. The missing step is the API write-back into `arbitration_results`.

**Risk:** If the future implementation stores the Claude output directly on `disputes`, the
result payload will be harder to audit and harder to replace with a richer schema later.

### Seam 2 - Dispute resolution must reference the arbitration result

`disputes.arbitration_result_id` is reserved so the human accept/reject flow can cite the
exact recommendation that informed the decision.

**Risk:** If the resolution path ignores this pointer, later reviews cannot distinguish the
human decision from the machine recommendation.

### Seam 3 - Route surface stays stubbed until the live workflow lands

The route handlers currently return 501 and are not wired into `apps/server/src/index.ts`.
This keeps the repo behavior unchanged while making the future boundary explicit.

---

## Risks

| ID | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | Duplicate arbitration results for the same dispute | High | Unique constraint on `arbitration_results.dispute_id` |
| R2 | Result payload drifts from the shared contract | Medium | Keep the route validator and shared DB type in sync |
| R3 | Server router is wired too early | Medium | Keep the route handlers unregistered until the feature team lands the full flow |

---

## Downstream issues

The next dispute-arbitration implementation issue should consume this record before wiring the
live enqueue and result submission paths.
