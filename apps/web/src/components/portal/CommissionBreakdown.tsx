/**
 * CommissionBreakdown — shows the financial calculation for a commission record.
 * Displays: notional gross → deductions (hold reasons, split adjustments) → net payable.
 *
 * Issue: feat: producer portal — commission breakdown redesign (#259)
 */

import type { CommissionRecord } from 'core/producer-portal';
import { formatCurrency } from '../../lib/format';

interface HoldReasonTagProps {
  reason: string | null;
  label: string;
}

function HoldReasonTag({ reason, label }: HoldReasonTagProps) {
  if (!reason) return null;

  return (
    <span
      className="inline-block px-2.5 py-1 rounded-sm text-xs font-medium bg-surface-sunken text-text-secondary"
      title={reason}
      role="status"
      aria-label={`Hold reason: ${label}`}
    >
      {label}
    </span>
  );
}

export function CommissionBreakdown({ record }: { record: CommissionRecord }) {
  const gross =
    typeof record.gross_commission === 'string'
      ? parseFloat(record.gross_commission)
      : record.gross_commission;
  const net =
    typeof record.net_payable === 'string' ? parseFloat(record.net_payable) : record.net_payable;
  const held = gross - net;

  return (
    <div className="mt-3 pt-3 border-t border-border-subtle text-sm space-y-2">
      {/* Notional commission row */}
      <div className="flex justify-between items-baseline">
        <span className="text-text-secondary">Notional commission:</span>
        <span className="font-semibold text-ink">{formatCurrency(gross)}</span>
      </div>

      {/* Deductions section */}
      {held > 0 && (
        <>
          <div className="flex justify-between items-baseline text-text-secondary text-xs ml-2">
            <span>Less: {record.hold_reason ? 'holds & adjustments' : 'adjustments'}</span>
            <span className="font-medium">-{formatCurrency(held)}</span>
          </div>

          {/* Hold reason tags */}
          {record.hold_reason && (
            <div className="ml-2 mt-1.5 flex flex-wrap gap-1.5">
              <HoldReasonTag
                reason={record.hold_reason}
                label={holdReasonLabel(record.hold_reason)}
              />
            </div>
          )}
        </>
      )}

      {/* Net payable row - highlighted */}
      <div className="flex justify-between items-baseline pt-1.5 border-t border-border-subtle font-semibold">
        <span className="text-ink">Net payable:</span>
        <span className={net > 0 ? 'text-status-success' : 'text-text-secondary'}>
          {formatCurrency(net)}
        </span>
      </div>
    </div>
  );
}

function holdReasonLabel(reason: string | null): string {
  const labels: Record<string, string> = {
    collection_gate: 'Awaiting invoice payment',
    guarantee_hold: 'Inside guarantee window',
    held_pending_phase_invoice: 'Phase invoice pending',
  };
  return labels[reason || ''] || 'On hold';
}
