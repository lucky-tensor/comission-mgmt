/**
 * EntityPicker — a reusable name-based selector that replaces raw UUID inputs.
 *
 * The UX review (docs/ux-review.md §1) found the app repeatedly asked users to
 * type a UUID to navigate — run lookup, placement adjustments, payroll export,
 * producer draw lookup, attribution timeline. No real user knows a UUID. This
 * component renders a <select> populated from a list the user already has
 * (recent runs, placements by client/candidate, producers), surfacing the id
 * only as the option value. It covers loading / error / empty states from the
 * standard AsyncState shape.
 *
 * Pure view: callers pass the options and the current AsyncState; a container
 * does the fetch. Keeps the component browser-testable without a server.
 *
 * Issue: feat: webapp — UX overhaul: entity pickers (#203)
 */

import type { AsyncState } from '../lib/useAsync';
import { LoadingState, ErrorState, EmptyState } from './portal/states';

export interface PickerOption {
  /** Opaque id (e.g. a UUID) used as the option value. */
  id: string;
  /** Human-readable label shown to the user. */
  label: string;
}

export interface EntityPickerProps<T> {
  /** Stable id prefix for the control + its test ids (e.g. "run", "placement"). */
  name: string;
  /** Visible label for the select control. */
  label: string;
  /** Async state holding the list of selectable entities. */
  state: AsyncState<T[]>;
  /** Map a loaded entity to a {id,label} option. */
  toOption: (item: T) => PickerOption;
  /** Currently selected id (or null/empty for none). */
  value: string | null;
  /** Called with the selected id when the user picks an option. */
  onChange: (id: string) => void;
  /** Placeholder text for the empty selection. */
  placeholder?: string;
  /** Message shown when the loaded list is empty. */
  emptyMessage?: string;
}

const LABEL_CLASS = 'block text-sm font-semibold text-ink-muted mb-1.5';

const SELECT_CLASS =
  'w-full px-3 py-2 border border-border-strong rounded-md text-sm bg-surface text-ink';

export function EntityPicker<T>({
  name,
  label,
  state,
  toOption,
  value,
  onChange,
  placeholder = 'Select…',
  emptyMessage = 'Nothing to select yet.',
}: EntityPickerProps<T>) {
  const selectId = `${name}-picker`;

  if (state.loading) {
    return (
      <div data-testid={`${name}-picker-loading`}>
        <LoadingState label={label} />
      </div>
    );
  }
  if (state.error) {
    return (
      <div data-testid={`${name}-picker-error`}>
        <ErrorState message={state.error} />
      </div>
    );
  }
  const items = state.data ?? [];
  if (items.length === 0) {
    return (
      <div data-testid={`${name}-picker-empty`}>
        <EmptyState message={emptyMessage} />
      </div>
    );
  }

  return (
    <div data-testid={`${name}-picker`}>
      <label className={LABEL_CLASS} htmlFor={selectId}>
        {label}
      </label>
      <select
        id={selectId}
        data-testid={`${name}-picker-select`}
        className={SELECT_CLASS}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="" disabled>
          {placeholder}
        </option>
        {items.map((item) => {
          const opt = toOption(item);
          return (
            <option key={opt.id} value={opt.id}>
              {opt.label}
            </option>
          );
        })}
      </select>
    </div>
  );
}
