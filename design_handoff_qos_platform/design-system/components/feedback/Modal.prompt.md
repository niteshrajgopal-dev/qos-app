# Modal

Focused decision or short form that must block the canvas.

```jsx
<ConfirmDialog tone="danger" title="Roll back to release 41?" description="Release 42 will be replaced on quotes.qosapp.com." confirmLabel="Roll back" onConfirm={...} onClose={...} />
```

`ConfirmDialog` is required for publishing, rollback, disconnecting an integration and any destructive action. Name the object and the consequence in the title and description.
