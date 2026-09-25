# IntelligenceCard

The QOS intelligence surface — the only place the brand gradient appears in operational UI.

```jsx
<IntelligenceCard kind="Anomaly" title="Delivery orders down 34% at Marina Walk"
  claims={[{kind:"System fact",text:"18 orders in the last 2 hours vs. 27 expected."},
           {kind:"AI interpretation",text:"The POS connector has been failing since 14:02."},
           {kind:"AI recommendation",text:"Reconnect Lightspeed and replay 9 failed orders."}]}
  actions={<><Button variant="intelligence" icon="check">Approve and reconnect</Button><Button variant="ghost">Dismiss</Button></>} />
```

Always separate system fact from AI interpretation from AI recommendation, and never apply a consequential change without an explicit approval action. `AiBadge` marks smaller AI-derived values inline.
