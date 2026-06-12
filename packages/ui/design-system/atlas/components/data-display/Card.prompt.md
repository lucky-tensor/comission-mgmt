The default content surface — bordered, flat (no shadow). Optional header with title, subtitle, and right-aligned actions.

```jsx
<Card title="Members" subtitle="42 active" actions={<Button size="sm">Invite</Button>}>
  …table or form…
</Card>
<Card padding="none"><Table .../></Card>
```

Use `padding="none"` when wrapping a Table or list so rows reach the edges.
