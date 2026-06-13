Transient confirmation after an action ("Saved", "Invite sent"). Render one Toast per message; position a fixed container bottom-right and map your queue into it.

```jsx
<div style={{position:'fixed',right:20,bottom:20,display:'flex',flexDirection:'column',gap:8}}>
  <Toast tone="success" title="Changes saved" onDismiss={pop} />
</div>
```

Dot color follows `tone`. Auto-dismiss timing is your responsibility (e.g. a 4s timeout).
