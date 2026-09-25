import { StaffSignInForm } from "@/app/staff/sign-in/staff-sign-in-form";
import { Logo } from "@/design-system";

export default function StaffSignInPage() {
  return (
    <div className="qos-login" data-qos-theme="dark">
      <div className="qos-login-brand">
        <img
          src="/brand/motif-orbital-hero.png"
          alt=""
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            opacity: 0.9,
          }}
        />
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "linear-gradient(180deg, rgba(5,7,14,.35), rgba(5,7,14,.85))",
          }}
        />
        <Logo variant="navy" height={26} style={{ position: "relative" }} />
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
