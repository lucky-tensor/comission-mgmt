# Commission Management Design System

This directory belongs to the `ui` workspace package. The web app consumes the
bridge through the exported `ui/design-system/app.css` package path, so local,
CI, and container builds all use the same declared dependency boundary.

`atlas/` is the vendored Atlas design-system archive supplied for this app.
Keep it intact so its tokens, component references, assets, and adherence
manifest remain auditable.

`app.css` is the only product-specific bridge. It maps the semantic utility
names used by the React surfaces to Atlas tokens. Product UI must not define
colors, fonts, radii, or shadows outside this directory.

Run the reproducible adherence check with:

```sh
bun run test:design-system
```
