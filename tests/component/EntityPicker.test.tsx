/**
 * EntityPicker component tests — real headless Chromium (no mocking helpers).
 *
 * The picker is the reusable control that replaces every raw UUID text input
 * (docs/ux-review.md §1, #203). These tests assert it renders a populated
 * <select> from a mocked list response, surfaces ids only as option values,
 * fires onChange with the selected id, and renders loading/error/empty states.
 *
 * Issue: feat: webapp — UX overhaul: entity pickers (#203)
 */

import { describe, test, expect, afterEach } from 'vitest';
import { page } from '@vitest/browser/context';
import { renderInBrowser, type Mounted } from './render';
import { EntityPicker } from '../../apps/web/src/components/EntityPicker';
import type { AsyncState } from '../../apps/web/src/lib/useAsync';

interface Row {
  id: string;
  name: string;
}

let mounted: Mounted | undefined;
afterEach(() => {
  try {
    mounted?.unmount();
  } catch {
    // already removed
  }
  mounted = undefined;
});

function render(state: AsyncState<Row[]>, onChange: (id: string) => void = () => {}) {
  mounted = renderInBrowser(
    <EntityPicker<Row>
      name="thing"
      label="Thing"
      state={state}
      value={null}
      onChange={onChange}
      toOption={(r) => ({ id: r.id, label: r.name })}
      placeholder="Pick one…"
      emptyMessage="Nothing here."
    />,
  );
}

const ROWS: Row[] = [
  { id: 'id-1', name: 'Alpha' },
  { id: 'id-2', name: 'Beta' },
];

describe('EntityPicker', () => {
  test('renders a populated select with option labels (no raw text input)', async () => {
    render({ data: ROWS, loading: false, error: null });
    await expect.element(page.getByTestId('thing-picker-select')).toBeInTheDocument();
    await expect.element(page.getByRole('option', { name: 'Alpha' })).toBeInTheDocument();
    await expect.element(page.getByRole('option', { name: 'Beta' })).toBeInTheDocument();
    // There must be no free-text input in the picker.
    const inputs = mounted!.container.querySelectorAll('input[type="text"]');
    expect(inputs.length).toBe(0);
  });

  test('fires onChange with the selected id', async () => {
    const picked: string[] = [];
    render({ data: ROWS, loading: false, error: null }, (id) => picked.push(id));
    await page.getByTestId('thing-picker-select').selectOptions('id-2');
    expect(picked).toEqual(['id-2']);
  });

  test('renders the loading state', async () => {
    render({ data: null, loading: true, error: null });
    await expect.element(page.getByTestId('thing-picker-loading')).toBeInTheDocument();
  });

  test('renders the error state', async () => {
    render({ data: null, loading: false, error: 'Boom' });
    await expect.element(page.getByTestId('thing-picker-error')).toBeInTheDocument();
    await expect.element(page.getByText('Boom')).toBeInTheDocument();
  });

  test('renders the empty state', async () => {
    render({ data: [], loading: false, error: null });
    await expect.element(page.getByTestId('thing-picker-empty')).toBeInTheDocument();
    await expect.element(page.getByText('Nothing here.')).toBeInTheDocument();
  });
});
