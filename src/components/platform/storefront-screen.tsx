// @ts-nocheck
"use client";

// Direct port of the design prototype. Markup and copy are kept as specified.
import React from "react";

import { Button, Icon, Badge, Radio, Checkbox, Input, Timeline, IconButton, Select } from "@/design-system";

/* Customer-facing storefront rendered by the shared QOS Storefront runtime from Quotes' published
   configuration (Release 42). Imagery is placeholder — real product photography comes from the tenant. */
const STORE_CATEGORIES = ["Coffee", "Tea", "Kitchen", "Bakery", "Cold drinks", "Retail"];
const STORE_PRODUCTS = [
  { id: "flat-white", name: "Flat white", cat: "Coffee", price: 18, desc: "Double ristretto, velvety milk.", mods: true, popular: true },
  { id: "cortado", name: "Cortado", cat: "Coffee", price: 16, desc: "Equal parts espresso and steamed milk.", mods: true },
  { id: "cold-brew", name: "Cold brew", cat: "Coffee", price: 22, desc: "18-hour steep, served over ice.", mods: false },
  { id: "matcha", name: "Matcha latte", cat: "Tea", price: 24, desc: "Ceremonial grade, oat milk by default.", mods: true },
  { id: "chai", name: "Karak chai", cat: "Tea", price: 12, desc: "Slow-brewed with cardamom.", mods: false, popular: true },
  { id: "avo", name: "Avocado toast", cat: "Kitchen", price: 38, desc: "Sourdough, chilli, lime, feta.", mods: true, soldOut: true },
  { id: "shak", name: "Shakshuka", cat: "Kitchen", price: 42, desc: "Two eggs, peppers, warm flatbread.", mods: false },
  { id: "banana", name: "Banana bread", cat: "Bakery", price: 21, desc: "Toasted, salted butter.", mods: false, popular: true },
  { id: "croissant", name: "Almond croissant", cat: "Bakery", price: 19, desc: "Baked at 06:00 daily.", mods: false },
  { id: "lemonade", name: "Mint lemonade", cat: "Cold drinks", price: 20, desc: "Fresh mint, no added sugar.", mods: false },
  { id: "beans", name: "House blend, 250g", cat: "Retail", price: 65, desc: "Brazil and Ethiopia. Whole bean.", mods: false },
];

export function Placeholder({ label, ratio = "4 / 3", radius = 12, style }) {
  return (
    <div style={{ aspectRatio: ratio, borderRadius: radius, background: "var(--surface-sunken)", border: "1px dashed var(--border-default)", display: "grid", placeItems: "center", color: "var(--text-tertiary)", fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", ...style }}>
      <span style={{ display: "flex", alignItems: "center", gap: 6 }}><Icon name="image" size={14} />{label}</span>
    </div>
  );
}

export function StorefrontApp({ mobile = false, onExit }) {
  const [cat, setCat] = React.useState("Coffee");
  const [cart, setCart] = React.useState([{ id: "flat-white", qty: 2, note: "Oat milk, extra shot", price: 24 }]);
  const [sheet, setSheet] = React.useState(null);
  const [cartOpen, setCartOpen] = React.useState(false);
  const [stage, setStage] = React.useState("browse"); // browse | checkout | confirmed
  const [fulfil, setFulfil] = React.useState("Collection");
  const [milk, setMilk] = React.useState("Whole");
  const [shot, setShot] = React.useState(false);

  const count = cart.reduce((n, c) => n + c.qty, 0);
  const total = cart.reduce((n, c) => n + c.qty * c.price, 0);
  const add = (p) => {
    const price = p.price + (shot ? 4 : 0) + (milk === "Oat" ? 2 : 0);
    const note = p.mods ? [milk !== "Whole" ? `${milk} milk` : null, shot ? "Extra shot" : null].filter(Boolean).join(", ") : "";
    setCart((c) => [...c, { id: p.id, qty: 1, note, price }]);
    setSheet(null); setMilk("Whole"); setShot(false);
  };
  const cols = mobile ? 2 : 4;
  const pad = mobile ? 16 : 32;
  const visible = STORE_PRODUCTS.filter((p) => p.cat === cat);

  const Header = (
    <header style={{ position: "sticky", top: 0, zIndex: 5, background: "var(--surface-default)", borderBottom: "1px solid var(--border-subtle)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, height: mobile ? 52 : 64, padding: `0 ${pad}px`, maxWidth: 1200, margin: "0 auto" }}>
        <span style={{ fontWeight: 700, fontSize: mobile ? 17 : 20, letterSpacing: "-.02em" }}>Quotes</span>
        <button type="button" style={{ display: "flex", alignItems: "center", gap: 6, height: 32, padding: "0 10px", borderRadius: 999, border: "1px solid var(--border-default)", background: "var(--surface-subtle)", fontSize: 12, color: "var(--text-secondary)", cursor: "pointer", minWidth: 0 }}>
          <Icon name="map-pin" size={13} /><span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Marina Walk · {fulfil}</span><Icon name="chevron-down" size={12} />
        </button>
        <span style={{ flex: 1 }} />
        {!mobile ? <nav style={{ display: "flex", gap: 20, fontSize: 14, color: "var(--text-secondary)" }}><a href="#">Menu</a><a href="#">Locations</a><a href="#">Our story</a></nav> : null}
        <button type="button" onClick={() => setCartOpen(true)} style={{ display: "flex", alignItems: "center", gap: 6, height: 36, padding: "0 12px", borderRadius: 8, border: "none", background: "var(--action-primary)", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
          <Icon name="shopping-bag" size={14} />{count}{!mobile ? <span> · AED {total.toFixed(2)}</span> : null}
        </button>
      </div>
    </header>
  );

  if (stage === "confirmed") {
    return (
      <div style={{ minHeight: "100%", background: "var(--surface-canvas)", color: "var(--text-primary)", fontFamily: "var(--font-sans)" }}>
        {mobile ? <div style={{ height: 54 }} /> : null}
        {Header}
        <div style={{ maxWidth: 560, margin: "0 auto", padding: `${mobile ? 24 : 56}px ${pad}px 80px`, display: "grid", gap: 20 }}>
          <div style={{ width: 48, height: 48, borderRadius: 999, background: "var(--status-success-bg)", color: "var(--status-success-fg)", display: "grid", placeItems: "center" }}><Icon name="check" size={22} /></div>
          <div>
            <h1 style={{ fontSize: mobile ? 24 : 32, lineHeight: 1.2, letterSpacing: "-.02em", fontWeight: 600 }}>Order placed</h1>
            <p style={{ marginTop: 8, color: "var(--text-secondary)", fontSize: 15 }}>Order <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>QO-10429</span> · Ready for {fulfil.toLowerCase()} at Marina Walk in about 15 minutes.</p>
          </div>
          <div style={{ background: "var(--surface-default)", border: "1px solid var(--border-subtle)", borderRadius: 12, padding: 20 }}>
            <Timeline items={[
              { title: "Order received", meta: "Just now · quotes.qosapp.com", tone: "success", icon: "check" },
              { title: "Payment confirmed", meta: `AED ${(total + 2).toFixed(2)} · Visa •••• 4421`, tone: "success", icon: "credit-card" },
              { title: "Sent to the kitchen", meta: "Marina Walk", tone: "processing", icon: "chef-hat" },
              { title: `Ready for ${fulfil.toLowerCase()}`, meta: "Estimated 14:24", tone: "neutral", icon: "shopping-bag" },
            ]} />
          </div>
          <Button variant="secondary" fullWidth onClick={() => { setCart([]); setStage("browse"); }}>Back to menu</Button>
          {onExit ? <button type="button" onClick={onExit} style={{ background: "none", border: "none", color: "var(--text-tertiary)", fontSize: 12, cursor: "pointer" }}>Exit storefront preview</button> : null}
        </div>
      </div>
    );
  }

  if (stage === "checkout") {
    return (
      <div style={{ minHeight: "100%", background: "var(--surface-canvas)", color: "var(--text-primary)", fontFamily: "var(--font-sans)" }}>
        {mobile ? <div style={{ height: 54 }} /> : null}
        {Header}
        <div style={{ maxWidth: 1000, margin: "0 auto", padding: `${mobile ? 16 : 40}px ${pad}px 100px`, display: "grid", gridTemplateColumns: mobile ? "1fr" : "1.3fr 1fr", gap: mobile ? 16 : 32, alignItems: "start" }}>
          <div style={{ display: "grid", gap: 16 }}>
            <button type="button" onClick={() => setStage("browse")} style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", color: "var(--text-secondary)", fontSize: 13, cursor: "pointer", padding: 0, width: "fit-content" }}><Icon name="arrow-left" size={14} />Back to menu</button>
            <h1 style={{ fontSize: mobile ? 22 : 28, lineHeight: 1.2, letterSpacing: "-.02em", fontWeight: 600 }}>Checkout</h1>
            <section style={{ background: "var(--surface-default)", border: "1px solid var(--border-subtle)", borderRadius: 12, padding: 20, display: "grid", gap: 12 }}>
              <h2 style={{ fontSize: 15, fontWeight: 600 }}>How would you like it?</h2>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                {[["Collection", "Ready in ~15 min", "shopping-bag"], ["Delivery", "35–45 min · AED 8", "truck"]].map(([k, m, ic]) => (
                  <button key={k} type="button" onClick={() => setFulfil(k)} style={{ textAlign: "left", padding: 14, borderRadius: 10, border: `1px solid ${fulfil === k ? "var(--action-primary)" : "var(--border-default)"}`, background: fulfil === k ? "var(--surface-selected)" : "var(--surface-default)", cursor: "pointer", display: "flex", gap: 10, alignItems: "center", color: "inherit" }}>
                    <Icon name={ic} size={16} /><span><span style={{ display: "block", fontSize: 14, fontWeight: 600 }}>{k}</span><span style={{ display: "block", fontSize: 12, color: "var(--text-secondary)" }}>{m}</span></span>
                  </button>
                ))}
              </div>
            </section>
            <section style={{ background: "var(--surface-default)", border: "1px solid var(--border-subtle)", borderRadius: 12, padding: 20, display: "grid", gap: 12 }}>
              <h2 style={{ fontSize: 15, fontWeight: 600 }}>Your details</h2>
              <div style={{ display: "grid", gridTemplateColumns: mobile ? "1fr" : "1fr 1fr", gap: 12 }}>
                <Input id="sf-name" label="Name" defaultValue="Aisha Rahman" />
                <Input id="sf-phone" label="Mobile" defaultValue="+971 50 123 4541" hint="We text you when it is ready." />
              </div>
            </section>
            <section style={{ background: "var(--surface-default)", border: "1px solid var(--border-subtle)", borderRadius: 12, padding: 20, display: "grid", gap: 12 }}>
              <h2 style={{ fontSize: 15, fontWeight: 600 }}>Payment</h2>
              <div style={{ display: "flex", alignItems: "center", gap: 12, padding: 12, borderRadius: 10, border: "1px solid var(--action-primary)", background: "var(--surface-selected)", fontSize: 14 }}>
                <Icon name="credit-card" size={16} /><span style={{ flex: 1 }}>Visa •••• 4421</span><span style={{ fontSize: 12, color: "var(--text-secondary)" }}>Change</span>
              </div>
              <p style={{ fontSize: 12, color: "var(--text-tertiary)" }}>Payments are processed by Stripe. You are charged when the order is accepted.</p>
            </section>
          </div>
          <aside style={{ background: "var(--surface-default)", border: "1px solid var(--border-subtle)", borderRadius: 12, padding: 20, display: "grid", gap: 14, position: mobile ? "static" : "sticky", top: 84 }}>
            <h2 style={{ fontSize: 15, fontWeight: 600 }}>Order summary</h2>
            {cart.map((c, i) => { const p = STORE_PRODUCTS.find((x) => x.id === c.id); return (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 14 }}>
                <span>{c.qty} × {p.name}{c.note ? <span style={{ display: "block", fontSize: 12, color: "var(--text-secondary)" }}>{c.note}</span> : null}</span>
                <span style={{ fontVariantNumeric: "tabular-nums" }}>{(c.qty * c.price).toFixed(2)}</span>
              </div>
            ); })}
            <div style={{ borderTop: "1px solid var(--border-subtle)", paddingTop: 12, display: "grid", gap: 6, fontSize: 13, color: "var(--text-secondary)" }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}><span>Subtotal</span><span>{total.toFixed(2)}</span></div>
              <div style={{ display: "flex", justifyContent: "space-between" }}><span>Service fee</span><span>2.00</span></div>
              {fulfil === "Delivery" ? <div style={{ display: "flex", justifyContent: "space-between" }}><span>Delivery</span><span>8.00</span></div> : null}
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 16, fontWeight: 600, color: "var(--text-primary)", marginTop: 4 }}><span>Total</span><span>AED {(total + 2 + (fulfil === "Delivery" ? 8 : 0)).toFixed(2)}</span></div>
            </div>
            <Button size="lg" fullWidth onClick={() => setStage("confirmed")}>Place order</Button>
          </aside>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100%", height: mobile ? "100%" : undefined, display: mobile ? "flex" : undefined, flexDirection: "column", overflow: mobile ? "hidden" : undefined, background: "var(--surface-canvas)", color: "var(--text-primary)", fontFamily: "var(--font-sans)", position: "relative" }}>
      {mobile ? <div style={{ height: 54, flex: "none" }} /> : null}
      {Header}
      <div style={{ flex: mobile ? 1 : undefined, minHeight: 0, overflowY: mobile ? "auto" : undefined }}>
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: `${mobile ? 16 : 28}px ${pad}px ${mobile ? 96 : 64}px`, display: "grid", gap: mobile ? 20 : 32 }}>
        <section style={{ display: "grid", gridTemplateColumns: mobile ? "1fr" : "1fr 1fr", gap: mobile ? 14 : 32, alignItems: "center" }}>
          <div style={{ display: "grid", gap: 12, order: mobile ? 2 : 1 }}>
            <span style={{ fontSize: 11, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--text-secondary)", fontWeight: 600 }}>Marina Walk · Open until 23:00</span>
            <h1 style={{ fontSize: mobile ? 28 : 44, lineHeight: 1.1, letterSpacing: "-.025em", fontWeight: 600 }}>Coffee worth quoting.</h1>
            <p style={{ fontSize: mobile ? 14 : 16, color: "var(--text-secondary)", maxWidth: 420 }}>Order ahead for collection, or get it delivered across Dubai Marina in under 45 minutes.</p>
            <div style={{ display: "flex", gap: 10 }}><Button size={mobile ? "md" : "lg"} onClick={() => setCat("Coffee")}>Order now</Button><Button size={mobile ? "md" : "lg"} variant="secondary">See locations</Button></div>
          </div>
          <Placeholder label="Hero image" ratio={mobile ? "16 / 9" : "5 / 4"} radius={16} style={{ order: mobile ? 1 : 2 }} />
        </section>

        <div id="sf-menu" style={{ position: "sticky", top: mobile ? 0 : 64, zIndex: 4, background: "var(--surface-canvas)", padding: "10px 0", display: "flex", gap: 8, overflowX: "auto", scrollbarWidth: "none" }}>
          {STORE_CATEGORIES.map((c) => (
            <button key={c} type="button" onClick={() => setCat(c)} style={{ flex: "none", height: 34, padding: "0 14px", borderRadius: 999, border: `1px solid ${cat === c ? "var(--text-primary)" : "var(--border-default)"}`, background: cat === c ? "var(--text-primary)" : "var(--surface-default)", color: cat === c ? "#fff" : "var(--text-primary)", fontSize: 13, fontWeight: 500, cursor: "pointer", whiteSpace: "nowrap" }}>{c}</button>
          ))}
        </div>

        <section style={{ display: "grid", gap: 14 }}>
          <h2 style={{ fontSize: mobile ? 20 : 24, fontWeight: 600, letterSpacing: "-.015em" }}>{cat}</h2>
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))`, gap: mobile ? 12 : 20 }}>
            {visible.map((p) => (
              <button key={p.id} type="button" disabled={p.soldOut} onClick={() => setSheet(p)} style={{ textAlign: "left", padding: 0, background: "var(--surface-default)", border: "1px solid var(--border-subtle)", borderRadius: 14, overflow: "hidden", cursor: p.soldOut ? "not-allowed" : "pointer", color: "inherit", opacity: p.soldOut ? 0.6 : 1, display: "grid" }}>
                <div style={{ position: "relative" }}>
                  <Placeholder label={p.name} radius={0} ratio="4 / 3" style={{ border: "none", borderBottom: "1px solid var(--border-subtle)" }} />
                  {p.popular ? <span style={{ position: "absolute", top: 10, left: 10 }}><Badge tone="neutral">Popular</Badge></span> : null}
                  {p.soldOut ? <span style={{ position: "absolute", top: 10, left: 10 }}><Badge tone="error">Sold out today</Badge></span> : null}
                </div>
                <div style={{ padding: mobile ? 12 : 14, display: "grid", gap: 4 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: mobile ? 14 : 15, fontWeight: 600 }}><span>{p.name}</span><span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 500 }}>{p.price}</span></div>
                  <p style={{ fontSize: 12, lineHeight: "16px", color: "var(--text-secondary)" }}>{p.desc}</p>
                </div>
              </button>
            ))}
            {!visible.length ? <p style={{ color: "var(--text-secondary)", fontSize: 14 }}>Nothing in this category at Marina Walk right now.</p> : null}
          </div>
        </section>

        {!mobile ? (
          <footer style={{ borderTop: "1px solid var(--border-subtle)", paddingTop: 24, display: "flex", justifyContent: "space-between", gap: 24, fontSize: 12, color: "var(--text-tertiary)", flexWrap: "wrap" }}>
            <span>© 2026 Quotes Hospitality LLC · Dubai</span>
            <span style={{ display: "flex", gap: 16 }}><a href="#">Allergens</a><a href="#">Privacy</a><a href="#">Terms</a></span>
            <span>Powered by QOS</span>
          </footer>
        ) : null}
      </div>

      {mobile && count ? (
        <div style={{ position: "sticky", bottom: 0, padding: "10px 16px 20px", background: "linear-gradient(180deg, rgba(248,250,252,0), var(--surface-canvas) 40%)" }}>
          <Button size="lg" fullWidth onClick={() => setCartOpen(true)}><span style={{ display: "flex", justifyContent: "space-between", width: "100%" }}><span>View order · {count}</span><span>AED {total.toFixed(2)}</span></span></Button>
        </div>
      ) : null}

      </div>
      {sheet ? (
        <div onClick={() => setSheet(null)} style={{ position: mobile ? "absolute" : "fixed", inset: 0, background: "rgba(11,15,26,.48)", zIndex: 20, display: "grid", alignItems: mobile ? "end" : "center", justifyItems: "center", padding: mobile ? 0 : 24 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: mobile ? "100%" : 440, background: "var(--surface-default)", borderRadius: mobile ? "16px 16px 0 0" : 16, overflow: "hidden", boxShadow: "var(--shadow-xl)", maxHeight: "92%", display: "grid", gridTemplateRows: "auto 1fr auto" }}>
            <Placeholder label={sheet.name} radius={0} ratio="16 / 9" style={{ border: "none" }} />
            <div style={{ padding: 20, display: "grid", gap: 16, overflowY: "auto" }}>
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 18, fontWeight: 600 }}><span>{sheet.name}</span><span style={{ fontVariantNumeric: "tabular-nums" }}>AED {sheet.price}</span></div>
                <p style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 4 }}>{sheet.desc}</p>
              </div>
              {sheet.mods ? (
                <>
                  <div style={{ display: "grid", gap: 8 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>Milk <span style={{ fontWeight: 400, color: "var(--text-tertiary)" }}>· choose one</span></div>
                    {[["Whole", ""], ["Skimmed", ""], ["Oat", "+2.00"]].map(([m, extra]) => (
                      <label key={m} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14, cursor: "pointer" }}>
                        <Radio name="milk" checked={milk === m} onChange={() => setMilk(m)} /><span style={{ flex: 1 }}>{m}</span><span style={{ fontSize: 12, color: "var(--text-secondary)" }}>{extra}</span>
                      </label>
                    ))}
                  </div>
                  <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14, cursor: "pointer" }}>
                    <Checkbox checked={shot} onChange={(e) => setShot(e.target.checked)} /><span style={{ flex: 1 }}>Extra shot</span><span style={{ fontSize: 12, color: "var(--text-secondary)" }}>+4.00</span>
                  </label>
                </>
              ) : null}
            </div>
            <div style={{ padding: "12px 20px 20px", borderTop: "1px solid var(--border-subtle)", display: "flex", gap: 10 }}>
              <Button variant="secondary" onClick={() => setSheet(null)}>Cancel</Button>
              <Button fullWidth onClick={() => add(sheet)}>Add · AED {(sheet.price + (shot ? 4 : 0) + (milk === "Oat" ? 2 : 0)).toFixed(2)}</Button>
            </div>
          </div>
        </div>
      ) : null}

      {cartOpen ? (
        <div onClick={() => setCartOpen(false)} style={{ position: mobile ? "absolute" : "fixed", inset: 0, background: "rgba(11,15,26,.48)", zIndex: 20, display: "flex", justifyContent: "flex-end", alignItems: mobile ? "flex-end" : "stretch" }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: mobile ? "100%" : 400, maxHeight: mobile ? "85%" : "100%", background: "var(--surface-default)", borderRadius: mobile ? "16px 16px 0 0" : 0, display: "grid", gridTemplateRows: "auto 1fr auto", boxShadow: "var(--shadow-xl)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderBottom: "1px solid var(--border-subtle)" }}>
              <span style={{ fontSize: 16, fontWeight: 600 }}>Your order</span><IconButton icon="x" label="Close" size="sm" onClick={() => setCartOpen(false)} />
            </div>
            <div style={{ padding: 20, overflowY: "auto", display: "grid", gap: 14, alignContent: "start" }}>
              {!cart.length ? <p style={{ fontSize: 14, color: "var(--text-secondary)" }}>Your order is empty. Add something from the menu.</p> : null}
              {cart.map((c, i) => { const p = STORE_PRODUCTS.find((x) => x.id === c.id); return (
                <div key={i} style={{ display: "flex", gap: 12, alignItems: "center", fontSize: 14 }}>
                  <span style={{ flex: 1, minWidth: 0 }}><span style={{ fontWeight: 500 }}>{p.name}</span>{c.note ? <span style={{ display: "block", fontSize: 12, color: "var(--text-secondary)" }}>{c.note}</span> : null}</span>
                  <span style={{ display: "inline-flex", alignItems: "center", border: "1px solid var(--border-default)", borderRadius: 8, height: 32 }}>
                    <button type="button" onClick={() => setCart((cs) => cs.map((x, j) => j === i ? { ...x, qty: x.qty - 1 } : x).filter((x) => x.qty > 0))} style={{ width: 32, height: 30, border: "none", background: "none", cursor: "pointer", color: "inherit" }}>−</button>
                    <span style={{ width: 20, textAlign: "center", fontVariantNumeric: "tabular-nums" }}>{c.qty}</span>
                    <button type="button" onClick={() => setCart((cs) => cs.map((x, j) => j === i ? { ...x, qty: x.qty + 1 } : x))} style={{ width: 32, height: 30, border: "none", background: "none", cursor: "pointer", color: "inherit" }}>+</button>
                  </span>
                  <span style={{ width: 56, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{(c.qty * c.price).toFixed(2)}</span>
                </div>
              ); })}
            </div>
            <div style={{ padding: "14px 20px 20px", borderTop: "1px solid var(--border-subtle)", display: "grid", gap: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 15, fontWeight: 600 }}><span>Subtotal</span><span>AED {total.toFixed(2)}</span></div>
              <Button size="lg" fullWidth disabled={!cart.length} onClick={() => { setCartOpen(false); setStage("checkout"); }}>Go to checkout</Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
