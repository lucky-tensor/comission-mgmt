/**
 * Forbidden — 403 surface rendered when an authenticated user navigates
 * directly to a route their role is not permitted to access.
 *
 * Displays an explanatory message and a link back to the user's landing page.
 *
 * Canonical docs: docs/prd.md §3 (User Roles)
 * Issue: feat: web app shell — role-based routing, navigation, and per-role
 *        landing (#100)
 */

import type { AppRole } from 'core/auth';
import { Button } from 'ui';
import { landingPathForRole } from '../lib/roleRoutes';

interface ForbiddenProps {
  role: AppRole;
  onNavigate: (path: string) => void;
}

export function Forbidden({ role, onNavigate }: ForbiddenProps) {
  const landing = landingPathForRole(role);

  return (
    <div
      className="min-h-screen bg-surface-muted flex flex-col justify-center items-center p-8"
      data-testid="forbidden-surface"
    >
      <div className="bg-surface p-10 rounded-2xl shadow-sm border border-border text-center max-w-empty w-full">
        <p className="text-2xl font-extrabold text-border-strong mb-2 leading-none">403</p>
        <h1 className="text-xl font-bold text-ink mb-3">Access denied</h1>
        <p className="text-sm text-ink-subtle mb-6">
          You do not have permission to view this page. Your role does not include access to this
          section.
        </p>
        <Button type="button" data-testid="forbidden-back-btn" onClick={() => onNavigate(landing)}>
          Go to my home
        </Button>
      </div>
    </div>
  );
}
