Dark hint on hover/focus. Wrap exactly one trigger — usually an IconButton or a truncated label.

```jsx
<Tooltip content="Copy ID" side="top">
  <IconButton label="Copy"><CopyIcon/></IconButton>
</Tooltip>
```

Keep content to a few words. Don't put interactive elements inside (it's pointer-transparent).
