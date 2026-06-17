# Demo Data Integration Guide

## Overview

The commission management demo seed system creates comprehensive, integrated test data across three phases:

1. **Phase 1 (demo-seed.ts)**: Identity setup — users, organizations, and memberships
2. **Phase 2 (phase2-seed.ts)**: Encrypted business data — placements, plans, commission records, and invoices via HTTP API
3. **Phase 3 (finalize-demo.ts)**: Post-seed cleanup — releases collection gates and verifies data integrity

This ensures the demo proves that all data is tightly integrated and correct.

## Architecture

### Phase 1: Identities (Direct DB)

```
Organizations
  ↓
Users + Org Memberships
  - Finance Admin
  - Producer (1, 2)
  - Manager (1, 2)
  - Executive
  - HR
  - External Partner
```

**Status**: ✓ Complete after migration
**Method**: Direct PostgreSQL INSERT (no encryption needed)
**Scoped to**: SEEDED.orgId = `e2e00000-0000-0000-0000-0000000000aa`

### Phase 2: Encrypted Commission Data (HTTP API)

The app server's HTTP API is used so encryption/decryption happens in-process with the server's DEK (Data Encryption Key).

#### Data Hierarchy

```
Plans + Plan Versions
    ↓
Plan Assignments (producer → plan)
    ↓
Placements (job opportunity)
    ├─ Contributors (producer + manager splits)
    ├─ Commission Records (calculated per contributor)
    └─ Invoices (billing events)
```

#### Key Placements in Seed

| Purpose | Count | Status Examples |
|---------|-------|-----------------|
| Lifecycle demonstration | 8 | Created, Active, Collected, Closed, GuaranteeActive, GuaranteeExpired |
| Producer payout E2E | 1 | Active → Approved payout |
| Manager approval E2E | 2 | PendingApproval, Disputed |
| Finance close E2E | 2 | Incomplete, Complete (with AR discrepancy) |
| Partner isolation | 2 | Partner's own deal + unrelated deal |
| Executive escalation | 1 | Escalated dispute |
| **Demo heterogeneous scenarios** | **6** | Collected, Held, Tiered, Split, Guarantee, Retained |

**Total**: 23 placements across all scenarios

#### Demo Scenarios (Issue #196)

The heterogeneous demo placements demonstrate realistic commission states:

| Scenario | Status | Hold Reason | Net Payable | Purpose |
|----------|--------|------------|-------------|---------|
| **Collected** | Payable | — | $7,500 | Paid invoice releases collection gate |
| **Held Collection** | Held | collection_gate | $0 | Active placement, invoice unpaid |
| **Tiered Rate** | Payable | — | $21,600 | Effective tier rate ≠ base rate |
| **Manager Split** | Payable | — | $6,000 | Split reduces commission (0.6 × fee) |
| **Guarantee Hold** | Held | guarantee_hold | $0 | Active guarantee window blocks payout |
| **Retained Search** | Held/Payable | collection_gate (phases) | Phase-dependent | Retainer (Payable) + Delivery (Held) |

### Phase 3: Finalization

After Phase 2, the finalize script:

1. **Identifies placements with paid invoices**
   - Queries: `invoices WHERE status = 'Paid'`
   
2. **Releases collection gates**
   - Updates: commission records from `Held (collection_gate) → Payable`
   - This mirrors what `/invoices/:id` PATCH does when invoice transitions to `Paid`
   
3. **Reports final state**
   - Commission records by producer (Payable vs Held counts)
   - Data integrity checks (no orphans, no unreasoned holds)
   
4. **Verifies integrity**
   - No orphaned commission records (no matching contributor)
   - All held records have a valid hold reason
   - Producer assignments exist for all credited placements

## Data Flow Example

### "Chief Technology Officer (Demo Collected)" Scenario

```
1. Placement created (job_title="Chief Technology Officer (Demo Collected)")
   Status: Active
   Fee: $30,000

2. Contributor added (producer_id=SEEDED.producerId, split_pct=1.0)

3. Commission record calculated
   Status: Held (no invoice yet, collection gate blocks payout)
   Hold Reason: collection_gate
   Net Payable: $0 (held)

4. Invoice created
   Amount: $30,000
   Status: Issued

5. Invoice marked Paid via PATCH /invoices/{id}
   → Triggers releaseCollectionGate()
   → Updates commission record: Held (collection_gate) → Payable
   → Net Payable: $7,500 (25% of fee)

6. Producer sees in portal:
   - Placement: "Chief Technology Officer (Demo Collected)"
   - Amount: $7,500
   - Status: Payable ✓
```

## Encryption & Keys

**Master Key** (ENCRYPTION_MASTER_KEY env var):
- Value (demo): `0000000000000000000000000000000000000000000000000000000000000001`
- Purpose: Derives Data Encryption Key (DEK) via KMS adapter
- Scope: Deployed in k3d secret, available to app pod

**Encrypted Columns**:
- `commission_records.gross_amount` (BYTEA)
- `commission_records.net_payable` (BYTEA)
- `invoices.amount_billed` (BYTEA)
- `draw_balances.balance` (BYTEA)
- `draw_balances.draw_limit` (BYTEA)
- `guarantee_periods.risk_amount` (BYTEA)
- `placements.compensation_base` (BYTEA)
- `placements.fee_amount` (BYTEA)

**Note**: Encryption/decryption only works within the app server's HTTP context (where DEK is loaded). Direct database diagnostics (diagnose-commissions.ts) cannot decrypt amounts without the server's KMS adapter.

## Diagnostic Tools

### 1. `scripts/diagnose-seed.ts`

**Purpose**: Verify seed data completeness and integrity (without decryption)

**Checks**:
- ✓ Organizations, users, memberships exist
- ✓ Placements created across all statuses
- ✓ Contributors linked to producers
- ✓ Commission records exist and match contributions
- ✓ Plans and plan versions
- ✓ Invoices by status
- ✓ No orphaned records
- ✓ Active placements without contributors (should be 0)

**Run**:
```bash
export KUBECONFIG=.k3d-kubeconfig-1232de
kubectl port-forward svc/commission-dev-postgres 15432:5432 &
sleep 3
DATABASE_URL="postgres://app_rw:app_rw_password@localhost:15432/commission_app" \
  bun run scripts/diagnose-seed.ts
```

**Output**: Structured list of checks (pass/fail) with data samples

### 2. `scripts/diagnose-commissions.ts`

**Purpose**: Show decrypted commission amounts (requires server DEK)

**Limitation**: Cannot decrypt without the server's KMS adapter in-process

**Alternative**: View commission records through the producer portal UI, which decrypts transparently

### 3. `scripts/finalize-demo.ts`

**Purpose**: Release collection gates and report final commission state

**Actions**:
1. Find placements with paid invoices
2. Release collection-gated commission records for those placements
3. Report commission state by producer (Payable vs Held)
4. Verify data integrity

**Run**:
```bash
export KUBECONFIG=.k3d-kubeconfig-1232de
kubectl port-forward svc/commission-dev-postgres 15432:5432 &
sleep 3
DATABASE_URL="postgres://app_rw:app_rw_password@localhost:15432/commission_app" \
  bun run scripts/finalize-demo.ts
```

**Output**:
```
[finalize-demo] Commission Record Summary:

  Producer
    Total: 10
    Payable: 5 ✓
    Held: 5
    Paid: 0

[finalize-demo] Data Integrity:
  ✓ No orphaned commission records
  ✓ All held records have a hold reason
  ✓ 5 producer(s) with plan assignments

[finalize-demo] Final State:
  Total commission records: 13
  Payable records: 5 (38.5%)
```

## Realism Checks

The demo proves data integration and correctness by showing:

### For Producers
- ✓ Multiple placements with different statuses
- ✓ Mix of Payable (released by paid invoices) and Held (awaiting payment) records
- ✓ Non-zero commissions for Payable records
- ✓ Plain-language explanations for each record
- ✓ Tier rates calculated per placement's plan
- ✓ Split calculations (manager overrides reduce producer share)

### For Managers
- ✓ Visibility of all producer placements
- ✓ Commission totals by producer
- ✓ Held vs Payable breakdown
- ✓ Team isolation (managers see only their org's data)

### For HR
- ✓ Draw balance tracking
- ✓ Guarantee period gating
- ✓ Accrual vs payable vs held breakdown

### For Executives
- ✓ Firm financial position (gross vs net)
- ✓ AR reconciliation (billing vs cash)
- ✓ Pipeline visibility (placements by stage)

### For Finance
- ✓ Invoice lifecycle (Issued → Paid → Collection released)
- ✓ Commission record state transitions
- ✓ Audit trail (invoice and commission changes logged)
- ✓ Guarantee and collection gates operating correctly

## Known Limitations

### 1. Producer Simulation Feature (Issue #187)
**Status**: Not implemented (returns 501)

The deal simulator UI endpoints exist but return `Not Implemented`:
- POST /producer/simulations/actual
- POST /producer/simulations/hypothetical
- GET /producer/simulations

This will be built in phase/arbitration-simulation phase.

### 2. Encryption Decryption Outside Server
Diagnostic scripts cannot decrypt commission amounts without the server's KMS adapter. Instead:
- View amounts through the UI (which decrypts transparently)
- Or check raw record status/hold_reason (which are plaintext)

## Troubleshooting

### Problem: "Producer sees 0% commission on all deals"

**Cause**: All commission records in `Held (collection_gate)` status
- No invoices marked as `Paid` yet, so collection gates are active
- This is correct behavior — the demo shows the state after calculations but before collection

**Solution**: 
1. Run `finalize-demo.ts` to release collection gates for paid invoices
2. Or manually update invoices to `Paid` status:
   ```sql
   UPDATE invoices SET status = 'Paid' WHERE status = 'Issued' LIMIT 5;
   ```
3. Then verify with `diagnose-seed.ts` to see increased Payable record count

### Problem: "Manager sees zero commissions for all producers"

**Cause**: Same as above — records are all `Held` (net_payable=$0 when held)

**Solution**: Run finalization step to release collection gates

### Problem: "HR shows two producers with typo 'producre 2'"

**Cause**: Display name in users table contains typo

**Fix**: Update the users table:
```sql
UPDATE users SET display_name = 'Producer 2' 
WHERE display_name = 'Producre 2' AND org_id = 'e2e00000-0000-0000-0000-0000000000aa';
```

Or fix the seed source (scripts/shared-seed/identities.ts line 23)

### Problem: "Executive sees only one client customer"

**Cause**: Seed creates diverse placements but executive dashboard may be filtering

**Check**:
1. How many client_entity_ids exist?
   ```sql
   SELECT COUNT(DISTINCT client_entity_id) FROM placements
   WHERE org_id = 'e2e00000-0000-0000-0000-0000000000aa';
   ```
2. Are all placements seeded successfully?
   ```sql
   SELECT COUNT(*) FROM placements
   WHERE org_id = 'e2e00000-0000-0000-0000-0000000000aa';
   ```

## Reseed Process

To reset the demo and start with fresh seed data:

```bash
# Option 1: Run local-demo again (tears down and rebuilds cluster)
bun run local-demo

# Option 2: Manual reseed (if cluster is already running)
export KUBECONFIG=.k3d-kubeconfig-1232de

# Phase 1: Identities
kubectl port-forward svc/commission-dev-postgres 15432:5432 &
sleep 2
DEMO_MODE=true DATABASE_URL=postgres://app_rw:app_rw_password@localhost:15432/commission_app \
  bun run scripts/demo-seed.ts
pkill kubectl

# Phase 2: Commission data (requires app to be running)
# This happens automatically in local-demo.ts
```

## Integration Test Examples

The test suite verifies data integration across user stories:

- **test: E2E — Producer Payout Portal** — verifies producers see accurate commission records
- **test: E2E — Manager split-approval and dispute resolution** — verifies multi-producer placed transfers credit correctly
- **test: E2E — Finance Admin month-end close** — verifies commission run approval transitions records to Paid
- **test: E2E — AR reconciliation** — verifies invoices and commission records match

These tests prove the data flows through the system correctly end-to-end.

---

**Last Updated**: 2026-06-16
**Related Issues**: #16 (producer portal), #33 (demo seed), #186-188 (arbitration features), #196 (demo heterogeneous scenarios)
