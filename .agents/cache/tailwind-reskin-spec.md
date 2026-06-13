# Tailwind reskin — conversion spec (authoritative)

We are migrating the web app from inline `CSSProperties` to **Tailwind v4** utility
classes driven by an `@theme` in `apps/web/src/index.css`. Goal: uniform styles, the
Geist font (already wired globally), and a **reduced slate near-monochrome palette**.

Convert every assigned `.tsx` file: replace `style={{…}}` with `className="…"`, map all
hardcoded colors to the theme tokens below, and adopt the shared `Button`/`StatusChip`.

## Theme tokens available as utilities (the ONLY colors allowed)

Use `bg-<name>`, `text-<name>`, `border-<name>`:

- Neutrals (one slate ramp): `surface`, `surface-muted`, `surface-sunken`,
  `border`, `border-strong`, `ink-faint`, `ink-subtle`, `ink-muted`, `ink`
  - border utils: `border-border`, `border-border-strong`, `border-ink`, etc.
- Accent (single, restrained): `accent`, `accent-hover`  (use sparingly: links, focus)
- Status (functional): `ok-bg`/`ok-fg` (green), `warn-bg`/`warn-fg` (amber),
  `bad-bg`/`bad-fg` (red), `neutral-bg`/`neutral-fg`
- `text-white` and `bg-surface` (white) are fine.
- Mono numerics: `font-mono`. Never set font-family (body provides Geist).

## Hex → token mapping (apply to EVERY hardcoded color — none may remain)

Neutrals:
- `#111827` `#0f172a` → ink
- `#374151` `#334155` → ink-muted
- `#6b7280` `#64748b` → ink-subtle
- `#9ca3af` `#94a3b8` → ink-faint
- `#e5e7eb` `#e2e8f0` → border  (`border-border`)
- `#d1d5db` `#cbd5e1` → border-strong (`border-border-strong`)
- `#ffffff` `#fff` → bg-surface / text-white
- `#f9fafb` `#f8fafc` → surface-muted
- `#f3f4f6` `#f1f5f9` → surface-sunken

Accent — collapse ALL blues and purples to the one accent:
- `#2563eb` → accent ; `#1d4ed8` `#1e40af` `#1e3a8a` → accent (use `accent-hover` for hover)
- purple solids `#7c3aed` `#6d28d9` `#5b21b6` → accent
- light blue/purple tint panels (`#eff6ff` `#dbeafe` `#bfdbfe` `#93c5fd` `#ede9fe`
  `#f5f3ff` `#faf5ff` `#d8b4fe`) → **neutralize**: `bg-surface-sunken`, text `text-ink-muted`,
  border `border-border`.

Status — green (positive/paid/success):
- text greens `#065f46` `#166534` `#15803d` `#047857` → text-ok-fg
- solid green action buttons `#16a34a` `#059669` → use `<Button>` (slate primary)
- green tint bg `#dcfce7` `#d1fae5` `#ecfdf5` `#bbf7d0` `#6ee7b7` `#f0fdf4` → bg-ok-bg
  (paired text → text-ok-fg, border → `border-ok-fg/30`)

Status — amber/yellow (pending/held/warning):
- text `#92400e` `#b45309` `#854d0e` `#78350f` `#713f12` `#d97706` → text-warn-fg
- bg tint `#fef3c7` `#fef9c3` `#fefce8` `#fde68a` `#fde047` `#fcd34d` `#fbbf24` `#fffbeb` → bg-warn-bg

Status — red (disputed/blocked/error):
- text `#b91c1c` `#991b1b` `#dc2626` → text-bad-fg
- bg tint `#fee2e2` `#fef2f2` → bg-bad-bg ; border `#fca5a5` → `border-bad-fg/30`

## Spacing / size conversion (rem → Tailwind; 1rem = 4 units)

padding/margin/gap: `0.125rem`→0.5, `0.25rem`→1, `0.375rem`→1.5, `0.5rem`→2,
`0.625rem`→2.5, `0.75rem`→3, `0.875rem`→3.5, `1rem`→4, `1.25rem`→5, `1.5rem`→6, `2rem`→8.
(e.g. `padding:'0.5rem 1rem'`→`px-4 py-2`; `marginBottom:'0.75rem'`→`mb-3`; `gap:'1rem'`→`gap-4`;
`margin:0`→`m-0`; `margin:'0 auto'`→`mx-auto`.)

fontSize: `0.6875rem`→`text-[0.6875rem]`, `0.75rem`→`text-xs`, `0.8125rem`→`text-[0.8125rem]`,
`0.875rem`→`text-sm`, `0.9375rem`→`text-[0.9375rem]`, `1rem`→`text-base`, `1.125rem`→`text-lg`,
`1.25rem`→`text-xl`, `1.5rem`→`text-2xl`, `1.75rem`→`text-[1.75rem]`, `2rem`→`text-[2rem]`.

fontWeight: 400→`font-normal`, 500→`font-medium`, 600→`font-semibold`, 700→`font-bold`.

radius: `0.25rem`→`rounded`, `0.375rem`→`rounded-md`, `0.5rem`→`rounded-lg`, `0.75rem`→`rounded-xl`,
`1rem`→`rounded-2xl`, `9999px`→`rounded-full`.

layout/flex/grid: `display:'flex'`→`flex`, `'grid'`→`grid`, `'inline-block'`→`inline-block`,
`flexDirection:'column'`→`flex-col`, `alignItems:'center'`→`items-center`, `'flex-start'`→`items-start`,
`justifyContent:'center'`→`justify-center`, `'space-between'`→`justify-between`, `'flex-end'`→`justify-end`,
`flex:1`→`flex-1`, `flexShrink:0`→`shrink-0`, `gridTemplateColumns:'1fr 1fr'` or `'repeat(2,1fr)'`→`grid-cols-2`
(3→`grid-cols-3`, 4→`grid-cols-4`), `gridColumn:'1 / -1'`→`col-span-2` (match the grid's col count).

misc: `width:'100%'`→`w-full`, `maxWidth:'880px'`→`max-w-[880px]`, `minHeight:'100vh'`→`min-h-screen`,
`minHeight:'calc(100vh - 3.25rem)'`→`min-h-[calc(100vh-3.25rem)]`, `whiteSpace:'nowrap'`→`whitespace-nowrap`,
`textAlign:'center'`→`text-center`, `textTransform:'uppercase'`→`uppercase`,
`letterSpacing:'0.05em'`→`tracking-wider`, `'0.025em'`→`tracking-wide`, `textDecoration:'underline'`→`underline`,
`outline:'none'`→`outline-none`, `resize:'vertical'`→`resize-y`, `listStyle:'none'`→`list-none`,
`overflowX:'auto'`→`overflow-x-auto`, `cursor:'pointer'`→`cursor-pointer`, `'not-allowed'`→`cursor-not-allowed`,
`transition:'…'`→`transition-colors`, `boxSizing:'border-box'`→`box-border`,
`boxShadow` subtle → `shadow-sm`; stronger → `shadow-md`; or arbitrary `shadow-[…]`.
`borderBottom:'1px solid #e5e7eb'`→`border-b border-border` (same for border-t/l/r).
`border:'1px solid #d1d5db'`→`border border-border-strong`.

Dynamic color like `background: saving ? '#93c5fd' : '#2563eb'` → use `<Button disabled={saving}>`
or `bg-accent disabled:opacity-60`. Keep any genuinely dynamic NON-color value (e.g. a computed
`width: pct%` bar) as an inline `style` for that one property only.

## Buttons & chips

- Affirmative CTA (Submit / Approve / Resolve / Accept / Run / Save / Create) → `<Button>` from `'ui'`.
- Destructive / negative (Reject / Delete) → `<Button variant="destructive">`.
- Neutral / secondary (Cancel / secondary) → `<Button variant="secondary">`.
- Text-link buttons (`← Back`, `View`) → keep `<button>` with
  `text-sm text-accent underline bg-transparent border-none cursor-pointer p-0` (don't force Button).
- Compact table-row action buttons → prefer `<Button>`; if its `px-4 py-2` clearly breaks a dense row,
  use `<button className="text-[0.8125rem] px-3 py-1.5 rounded-md bg-ink text-white cursor-pointer">`.
- Status pills/badges → use `<StatusChip status={raw}>` from `'ui'` when it's clearly a status
  indicator (preserve its `data-testid` and label). Otherwise map the span's colors to ok/warn/bad/neutral.

## HARD RULES (do not violate)

1. No raw hex color may remain anywhere in your files. Every color → a theme-token utility.
2. Replace `style={{…}}` with `className`. Inline `style` allowed ONLY for a genuinely dynamic
   non-color value (rare).
3. Preserve EXACTLY, unchanged: every `data-testid`, `role`, `aria-*`, `htmlFor`, `id`, `name`,
   `onClick`/`onChange`/`onKeyDown`/handlers, `disabled`, `type`, `value`, `placeholder`, and all
   visible text. Tests assert on these — do not rename, remove, or reorder them.
4. Remove any `import { colors, space, radius, font, layout } from 'ui'` (those exports were deleted).
   Add `import { Button, StatusChip, statusVariant } from 'ui'` only as needed.
5. Change ONLY styling. Keep all component logic, props, exports, hooks, and structure identical.

## Canonical examples (already converted — match their style)

- `packages/ui/Button.tsx`, `packages/ui/StatusChip.tsx` (variant→class maps)
- `apps/web/src/components/NavShell.tsx`
- `apps/web/src/components/Login.tsx`  (cards, inputs, tabs, Button adoption)
- `apps/web/src/App.tsx`

## Self-check before finishing

In each file you edited, confirm:
- `grep -nE "#[0-9a-fA-F]{3,6}" <file>` returns nothing (ignore matches inside `// #123`-style issue
  refs in comments — those are fine; only CSS color hex must be gone).
- `grep -n "from 'ui'" <file>` does not import colors/space/radius/font/layout.
- `grep -n "style={{" <file>` returns nothing, OR only a dynamic non-color style.
