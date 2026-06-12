Single-line text field. Owns its label/hint/error layout, so drop it straight into a form column.

```jsx
<Input label="Workspace name" placeholder="acme-inc" required />
<Input label="Search" iconLeft={<SearchIcon/>} placeholder="Filter users…" />
<Input label="Slug" error="Already taken" defaultValue="acme" />
```

Focus shows the Atlas Blue ring; `error` swaps to the danger ring. Sizes `sm`/`md`/`lg`.
