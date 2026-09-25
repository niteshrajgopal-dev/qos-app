# StatusBadge

The canonical QOS lifecycle state token — the single source of truth for state wording, tone and icon.

```jsx
<StatusBadge state="out_of_sync" />
```

States cover publishing (draft, published, unpublished, publishing), connectivity (connected, disconnected, synced, out_of_sync, config_required), operations (live, active, paused, suspended), and exceptions (warning, error, failed, offline). Never invent a new colour-only state — add it to `QOS_STATES`.
