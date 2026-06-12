Boolean / multi-select form input. Supports an `indeterminate` state for "select all" headers and an optional `description` line.

```jsx
<Checkbox checked={a} onChange={setA} label="Send weekly digest" />
<Checkbox indeterminate label="Select all" />
<Checkbox label="Admin" description="Full access to billing and members" />
```

Use for values submitted with a form; use Switch for instant settings.
