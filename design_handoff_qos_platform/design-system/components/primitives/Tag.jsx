import React from "react";

export function Tag({ children, onRemove, ...rest }) {
  return (
    <span className="qos-tag" data-removable={onRemove ? "true" : "false"} {...rest}>
      {children}
      {onRemove ? (
        <button type="button" className="qos-tag-x" aria-label={`Remove ${typeof children === "string" ? children : "tag"}`} onClick={onRemove}>×</button>
      ) : null}
    </span>
  );
}
