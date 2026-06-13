Square button holding a single icon — for toolbars, table-row actions, and dialog close buttons. Always pass `label` for accessibility (also shows as a native tooltip).

```jsx
<IconButton label="More actions"><MoreIcon/></IconButton>
<IconButton label="Delete" variant="outline"><TrashIcon/></IconButton>
```

`variant`: `ghost` (default, transparent) · `outline` (bordered). Sizes match Button: `sm`/`md`/`lg`.
