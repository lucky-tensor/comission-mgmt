/**
 * Demo seed step 3 — Placements.
 *
 * Creates 8 placements across all lifecycle states:
 *   Created, Active, Invoiced, Collected, GuaranteeActive,
 *   GuaranteeExpired, Closed, ClawbackTriggered
 *
 * All fee_amount and compensation_base fields are encrypted via FieldEncryptor.
 * All entities carry deterministic UUIDs (ON CONFLICT DO NOTHING).
 */

import type { Sql } from 'postgres';
import { FieldEncryptor } from '../../packages/db/src/encryption.js';
import { createKmsAdapter } from '../../packages/db/src/kms.js';
import { DEMO_ORG_ID } from './demo-users.js';

// ---------------------------------------------------------------------------
// Deterministic demo IDs
// ---------------------------------------------------------------------------

export const DEMO_PLACEMENTS = {
  created: { id: 'dd030000-0000-0000-0000-000000000001', status: 'Created' as const },
  active: { id: 'dd030000-0000-0000-0000-000000000002', status: 'Active' as const },
  invoiced: { id: 'dd030000-0000-0000-0000-000000000003', status: 'Invoiced' as const },
  collected: { id: 'dd030000-0000-0000-0000-000000000004', status: 'Collected' as const },
  guaranteeActive: { id: 'dd030000-0000-0000-0000-000000000005', status: 'GuaranteeActive' as const },
  guaranteeExpired: { id: 'dd030000-0000-0000-0000-000000000006', status: 'GuaranteeExpired' as const },
  closed: { id: 'dd030000-0000-0000-0000-000000000007', status: 'Closed' as const },
  clawback: { id: 'dd030000-0000-0000-0000-000000000008', status: 'ClawbackTriggered' as const },
} as const;

// Deterministic candidate and client entity UUIDs
const CANDIDATE_A = 'dd030000-0000-0000-0001-000000000001';
const CANDIDATE_B = 'dd030000-0000-0000-0001-000000000002';
const CANDIDATE_C = 'dd030000-0000-0000-0001-000000000003';
const CANDIDATE_D = 'dd030000-0000-0000-0001-000000000004';
const CANDIDATE_E = 'dd030000-0000-0000-0001-000000000005';
const CANDIDATE_F = 'dd030000-0000-0000-0001-000000000006';
const CANDIDATE_G = 'dd030000-0000-0000-0001-000000000007';
const CANDIDATE_H = 'dd030000-0000-0000-0001-000000000008';

const CLIENT_ALPHA = 'dd030000-0000-0000-0002-000000000001';
const CLIENT_BETA = 'dd030000-0000-0000-0002-000000000002';
const CLIENT_GAMMA = 'dd030000-0000-0000-0002-000000000003';

interface DemoPlacement {
  id: string;
  status: string;
  candidateId: string;
  clientEntityId: string;
  jobTitle: string;
  compensationBase: string;
  feeAmount: string;
  startDate: string;
  guaranteeDays: number;
}

const PLACEMENT_DATA: DemoPlacement[] = [
  {
    id: DEMO_PLACEMENTS.created.id,
    status: 'Created',
    candidateId: CANDIDATE_A,
    clientEntityId: CLIENT_ALPHA,
    jobTitle: 'Software Engineer (Demo)',
    compensationBase: '120000',
    feeAmount: '18000',
    startDate: '2026-06-01',
    guaranteeDays: 90,
  },
  {
    id: DEMO_PLACEMENTS.active.id,
    status: 'Active',
    candidateId: CANDIDATE_B,
    clientEntityId: CLIENT_ALPHA,
    jobTitle: 'Product Manager (Demo)',
    compensationBase: '150000',
    feeAmount: '22500',
    startDate: '2026-03-15',
    guaranteeDays: 90,
  },
  {
    id: DEMO_PLACEMENTS.invoiced.id,
    status: 'Invoiced',
    candidateId: CANDIDATE_C,
    clientEntityId: CLIENT_BETA,
    jobTitle: 'Director of Marketing (Demo)',
    compensationBase: '175000',
    feeAmount: '26250',
    startDate: '2026-02-01',
    guaranteeDays: 90,
  },
  {
    id: DEMO_PLACEMENTS.collected.id,
    status: 'Collected',
    candidateId: CANDIDATE_D,
    clientEntityId: CLIENT_BETA,
    jobTitle: 'VP of Sales (Demo)',
    compensationBase: '200000',
    feeAmount: '30000',
    startDate: '2025-12-01',
    guaranteeDays: 90,
  },
  {
    id: DEMO_PLACEMENTS.guaranteeActive.id,
    status: 'GuaranteeActive',
    candidateId: CANDIDATE_E,
    clientEntityId: CLIENT_GAMMA,
    jobTitle: 'Senior Data Analyst (Demo)',
    compensationBase: '130000',
    feeAmount: '19500',
    startDate: '2026-04-01',
    guaranteeDays: 90,
  },
  {
    id: DEMO_PLACEMENTS.guaranteeExpired.id,
    status: 'GuaranteeExpired',
    candidateId: CANDIDATE_F,
    clientEntityId: CLIENT_GAMMA,
    jobTitle: 'DevOps Lead (Demo)',
    compensationBase: '160000',
    feeAmount: '24000',
    startDate: '2025-10-01',
    guaranteeDays: 90,
  },
  {
    id: DEMO_PLACEMENTS.closed.id,
    status: 'Closed',
    candidateId: CANDIDATE_G,
    clientEntityId: CLIENT_ALPHA,
    jobTitle: 'CFO (Demo)',
    compensationBase: '280000',
    feeAmount: '42000',
    startDate: '2025-09-01',
    guaranteeDays: 90,
  },
  {
    id: DEMO_PLACEMENTS.clawback.id,
    status: 'ClawbackTriggered',
    candidateId: CANDIDATE_H,
    clientEntityId: CLIENT_BETA,
    jobTitle: 'Operations Manager (Demo)',
    compensationBase: '110000',
    feeAmount: '16500',
    startDate: '2025-11-01',
    guaranteeDays: 90,
  },
];

let _encryptor: FieldEncryptor | null = null;

async function getEncryptor(): Promise<FieldEncryptor> {
  if (_encryptor) return _encryptor;
  const adapter = await createKmsAdapter();
  _encryptor = new FieldEncryptor(adapter);
  return _encryptor;
}

export async function seedDemoPlacements(sql: Sql): Promise<void> {
  const enc = await getEncryptor();

  for (const p of PLACEMENT_DATA) {
    const compensationBuf = await enc.encrypt('placements', 'compensation_base', p.compensationBase);
    const feeBuf = await enc.encrypt('placements', 'fee_amount', p.feeAmount);

    await sql.unsafe(
      `
      INSERT INTO placements (
        id, org_id, candidate_id, client_entity_id, job_title,
        compensation_base, fee_amount, status, start_date, guarantee_days
      ) VALUES (
        '${p.id}', '${DEMO_ORG_ID}', '${p.candidateId}', '${p.clientEntityId}', '${p.jobTitle}',
        $1, $2, '${p.status}', '${p.startDate}', ${p.guaranteeDays}
      )
      ON CONFLICT (id) DO NOTHING
      `,
      [compensationBuf, feeBuf],
    );
  }

  console.log('[demo-seed] Step 3: demo placements seeded (8 placements across all lifecycle states).');
}

/** Export the shared encryptor instance so later steps can reuse it (avoiding extra KMS init). */
export async function getDemoEncryptor(): Promise<FieldEncryptor> {
  return getEncryptor();
}
