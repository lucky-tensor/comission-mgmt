/**
 * Demo seed step 1 — Users.
 *
 * Upserts 6 demo users (one per PRD role) plus a demo org.
 * All entities carry deterministic UUIDs so re-running produces no duplicates
 * (ON CONFLICT DO NOTHING).
 *
 * PRD roles: FinanceAdmin, Producer, Manager, Executive, HR, ExternalPartner
 */

import type { Sql } from 'postgres';

// ---------------------------------------------------------------------------
// Deterministic demo IDs (prefixed with dd01 for "demo data, step 01")
// ---------------------------------------------------------------------------

export const DEMO_ORG_ID = 'dd010000-0000-0000-0000-000000000001';

export const DEMO_USERS = {
  financeAdmin: {
    id: 'dd010000-0000-0000-0000-000000000011',
    email: 'demo-finance@demo.example',
    displayName: 'Dana Finance (Demo)',
    role: 'FinanceAdmin',
  },
  producer: {
    id: 'dd010000-0000-0000-0000-000000000012',
    email: 'demo-producer@demo.example',
    displayName: 'Pat Producer (Demo)',
    role: 'Producer',
  },
  manager: {
    id: 'dd010000-0000-0000-0000-000000000013',
    email: 'demo-manager@demo.example',
    displayName: 'Morgan Manager (Demo)',
    role: 'Manager',
  },
  executive: {
    id: 'dd010000-0000-0000-0000-000000000014',
    email: 'demo-executive@demo.example',
    displayName: 'Alex Executive (Demo)',
    role: 'Executive',
  },
  hr: {
    id: 'dd010000-0000-0000-0000-000000000015',
    email: 'demo-hr@demo.example',
    displayName: 'Harper HR (Demo)',
    role: 'HR',
  },
  externalPartner: {
    id: 'dd010000-0000-0000-0000-000000000016',
    email: 'demo-partner@demo.example',
    displayName: 'Perry Partner (Demo)',
    role: 'ExternalPartner',
  },
} as const;

export async function seedDemoUsers(sql: Sql): Promise<void> {
  // Upsert demo org
  await sql.unsafe(`
    INSERT INTO orgs (id, name)
    VALUES ('${DEMO_ORG_ID}', 'Demo Company (Demo)')
    ON CONFLICT (id) DO NOTHING
  `);

  // Upsert each demo user and their org membership
  for (const user of Object.values(DEMO_USERS)) {
    await sql.unsafe(`
      INSERT INTO users (id, email, display_name)
      VALUES ('${user.id}', '${user.email}', '${user.displayName}')
      ON CONFLICT (id) DO NOTHING
    `);

    await sql.unsafe(`
      INSERT INTO org_memberships (id, user_id, org_id, role)
      VALUES (
        gen_random_uuid(),
        '${user.id}',
        '${DEMO_ORG_ID}',
        '${user.role}'
      )
      ON CONFLICT (user_id, org_id) DO NOTHING
    `);
  }

  console.log('[demo-seed] Step 1: demo users seeded (6 users, 1 org).');
}
