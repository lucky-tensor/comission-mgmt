/**
 * Attribution API integration tests — issue #8 acceptance criteria.
 *
 * Tests:
 *   AC#1 — POST /placements/:id/attribution/submit transitions placement to PendingApproval
 *   AC#2 — POST /placements/:id/attribution/approve (Manager) transitions placement to Active
 *   AC#3 — POST /placements/:id/attribution/approve by non-Manager returns 403
 *   AC#4 — POST /placements/:id/attribution/reject transitions back to ContributorsAssigned
 *            and records the rejection reason
 *   AC#5 — GET /placements/:id/attribution/timeline returns events in chronological order
 *
 * Additional tests:
 *   - State machine: approve from Created state returns 422
 *   - State machine: submit from Created state returns 422
 *   - RBAC: Producer token receives 403 on approve/reject
 *   - RBAC: FinanceAdmin token receives 403 on approve/reject (only Manager is allowed)
 *   - Timeline: empty array when no events exist
 *
 * Uses ephemeral Postgres via pg-container (Docker required).
 * All route handlers are called directly with an injectable sql client.
 * No vi.fn / vi.mock / vi.spyOn (TEST-C-001).
 *
 * Canonical docs: docs/prd.md §5.2
 * Issue: feat: manager split approval workflow and attribution timeline (#8)
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { startPostgres, type PgContainer } from 'db/pg-container';
import { migrate } from 'db/index';
import { FieldEncryptor } from '../../../packages/db/src/encryption';
import { LocalDevKmsAdapter } from '../../../packages/db/src/kms-dev';
import { _setEncryptorForTest, _resetEncryptorForTest } from '../../../packages/db/src/placements';
import { handleCreatePlacement } from '../../../apps/server/src/api/placements';
import { updatePlacement } from '../../../packages/db/src/placements';
import {
  handleSubmitAttribution,
  handleApproveAttribution,
  handleRejectAttribution,
  handleAttributionTimeline,
} from '../../../apps/server/src/api/attribution';
import type { SessionClaims } from 'core/auth';

// ---------------------------------------------------------------------------
// Test setup: ephemeral Postgres + encryption
// ---------------------------------------------------------------------------

let pg: PgContainer;
let testSql: ReturnType<typeof postgres>;
let auditSql: ReturnType<typeof postgres>;

const ORG_A_ID = crypto.randomUUID();
const USER_A_ID = crypto.randomUUID();
const MANAGER_ID = crypto.randomUUID();

const financeAdminClaims: SessionClaims = {
  org_id: ORG_A_ID,
  user_id: USER_A_ID,
  role: 'FinanceAdmin',
  jti: crypto.randomUUID(),
  exp: Math.floor(Date.now() / 1000) + 3600,
};

const managerClaims: SessionClaims = {
  org_id: ORG_A_ID,
  user_id: MANAGER_ID,
  role: 'Manager',
  jti: crypto.randomUUID(),
  exp: Math.floor(Date.now() / 1000) + 3600,
};

const producerClaims: SessionClaims = {
  org_id: ORG_A_ID,
  user_id: crypto.randomUUID(),
  role: 'Producer',
  jti: crypto.randomUUID(),
  exp: Math.floor(Date.now() / 1000) + 3600,
};

beforeAll(async () => {
  pg = await startPostgres();
  testSql = postgres(pg.url, { max: 5 });
  auditSql = postgres(pg.url, { max: 2 });

  await migrate({ databaseUrl: pg.url, auditDatabaseUrl: pg.url, analyticsDatabaseUrl: null });

  const adapter = new LocalDevKmsAdapter();
  const enc = new FieldEncryptor(adapter);
  _setEncryptorForTest(enc);
}, 120_000);

afterAll(async () => {
  _resetEncryptorForTest();
  await testSql?.end({ timeout: 5 });
  await auditSql?.end({ timeout: 5 });
  await pg?.stop();
}, 30_000);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(opts: { path: string; method?: string; body?: unknown }): Request {
  const method = opts.method ?? 'GET';
  return new Request(`http://localhost${opts.path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
}

/**
 * Creates a placement and advances it to ContributorsAssigned state.
 * Uses updatePlacement directly to set the status (PATCH API does not expose status).
 */
async function createPlacementInContributorsAssigned(): Promise<string> {
  const createReq = makeRequest({
    path: '/placements',
    method: 'POST',
    body: {
      candidate_id: crypto.randomUUID(),
      client_entity_id: crypto.randomUUID(),
      job_title: 'Senior Engineer',
      compensation_base: '150000',
      fee_amount: '22500',
      start_date: '2025-01-15',
    },
  });

  const createRes = await handleCreatePlacement(createReq, financeAdminClaims, testSql);
  expect(createRes.status).toBe(201);
  const created = (await createRes.json()) as Record<string, unknown>;
  const placementId = created.id as string;

  // Advance to ContributorsAssigned directly via DB (API PATCH does not expose status field)
  await updatePlacement(testSql, placementId, { status: 'ContributorsAssigned' });

  return placementId;
}

/**
 * Creates a placement in ContributorsAssigned state, then submits it to PendingApproval.
 */
async function createPlacementInPendingApproval(): Promise<string> {
  const placementId = await createPlacementInContributorsAssigned();

  const res = await handleSubmitAttribution(placementId, financeAdminClaims, testSql, auditSql);
  expect(res.status).toBe(200);

  return placementId;
}

// ---------------------------------------------------------------------------
// AC#1 — Submit transitions to PendingApproval
// ---------------------------------------------------------------------------

describe('POST /placements/:id/attribution/submit', () => {
  test('AC#1: transitions placement from ContributorsAssigned to PendingApproval', async () => {
    const placementId = await createPlacementInContributorsAssigned();

    const res = await handleSubmitAttribution(placementId, financeAdminClaims, testSql, auditSql);
    expect(res.status).toBe(200);

    const body = (await res.json()) as Record<string, unknown>;
    expect(body.placement_id).toBe(placementId);
    expect(body.status).toBe('PendingApproval');
  });

  test('returns 404 when placement does not exist', async () => {
    const res = await handleSubmitAttribution(crypto.randomUUID(), financeAdminClaims, testSql, auditSql);
    expect(res.status).toBe(404);
  });

  test('returns 404 when placement belongs to different tenant', async () => {
    const placementId = await createPlacementInContributorsAssigned();

    const foreignClaims: SessionClaims = {
      org_id: crypto.randomUUID(),
      user_id: crypto.randomUUID(),
      role: 'FinanceAdmin',
      jti: crypto.randomUUID(),
      exp: Math.floor(Date.now() / 1000) + 3600,
    };

    const res = await handleSubmitAttribution(placementId, foreignClaims, testSql, auditSql);
    expect(res.status).toBe(404);
  });

  test('returns 422 when placement is in Created state (invalid transition)', async () => {
    const createReq = makeRequest({
      path: '/placements',
      method: 'POST',
      body: {
        candidate_id: crypto.randomUUID(),
        client_entity_id: crypto.randomUUID(),
        job_title: 'Engineer',
        compensation_base: '100000',
        fee_amount: '15000',
      },
    });
    const createRes = await handleCreatePlacement(createReq, financeAdminClaims, testSql);
    const created = (await createRes.json()) as Record<string, unknown>;
    const placementId = created.id as string;

    const res = await handleSubmitAttribution(placementId, financeAdminClaims, testSql, auditSql);
    expect(res.status).toBe(422);
  });
});

// ---------------------------------------------------------------------------
// AC#2 — Approve transitions to Active
// ---------------------------------------------------------------------------

describe('POST /placements/:id/attribution/approve', () => {
  test('AC#2: Manager transitions placement from PendingApproval to Active', async () => {
    const placementId = await createPlacementInPendingApproval();

    const res = await handleApproveAttribution(placementId, managerClaims, testSql, auditSql);
    expect(res.status).toBe(200);

    const body = (await res.json()) as Record<string, unknown>;
    expect(body.placement_id).toBe(placementId);
    expect(body.status).toBe('Active');
  });

  test('returns 422 when placement is in Created state (invalid transition)', async () => {
    const createReq = makeRequest({
      path: '/placements',
      method: 'POST',
      body: {
        candidate_id: crypto.randomUUID(),
        client_entity_id: crypto.randomUUID(),
        job_title: 'Engineer',
        compensation_base: '100000',
        fee_amount: '15000',
      },
    });
    const createRes = await handleCreatePlacement(createReq, financeAdminClaims, testSql);
    const created = (await createRes.json()) as Record<string, unknown>;
    const placementId = created.id as string;

    const res = await handleApproveAttribution(placementId, managerClaims, testSql, auditSql);
    expect(res.status).toBe(422);
  });

  test('returns 404 when placement does not exist', async () => {
    const res = await handleApproveAttribution(crypto.randomUUID(), managerClaims, testSql, auditSql);
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// AC#3 — RBAC: non-Manager roles return 403 on approve
// ---------------------------------------------------------------------------

describe('RBAC: approve endpoint', () => {
  test('AC#3: FinanceAdmin receives 403 on approve', async () => {
    const placementId = await createPlacementInPendingApproval();

    const res = await handleApproveAttribution(placementId, financeAdminClaims, testSql, auditSql);
    expect(res.status).toBe(403);
  });

  test('AC#3: Producer receives 403 on approve', async () => {
    const placementId = await createPlacementInPendingApproval();

    const res = await handleApproveAttribution(placementId, producerClaims, testSql, auditSql);
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// AC#4 — Reject transitions back to ContributorsAssigned and records reason
// ---------------------------------------------------------------------------

describe('POST /placements/:id/attribution/reject', () => {
  test('AC#4: Manager transitions placement back to ContributorsAssigned with reason', async () => {
    const placementId = await createPlacementInPendingApproval();

    const rejectReq = makeRequest({
      path: `/placements/${placementId}/attribution/reject`,
      method: 'POST',
      body: { reason: 'Split percentages need revision' },
    });

    const res = await handleRejectAttribution(placementId, rejectReq, managerClaims, testSql, auditSql);
    expect(res.status).toBe(200);

    const body = (await res.json()) as Record<string, unknown>;
    expect(body.placement_id).toBe(placementId);
    expect(body.status).toBe('ContributorsAssigned');
    expect(body.reason).toBe('Split percentages need revision');
  });

  test('FinanceAdmin receives 403 on reject', async () => {
    const placementId = await createPlacementInPendingApproval();

    const rejectReq = makeRequest({
      path: `/placements/${placementId}/attribution/reject`,
      method: 'POST',
      body: { reason: 'Some reason' },
    });

    const res = await handleRejectAttribution(placementId, rejectReq, financeAdminClaims, testSql, auditSql);
    expect(res.status).toBe(403);
  });

  test('Producer receives 403 on reject', async () => {
    const placementId = await createPlacementInPendingApproval();

    const rejectReq = makeRequest({
      path: `/placements/${placementId}/attribution/reject`,
      method: 'POST',
      body: { reason: 'Some reason' },
    });

    const res = await handleRejectAttribution(placementId, rejectReq, producerClaims, testSql, auditSql);
    expect(res.status).toBe(403);
  });

  test('returns 422 when reason is missing', async () => {
    const placementId = await createPlacementInPendingApproval();

    const rejectReq = makeRequest({
      path: `/placements/${placementId}/attribution/reject`,
      method: 'POST',
      body: {},
    });

    const res = await handleRejectAttribution(placementId, rejectReq, managerClaims, testSql, auditSql);
    expect(res.status).toBe(422);
  });

  test('returns 422 when placement is in Created state (invalid transition)', async () => {
    const createReq = makeRequest({
      path: '/placements',
      method: 'POST',
      body: {
        candidate_id: crypto.randomUUID(),
        client_entity_id: crypto.randomUUID(),
        job_title: 'Engineer',
        compensation_base: '100000',
        fee_amount: '15000',
      },
    });
    const createRes = await handleCreatePlacement(createReq, financeAdminClaims, testSql);
    const created = (await createRes.json()) as Record<string, unknown>;
    const placementId = created.id as string;

    const rejectReq = makeRequest({
      path: `/placements/${placementId}/attribution/reject`,
      method: 'POST',
      body: { reason: 'Not ready' },
    });

    const res = await handleRejectAttribution(placementId, rejectReq, managerClaims, testSql, auditSql);
    expect(res.status).toBe(422);
  });
});

// ---------------------------------------------------------------------------
// AC#5 — Timeline returns events in chronological order
// ---------------------------------------------------------------------------

describe('GET /placements/:id/attribution/timeline', () => {
  test('AC#5: returns events in chronological order after submit → reject → submit → approve', async () => {
    const placementId = await createPlacementInContributorsAssigned();

    // Submit
    const submitRes = await handleSubmitAttribution(placementId, financeAdminClaims, testSql, auditSql);
    expect(submitRes.status).toBe(200);

    // Reject
    const rejectReq = makeRequest({
      path: `/placements/${placementId}/attribution/reject`,
      method: 'POST',
      body: { reason: 'Needs revision' },
    });
    const rejectRes = await handleRejectAttribution(placementId, rejectReq, managerClaims, testSql, auditSql);
    expect(rejectRes.status).toBe(200);

    // Re-submit after rejection
    const submitRes2 = await handleSubmitAttribution(placementId, financeAdminClaims, testSql, auditSql);
    expect(submitRes2.status).toBe(200);

    // Approve
    const approveRes = await handleApproveAttribution(placementId, managerClaims, testSql, auditSql);
    expect(approveRes.status).toBe(200);

    // Fetch timeline
    const timelineRes = await handleAttributionTimeline(placementId, financeAdminClaims, testSql);
    expect(timelineRes.status).toBe(200);

    const events = (await timelineRes.json()) as Record<string, unknown>[];
    expect(events.length).toBe(4);

    // Verify chronological order
    expect(events[0].event_type).toBe('Submitted');
    expect(events[1].event_type).toBe('Rejected');
    expect(events[1].reason).toBe('Needs revision');
    expect(events[2].event_type).toBe('Submitted');
    expect(events[3].event_type).toBe('Approved');

    // Verify timestamps are non-decreasing
    const timestamps = events.map((e) => new Date(e.created_at as string).getTime());
    for (let i = 1; i < timestamps.length; i++) {
      expect(timestamps[i]).toBeGreaterThanOrEqual(timestamps[i - 1]);
    }
  });

  test('returns empty array when no events exist', async () => {
    const placementId = await createPlacementInContributorsAssigned();

    const timelineRes = await handleAttributionTimeline(placementId, financeAdminClaims, testSql);
    expect(timelineRes.status).toBe(200);

    const events = (await timelineRes.json()) as unknown[];
    expect(events).toHaveLength(0);
  });

  test('returns 404 when placement does not exist', async () => {
    const res = await handleAttributionTimeline(crypto.randomUUID(), financeAdminClaims, testSql);
    expect(res.status).toBe(404);
  });

  test('each event includes placement_id, event_type, actor_id, and created_at', async () => {
    const placementId = await createPlacementInContributorsAssigned();

    await handleSubmitAttribution(placementId, financeAdminClaims, testSql, auditSql);

    const timelineRes = await handleAttributionTimeline(placementId, financeAdminClaims, testSql);
    expect(timelineRes.status).toBe(200);

    const events = (await timelineRes.json()) as Record<string, unknown>[];
    expect(events.length).toBe(1);

    const event = events[0];
    expect(event.id).toBeDefined();
    expect(event.placement_id).toBe(placementId);
    expect(event.event_type).toBe('Submitted');
    expect(event.actor_id).toBe(USER_A_ID);
    expect(event.created_at).toBeDefined();
    expect(event.reason).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// State machine: invalid transitions
// ---------------------------------------------------------------------------

describe('State machine — invalid transitions return 422', () => {
  test('approve from ContributorsAssigned returns 422', async () => {
    const placementId = await createPlacementInContributorsAssigned();

    const res = await handleApproveAttribution(placementId, managerClaims, testSql, auditSql);
    expect(res.status).toBe(422);
  });

  test('reject from ContributorsAssigned returns 422', async () => {
    const placementId = await createPlacementInContributorsAssigned();

    const rejectReq = makeRequest({
      path: `/placements/${placementId}/attribution/reject`,
      method: 'POST',
      body: { reason: 'Test reason' },
    });

    const res = await handleRejectAttribution(placementId, rejectReq, managerClaims, testSql, auditSql);
    expect(res.status).toBe(422);
  });

  test('submit from PendingApproval returns 422', async () => {
    const placementId = await createPlacementInPendingApproval();

    const res = await handleSubmitAttribution(placementId, financeAdminClaims, testSql, auditSql);
    expect(res.status).toBe(422);
  });
});
