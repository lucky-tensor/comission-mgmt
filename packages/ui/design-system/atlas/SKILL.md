---
name: atlas-design
description: Use this skill to generate well-branded interfaces and assets for Atlas, a minimalist admin / CRUD design system, either for production or throwaway prototypes/mocks/etc. Contains essential design guidelines, colors, type, fonts, assets, and UI kit components for prototyping.
user-invocable: true
---

Read the `readme.md` file within this skill, and explore the other available files.

Atlas is a minimalist design system for **admin interfaces** — control panels,
dashboards, and CRUD back-offices. Its signature: flat, border-first surfaces;
a cool-gray neutral ramp; ink (near-black) primary actions with a single Atlas
Blue accent reserved for interactive/selected state; Geist + Geist Mono type;
Lucide line icons; quiet motion.

Key files:
- `readme.md` — full design guide: content fundamentals, visual foundations, iconography, token usage.
- `styles.css` — the single stylesheet to link; `@import`s all tokens in `tokens/`.
- `tokens/` — color, type, spacing, radius, shadow, and font custom properties.
- `components/` — React primitives (Button, Input, Table, Badge, Dialog, Tabs, …), each with a `.prompt.md` describing usage.
- `ui_kits/admin-console/` — an interactive recreation of the full admin product to copy patterns from.
- `guidelines/*.card.html` — foundation specimen cards.
- `assets/` — the Atlas wordmark/mark SVGs.

If creating visual artifacts (slides, mocks, throwaway prototypes, etc), copy
assets out and create static HTML files for the user to view. If working on
production code, copy assets and read the rules here to become an expert in
designing with this brand. Reference semantic tokens (`--accent`,
`--surface-card`, `--text-tertiary`), not raw hex.

If the user invokes this skill without any other guidance, ask them what they
want to build or design, ask a few clarifying questions, and act as an expert
designer who outputs HTML artifacts _or_ production code, depending on the need.
