/**
 * useAsync — minimal data-fetching hook giving every portal surface explicit
 * loading / error / data states (the three states each component must render).
 *
 * Issue: feat: Producer Portal UI + headless-Chromium browser/E2E harness (#78)
 */

import { useState, useEffect } from 'react';

export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

/**
 * Run an async loader on mount (and whenever `deps` change), tracking
 * loading/error/data. The loader's rejection message becomes `error`.
 */
export function useAsync<T>(loader: () => Promise<T>, deps: unknown[] = []): AsyncState<T> {
  const [state, setState] = useState<AsyncState<T>>({
    data: null,
    loading: true,
    error: null,
  });

  useEffect(() => {
    let active = true;
    setState({ data: null, loading: true, error: null });
    loader()
      .then((data) => {
        if (active) setState({ data, loading: false, error: null });
      })
      .catch((err: unknown) => {
        if (active) {
          const message = err instanceof Error ? err.message : 'Something went wrong';
          setState({ data: null, loading: false, error: message });
        }
      });
    return () => {
      active = false;
    };
  }, deps);

  return state;
}
