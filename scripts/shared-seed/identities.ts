#!/usr/bin/env bun
import postgres from 'postgres';
import { migrate } from 'db/index';
import { SEEDED } from '../../tests/e2e/fixtures/ids.js';

export async function seedIdentities(databaseUrl: string): Promise<void> {
  await migrate({ databaseUrl, auditDatabaseUrl: databaseUrl, analyticsDatabaseUrl: null });

  const sql = postgres(databaseUrl, { max: 3 });

  try {
    await sql.unsafe(`INSERT INTO orgs (id, name) VALUES ('${SEEDED.orgId}', 'Demo Company')
      ON CONFLICT (id) DO NOTHING`);

    const users: { id: string; email: string; displayName: string }[] = [
      { id: SEEDED.adminId, email: SEEDED.adminEmail, displayName: 'Finance Admin' },
      { id: SEEDED.producerId, email: SEEDED.producerEmail, displayName: 'Producer' },
      { id: SEEDED.managerId, email: SEEDED.managerEmail, displayName: 'Manager' },
      { id: SEEDED.manager2Id, email: SEEDED.manager2Email, displayName: 'Manager 2' },
      { id: SEEDED.executiveId, email: SEEDED.executiveEmail, displayName: 'Executive' },
      { id: SEEDED.hrId, email: SEEDED.hrEmail, displayName: 'HR Operator' },
      { id: SEEDED.partnerId, email: SEEDED.partnerEmail, displayName: 'External Partner' },
      { id: SEEDED.producer2Id, email: SEEDED.producer2Email, displayName: 'Producer 2' },
    ];

    for (const user of users) {
      await sql.unsafe(`INSERT INTO users (id, email, display_name) VALUES ('${user.id}', '${user.email}', '${user.displayName}')
        ON CONFLICT (id) DO NOTHING`);
    }

    const memberships: { userId: string; role: string }[] = [
      { userId: SEEDED.adminId, role: 'FinanceAdmin' },
      { userId: SEEDED.producerId, role: 'Producer' },
      { userId: SEEDED.managerId, role: 'Manager' },
      { userId: SEEDED.manager2Id, role: 'Manager' },
      { userId: SEEDED.executiveId, role: 'Executive' },
      { userId: SEEDED.hrId, role: 'HR' },
      { userId: SEEDED.partnerId, role: 'ExternalPartner' },
      { userId: SEEDED.producer2Id, role: 'Producer' },
    ];

    for (const m of memberships) {
      await sql.unsafe(`INSERT INTO org_memberships (user_id, org_id, role)
        VALUES ('${m.userId}', '${SEEDED.orgId}', '${m.role}')
        ON CONFLICT (user_id, org_id) DO NOTHING`);
    }

    console.log(`[shared-seed] Phase 1: identities seeded (${users.length} users, 1 org).`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}
