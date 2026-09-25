# TrendChart

QOS data-visualisation primitives.

```jsx
<TrendChart series={[{ label: "Orders", values: data }]} labels={days} height={200} />
```

Series colours come from `--viz-1…6` in order (blue, violet, cyan, navy, then tints). Hairline grid, tabular axis numbers, no decorative gradients behind the plot. `Sparkline` for in-row trends, `BarChart` for categorical comparison, `ChartLegend` when more than one series is shown.
