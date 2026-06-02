/**
 * PayrollExport — Finance Admin surface for generating and downloading
 * payroll-ready export artifacts from an approved commission run.
 *
 * Behaviour:
 *   - For an Approved run: shows "Generate Export" button, issues
 *     POST /commission-runs/:id/export, then refreshes the export list.
 *   - For a non-Approved run: renders a disabled control with a gating reason.
 *   - Lists all prior exports from GET /commission-runs/:id/exports.
 *   - Provides a download link per export (targets the artifact content).
 *
 * Pure view + container split:
 *   - PayrollExportView — presentational; accepts all state as props.
 *   - PayrollExport      — container; fetches & drives state.
 *
 * No Vitest mocking helpers are used (TEST-C-001 compliance).
 *
 * Canonical docs: docs/prd.md §5.7 — Payroll Export
 * Issue: feat: Finance Admin UI — payroll-ready export (#105)
 */

import { useState } from 'react';
import { apiGet, apiPost, ApiError } from '../../lib/apiClient';
import { useAsync, type AsyncState } from '../../lib/useAsync';
import { PortalCard, LoadingState, ErrorState, EmptyState } from '../portal/states';

// ---------------------------------------------------------------------------
// API response types
// ---------------------------------------------------------------------------

export interface ExportArtifact {
  artifact_id: string;
  run_id: string;
  format: string;
  row_count: number;
  created_at: string;
}

export interface ExportArtifactWithContent extends ExportArtifact {
  content: string;
}

export interface ExportsListResponse {
  run_id: string;
  exports: ExportArtifact[];
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const rowStyle: React.CSSProperties = {
  padding: '0.75rem 0',
  borderBottom: '1px solid #f3f4f6',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
};

const buttonStyle: React.CSSProperties = {
  padding: '0.5rem 1.25rem',
  borderRadius: '0.375rem',
  border: 'none',
  cursor: 'pointer',
  fontWeight: 600,
  fontSize: '0.875rem',
};

const primaryButton: React.CSSProperties = {
  ...buttonStyle,
  background: '#2563eb',
  color: '#ffffff',
};

const disabledButton: React.CSSProperties = {
  ...buttonStyle,
  background: '#e5e7eb',
  color: '#9ca3af',
  cursor: 'not-allowed',
};

// ---------------------------------------------------------------------------
// PayrollExportView — pure presentational component
// ---------------------------------------------------------------------------

export interface PayrollExportViewProps {
  runId: string;
  /** Whether the run is Approved and eligible for export. */
  runApproved: boolean;
  /** Human-readable reason export is disabled (non-approved state). */
  gatingReason?: string;
  /** Current list of exports (loading/error/data). */
  exportsState: AsyncState<ExportArtifact[]>;
  /** True while a POST /export is in flight. */
  generating: boolean;
  /** Error from a failed POST /export, if any. */
  generateError: string | null;
  /** Callback to trigger export generation. */
  onGenerate: () => void;
}

export function PayrollExportView({
  runApproved,
  gatingReason,
  exportsState,
  generating,
  generateError,
  onGenerate,
}: PayrollExportViewProps) {
  return (
    <PortalCard title="Payroll Export">
      {/* Generate export control */}
      <div data-testid="export-generate-section" style={{ marginBottom: '1.25rem' }}>
        {runApproved ? (
          <button
            data-testid="generate-export-button"
            style={generating ? disabledButton : primaryButton}
            disabled={generating}
            onClick={onGenerate}
          >
            {generating ? 'Generating…' : 'Generate Payroll Export'}
          </button>
        ) : (
          <div
            data-testid="export-gated"
            style={{
              padding: '0.75rem 1rem',
              background: '#fefce8',
              border: '1px solid #fde68a',
              borderRadius: '0.5rem',
              fontSize: '0.875rem',
              color: '#92400e',
            }}
          >
            <strong>Export unavailable.</strong>{' '}
            {gatingReason ?? 'This run must be Approved before a payroll export can be generated.'}
          </div>
        )}

        {/* Error from generate attempt */}
        {generateError && (
          <div
            data-testid="generate-error"
            role="alert"
            style={{
              marginTop: '0.75rem',
              padding: '0.75rem 1rem',
              background: '#fef2f2',
              border: '1px solid #fca5a5',
              borderRadius: '0.5rem',
              fontSize: '0.875rem',
              color: '#b91c1c',
            }}
          >
            {generateError}
          </div>
        )}
      </div>

      {/* Export list */}
      <div data-testid="exports-list-section">
        {exportsState.loading ? (
          <LoadingState label="exports" />
        ) : exportsState.error ? (
          <ErrorState message={exportsState.error} />
        ) : !exportsState.data || exportsState.data.length === 0 ? (
          <EmptyState message="No exports generated yet." />
        ) : (
          <ul data-testid="exports-list" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {exportsState.data.map((artifact) => (
              <li key={artifact.artifact_id} style={rowStyle}>
                <div>
                  <span style={{ fontWeight: 500, color: '#111827', fontSize: '0.875rem' }}>
                    {artifact.format.toUpperCase()} export
                  </span>
                  <span style={{ marginLeft: '0.75rem', fontSize: '0.75rem', color: '#6b7280' }}>
                    {artifact.row_count} row{artifact.row_count !== 1 ? 's' : ''}
                  </span>
                  <span style={{ marginLeft: '0.75rem', fontSize: '0.75rem', color: '#9ca3af' }}>
                    {new Date(artifact.created_at).toLocaleString()}
                  </span>
                </div>
                <a
                  data-testid={`download-link-${artifact.artifact_id}`}
                  href={`/api/commission-runs/${artifact.run_id}/exports/${artifact.artifact_id}/download`}
                  download={`payroll-export-${artifact.artifact_id}.csv`}
                  style={{ fontSize: '0.875rem', color: '#2563eb', textDecoration: 'none' }}
                >
                  Download
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </PortalCard>
  );
}

// ---------------------------------------------------------------------------
// PayrollExport — container component
// ---------------------------------------------------------------------------

export interface PayrollExportProps {
  runId: string;
  /**
   * The current status of the commission run. When not 'Approved', the export
   * control is disabled with an explanatory message.
   */
  runStatus: string;
}

export function PayrollExport({ runId, runStatus }: PayrollExportProps) {
  const [refreshKey, setRefreshKey] = useState(0);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  const exportsState = useAsync<ExportArtifact[]>(
    () => apiGet<ExportsListResponse>(`/commission-runs/${runId}/exports`).then((r) => r.exports),
    [runId, refreshKey],
  );

  const runApproved = runStatus === 'Approved';
  const gatingReason = runApproved
    ? undefined
    : `This run is in '${runStatus}' status — it must be Approved before a payroll export can be generated.`;

  async function handleGenerate() {
    if (!runApproved || generating) return;
    setGenerating(true);
    setGenerateError(null);
    try {
      await apiPost<ExportArtifactWithContent>(`/commission-runs/${runId}/export`, {});
      setRefreshKey((k) => k + 1);
    } catch (err: unknown) {
      const msg =
        err instanceof ApiError ? err.message : 'Failed to generate export. Please try again.';
      setGenerateError(msg);
    } finally {
      setGenerating(false);
    }
  }

  return (
    <PayrollExportView
      runId={runId}
      runApproved={runApproved}
      gatingReason={gatingReason}
      exportsState={exportsState}
      generating={generating}
      generateError={generateError}
      onGenerate={() => void handleGenerate()}
    />
  );
}
