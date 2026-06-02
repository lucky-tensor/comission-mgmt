/**
 * PayrollExport component tests — real headless Chromium (no mocking helpers).
 *
 * Tests drive the real component against controlled state via the pure-view
 * PayrollExportView. Server-side behaviour (generate + list) is exercised in
 * the E2E test; here we verify the component renders every UI state correctly.
 *
 * Covered:
 *   - AC#1: Approved run shows the generate button; disabled/gated for non-approved.
 *   - AC#2: Non-approved run renders the gated state with the gating reason.
 *   - AC#3: Export list renders after generation (download link targets the resource).
 *   - AC#4: Loading / empty / error states render.
 *   - AC#5: No Vitest mocking helpers are used (TEST-C-001).
 *
 * No Vitest mocking helpers are used.
 *
 * Canonical docs: docs/prd.md §5.7 — Payroll Export
 * Issue: feat: Finance Admin UI — payroll-ready export (#105)
 */

import { describe, test, expect, afterEach } from 'vitest';
import { page } from '@vitest/browser/context';
import { renderInBrowser, type Mounted } from './render';
import {
  PayrollExportView,
  type ExportArtifact,
  type PayrollExportViewProps,
} from '../../apps/web/src/components/finance/PayrollExport';

let mounted: Mounted | undefined;
afterEach(() => {
  try {
    mounted?.unmount();
  } catch {
    // component may have already been removed
  }
  mounted = undefined;
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const RUN_ID = 'run-00000000-0000-0000-0000-000000000001';

const APPROVED_ARTIFACT: ExportArtifact = {
  artifact_id: 'art-00000000-0000-0000-0000-000000000001',
  run_id: RUN_ID,
  format: 'csv',
  row_count: 3,
  created_at: '2025-05-01T10:00:00.000Z',
};

function renderView(props: Partial<PayrollExportViewProps> = {}) {
  const defaults: PayrollExportViewProps = {
    runId: RUN_ID,
    runApproved: true,
    gatingReason: undefined,
    exportsState: { data: [], loading: false, error: null },
    generating: false,
    generateError: null,
    onGenerate: () => {},
  };
  mounted = renderInBrowser(<PayrollExportView {...defaults} {...props} />);
}

// ---------------------------------------------------------------------------
// AC#1 — Approved run shows the generate button
// ---------------------------------------------------------------------------

describe('PayrollExportView — approved run', () => {
  test('renders the generate export button when run is Approved', async () => {
    renderView({ runApproved: true });
    await expect.element(page.getByTestId('generate-export-button')).toBeInTheDocument();
    expect(page.getByTestId('export-gated').elements()).toHaveLength(0);
  });

  test('button is disabled while generating', async () => {
    renderView({ runApproved: true, generating: true });
    const btn = page.getByTestId('generate-export-button');
    await expect.element(btn).toBeInTheDocument();
    await expect.element(btn).toBeDisabled();
    await expect.element(btn).toHaveTextContent('Generating…');
  });

  test('calls onGenerate when the button is clicked', async () => {
    let called = false;
    renderView({
      runApproved: true,
      onGenerate: () => {
        called = true;
      },
    });
    await page.getByTestId('generate-export-button').click();
    expect(called).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC#2 — Non-approved run renders gated state
// ---------------------------------------------------------------------------

describe('PayrollExportView — non-approved run', () => {
  test('renders the gated state instead of the button', async () => {
    renderView({
      runApproved: false,
      gatingReason:
        "This run is in 'Draft' status — it must be Approved before a payroll export can be generated.",
    });
    await expect.element(page.getByTestId('export-gated')).toBeInTheDocument();
    expect(page.getByTestId('generate-export-button').elements()).toHaveLength(0);
  });

  test('gated state contains the gating reason text', async () => {
    renderView({
      runApproved: false,
      gatingReason: "This run is in 'Pending' status — it must be Approved first.",
    });
    await expect
      .element(page.getByText("This run is in 'Pending' status — it must be Approved first."))
      .toBeInTheDocument();
  });

  test('renders fallback gating reason when none provided', async () => {
    renderView({ runApproved: false, gatingReason: undefined });
    await expect
      .element(
        page.getByText('This run must be Approved before a payroll export can be generated.'),
      )
      .toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// AC#3 — Download link targets the export resource
// ---------------------------------------------------------------------------

describe('PayrollExportView — exports list with download links', () => {
  test('renders the exports list when artifacts are available', async () => {
    renderView({
      exportsState: { data: [APPROVED_ARTIFACT], loading: false, error: null },
    });
    await expect.element(page.getByTestId('exports-list')).toBeInTheDocument();
  });

  test('download link href targets the export artifact resource', async () => {
    renderView({
      exportsState: { data: [APPROVED_ARTIFACT], loading: false, error: null },
    });
    const link = page.getByTestId(`download-link-${APPROVED_ARTIFACT.artifact_id}`);
    await expect.element(link).toBeInTheDocument();
    const href = await link.element()?.getAttribute('href');
    expect(href).toContain(
      `/api/commission-runs/${RUN_ID}/exports/${APPROVED_ARTIFACT.artifact_id}/download`,
    );
  });

  test('renders row_count and format label', async () => {
    renderView({
      exportsState: { data: [APPROVED_ARTIFACT], loading: false, error: null },
    });
    await expect.element(page.getByText('CSV export')).toBeInTheDocument();
    await expect.element(page.getByText('3 rows')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// AC#4 — Loading / empty / error states
// ---------------------------------------------------------------------------

describe('PayrollExportView — export list states', () => {
  test('renders the loading state', async () => {
    renderView({
      exportsState: { data: null, loading: true, error: null },
    });
    await expect.element(page.getByTestId('loading-state')).toBeInTheDocument();
  });

  test('renders the empty state when no exports exist', async () => {
    renderView({
      exportsState: { data: [], loading: false, error: null },
    });
    await expect.element(page.getByTestId('empty-state')).toBeInTheDocument();
    await expect.element(page.getByText('No exports generated yet.')).toBeInTheDocument();
  });

  test('renders the error state when the list load fails', async () => {
    renderView({
      exportsState: { data: null, loading: false, error: 'Failed to load exports' },
    });
    await expect.element(page.getByTestId('error-state')).toBeInTheDocument();
    await expect.element(page.getByText('Failed to load exports')).toBeInTheDocument();
  });

  test('renders generate-error alert when export generation fails', async () => {
    renderView({
      runApproved: true,
      generateError: 'Cannot export a run in status Draft — run must be Approved',
    });
    await expect.element(page.getByTestId('generate-error')).toBeInTheDocument();
    await expect
      .element(page.getByText('Cannot export a run in status Draft — run must be Approved'))
      .toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Structural assertion — export-generate-section always rendered
// ---------------------------------------------------------------------------

describe('PayrollExportView — structural', () => {
  test('export-generate-section is always present', async () => {
    renderView({ runApproved: true });
    await expect.element(page.getByTestId('export-generate-section')).toBeInTheDocument();
  });

  test('exports-list-section is always present', async () => {
    renderView({ runApproved: false });
    await expect.element(page.getByTestId('exports-list-section')).toBeInTheDocument();
  });
});
