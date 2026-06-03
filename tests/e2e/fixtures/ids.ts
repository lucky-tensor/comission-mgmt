/**
 * Stable seeded identifiers shared between the Bun-side seed
 * (seed-producer.ts) and the browser-side E2E test (producer-portal.e2e.ts).
 *
 * This module is intentionally dependency-free (no server/db imports) so it is
 * safe to import into the browser bundle — the E2E test only needs the producer
 * id to demo-login as the seeded user.
 *
 * Issue: feat: Producer Portal UI + headless-Chromium browser/E2E harness (#78)
 * Issue: feat: Executive UI — firm financial position dashboard (#110)
 */

export const SEEDED = {
  orgId: 'e2e00000-0000-0000-0000-0000000000aa',
  producerId: 'e2e00000-0000-0000-0000-0000000000b1',
  producerEmail: 'e2e-producer@demo.example',
  adminId: 'e2e00000-0000-0000-0000-0000000000c1',
  adminEmail: 'e2e-admin@demo.example',
  executiveId: 'e2e00000-0000-0000-0000-0000000000d1',
  executiveEmail: 'e2e-executive@demo.example',
  hrId: 'e2e00000-0000-0000-0000-0000000000e1',
  hrEmail: 'e2e-hr@demo.example',
} as const;
