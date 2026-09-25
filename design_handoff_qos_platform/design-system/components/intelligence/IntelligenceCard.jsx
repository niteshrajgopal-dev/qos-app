import React from "react";
import { Icon } from "../primitives/Icon.jsx";

/* The QOS intelligence surface. Rules:
   - kind names what the panel is: Insight, Anomaly, Recommendation, Summary, Mapping.
   - claims separate SYSTEM FACT from AI INTERPRETATION from AI RECOMMENDATION.
   - nothing is applied until the operator approves; the footer always shows the approval action. */
export function IntelligenceCard({ kind = "Insight", title, claims = [], children, actions, confidence, ...rest }) {
  return (
    <section className="qos-ai" {...rest}>
      <div className="qos-ai-head">
        <span className="qos-ai-mark"><Icon name="sparkles" size={13} /></span>
        <span className="qos-ai-kind">QOS Intelligence · {kind}</span>
        {confidence ? (
          <span style={{ marginLeft: "auto", fontSize: "var(--text-meta-size)", color: "var(--text-secondary)" }}>Confidence {confidence}</span>
        ) : null}
      </div>
      <div className="qos-ai-body">
        {title ? <h3 style={{ fontSize: "var(--text-section-size)", lineHeight: "var(--text-section-lh)", fontWeight: "var(--fw-semibold)", marginBottom: 8 }}>{title}</h3> : null}
        {claims.length ? (
          <div className="qos-ai-claim">
            {claims.map((c, i) => (
              <React.Fragment key={i}>
                <span className="qos-ai-claim-kind">{c.kind}</span>
                <span style={{ color: c.kind && c.kind.toLowerCase().includes("fact") ? "var(--text-primary)" : "var(--text-secondary)" }}>{c.text}</span>
              </React.Fragment>
            ))}
          </div>
        ) : null}
        {children}
      </div>
      {actions ? <div className="qos-ai-foot">{actions}</div> : null}
    </section>
  );
}

export function AiBadge({ children = "AI", ...rest }) {
  return (
    <span className="qos-badge" data-tone="intelligence" {...rest}>
      <Icon name="sparkles" size={11} />{children}
    </span>
  );
}
