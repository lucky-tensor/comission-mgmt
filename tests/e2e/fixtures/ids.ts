/**
 * Stable seeded identifiers and fixture constants shared between the Bun-side
 * seeds and the browser-side E2E tests.
 *
 * This module is intentionally dependency-free (no server/db imports) so it is
 * safe to import into the browser bundle. The E2E tests import from here rather
 * than from the seed helpers (which pull in postgres / server packages that must
 * not be bundled into Chromium).
 *
 * Issue: feat: Producer Portal UI + headless-Chromium browser/E2E harness (#78)
 * Issue: feat: Executive UI — firm financial position dashboard (#110)
 * Issue: feat: HR/People Ops UI — draw balance and recovery schedule view (#115)
 * Issue: test: E2E — Finance Admin month-end close (headless Chromium) (#117)
 * Issue: test: E2E — Manager split-approval and dispute resolution (#118)
 * Issue: test: E2E — External Partner payout visibility and scope enforcement (#121)
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
  // Manager E2E personas (issue #118)
  managerId: 'e2e00000-0000-0000-0000-0000000000f1',
  managerEmail: 'e2e-manager@demo.example',
  manager2Id: 'e2e00000-0000-0000-0000-0000000000f2',
  manager2Email: 'e2e-manager2@demo.example',
  producer2Id: 'e2e00000-0000-0000-0000-0000000000b2',
  producer2Email: 'e2e-producer2@demo.example',
  // External Partner E2E persona (issue #121)
  partnerId: 'e2e00000-0000-0000-0000-0000000000a1',
  partnerEmail: 'e2e-partner@demo.example',
} as const;

/**
 * External Partner fixture constants — pure data, no Node.js dependencies.
 *
 * The seeded External Partner holds a split on one placement (PARTNER.feeAmount
 * with a start_date trigger) and must NOT see an unrelated placement seeded by
 * the admin persona.
 */
export const PARTNER = {
  /** Fee amount for the partner's own split deal. */
  feeAmount: '8000',
  /** Placement start date used as payment trigger. */
  startDate: '2025-03-01',
} as const;

/**
 * Finance-close fixture constants — pure data, no Node.js dependencies.
 *
 * Exported from here (rather than from seed-finance-close.ts) so the
 * browser-side finance-close E2E test can import them without pulling the
 * postgres / db packages into the Chromium bundle.
 */
export const CLOSE = {
  /** Period used for the commission run and reconciliation report. */
  periodStart: '2025-05-01',
  periodEnd: '2025-05-31',

  /** Invoice number used in the ledger; AR record has a different amount. */
  invoiceNumber: 'INV-E2E-CLOSE-001',

  /** Amount billed in the ledger invoice (encrypted; server writes it). */
  ledgerAmount: '15000',

  /** Amount that will be inserted into the AR table — intentionally wrong. */
  arAmount: '9999',
} as const;
