Underline tabs for switching sub-views inside a record or page (Overview / Members / Activity / Settings). Controlled.

```jsx
const [tab, setTab] = React.useState('members');
<Tabs value={tab} onChange={setTab} items={[
  { value:'overview', label:'Overview' },
  { value:'members', label:'Members', count: 42 },
  { value:'activity', label:'Activity' },
]} />
```

Active tab is ink with an ink underline. Add `count` for row totals.
