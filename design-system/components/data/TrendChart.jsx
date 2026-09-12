import React from "react";

function path(values, w, h, pad) {
  const max = Math.max(...values), min = Math.min(...values);
  const span = max - min || 1;
  const step = (w - pad * 2) / (values.length - 1 || 1);
  return values.map((v, i) => `${i === 0 ? "M" : "L"}${(pad + i * step).toFixed(1)},${(h - pad - ((v - min) / span) * (h - pad * 2)).toFixed(1)}`).join(" ");
}

/* Line/area trend chart. QOS charting rule: one accent hue per series in --viz order,
   hairline grid, tabular numeric axis labels, no decorative gradients behind the plot. */
export function TrendChart({ series = [], labels = [], height = 200, area = true, yTicks = 4, valueFormat = (v) => v, ...rest }) {
  const w = 1000, pad = 8;
  const all = series.flatMap((s) => s.values);
  const max = Math.max(...all, 0), min = Math.min(...all, 0);
  const gid = React.useId ? React.useId().replace(/:/g, "") : "g";
  return (
    <div {...rest}>
      <div style={{ display: "flex", gap: 8 }}>
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", fontSize: 11, color: "var(--viz-axis)", fontVariantNumeric: "tabular-nums", height, paddingBottom: 16 }}>
          {Array.from({ length: yTicks + 1 }, (_, i) => (
            <span key={i}>{valueFormat(Math.round(max - ((max - min) / yTicks) * i))}</span>
          ))}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <svg className="qos-chart" viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" style={{ height }} role="img">
            {Array.from({ length: yTicks + 1 }, (_, i) => (
              <line key={i} x1="0" x2={w} y1={(height / yTicks) * i} y2={(height / yTicks) * i} stroke="var(--viz-grid)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
            ))}
            {series.map((s, si) => {
              const color = s.color || `var(--viz-${(si % 6) + 1})`;
              const d = path(s.values, w, height, pad);
              return (
                <g key={s.label || si}>
                  {area ? (
                    <>
                      <defs>
                        <linearGradient id={`${gid}-${si}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={color} stopOpacity="0.22" />
                          <stop offset="100%" stopColor={color} stopOpacity="0" />
                        </linearGradient>
                      </defs>
                      <path d={`${d} L${w - pad},${height} L${pad},${height} Z`} fill={`url(#${gid}-${si})`} />
                    </>
                  ) : null}
                  <path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                </g>
              );
            })}
          </svg>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--viz-axis)", marginTop: 6 }}>
            {labels.map((l) => <span key={l}>{l}</span>)}
          </div>
        </div>
      </div>
    </div>
  );
}

export function Sparkline({ values = [], width = 96, height = 28, tone = "var(--viz-1)", ...rest }) {
  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width, height, display: "block" }} aria-hidden="true" {...rest}>
      <path d={path(values, width, height, 2)} fill="none" stroke={tone} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function BarChart({ data = [], height = 180, valueFormat = (v) => v, ...rest }) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div {...rest}>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 10, height }}>
        {data.map((d, i) => (
          <div key={d.label} style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-end", alignItems: "center", gap: 6, height: "100%" }}>
            <span style={{ fontSize: 11, color: "var(--text-secondary)", fontVariantNumeric: "tabular-nums" }}>{valueFormat(d.value)}</span>
            <div style={{ width: "100%", maxWidth: 44, height: `${(d.value / max) * 100}%`, background: d.color || `var(--viz-${(i % 6) + 1})`, borderRadius: "var(--radius-xs) var(--radius-xs) 2px 2px", minHeight: 2 }} />
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
        {data.map((d) => <span key={d.label} style={{ flex: 1, textAlign: "center", fontSize: 11, color: "var(--viz-axis)" }}>{d.label}</span>)}
      </div>
    </div>
  );
}

export function ChartLegend({ items = [], ...rest }) {
  return (
    <div className="qos-legend" {...rest}>
      {items.map((it, i) => (
        <span key={it.label} className="qos-legend-key">
          <span className="qos-legend-swatch" style={{ background: it.color || `var(--viz-${(i % 6) + 1})` }} />
          {it.label}
        </span>
      ))}
    </div>
  );
}
