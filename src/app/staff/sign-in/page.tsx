import { StaffSignInForm } from "@/app/staff/sign-in/staff-sign-in-form";
import { StaffWordmark } from "@/components/staff/StaffWordmark";

export default function StaffSignInPage() {
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
            The orchestration layer for your commerce operations — channels,
            catalogue, locations and integrations in one place.
          </p>
        </div>
        <div className="qos-login-brand-foot">
          <span>Higher quality</span>
          <span>Brighter possibilities</span>
        </div>
      </div>
      <div className="qos-login-panel">
        <StaffSignInForm />
      </div>
    </div>
  );
}
