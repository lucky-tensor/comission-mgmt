# Atlas Design System

**Atlas** is a design system for **minimalist admin interfaces** — the control
panels, dashboards, and CRUD back-offices that sit behind web apps. It optimizes
for the things admin work actually needs: dense, legible data; fast scanning;
calm, low-chrome surfaces; and forms that get out of the way.

> **Provenance.** This system was authored from a written brief ("a minimalist
> web-app UI for admin controls, mostly CRUD") with **no existing codebase,
> Figma, or brand assets attached.** Everything here — name, palette, type,
> components — is an original system created for that brief. If you have real
> brand assets (logo, fonts, product screens), share them and we'll reconcile.

---

## The product context
Atlas targets the **admin / operator** surface of a SaaS product: managing users,
roles, teams, API keys, billing, and audit logs. The reference product in this
repo is the **Admin Console** UI kit (`ui_kits/admin-console/`), an interactive
recreation of a typical CRUD workspace: dashboard → users list → record detail →
settings.

The locked visual direction is **"Graphite & Ink"** — a near-monochrome system:
a pure-ink (`#0a0a0a`) accent, a crisp cool-neutral gray ramp, and chromatic
color reserved **exclusively** for status (success / danger). No amber, no blue.

There is one product surface (the admin web app). No marketing site, mobile app,
or docs site were specified.

---

## Content fundamentals
How Atlas writes UI copy:

- **Voice: plain, direct, operator-to-operator.** Short labels, verbs first.
  "Invite user", "Save changes", "Delete workspace" — not "Click here to add a
  new user to your team".
- **Person.** Address the admin as **you** ("You have unsaved changes"). Refer to
  records in the third person ("This user's access").
- **Casing.** **Sentence case** everywhere — buttons, headers, menu items
  ("Invite user", not "Invite User"). The only uppercase is the tracked
  **overline** label (`.atlas-overline`) used for section eyebrows and table
  headers.
- **Tone.** Calm and factual. Warnings state consequences plainly ("Deleting a
  workspace is permanent. All users, records, and API keys will be removed
  immediately."). No hype, no exclamation marks.
- **Numbers & IDs** are first-class: shown in mono with tabular figures
  (`usr_8Kp2`, `1.2M`, `142ms`, `$12,480.00`).
- **No emoji.** Status is communicated with dot-badges and color, never emoji.
- **Empty/error states** are specific and actionable ("No users match this
  filter", "3 fields need attention"), never cute.

Examples in use: `Invite user` · `12 selected` · `Unsaved changes — Save your
edits before leaving this page.` · `Operational · 142ms`.

---

## Visual foundations
The Atlas look in one line: **flat, border-first, ink-and-paper, dense but
breathable.**

- **Color.** A crisp **cool-neutral gray ramp** (`--gray-0…950`, hue ~232°) does
  almost all the work. The accent is **ink** (`--accent` = `#0a0a0a`, near-black)
  — there is no chromatic accent. Interactive state, links, the focus ring,
  selected rows, and the **primary action** all render as ink, so the UI stays
  calm and architectural. **Chromatic color is reserved entirely for status:**
  a clean emerald (`--status-success`) and a true crimson (`--status-danger`).
  Everything else — "pending", "paused", "beta", "degraded" — uses neutral gray.
  **There is no amber and no blue in the system.**
- **Type.** One family: **Geist** for all UI and display, **Geist Mono** for
  data, IDs, metrics, code. Tight negative tracking on headings
  (`--tracking-tight`), tabular figures on anything numeric. Scale runs small and
  dense (body 14px; table cells 13px; meta 12px).
- **Spacing.** 4px base grid (`--space-*`). Controls are tight (34px default
  height); pages breathe via a centered 1200px max width and 24px gutter.
- **Backgrounds.** Plain surfaces only — `--surface-page` (gray-50) behind
  `--surface-card` (white). **No gradients, no images, no textures, no
  illustration.** The page is quiet so the data is loud.
- **Borders over shadows.** The system is deliberately flat. A **1px border**
  (`--border-default`) defines every card, input, and table. **Shadows are
  reserved for genuinely floating layers** — menus (`--shadow-sm`), popovers
  (`--shadow-md`), dialogs (`--shadow-lg`). Resting cards have no shadow.
- **Corner radii.** Sharp and architectural: `xs/2` chips & badges, `sm/3`
  inputs & buttons, `md/4` cards & menus, `lg/6` dialogs. Only true pills
  (switches, avatars, count chips) use `--radius-full`. Atlas favors crisp edges
  over softness.
- **Hover states.** Surfaces lighten to `--surface-hover`; ghost/secondary
  buttons fill with a subtle gray; primary buttons (ink) go one step darker.
  Table rows tint to `--surface-hover` on hover, ink-tinted (`--accent-soft`)
  when selected.
- **Press / active.** Buttons step to a darker shade (no scale/shrink). Nav items
  settle on `--surface-active`.
- **Focus.** A 3px ink ring (`--ring-focus`) on `:focus-visible`; danger fields
  use `--ring-danger`. Always visible, never removed. Native form controls
  (`input`/`select`/`textarea`) suppress the global ring — their wrapper draws a
  single ring, so there's never a double outline.
- **Animation.** Minimal and quick — 120ms ease on color/background transitions.
  The only spring is the Switch knob (a soft overshoot). Dialogs fade + rise
  160ms. No looping, bouncing, or decorative motion. Respect reduced-motion.
- **Transparency / blur.** Used once: the dialog overlay (`rgba(14,16,22,0.45)`
  + 2px backdrop blur). Otherwise surfaces are opaque.
- **Cards.** White, 1px `--border-default`, `md` radius, no shadow, optional
  header (title + subtitle + right-aligned actions) divided by a subtle border.
- **Imagery vibe.** N/A by design — Atlas ships no photography or illustration.
  Identity is carried by the wordmark, the dot-badge status language, and mono
  data formatting.

---

## Iconography
- **Library: [Lucide](https://lucide.dev).** Consistent ~1.5–1.7px stroke,
  rounded joins — it matches Atlas's thin, geometric line language exactly.
- **Delivery: CDN.** Loaded via `https://unpkg.com/lucide` in cards and the UI
  kit (`lucide.createIcons()`), wrapped by a small React `Icon` helper in
  `ui_kits/admin-console/kit-lib.jsx`. No icon binaries are vendored into
  `assets/`.
- **Sizing.** 16px inside controls and table rows; 18px standalone. Icons inherit
  `currentColor` and sit at `--text-tertiary` until active.
- **No emoji, no unicode glyphs as icons.** Status uses colored dot-badges.
- **Substitution flag:** Lucide is an original, MIT-licensed match for the brief —
  not a substitute for a specified set. Swap freely if you adopt another line set
  at the same weight.
- See `guidelines/iconography.card.html` for the working sample set.

---

## Fonts — substitution flag
Geist and Geist Mono are loaded from **Google Fonts CDN** (`tokens/fonts.css`),
not vendored as `.woff2`. The compiler therefore reports **0 local @font-face**
rules — this is expected. If you need self-hosted binaries (offline builds,
strict CSP), send the `.woff2` files and we'll swap the `@import` for local
`@font-face` rules. If Geist isn't your intended typeface, name your house font
and we'll re-point the tokens.

---

## Index — what's in this project
**Foundations**
- `styles.css` — the one file consumers link. `@import`s everything below.
- `tokens/` — `colors.css`, `typography.css`, `spacing.css`, `radius.css`,
  `shadows.css`, `fonts.css`, `base.css`.
- `guidelines/*.card.html` — foundation specimen cards (Colors, Type, Spacing,
  Brand) shown in the Design System tab.
- `assets/` — `atlas-mark.svg` (primary mark), `atlas-mark-outline.svg`.

**Components** (`components/<group>/` — React primitives + `.d.ts` + `.prompt.md` + card)
- `forms/` — Button, IconButton, Input, Textarea, Select, Checkbox, Switch
- `data-display/` — Badge, Avatar, Card, Table, StatCard
- `feedback/` — Banner, Tooltip, Dialog, Toast
- `navigation/` — Tabs, Breadcrumb, Pagination

**UI kit** (`ui_kits/admin-console/`)
- Interactive Admin Console: Dashboard, Users, User detail, Settings. See its
  own `README.md`.

**Skill**
- `SKILL.md` — makes this system usable as a downloadable Claude skill.

---

## Using the system
Consumers link one file and read components off the namespace:
```html
<link rel="stylesheet" href="styles.css" />
<script src="_ds_bundle.js"></script>
<script>
  const { Button, Table, Badge } = window.AtlasDesignSystem_9b7d80;
</script>
```
Reference **semantic tokens** (`--accent`, `--surface-card`, `--text-tertiary`,
`--status-success`), not raw ramp values, in product code. Avatars and other
identity chips stay within the neutral ramp to preserve the monochrome feel.
