import React from "react";
import { Icon } from "../primitives/Icon.jsx";

export function Stepper({ steps = [], current = 0, ...rest }) {
  return (
    <div className="qos-stepper" {...rest}>
      {steps.map((s, i) => {
        const label = typeof s === "string" ? s : s.label;
        const state = i < current ? "complete" : i === current ? "current" : "upcoming";
        return (
          <React.Fragment key={label}>
            <div className="qos-step" data-state={state}>
              <span className="qos-step-dot">{state === "complete" ? <Icon name="check" size={12} /> : i + 1}</span>
              {label}
            </div>
            {i < steps.length - 1 ? <span className="qos-step-line" /> : null}
          </React.Fragment>
        );
      })}
    </div>
  );
}
