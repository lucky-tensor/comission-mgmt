/**
 * AttributionTimeline component tests — real headless Chromium (no mocking helpers).
 *
 * Tests render the pure presentational view (`AttributionTimelineView`) in each
 * state with in-test data. No network mock, no Vitest mocking helpers.
 * The search callback is a real async function provided by the test.
 *
 * States exercised:
 *   - idle        — initial state before any search
 *   - loading     — timeline fetch in-flight
 *   - error       — fetch failure
 *   - empty       — no events for the placement
 *   - timeline    — ordered event list: Submitted, Approved, Rejected with reason
 *
 * Canonical docs: docs/prd.md §4 (Manager), §5.2
 * Issue: feat: Manager UI — split approval and attribution timeline (#107)
 */

import { describe, test, expect, afterEach } from 'vitest';
import { page } from '@vitest/browser/context';
import { renderInBrowser, type Mounted } from './render';
import {
  AttributionTimelineView,
  type AttributionTimelineViewProps,
  type AttributionEvent,
} from '../../apps/web/src/components/manager/AttributionTimeline';

let mounted: Mounted | undefined;
afterEach(() => mounted?.unmount());

// ---------------------------------------------------------------------------
// Test data helpers
// ---------------------------------------------------------------------------

function makeEvent(overrides: Partial<AttributionEvent> = {}): AttributionEvent {
  return {
    id: 'ae-0000-0001',
    placement_id: 'pl-0000-0001',
    event_type: 'Submitted',
    actor_id: 'user-0000-0001',
    reason: null,
    created_at: '2025-04-10T09:00:00.000Z',
    ...overrides,
  };
}

const SAMPLE_PLACEMENTS = [
  { id: 'pl-0000-0001', job_title: 'Staff Engineer', candidate_name: 'Riley Chen' },
  { id: 'pl-0000-0002', job_title: 'VP Sales', candidate_name: 'Sam Ortiz' },
];

function defaultProps(): AttributionTimelineViewProps {
  return {
    placementId: '',
    // Populated by default so the picker is not in its own empty-state (which
    // would collide with the timeline's empty-state in the phase tests below).
    placements: { data: SAMPLE_PLACEMENTS, loading: false, error: null },
    phase: { kind: 'idle' },
    onSearch: () => {},
  };
}

// ---------------------------------------------------------------------------
// Idle state — placement picker, no free-text UUID input
// ---------------------------------------------------------------------------

describe('AttributionTimelineView — idle state', () => {
  test('renders a placement picker select (not a free-text UUID input)', async () => {
    mounted = renderInBrowser(
      <AttributionTimelineView
        {...defaultProps()}
        placements={{ data: SAMPLE_PLACEMENTS, loading: false, error: null }}
      />,
    );

    await expect.element(page.getByTestId('attribution-timeline')).toBeInTheDocument();
    await expect.element(page.getByTestId('timeline-search-form')).toBeInTheDocument();
    await expect.element(page.getByTestId('placement-picker-select')).toBeInTheDocument();
    await expect.element(page.getByTestId('timeline-idle')).toBeInTheDocument();

    // No raw UUID text input remains.
    expect(page.getByTestId('placement-id-input').elements()).toHaveLength(0);
    expect(page.getByTestId('search-timeline-btn').elements()).toHaveLength(0);
  });

  test('the picker is populated from the placements list, labelled by role/candidate', async () => {
    mounted = renderInBrowser(
      <AttributionTimelineView
        {...defaultProps()}
        placements={{ data: SAMPLE_PLACEMENTS, loading: false, error: null }}
      />,
    );
    await expect
      .element(page.getByRole('option', { name: 'Staff Engineer — Riley Chen' }))
      .toBeInTheDocument();
  });

  test('selecting a placement calls onSearch with its id', async () => {
    const calls: string[] = [];
    mounted = renderInBrowser(
      <AttributionTimelineView
        {...defaultProps()}
        placements={{ data: SAMPLE_PLACEMENTS, loading: false, error: null }}
        onSearch={(id) => calls.push(id)}
      />,
    );
    await page.getByTestId('placement-picker-select').selectOptions('pl-0000-0002');
    expect(calls).toEqual(['pl-0000-0002']);
  });
});

// ---------------------------------------------------------------------------
// Loading state
// ---------------------------------------------------------------------------

describe('AttributionTimelineView — loading state', () => {
  test('renders the loading state', async () => {
    mounted = renderInBrowser(
      <AttributionTimelineView {...defaultProps()} phase={{ kind: 'loading' }} />,
    );

    await expect.element(page.getByTestId('loading-state')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Error state
// ---------------------------------------------------------------------------

describe('AttributionTimelineView — error state', () => {
  test('renders the error state with message', async () => {
    mounted = renderInBrowser(
      <AttributionTimelineView
        {...defaultProps()}
        phase={{ kind: 'error', message: 'Placement not found' }}
      />,
    );

    await expect.element(page.getByTestId('error-state')).toBeInTheDocument();
    await expect.element(page.getByText('Placement not found')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

describe('AttributionTimelineView — empty state', () => {
  test('renders the empty state message', async () => {
    mounted = renderInBrowser(
      <AttributionTimelineView {...defaultProps()} phase={{ kind: 'empty' }} />,
    );

    await expect.element(page.getByTestId('empty-state')).toBeInTheDocument();
    await expect
      .element(page.getByText('No attribution events recorded for this placement.'))
      .toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Timeline state
// ---------------------------------------------------------------------------

describe('AttributionTimelineView — timeline state', () => {
  test('renders ordered events in the timeline', async () => {
    const events: AttributionEvent[] = [
      makeEvent({ id: 'ae-0001', event_type: 'Submitted', actor_id: 'user-0001' }),
      makeEvent({
        id: 'ae-0002',
        event_type: 'Rejected',
        actor_id: 'manager-0001',
        reason: 'Splits incorrect',
      }),
      makeEvent({ id: 'ae-0003', event_type: 'Submitted', actor_id: 'user-0001' }),
      makeEvent({ id: 'ae-0004', event_type: 'Approved', actor_id: 'manager-0001' }),
    ];

    mounted = renderInBrowser(
      <AttributionTimelineView {...defaultProps()} phase={{ kind: 'timeline', events }} />,
    );

    await expect.element(page.getByTestId('timeline-events')).toBeInTheDocument();
    await expect.element(page.getByTestId('timeline-event-ae-0001')).toBeInTheDocument();
    await expect.element(page.getByTestId('timeline-event-ae-0002')).toBeInTheDocument();
    await expect.element(page.getByTestId('timeline-event-ae-0003')).toBeInTheDocument();
    await expect.element(page.getByTestId('timeline-event-ae-0004')).toBeInTheDocument();
  });

  test('renders event type labels for each event', async () => {
    const events: AttributionEvent[] = [
      makeEvent({ id: 'ae-0001', event_type: 'Submitted' }),
      makeEvent({ id: 'ae-0002', event_type: 'Approved' }),
    ];

    mounted = renderInBrowser(
      <AttributionTimelineView {...defaultProps()} phase={{ kind: 'timeline', events }} />,
    );

    await expect
      .element(page.getByTestId('event-type-ae-0001'))
      .toHaveTextContent('Submitted for approval');
    await expect.element(page.getByTestId('event-type-ae-0002')).toHaveTextContent('Approved');
  });

  test('renders rejection reason when present', async () => {
    const events: AttributionEvent[] = [
      makeEvent({ id: 'ae-0001', event_type: 'Rejected', reason: 'Split totals exceed 100%' }),
    ];

    mounted = renderInBrowser(
      <AttributionTimelineView {...defaultProps()} phase={{ kind: 'timeline', events }} />,
    );

    await expect.element(page.getByTestId('event-reason-ae-0001')).toBeInTheDocument();
    await expect.element(page.getByText(/Split totals exceed 100%/)).toBeInTheDocument();
  });

  test('does not render reason element when reason is null', async () => {
    const events: AttributionEvent[] = [
      makeEvent({ id: 'ae-0001', event_type: 'Submitted', reason: null }),
    ];

    mounted = renderInBrowser(
      <AttributionTimelineView {...defaultProps()} phase={{ kind: 'timeline', events }} />,
    );

    await expect.element(page.getByTestId('timeline-event-ae-0001')).toBeInTheDocument();
    await expect.element(page.getByTestId('event-reason-ae-0001')).not.toBeInTheDocument();
  });

  test('renders a single event with no connector line', async () => {
    const events: AttributionEvent[] = [makeEvent({ id: 'ae-0001', event_type: 'Approved' })];

    mounted = renderInBrowser(
      <AttributionTimelineView {...defaultProps()} phase={{ kind: 'timeline', events }} />,
    );

    await expect.element(page.getByTestId('timeline-events')).toBeInTheDocument();
    await expect.element(page.getByTestId('timeline-event-ae-0001')).toBeInTheDocument();
  });
});
