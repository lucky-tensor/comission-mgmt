/**
 * Field-level encryption integration test.
 *
 * Acceptance criteria (from issue #31):
 *   - A value written to placements.compensation_base is stored as BYTEA in
 *     Postgres and is NOT the plaintext value — a direct query returns bytea,
 *     not a numeric string.
 *   - getPlacement() correctly decrypts the value back to the original string.
 *
 * Requires Docker (uses pg-container for an ephemeral Postgres container).
 * Runs as part of: bun run test:migration (vitest.migration.config.ts)
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { startPostgres, type PgContainer } from '../pg-container';
import { migrate } from '../index';
import { createPlacement, getPlacement, _resetEncryptorForTest } from '../index';
import { FieldEncryptor } from '../src/encryption';
import { LocalDevKmsAdapter } from '../src/kms-dev';
import { _setEncryptorForTest } from '../src/placements';

let pg: PgContainer;
let sql: ReturnType<typeof postgres>;

/** Deterministic IDs for the test fixture */
const ORG_ID = '11000000-0000-0000-0000-000000000001';
const CANDIDATE_ID = '11000000-0000-0000-0000-000000000002';
const CLIENT_ENTITY_ID = '11000000-0000-0000-0000-000000000003';

beforeAll(async () => {
  pg = await startPostgres();
  sql = postgres(pg.url, { max: 3 });

  await migrate({
    databaseUrl: pg.url,
    auditDatabaseUrl: null,
    analyticsDatabaseUrl: null,
  });

  // Inject a deterministic dev-stub encryptor so tests run without env config
  const adapter = new LocalDevKmsAdapter();
  const enc = new FieldEncryptor(adapter);
  _setEncryptorForTest(enc);
}, 300_000);

afterAll(async () => {
  _resetEncryptorForTest();
  await sql?.end({ timeout: 5 });
  await pg?.stop();
});

// ---------------------------------------------------------------------------
// Test 1: createPlacement + getPlacement round-trip
// ---------------------------------------------------------------------------

describe('createPlacement / getPlacement — transparent encryption', () => {
  test('getPlacement returns the original compensation_base value after encrypt/store/decrypt', async () => {
    const created = await createPlacement(sql, {
      orgId: ORG_ID,
      candidateId: CANDIDATE_ID,
      clientEntityId: CLIENT_ENTITY_ID,
      jobTitle: 'Senior Engineer',
      compensationBase: '150000',
      feeAmount: '22500',
    });

    expect(created.id).toBeTruthy();

    const fetched = await getPlacement(sql, created.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.compensationBase).toBe('150000');
    expect(fetched!.feeAmount).toBe('22500');
    expect(fetched!.jobTitle).toBe('Senior Engineer');
    expect(fetched!.orgId).toBe(ORG_ID);
  });
});

// ---------------------------------------------------------------------------
// Test 2: BYTEA column is NOT the plaintext value in Postgres
// ---------------------------------------------------------------------------

describe('placements.compensation_base — stored as BYTEA, not plaintext', () => {
  test('direct psql query returns bytea, not the numeric string "150000"', async () => {
    // Insert via createPlacement (encrypts transparently)
    const created = await createPlacement(sql, {
      orgId: ORG_ID,
      candidateId: CANDIDATE_ID,
      clientEntityId: CLIENT_ENTITY_ID,
      jobTitle: 'Lead Developer',
      compensationBase: '150000',
      feeAmount: '30000',
    });

    // Query the raw column via a direct sql call (bypassing FieldEncryptor)
    const rows = await sql.unsafe(`SELECT compensation_base FROM placements WHERE id = $1`, [
      created.id,
    ]);

    expect(rows.length).toBe(1);
    const rawValue = rows[0].compensation_base;

    // The raw column must be a Buffer (BYTEA), not a string
    expect(Buffer.isBuffer(rawValue)).toBe(true);

    // The raw bytes must NOT be the UTF-8 encoding of "150000"
    const plaintextBytes = Buffer.from('150000', 'utf8');
    // Lengths differ or contents differ — the stored bytes are ciphertext
    const rawBuf = rawValue as Buffer;
    const isSameLengthAndContent =
      rawBuf.length === plaintextBytes.length && rawBuf.equals(plaintextBytes);
    expect(isSameLengthAndContent).toBe(false);

    // The raw bytes must not contain "150000" as a substring either
    expect(rawBuf.toString('utf8')).not.toContain('150000');
  });

  test('compensation_base column data_type is bytea in information_schema', async () => {
    const rows = await sql.unsafe(
      `
      SELECT data_type
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'placements'
        AND column_name = 'compensation_base'
      `,
    );
    expect(rows.length).toBe(1);
    expect(rows[0].data_type).toBe('bytea');
  });
});
