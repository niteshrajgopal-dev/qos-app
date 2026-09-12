import { Badge } from "./Badge";
import { QOS_STATES, resolveQosState } from "./qos-states";

export type StatusBadgeProps = {
  /** Key from QOS_STATES — live, draft, published, connected, out_of_sync, error, syncing… */
  state: keyof typeof QOS_STATES | string;
  /** Override the canonical label; the tone and icon stay fixed. */
  label?: string;
};

export { QOS_STATES } from "./qos-states";

export function StatusBadge({ state, label }: StatusBadgeProps) {
  const cfg = resolveQosState(state);

  return (
    <Badge tone={cfg.tone} icon={cfg.icon}>
      {label ?? cfg.label}
    </Badge>
  );
}
