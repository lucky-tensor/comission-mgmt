/**
 * Small presentation helpers for the Producer Portal.
 * Pure functions — no DOM, no fetch. Issue #78.
 */

/**
 * Format an amount as USD currency (e.g. 15750 → "$15,750.00").
 *
 * Encrypted numeric columns come back over the wire as decimal strings
 * (e.g. "5000.0000"), so this accepts string | number and coerces; a
 * non-numeric value renders as "—".
 */
export function formatCurrency(amount: number | string): string {
  const n = typeof amount === 'string' ? Number(amount) : amount;
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(n);
}

/** Format a decimal rate as a percentage (e.g. 0.25 → "25%"). */
export function formatRate(rate: number): string {
  return `${(rate * 100).toFixed(0)}%`;
}

/** Format an ISO date string as a short date, or "—" when null. */
export function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-US');
}
