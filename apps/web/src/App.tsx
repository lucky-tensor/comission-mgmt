/**
 * Root application component.
 *
 * Phase 1 Foundation: blank shell — product UI implemented in later issues.
 * Canonical docs: docs/architecture.md — Phase 1 Foundation
 */

export default function App() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        fontFamily: 'system-ui, sans-serif',
        color: '#374151',
      }}
    >
      <div style={{ textAlign: 'center' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 600, marginBottom: '0.5rem' }}>
          Commission Management
        </h1>
        <p style={{ color: '#6b7280' }}>Platform scaffolding complete — UI coming soon.</p>
      </div>
    </div>
  );
}
