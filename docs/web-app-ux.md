# Web App UX — Phase Scout

> Scout deliverable for the Web App UX phase (#201).
> Establishes the phase seam and routing contract that the nav cleanup (#198)
> and product docs (#197) issues build on, and that #203 extends.

## Phase

Web App UX

## Scope

This is a **dev-scout**: a stub-only integration pass. It adds **no runtime
behavior**. It verifies the existing app-shell routing infrastructure compiles
and is covered by tests, and documents the one seam every downstream issue in
this phase touches: `apps/web/src/lib/roleRoutes.ts`.

Downstream issues in this phase:

- **#197 — product docs**: will add a docs route / rendering. Must register the
  route via the seam below; the docs route becomes a `ROUTES.*` constant and is
  added to the `permitted` set (and optionally `navItems`) of the roles that may
  see it.
- **#198 — nav cleanup**: will remove/reorder nav entries. Edits only the
  `navItems` arrays. The seam's nav/permitted invariant (enforced by the unit
  test) guarantees a nav entry can never point at a non-permitted path.
- **#203** — extends the same shell; same seam rules apply.

Out of scope for the scout (deferred to the issues above): NavShell styling or
layout changes, real docs content or doc rendering, and removing nav items.

## Canonical docs

- `docs/prd.md` §3 (User Roles) — the role model the routing seam encodes.

## The routing seam — `apps/web/src/lib/roleRoutes.ts`

This module is the **single source of truth** for app-shell routing. No
component re-implements role gating; `NavShell` and the `App.tsx` forbidden-route
guard both import from here.

### Public surface (the contract)

| Export                          | Purpose                                                              |
| ------------------------------- | ------------------------------------------------------------------- |
| `ROUTES`                        | Frozen map of route-path constants. All paths flow from here.       |
| `NavItem`                       | `{ path, label }` — one rendered nav entry.                         |
| `RoleRouteConfig`               | `{ landing, permitted: Set<string>, navItems: NavItem[] }` per role.|
| `ROLE_ROUTES`                   | `Record<AppRole, RoleRouteConfig>` — the role → routes table.       |
| `isPathPermitted(role, path)`   | Guard used by the forbidden-route redirect. Login (`/`) always true.|
| `landingPathForRole(role)`      | Post-login landing path. Falls back to login for unknown roles.     |

### How to add a route for a role (e.g. #197 docs route)

1. Add a constant to `ROUTES`, e.g. `DOCS: '/docs'`.
2. Add `ROUTES.DOCS` to the `permitted` set of every role that may visit it.
3. (Optional) Add `{ path: ROUTES.DOCS, label: 'Docs' }` to those roles'
   `navItems` to surface it in the nav.
4. Mount the route's component in `App.tsx`'s path switch.

Invariants the routing-seam unit tests enforce (`apps/web/tests/roleRoutes.test.ts`):

- A role's `landing` must be in its own `permitted` set.
- Every `navItems[].path` must be in the same role's `permitted` set — so a nav
  entry can never dangle. This is the guard that makes #198's nav edits safe.
- Unknown roles are denied every non-login path and land on login.

### How to remove / reorder nav items (e.g. #198 nav cleanup)

Edit only the `navItems` array of the affected role(s). Removing the **last**
nav entry that referenced a route does **not** remove the route from `permitted`
— that is intentional; a role may still navigate directly to a permitted path
even with no nav button. If a route should become fully inaccessible to a role,
remove it from `permitted` as well (and the invariant test will then flag any
stale nav entry).

## Verification (run on the phase branch)

```bash
bun run build            # apps/web compiles (tsc --noEmit && vite build)
bun run test:webapp-ux   # role routing seam unit tests (node-only, no infra)
bun run test:browser     # app-shell E2E (tests/e2e/app-shell.e2e.ts) — needs Docker/Postgres
```

The app-shell E2E (`tests/e2e/app-shell.e2e.ts`) drives real headless Chromium
against the real API server + ephemeral Postgres and asserts per-role landing
(Finance Admin → `/finance`, Producer → `/portal`). It runs in CI under
`vitest.browser.config.ts` via `test-e2e.yml`.

## Discovered integration points & risks

- **Single seam, multiple writers**: #197 and #198 both edit `roleRoutes.ts`.
  Keep their edits scoped (one adds routes, one edits `navItems`) to minimize
  merge conflicts. The phase branch + this contract exist to coordinate that.
- **`App.tsx` path switch is the second half of the seam**: adding a `ROUTES`
  entry without mounting a component in `App.tsx` yields a permitted-but-blank
  route. Route registration and component mounting must land together.
- **E2E gate is Postgres/Docker-bound**: the app-shell E2E cannot run in the
  node-only suite; it stays in the browser suite. Routing-logic regressions are
  caught faster by `test:webapp-ux`, which needs no infra.
