/**
 * SPA navigation helper.
 *
 * Lives in its own module (rather than App.tsx) so any component can navigate
 * without importing the root App — which would create an import cycle. App.tsx
 * re-exports `navigate` for backwards compatibility with existing imports.
 *
 * Routing is intentionally tiny (no router dependency): the app reads
 * window.location.pathname and navigates with history.pushState. pushState does
 * not emit popstate, so we dispatch one to notify listeners.
 */
export function navigate(path: string) {
  window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}
