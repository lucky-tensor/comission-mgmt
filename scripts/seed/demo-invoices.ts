/**
 * Demo seed step 6 — Invoices.
 *
 * Creates 4 invoices in states: Issued, PartiallyPaid, Paid, Disputed.
 * amount_billed is encrypted via FieldEncryptor.
 * All entities carry deterministic UUIDs (ON CONFLICT DO NOTHING).
 */

import type { Sql } from 'postgres';
import { DEMO_ORG_ID } from './demo-users.js';
import { DEMO_PLACEMENTS, getDemoEncryptor } from './demo-placements.js';

// ---------------------------------------------------------------------------
// Deterministic invoice IDs
// ---------------------------------------------------------------------------

export const DEMO_INVOICES = {
  issued: { id: 'dd060000-0000-0000-0000-000000000001' },
  partiallyPaid: { id: 'dd060000-0000-0000-0000-000000000002' },
  paid: { id: 'dd060000-0000-0000-0000-000000000003' },
  disputed: { id: 'dd060000-0000-0000-0000-000000000004' },
} as const;

interface InvoiceDef {
  id: string;
  placementId: string;
  invoiceNumber: string;
  amountBilled: string;
  amountCollected: string | null;
  status: string;
  issuedAt: string;
  dueAt: string;
  collectedAt: string | null;
}

const INVOICES: InvoiceDef[] = [
  {
    id: DEMO_INVOICES.issued.id,
    placementId: DEMO_PLACEMENTS.invoiced.id,
    invoiceNumber: 'DEMO-INV-001',
    amountBilled: '26250',
    amountCollected: null,
    status: 'Issued',
    issuedAt: '2026-02-15T00:00:00Z',
    dueAt: '2026-03-17T00:00:00Z',
    collectedAt: null,
  },
  {
    id: DEMO_INVOICES.partiallyPaid.id,
    placementId: DEMO_PLACEMENTS.active.id,
    invoiceNumber: 'DEMO-INV-002',
    amountBilled: '22500',
    amountCollected: '11250',
    status: 'PartiallyPaid',
    issuedAt: '2026-03-20T00:00:00Z',
    dueAt: '2026-04-19T00:00:00Z',
    collectedAt: null,
  },
  {
    id: DEMO_INVOICES.paid.id,
    placementId: DEMO_PLACEMENTS.collected.id,
    invoiceNumber: 'DEMO-INV-003',
    amountBilled: '30000',
    amountCollected: '30000',
    status: 'Paid',
    issuedAt: '2025-12-15T00:00:00Z',
    dueAt: '2026-01-14T00:00:00Z',
    collectedAt: '2026-01-10T00:00:00Z',
  },
  {
    id: DEMO_INVOICES.disputed.id,
    placementId: DEMO_PLACEMENTS.clawback.id,
    invoiceNumber: 'DEMO-INV-004',
    amountBilled: '16500',
    amountCollected: null,
    status: 'Disputed',
    issuedAt: '2025-11-20T00:00:00Z',
    dueAt: '2025-12-20T00:00:00Z',
    collectedAt: null,
  },
];

export async function seedDemoInvoices(sql: Sql): Promise<void> {
  const enc = await getDemoEncryptor();

  for (const inv of INVOICES) {
    const amountBilledBuf = await enc.encrypt('invoices', 'amount_billed', inv.amountBilled);

    if (inv.amountCollected !== null) {
      const amountCollectedBuf = await enc.encrypt(
        'invoices',
        'amount_collected',
        inv.amountCollected,
      );
      const collectedClause =
        inv.collectedAt !== null ? `'${inv.collectedAt}'` : 'NULL';

      await sql.unsafe(
        `
        INSERT INTO invoices (
          id, org_id, placement_id, invoice_number, amount_billed, amount_collected,
          status, issued_at, due_at, collected_at
        ) VALUES (
          '${inv.id}', '${DEMO_ORG_ID}', '${inv.placementId}', '${inv.invoiceNumber}',
          $1, $2, '${inv.status}', '${inv.issuedAt}', '${inv.dueAt}', ${collectedClause}
        )
        ON CONFLICT (id) DO NOTHING
        `,
        [amountBilledBuf, amountCollectedBuf],
      );
    } else {
      const collectedClause =
        inv.collectedAt !== null ? `'${inv.collectedAt}'` : 'NULL';

      await sql.unsafe(
        `
        INSERT INTO invoices (
          id, org_id, placement_id, invoice_number, amount_billed,
          status, issued_at, due_at, collected_at
        ) VALUES (
          '${inv.id}', '${DEMO_ORG_ID}', '${inv.placementId}', '${inv.invoiceNumber}',
          $1, '${inv.status}', '${inv.issuedAt}', '${inv.dueAt}', ${collectedClause}
        )
        ON CONFLICT (id) DO NOTHING
        `,
        [amountBilledBuf],
      );
    }
  }

  console.log(
    '[demo-seed] Step 6: demo invoices seeded (4 invoices: Issued, PartiallyPaid, Paid, Disputed).',
  );
}
