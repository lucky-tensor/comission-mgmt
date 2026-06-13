Round identity chip. Shows the image when `src` is provided, otherwise derives initials and a stable color from `name`.

```jsx
<Avatar name="Dana Reyes" />
<Avatar name="Acme Inc" src="/logo.png" size="sm" />
```

Sizes `xs`(20) · `sm`(24) · `md`(32) · `lg`(40). Color is hashed from the name so the same person is always the same color.
