import { afterEach, describe, expect, test } from 'vitest';
import { page } from '@vitest/browser/context';
import { PlacementLedger } from '../../apps/web/src/components/placements/PlacementLedger';
import { renderInBrowser, type Mounted } from './render';

let mounted: Mounted | undefined;

afterEach(() => {
  try {
    mounted?.unmount();
  } catch {
    // already removed
  }
  mounted = undefined;
});

describe('PlacementLedger role surface', () => {
  test('Finance Admin sees the create action and sortable ledger columns', async () => {
    mounted = renderInBrowser(
      <PlacementLedger
        role="FinanceAdmin"
        load={() => Promise.resolve({ editable: true, placements: [] })}
      />,
    );

    await expect
      .element(page.getByRole('heading', { name: 'Placement Ledger' }))
      .toBeInTheDocument();
    await expect.element(page.getByRole('button', { name: 'New placement' })).toBeInTheDocument();
    for (const column of ['customer', 'status', 'billing', 'producers']) {
      await expect
        .element(page.getByRole('button', { name: new RegExp(column, 'i') }))
        .toBeInTheDocument();
    }
  });

  test('read-only roles do not see the create action', async () => {
    mounted = renderInBrowser(
      <PlacementLedger
        role="Executive"
        load={() => Promise.resolve({ editable: false, placements: [] })}
      />,
    );

    await expect
      .element(page.getByRole('heading', { name: 'Placement Ledger' }))
      .toBeInTheDocument();
    expect(mounted.container.textContent).not.toContain('New placement');
  });
});
