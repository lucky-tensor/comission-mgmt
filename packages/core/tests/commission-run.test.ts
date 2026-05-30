/**
 * Unit tests for packages/core/commission-run.ts and packages/core/invoice-trigger.ts
 *
 * Verifies that:
 * - CommissionRun.STATES includes Open, Approved, Exported (acceptance criterion 1)
 * - InvoicePaymentTrigger compiles with no-op stub (acceptance criterion 2)
 * - Transition table is structurally sound
 *
 * No database required — pure in-memory enum assertions.
 *
 * Test plan (issue #25):
 *   Enum test: CommissionRun.STATES includes Open, Approved, Exported
 *   Compile test: build step exits 0 with all stubs in place
 */

import { describe, it, expect } from 'vitest';
import {
  COMMISSION_RUN_STATES,
  COMMISSION_RUN_TRANSITIONS,
  canTransitionRun,
  type CommissionRunState,
  type CommissionRun,
} from '../commission-run';
import {
  INVOICE_STATES,
  NoOpInvoicePaymentTrigger,
  type InvoiceStatus,
  type InvoicePaymentEvent,
} from '../invoice-trigger';

// ---------------------------------------------------------------------------
// CommissionRun state enum tests
// ---------------------------------------------------------------------------

describe('COMMISSION_RUN_STATES', () => {
  it('includes Open', () => {
    expect(COMMISSION_RUN_STATES).toContain('Open');
  });

  it('includes Approved', () => {
    expect(COMMISSION_RUN_STATES).toContain('Approved');
  });

  it('includes Exported', () => {
    expect(COMMISSION_RUN_STATES).toContain('Exported');
  });

  it('contains exactly 3 PRD Finance Close lifecycle states', () => {
    expect(COMMISSION_RUN_STATES.length).toBe(3);
  });

  it('has no duplicate state values', () => {
    const unique = new Set(COMMISSION_RUN_STATES);
    expect(unique.size).toBe(COMMISSION_RUN_STATES.length);
  });
});

// ---------------------------------------------------------------------------
// COMMISSION_RUN_TRANSITIONS table tests
// ---------------------------------------------------------------------------

describe('COMMISSION_RUN_TRANSITIONS', () => {
  it('has an entry for every state', () => {
    for (const state of COMMISSION_RUN_STATES) {
      expect(COMMISSION_RUN_TRANSITIONS).toHaveProperty(state);
    }
  });

  it('all transition targets are valid states', () => {
    for (const [, targets] of Object.entries(COMMISSION_RUN_TRANSITIONS)) {
      for (const target of targets) {
        expect(COMMISSION_RUN_STATES).toContain(target as CommissionRunState);
      }
    }
  });

  it('Exported has no outgoing transitions (terminal state)', () => {
    expect(COMMISSION_RUN_TRANSITIONS['Exported']).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// canTransitionRun guard tests
// ---------------------------------------------------------------------------

describe('canTransitionRun', () => {
  it('allows Open → Approved', () => {
    expect(canTransitionRun('Open', 'Approved')).toBe(true);
  });

  it('allows Approved → Exported', () => {
    expect(canTransitionRun('Approved', 'Exported')).toBe(true);
  });

  it('rejects Open → Exported (skipping Approved)', () => {
    expect(canTransitionRun('Open', 'Exported')).toBe(false);
  });

  it('rejects Exported → Open (backward transition)', () => {
    expect(canTransitionRun('Exported', 'Open')).toBe(false);
  });

  it('rejects Approved → Open (no rollback after approval)', () => {
    expect(canTransitionRun('Approved', 'Open')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// CommissionRun entity type test (compile-time shape check)
// ---------------------------------------------------------------------------

describe('CommissionRun entity type', () => {
  it('accepts a structurally valid CommissionRun object', () => {
    const run: CommissionRun = {
      id: 'run-001',
      orgId: 'org-001',
      status: 'Open',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    expect(run.status).toBe('Open');
    expect(run.id).toBe('run-001');
  });
});

// ---------------------------------------------------------------------------
// INVOICE_STATES enum tests
// ---------------------------------------------------------------------------

describe('INVOICE_STATES', () => {
  it('includes Issued', () => {
    expect(INVOICE_STATES).toContain('Issued');
  });

  it('includes Paid', () => {
    expect(INVOICE_STATES).toContain('Paid');
  });

  it('includes PartiallyPaid', () => {
    expect(INVOICE_STATES).toContain('PartiallyPaid');
  });

  it('includes Disputed', () => {
    expect(INVOICE_STATES).toContain('Disputed');
  });

  it('includes WrittenOff', () => {
    expect(INVOICE_STATES).toContain('WrittenOff');
  });

  it('includes CreditMemoApplied', () => {
    expect(INVOICE_STATES).toContain('CreditMemoApplied');
  });

  it('has no duplicate state values', () => {
    const unique = new Set(INVOICE_STATES);
    expect(unique.size).toBe(INVOICE_STATES.length);
  });
});

// ---------------------------------------------------------------------------
// NoOpInvoicePaymentTrigger — stub compile and runtime tests
// ---------------------------------------------------------------------------

describe('NoOpInvoicePaymentTrigger', () => {
  const trigger = new NoOpInvoicePaymentTrigger();

  const mockEvent: InvoicePaymentEvent = {
    invoiceId: 'inv-001',
    placementId: 'plc-001',
    orgId: 'org-001',
    newStatus: 'Paid' as InvoiceStatus,
    previousStatus: 'Issued' as InvoiceStatus,
    occurredAt: new Date().toISOString(),
  };

  it('onInvoicePaid resolves without error (no-op)', async () => {
    await expect(trigger.onInvoicePaid(mockEvent)).resolves.toBeUndefined();
  });

  it('onInvoiceDisputed resolves without error (no-op)', async () => {
    const disputedEvent: InvoicePaymentEvent = { ...mockEvent, newStatus: 'Disputed' };
    await expect(trigger.onInvoiceDisputed(disputedEvent)).resolves.toBeUndefined();
  });

  it('onInvoiceCreditMemo resolves without error (no-op)', async () => {
    const creditEvent: InvoicePaymentEvent = { ...mockEvent, newStatus: 'CreditMemoApplied' };
    await expect(trigger.onInvoiceCreditMemo(creditEvent)).resolves.toBeUndefined();
  });

  it('onInvoiceWriteOff resolves without error (no-op)', async () => {
    const writeOffEvent: InvoicePaymentEvent = { ...mockEvent, newStatus: 'WrittenOff' };
    await expect(trigger.onInvoiceWriteOff(writeOffEvent)).resolves.toBeUndefined();
  });
});
