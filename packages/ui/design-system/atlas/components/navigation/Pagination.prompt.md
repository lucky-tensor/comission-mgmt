Table/list pager — shows "1–25 of 1,240" with prev/next. Place it in the table card footer.

```jsx
<Pagination page={page} pageSize={25} total={1240} onPageChange={setPage} />
```

Computes page count and range from `total` + `pageSize`; arrows disable at the ends.
