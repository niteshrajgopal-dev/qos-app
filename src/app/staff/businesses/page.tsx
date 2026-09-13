import { BusinessPicker } from "@/app/staff/businesses/business-picker";
import { StaffWordmark } from "@/components/staff/StaffWordmark";

export default function StaffBusinessesPage() {
  return (
    <div className="qos-login" data-qos-theme="dark">
      <div className="qos-login-brand">
        <StaffWordmark tone="navy" height={26} />
        <div style={{ position: "relative", maxWidth: 460 }}>
          <h1
            style={{
              fontSize: 40,
              lineHeight: "48px",
              letterSpacing: "-.02em",
              fontWeight: 600,
            }}
          >
            Ideas today.
            <br />
            Impact tomorrow.
          </h1>
          <p
            style={{
              marginTop: 14,
              fontSize: 16,
              lineHeight: "24px",
              color: "var(--text-secondary)",
            }}
          >
            Choose the business you want to operate.
          </p>
        </div>
        <div className="qos-login-brand-foot">
          <span>Higher quality</span>
          <span>Brighter possibilities</span>
        </div>
      </div>
      <div className="qos-login-panel">
        <div style={{ width: "100%", maxWidth: 380, display: "grid", gap: 16 }}>
          <div>
            <h2
              style={{
                fontSize: 24,
                lineHeight: "32px",
                fontWeight: 600,
                letterSpacing: "-.015em",
              }}
            >
              Choose a business
            </h2>
            <p
              style={{
                fontSize: 14,
                color: "var(--text-secondary)",
                marginTop: 6,
              }}
            >
              Access comes from your staff memberships, not from a typed
              tenant id.
            </p>
          </div>
          <BusinessPicker />
        </div>
      </div>
    </div>
  );
}
