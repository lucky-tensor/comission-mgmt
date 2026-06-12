Action control for Atlas — use `primary` (ink) for the main action on a view, `secondary` for everything else, `accent` (blue) only for the single most important affirmative action, and `danger` for destructive ones.

```jsx
<Button variant="primary" iconLeft={<PlusIcon/>}>New record</Button>
<Button variant="secondary">Cancel</Button>
<Button variant="danger" size="sm">Delete</Button>
```

Variants: `primary` · `secondary` · `ghost` · `accent` · `danger`. Sizes: `sm` (28px) · `md` (34px) · `lg` (40px). Pass `iconLeft` / `iconRight` as ~16px SVG nodes; `fullWidth` stretches it. Avoid more than one `accent`/`primary` button per region.
