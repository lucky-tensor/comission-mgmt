Inline message banner for the top of a view, form section, or card — validation summaries, system notices, destructive confirmations.

```jsx
<Banner tone="warning" title="Unsaved changes" onDismiss={dismiss}>
  You have edits that haven't been saved.
</Banner>
<Banner tone="danger" title="3 fields need attention" />
```

Tones: `info` · `success` · `warning` · `danger`. For transient confirmations use Toast instead.
