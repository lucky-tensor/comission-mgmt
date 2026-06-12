On/off toggle for settings that take effect immediately (e.g. "Enable 2FA"). For values submitted with a form, use Checkbox instead.

```jsx
const [on, setOn] = React.useState(true);
<Switch checked={on} onChange={setOn} label="Email notifications" />
```

The knob is ink when on, gray when off, with a soft spring on the slide.
