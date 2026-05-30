/**
 * Unit test for packages/db/worker-tokens.ts
 *
 * Tests: issue, consume, and invalidate a scoped commission token.
 * Uses ephemeral Postgres via pg-container (Docker required).
 *
 * worker-tokens.ts accepts an optional sql client override, so all functions
 * are called with the pg-container sql connection for isolation.
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { startPostgres, type PgContainer } from '../pg-container';

let pg: PgContainer;
let sql: ReturnType<typeof postgres>;

beforeAll(async () => {
  pg = await startPostgres();
  sql = postgres(pg.url, { max: 5 });

  const { migrate } = await import('../index');
  await migrate({ databaseUrl: pg.url });
}, 120_000);

afterAll(async () => {
  await sql.end({ timeout: 5 });
  await pg?.stop();
});

function makeJti(): string {
  return crypto.randomUUID();
}

function makeTaskId(): string {
  return `task-${crypto.randomUUID()}`;
}

describe('worker-tokens issue/consume/invalidate cycle', () => {
  test('issue: persistWorkerToken stores a row with commission fields', async () => {
    const { persistWorkerToken } = await import('../worker-tokens');
    const jti = makeJti();
    const taskId = makeTaskId();
    const expires = new Date(Date.now() + 3600 * 1000);

    const row = await persistWorkerToken({
      podId: 'pod-issue-1',
      agentType: 'commission-calculator',
      taskId,
      jti,
      expiresAt: expires,
      sql,
    });

    expect(row.pod_id).toBe('pod-issue-1');
    expect(row.agent_type).toBe('commission-calculator');
    expect(row.task_id).toBe(taskId);
    expect(row.jti).toBe(jti);
    expect(row.consumed_at).toBeNull();
    expect(row.invalidated_at).toBeNull();
    expect(new Date(row.expires_at).getTime()).toBeCloseTo(expires.getTime(), -3);
  });

  test('consume: consumeWorkerToken returns the row on first call', async () => {
    const { persistWorkerToken, consumeWorkerToken } = await import('../worker-tokens');
    const jti = makeJti();
    await persistWorkerToken({
      podId: 'pod-consume-1',
      agentType: 'commission-calculator',
      taskId: makeTaskId(),
      jti,
      expiresAt: new Date(Date.now() + 3600 * 1000),
      sql,
    });

    const result = await consumeWorkerToken(jti, sql);
    expect(result).not.toBeNull();
    expect(result!.jti).toBe(jti);
    expect(result!.consumed_at).not.toBeNull();
  });

  test('consume: single-use enforcement — null on second call', async () => {
    const { persistWorkerToken, consumeWorkerToken } = await import('../worker-tokens');
    const jti = makeJti();
    await persistWorkerToken({
      podId: 'pod-consume-2',
      agentType: 'commission-calculator',
      taskId: makeTaskId(),
      jti,
      expiresAt: new Date(Date.now() + 3600 * 1000),
      sql,
    });

    const first = await consumeWorkerToken(jti, sql);
    expect(first).not.toBeNull();

    const second = await consumeWorkerToken(jti, sql);
    expect(second).toBeNull();
  });

  test('consume: mirrors JTI into revoked_tokens on consumption', async () => {
    const { persistWorkerToken, consumeWorkerToken } = await import('../worker-tokens');
    const jti = makeJti();
    await persistWorkerToken({
      podId: 'pod-revoke-1',
      agentType: 'commission-calculator',
      taskId: makeTaskId(),
      jti,
      expiresAt: new Date(Date.now() + 3600 * 1000),
      sql,
    });

    await consumeWorkerToken(jti, sql);

    const revoked = await sql<{ jti: string }[]>`
      SELECT jti FROM revoked_tokens WHERE jti = ${jti}
    `;
    expect(revoked.length).toBe(1);
    expect(revoked[0].jti).toBe(jti);
  });

  test('invalidate: invalidateWorkerTokensForPod invalidates all unused pod tokens', async () => {
    const { persistWorkerToken, consumeWorkerToken, invalidateWorkerTokensForPod } =
      await import('../worker-tokens');
    const podId = `pod-inv-${Date.now()}`;
    const jti1 = makeJti();
    const jti2 = makeJti();

    await persistWorkerToken({
      podId,
      agentType: 'commission-calculator',
      taskId: makeTaskId(),
      jti: jti1,
      expiresAt: new Date(Date.now() + 3600 * 1000),
      sql,
    });
    await persistWorkerToken({
      podId,
      agentType: 'commission-calculator',
      taskId: makeTaskId(),
      jti: jti2,
      expiresAt: new Date(Date.now() + 3600 * 1000),
      sql,
    });

    const count = await invalidateWorkerTokensForPod(podId, sql);
    expect(count).toBe(2);

    // Both tokens should now be non-consumable
    expect(await consumeWorkerToken(jti1, sql)).toBeNull();
    expect(await consumeWorkerToken(jti2, sql)).toBeNull();
  });

  test('fetchWorkerTokenByJti retrieves the stored row', async () => {
    const { persistWorkerToken, fetchWorkerTokenByJti } = await import('../worker-tokens');
    const jti = makeJti();
    await persistWorkerToken({
      podId: 'pod-fetch-1',
      agentType: 'invoice-generator',
      taskId: makeTaskId(),
      jti,
      expiresAt: new Date(Date.now() + 3600 * 1000),
      sql,
    });

    const row = await fetchWorkerTokenByJti(jti, sql);
    expect(row).not.toBeNull();
    expect(row!.jti).toBe(jti);
  });

  test('fetchWorkerTokenByJti returns null for unknown JTI', async () => {
    const { fetchWorkerTokenByJti } = await import('../worker-tokens');
    const row = await fetchWorkerTokenByJti(makeJti(), sql);
    expect(row).toBeNull();
  });
});
