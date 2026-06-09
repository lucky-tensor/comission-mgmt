/**
 * Arbitration result schema seam tests — issue #186.
 *
 * Verifies the dormant dispute-arbitration result table and dispute pointer are
 * present in the database schema without exercising the live workflow.
 */

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import postgres from 'postgres';
import { startPostgres, type PgContainer } from '../pg-container';
import { migrate } from '../index';

let pg: PgContainer;
let sql: ReturnType<typeof postgres>;

beforeAll(async () => {
  pg = await startPostgres();
  sql = postgres(pg.url, { max: 5 });
  await migrate({ databaseUrl: pg.url, auditDatabaseUrl: null, analyticsDatabaseUrl: null });
}, 120_000);

afterAll(async () => {
  await sql?.end({ timeout: 5 });
  await pg?.stop();
});

describe('arbitration result schema', () => {
  test('reserves the result table and dispute pointer', async () => {
    const resultColumns = await sql<{ column_name: string }[]>`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'arbitration_results'
      ORDER BY ordinal_position
    `;
    expect(resultColumns.map((row) => row.column_name)).toEqual([
      'id',
      'org_id',
      'dispute_id',
      'correlation_id',
      'recommendation',
      'reasoning',
      'edge_cases',
      'payout_adjustment',
      'created_at',
    ]);

    const disputesColumns = await sql<{ column_name: string }[]>`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'disputes'
      ORDER BY ordinal_position
    `;
    expect(disputesColumns.map((row) => row.column_name)).toContain('arbitration_result_id');

    const uniqueConstraints = await sql<{ def: string }[]>`
      SELECT pg_get_constraintdef(oid) AS def
      FROM pg_constraint
      WHERE conrelid = 'arbitration_results'::regclass
        AND contype = 'u'
    `;
    expect(uniqueConstraints.map((row) => row.def)).toEqual(
      expect.arrayContaining([expect.stringContaining('(dispute_id)')]),
    );
  });
});
