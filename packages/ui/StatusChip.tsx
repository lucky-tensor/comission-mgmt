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

import type { CSSProperties, ReactNode } from 'react';
import { colors, radius } from './tokens';

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

const VARIANT_STYLE: Record<StatusVariant, CSSProperties> = {
  green: { background: colors.greenBg, color: colors.greenFg },
  amber: { background: colors.amberBg, color: colors.amberFg },
  gray: { background: colors.grayBg, color: colors.grayFg },
  red: { background: colors.redBg, color: colors.redFg },
};

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
  style?: CSSProperties;
  'data-testid'?: string;
}

export function StatusChip({
  status,
  variant,
  children,
  style,
  'data-testid': testId,
}: StatusChipProps) {
  const resolved: StatusVariant = variant ?? statusVariant(status ?? '');
  return (
    <span
      data-testid={testId ?? 'status-chip'}
      data-variant={resolved}
      style={{
        display: 'inline-block',
        padding: '0.125rem 0.5rem',
        borderRadius: radius.pill,
        fontSize: '0.75rem',
        fontWeight: 600,
        lineHeight: 1.5,
        whiteSpace: 'nowrap',
        ...VARIANT_STYLE[resolved],
        ...style,
      }}
    >
      {children ?? status ?? ''}
    </span>
  );
}
