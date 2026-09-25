# CommandPalette

Global search and command surface (⌘K).

```jsx
<CommandPalette open query={q} onQueryChange={setQ} groups={results} onSelect={go} onClose={close} />
```

Set `intelligence: true` on a result to mark it as an AI-derived suggestion rather than a system record.
