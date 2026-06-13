Styled native `<select>` — keeps native keyboard + accessibility, restyles the chrome. Use for short, known lists (status, role, region). For search/multi-select, build a custom popover instead.

```jsx
<Select label="Role" options={['Owner','Admin','Member','Viewer']} defaultValue="Member" />
<Select label="Status" placeholder="Choose…" options={[{value:'active',label:'Active'},{value:'paused',label:'Paused'}]} />
```
