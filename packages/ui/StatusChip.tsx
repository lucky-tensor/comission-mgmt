/**
 * StatusChip — a semantic status pill with one palette used everywhere.
 *
 * The UX review (docs/ux-review.md §5) found chip-color drift: on the Partner
 * view "Closed" was green while "Collected" was gray, even though collected
 * money is the positive state. This component fixes the semantics once:
 *
 *   green  = paid / complete       (the positive, money-in / done state)
 *   amber  = held / pending        (waiting, in-progress, needs attention)
 *   gray   = neutral / closed      (informational, terminal-but-neutral)
 *   red    = disputed / blocked    (error, contested, action-blocking)
 *
 * Callers pass a raw domain status string; `statusVariant` maps it to a
 * variant. Unknown statuses fall back to the neutral (gray) variant so a new
 * status never renders unstyled.
 *
 * Canonical docs: docs/ux-review.md §5 (Status chip semantics)
 * Issue: feat: webapp — UX overhaul: design-system pass (#203)
 */

import type { ReactNode } from 'react';

export type StatusVariant = 'green' | 'amber' | 'gray' | 'red';

/**
 * Map a domain status to a semantic chip variant. Matching is
 * case-insensitive. Unknown statuses resolve to 'gray' (neutral).
 */
export function statusVariant(status: string): StatusVariant {
  const s = status.trim().toLowerCase();

  // green — paid / complete
  if (
    [
      'paid',
      'payable',
      'complete',
      'completed',
      'collected',
      'approved',
      'finalized',
      'resolved',
      'active',
      'released',
      'recovered',
    ].includes(s)
  ) {
    return 'green';
  }

  // amber — held / pending
  if (
    [
      'held',
      'pending',
      'draft',
      'open',
      'in_progress',
      'in progress',
      'awaiting',
      'partial',
      'billed',
      'review',
      'escalated',
    ].includes(s)
  ) {
    return 'amber';
  }

  // red — disputed / blocked
  if (
    [
      'disputed',
      'blocked',
      'rejected',
      'failed',
      'error',
      'overdue',
      'forbidden',
      'clawback',
      'reversed',
    ].includes(s)
  ) {
    return 'red';
  }

  // gray — neutral / closed (explicit list + fallback)
  // 'closed', 'neutral', 'archived', 'inactive', 'n/a', and anything unknown.
  return 'gray';
}

const VARIANT_CLASS: Record<StatusVariant, string> = {
  green: 'bg-ok-bg text-ok-fg',
  amber: 'bg-warn-bg text-warn-fg',
  gray: 'bg-neutral-bg text-neutral-fg',
  red: 'bg-bad-bg text-bad-fg',
};

const BASE_CLASS =
  'inline-block px-2 py-0.5 rounded-full text-xs font-semibold leading-normal whitespace-nowrap';

export interface StatusChipProps {
  /**
   * Raw domain status; mapped to a semantic variant via `statusVariant`.
   * Ignored when `variant` is provided explicitly.
   */
  status?: string;
  /** Force a specific variant, bypassing the status→variant mapping. */
  variant?: StatusVariant;
  /** Visible label; defaults to the `status` string. */
  children?: ReactNode;
  className?: string;
  'data-testid'?: string;
}

export function StatusChip({
  status,
  variant,
  children,
  className,
  'data-testid': testId,
}: StatusChipProps) {
  const resolved: StatusVariant = variant ?? statusVariant(status ?? '');
  return (
    <span
      data-testid={testId ?? 'status-chip'}
      data-variant={resolved}
      className={[BASE_CLASS, VARIANT_CLASS[resolved], className].filter(Boolean).join(' ')}
    >
      {children ?? status ?? ''}
    </span>
  );
}
