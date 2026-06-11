# UI / Information Architecture Review

> Expert-designer review of the web app, conducted 2026-06-10 against latest `main`.
> Method: full local stack (ephemeral Postgres + API + Vite), logged in as each of the
> six demo roles, 13 screenshots captured across all role surfaces.

**Overall:** the app has solid bones — role-scoped nav, card-based sections, status chips, good explainability text — but it currently reads as a collection of API test panels stacked on a page rather than a designed product. The issues cluster into five themes, ordered by impact.

## 1. Navigation by UUID — the biggest IA failure

The app repeatedly asks the user to *type a UUID* to get anywhere:

- Finance Home: "Or load an existing run: *Run UUID…*", "Adjustment ledger: *Placement UUID…*", "Payroll export: *Commission run UUID…*", and a commission run is started by pasting **comma-separated placement IDs into a textarea**.
- HR Home: "Enter producer UUID…" to look up a draw balance.
- Manager Team View: "Attribution Timeline" is a bare *Placement ID* input.
- Executive Profitability: the "Client" column literally displays `6908cc9b-23d1-4965-b195-641fbba44c2c` as the client.

No real user knows a UUID. Every one of these should be a picker fed by data the user already has: a list of recent commission runs to click, a placement selector by client/candidate name, a producer dropdown, client display names in analytics. IDs belong in a detail view's metadata line with a copy button, never as the primary navigation input or display label.

## 2. Page composition — full-height sections and duplicate headings

Finance Home (also reused as Executive's "Finance View") stacks four sections with what looks like a full viewport-height of empty space between each — the page is ~7 screens tall with content occupying maybe 25% of it. Worse, two different sections on the same page are both titled **"Finance Admin"**, which describes the *viewer*, not the task.

Recommended structure for Finance Home: a compact single-column (or two-column) layout with task-named sections — "Data Gap Queue", "Commission Runs", "Invoice & Collection Tracking", "Adjustments & Payroll Export" — and a sticky in-page section nav or tabs. Kill the giant vertical gaps (sections appear to have `min-height: 100vh`-ish styling). The Executive dashboard has the same disease: the KPI row is good, then "Escalated Dispute Approval" floats oddly centered three screens down.

## 3. Forms-first instead of data-first

Reconciliation and Exception & Dispute Trends render an empty date-range form and a button. Modern convention is to load the current period immediately and treat the range as a filter chip — the user should land on information, not on a form that gates information. Executive Dashboard and Profitability already do this correctly (defaulted ranges); make Reconciliation and Trends consistent with them.

## 4. Cross-role surface leakage

Confirms what issue #198 already targets, plus one more:

- Manager → "Producer Portal" renders empty payout statements, "No active plan assignment", and a raw red **"Forbidden"** error inside the My Commission Plan card (the console shows 403/404s). This is the worst screen in the app — an error state shipped as navigation.
- FinanceAdmin → "Executive View" duplicates the exec dashboard.
- Executive → "Finance View" renders the *entire* Finance Admin workspace, including "Start a commission run" — an executive should see finance status, not operate the close. Worth deciding whether this stays; if it does, it should be a read-only summary, not the working surface.

## 5. Visual system inconsistencies

- **Leftover template branding:** the browser tab says **"RobotMoney Admin Dapp"**, and the app loads Space Grotesk / JetBrains Mono / Instrument Serif from a previous template. Title should be "Commission Management"; pick one font family deliberately.
- **Brand naming:** "Commission Mgmt" in the nav vs "Commission Management" on login — don't abbreviate in the product shell.
- **Button anarchy:** blue primary, black/dark buttons, a purple "Escalate to tiebreaker", green/red Approve/Reject pills, and a red-outlined "Log out" that reads as an error state. Define one primary, one secondary, one destructive style and apply them; sentence-case labels consistently ("Look Up" vs "Load run" vs "Resolve").
- **Status chip semantics drift:** on Partner view, "Closed" is green while "Collected" is gray — collected money is the positive state. Define a semantic palette (green = paid/complete, amber = held/pending, gray = neutral/closed, red = disputed/blocked) and use it everywhere.
- **Role chip:** header shows the raw enum `FinanceAdmin` / `ExternalPartner`. Show the human label and the persona name ("Jordan Lee · Finance Admin").
- **Inconsistent page width:** Finance content is a narrow ~640px column, Executive metrics are full-bleed 1400px, Producer portal ~880px. Standardize one content container (e.g., max 1100–1200px, consistent padding).
- **Producer credited placements list each lead with "$0.00 net"** and bury the placement identity inside the explanation paragraph (as UUIDs). Lead with client/role name, then amount and a status chip; keep the excellent plain-language explanation as the expandable detail. (The $0 amounts themselves are the seed-data problem #196 fixes.)
- **Login page:** the demo persona grid is good, but the "OR CREATE — username or email + Create" block is dev tooling leaking into the first impression; move it behind the Register tab.

## A note for the E2E console gate

The login page fires two 401s (pre-auth `/me` probes) on every load, and Manager→/portal fires 403/404s. The merged console-error gate (#175) will trip on these once those flows are covered — the session-probe fetch should treat 401 as a normal signed-out response, not let it hit the console.

## Recommended next steps

The Web App UX phase (#201 scout, #197 docs, #198 nav cleanup) is the natural home. #198 already fixes theme 4. Two new issues proposed:

- **(a)** "webapp: design-system pass — branding, typography, button/chip/tokens, page container" covering theme 5 plus the RobotMoney title.
- **(b)** "webapp: replace UUID inputs with entity pickers and data-first defaults" covering themes 1–3, which is the change that will most transform how professional the product feels in a demo.

Plus a third small fix: treat 401 from the session-probe fetch as a normal signed-out response so it never hits the console.

---

# Follow-up: NavShell / menu-system assessment

Verdict: mostly yes on the architecture, no on the rendering. The menu system is one config file (`roleRoutes.ts`) driving everything — that part is genuinely well done. But the NavShell that renders it has real problems.

## What's good (keep this)

- **Single source of truth.** `roleRoutes.ts` defines landing, permitted paths, and nav items per role; `NavShell`, the Forbidden guard, and post-login redirect all consume it. No component re-implements role gating. This is exactly the right pattern and makes #197/#198 one-file changes.
- **Config-driven rendering** with `aria-current="page"`, an `aria-label` on the nav, and per-item test IDs. Active state and accessibility basics are present.

## What's weak

1. **Nav items are `<button>`s, not links** (`NavShell.tsx:99`). They navigate via `pushState` only, so middle-click/Cmd-click to open in a new tab, right-click → copy link, and hover URL preview all don't work. Modern convention is `<a href>` with an intercepted left-click. This is the single most "feels off" thing for users.

2. **Exact-match routing won't survive growth.** Both the active state (`currentPath === item.path`) and the permission check (`permitted.has(path)`) are exact string matches on a `Set`. `/executive/profitability` already exists as a top-level sibling because there's no concept of nesting — any future detail route (`/disputes/:id`, which #199 effectively needs) either gets its own nav entry or breaks both highlighting and gating. There's also no trailing-slash or query-string tolerance. The route map needs prefix matching and a notion of parent/child.

3. **No hierarchy or overflow strategy.** Executive already has four flat top-level items; #197 adds Docs to everyone. A flat row of buttons with no grouping, no overflow menu, and no responsive collapse (fixed flex row — items will just overflow off-screen at narrow widths) doesn't scale past about five items.

4. **Inline styles with a hardcoded palette.** Every style is a `CSSProperties` object with raw hex values inside the component, and there's a `ui` workspace package that NavShell doesn't use. This is why every surface invented its own button styles — there's no shared token layer for the nav to anchor.

5. **Menus deliver to component stacks, not pages.** `App.tsx` renders `/finance` as four components concatenated (`DataGapQueue`, `CommissionRunReview`, `FinanceAdmin`, `FinanceAdminSurface` — two of which are literally both named "Finance Admin" on screen). The nav takes you to a pile, not a designed page. That's the source of the multi-screen whitespace from the visual review: each stacked component brings its own full-page layout.

6. **Small leftovers:** a `console.log` in the redirect effect fires on every render cycle in production (`App.tsx:152`); `return null` during session load and on the post-login frame gives blank-screen flashes instead of a skeleton; the role badge prints the raw enum.

## Verdict

Keep `roleRoutes.ts` as the contract — it's the right IA foundation. Rebuild `NavShell`'s rendering: real anchors, prefix-based active/permitted matching with support for child routes, a sensible cap with grouping/overflow, styles from the `ui` package tokens, and make each route map to one composed page component instead of a stack. That's a contained refactor (NavShell + a routing helper + thin page wrappers) and it slots naturally into the Web App UX phase — #201's scout is literally "document the roleRoutes seam," so this could be specified as part of that phase's work alongside #197/#198.
