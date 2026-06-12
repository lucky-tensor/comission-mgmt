Centered modal for create/edit forms and confirmations. Click-outside and Esc close it; put actions in `footer`.

```jsx
<Dialog open={open} onClose={close}
  title="Delete project?"
  description="This permanently removes the project and its data."
  footer={<>
    <Button onClick={close}>Cancel</Button>
    <Button variant="danger" onClick={confirm}>Delete</Button>
  </>}>
  Type the project name to confirm.
</Dialog>
```

For larger forms, raise `width` (e.g. 560). Keep the destructive action on the right as `danger`.
