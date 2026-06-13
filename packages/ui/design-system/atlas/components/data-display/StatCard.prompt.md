KPI tile for the top of a dashboard. Lay several in a CSS grid row.

```jsx
<div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12}}>
  <StatCard label="Active users" value="8,420" delta="+12%" trend="up" />
  <StatCard label="Churn" value="1.8%" delta="-0.3%" trend="down" />
</div>
```

`trend` colors the delta (up=green, down=red, flat=gray). Values use tabular figures so columns align.
