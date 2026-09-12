const { Logo, Button, Input, Card, Avatar, Badge, StatusBadge } = window.QOSDesignSystem_913581;

/* Flow 1, step 1 — login, then tenant selection. The brand is loud here and quiet everywhere else. */
function LoginScreen({ onSignIn, step, tenant, onPickTenant }) {
  return (
    <div data-qos-theme="dark" style={{ minHeight: "100vh", display: "grid", gridTemplateColumns: "1.15fr 1fr", background: "var(--surface-canvas)", color: "var(--text-primary)" }}>
      <div style={{ position: "relative", overflow: "hidden", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "40px 48px" }}>
        <img src="../../assets/motif-orbital-hero.png" alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", opacity: 0.9 }} />
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(5,7,14,.35), rgba(5,7,14,.85))" }} />
        <Logo variant="navy" height={26} assetBase="../../assets/" style={{ position: "relative" }} />
        <div style={{ position: "relative", maxWidth: 460 }}>
          <h1 style={{ fontSize: 40, lineHeight: "48px", letterSpacing: "-.02em", fontWeight: 600 }}>Ideas today.<br />Impact tomorrow.</h1>
          <p style={{ marginTop: 14, fontSize: 16, lineHeight: "24px", color: "var(--text-secondary)" }}>
            The orchestration layer for your commerce operations — channels, catalogue, locations and integrations in one place.
          </p>
        </div>
        <div style={{ position: "relative", display: "flex", gap: 24, fontSize: 11, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--text-secondary)" }}>
          <span>Higher quality</span><span>Brighter possibilities</span>
        </div>
      </div>
      <div style={{ display: "grid", placeItems: "center", padding: 40, background: "var(--surface-default)" }}>
        {step === "login" ? (
          <div style={{ width: "100%", maxWidth: 340, display: "grid", gap: 16 }}>
            <div>
              <h2 style={{ fontSize: 24, lineHeight: "32px", fontWeight: 600, letterSpacing: "-.015em" }}>Sign in to QOS</h2>
              <p style={{ fontSize: 14, color: "var(--text-secondary)", marginTop: 6 }}>Use your work account.</p>
            </div>
            <Input id="email" label="Work email" defaultValue="jamie.doyle@quotes.ae" />
            <Input id="pw" label="Password" type="password" defaultValue="••••••••••" />
            <Button size="lg" fullWidth iconTrailing="arrow-right" onClick={onSignIn}>Continue</Button>
            <div style={{ fontSize: 12, color: "var(--text-secondary)", textAlign: "center" }}>
              Trouble signing in? <a href="#">Request staff access</a>
            </div>
          </div>
        ) : (
          <div style={{ width: "100%", maxWidth: 380, display: "grid", gap: 14 }}>
            <div>
              <h2 style={{ fontSize: 24, lineHeight: "32px", fontWeight: 600, letterSpacing: "-.015em" }}>Choose a business</h2>
              <p style={{ fontSize: 14, color: "var(--text-secondary)", marginTop: 6 }}>You have access to 2 businesses on this platform.</p>
            </div>
            {window.TENANTS.map((t) => (
              <button key={t.id} type="button" onClick={() => onPickTenant(t.id)} className="qos-card" data-padding="sm" data-interactive="true" style={{ display: "flex", alignItems: "center", gap: 12, textAlign: "left", cursor: "pointer" }}>
                <Avatar name={t.name} tone="brand" size="lg" />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontWeight: 600, fontSize: 15 }}>{t.name}</span>
                  <span style={{ display: "block", fontSize: 12, color: "var(--text-secondary)" }}>{t.meta}</span>
                </span>
                {t.id === "quotes" ? <StatusBadge state="live" /> : <Badge tone="neutral">Retail</Badge>}
              </button>
            ))}
            <p style={{ fontSize: 12, color: "var(--text-tertiary)" }}>Quotes is Customer #1 on the shared QOS Storefront Platform.</p>
          </div>
        )}
      </div>
    </div>
  );
}

Object.assign(window, { LoginScreen });
