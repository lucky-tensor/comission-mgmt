The workhorse of CRUD admin — declarative columns + row data with optional selection and per-cell renderers. Wrap it in a `<Card padding="none">` so rows meet the card edges.

```jsx
const cols = [
  { key: 'name', header: 'Name', render: (v, r) => <Identity name={v} email={r.email} /> },
  { key: 'role', header: 'Role' },
  { key: 'status', header: 'Status', render: (v) => <Badge tone="success" dot>{v}</Badge> },
  { key: 'id', header: '', align: 'right', render: () => <IconButton label="Actions"><MoreIcon/></IconButton> },
];
<Table columns={cols} data={users} selectable selected={sel} onSelectedChange={setSel} />
```

Headers are sticky and uppercase; rows hover and selected rows tint Atlas Blue. Use `render` for badges, avatars, and row actions. Right-align numeric columns.
