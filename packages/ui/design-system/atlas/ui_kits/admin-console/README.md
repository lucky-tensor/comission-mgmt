# Admin Console — UI kit

A high-fidelity, click-through recreation of the **Atlas** admin product: a
minimalist CRUD console for managing a SaaS workspace.

## Run it
Open `index.html`. It loads the compiled design-system bundle (`_ds_bundle.js`)
and composes the Atlas component primitives — it does **not** re-implement them.

## Screens & flow
- **Dashboard** (`DashboardScreen.jsx`) — KPI stat row, recent sign-ups table, system status panel.
- **Users** (`UsersScreen.jsx`) — the core CRUD list: tabs, search/filter, selectable table, bulk actions, pagination, and an "Invite user" dialog. Click a row → record detail.
- **User detail** (`UserDetailScreen.jsx`) — breadcrumb, identity header, Profile / Permissions / Activity tabs, an editable form with an unsaved-changes banner, and a danger zone.
- **Settings** (`SettingsScreen.jsx`) — sectioned settings nav, workspace form, session-policy toggles, danger zone.

## Architecture
- `kit-lib.jsx` — shared helpers (`Icon` Lucide wrapper, `PageHeader`, `Identity` cell, seed data). Exported to `window`.
- `Shell.jsx` — sidebar + topbar + scroll region.
- `App.jsx` — tiny router over `route` state; mounts to `#root`.

Each script is a separate Babel file sharing scope via `window` assignment.
Icons are **Lucide** (loaded from CDN). Components come from
`window.AtlasDesignSystem_9b7d80`.

> Recreation, not production code: interactions are faked in local state. The
> goal is pixel-level fidelity to the Atlas visual language, not a real backend.
