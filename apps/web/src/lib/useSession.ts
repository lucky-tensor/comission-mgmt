/**
 * useSession — fetches the authenticated user's session identity once and
 * makes it available to the whole component tree.
 *
 * Sources the role from GET /me (re-uses apiGet from apiClient — no duplicate
 * fetch logic). The hook is designed to be called once at the root App level
 * and passed down; no component re-fetches independently.
 *
 * Returns:
 *   - `session`  — { user_id, org_id, role } once resolved, null while loading
 *   - `loading`  — true while the request is in flight
 *   - `error`    — non-null if /me returned an unexpected error (not 401)
 *   - `unauthenticated` — true if /me returned 401 (session absent/expired)
 *
 * Canonical docs: docs/prd.md §3 (User Roles)
 * Issue: feat: web app shell — role-based routing, navigation, and per-role
 *        landing (#100)
 */

import { useState, useEffect } from 'react';
import type { AppRole } from 'core/auth';
import { ApiError, apiGet } from './apiClient';

export interface SessionInfo {
  user_id: string;
  org_id: string;
  role: AppRole;
}

export interface UseSessionResult {
  session: SessionInfo | null;
  loading: boolean;
  error: string | null;
  unauthenticated: boolean;
}

export function useSession(): UseSessionResult {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unauthenticated, setUnauthenticated] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setUnauthenticated(false);

    apiGet<SessionInfo>('/me')
      .then((data) => {
        if (active) {
          setSession(data);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!active) return;
        if (err instanceof ApiError && err.status === 401) {
          setUnauthenticated(true);
        } else {
          setError(err instanceof Error ? err.message : 'Failed to load session');
        }
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  return { session, loading, error, unauthenticated };
}
