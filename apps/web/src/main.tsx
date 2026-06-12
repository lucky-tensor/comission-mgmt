/**
 * Commission Management frontend entry point.
 *
 * Phase 1 Foundation: blank React shell — UI implemented in later issues.
 * Canonical docs: docs/architecture.md — Phase 1 Foundation
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

const root = document.getElementById('root');
if (!root) {
  throw new Error('Root element not found');
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
