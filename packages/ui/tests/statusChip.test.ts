/**
 * StatusChip semantic mapping — unit tests (#203).
 *
 * Pins the one semantic palette every surface must use (docs/ux-review.md §5),
 * fixing the chip-color drift the review found (e.g. "Collected" rendering gray
 * instead of green):
 *
 *   green = paid/complete, amber = held/pending, gray = neutral/closed,
 *   red   = disputed/blocked
 *
 * Pure logic test — no DOM. Run: `bun run test:ui`
 */

import { describe, test, expect } from 'vitest';
import { statusVariant, type StatusVariant } from '../StatusChip';

describe('statusVariant — semantic status→variant mapping', () => {
  const cases: [string, StatusVariant][] = [
    // green — paid / complete
    ['paid', 'green'],
    ['complete', 'green'],
    ['completed', 'green'],
    ['collected', 'green'],
    ['approved', 'green'],
    ['finalized', 'green'],
    // amber — held / pending
    ['held', 'amber'],
    ['pending', 'amber'],
    ['draft', 'amber'],
    ['open', 'amber'],
    // gray — neutral / closed
    ['closed', 'gray'],
    ['neutral', 'gray'],
    // red — disputed / blocked
    ['disputed', 'red'],
    ['blocked', 'red'],
    ['rejected', 'red'],
    ['overdue', 'red'],
  ];

  for (const [status, variant] of cases) {
    test(`${status} → ${variant}`, () => {
      expect(statusVariant(status)).toBe(variant);
    });
  }

  test('matching is case-insensitive and trims whitespace', () => {
    expect(statusVariant('  PAID ')).toBe('green');
    expect(statusVariant('Disputed')).toBe('red');
    expect(statusVariant('HELD')).toBe('amber');
  });

  test('unknown statuses fall back to the neutral (gray) variant', () => {
    expect(statusVariant('something-unmapped')).toBe('gray');
    expect(statusVariant('')).toBe('gray');
  });
});
