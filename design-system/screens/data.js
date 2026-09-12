/* Fake data for the QOS platform UI kit. Object names follow the qosapp domain model
   (tenants → organizations → brands → locations; storefronts, releases, catalogue, menus). */
const TENANTS = [
  { id: "quotes", name: "Quotes", meta: "12 locations · AED · hospitality" },
  { id: "petal", name: "Petal & Stem", meta: "3 locations · AED · generic retail" },
];

const NAV = [
  { items: [
    { id: "home", label: "Home", icon: "layout-dashboard" },
    { id: "orders", label: "Orders", icon: "receipt", count: 9 },
  ] },
  { label: "Commerce", items: [
    { id: "catalogue", label: "Catalogue", icon: "package", children: [
      { id: "catalogue", label: "Products", count: 1583 },
      { id: "menus", label: "Menus", count: 6 },
      { id: "modifiers", label: "Modifier groups", count: 24 },
      { id: "categories", label: "Categories", count: 18 },
    ] },
    { id: "customers", label: "Customers", icon: "users" },
    { id: "channels", label: "Sales Channels", icon: "store", children: [
      { id: "channels", label: "All channels" },
      { id: "store", label: "Online Store" },
      { id: "pos", label: "POS" },
    ] },
    { id: "locations", label: "Locations", icon: "map-pin", count: 12 },
  ] },
  { label: "Platform", items: [
    { id: "integrations", label: "Integrations", icon: "plug", count: 2 },
    { id: "analytics", label: "Analytics", icon: "bar-chart-3" },
    { id: "team", label: "Team", icon: "shield-check" },
    { id: "settings", label: "Settings", icon: "settings" },
  ] },
];

const ORDERS = [
  { id: "QO-10428", customer: "A. Rahman", channel: "Online Store", location: "Marina Walk", state: "failed", fulfilment: "Delivery", payment: "Authorised", amount: "184.00", time: "14:06", exception: true, issue: "Not sent to POS" },
  { id: "QO-10427", customer: "L. Fernandes", channel: "POS", location: "Downtown", state: "live", fulfilment: "Dine-in", payment: "Paid", amount: "62.50", time: "14:04" },
  { id: "QO-10426", customer: "S. Habib", channel: "Deliveroo", location: "Marina Walk", state: "processing", fulfilment: "Delivery", payment: "Paid", amount: "96.00", time: "14:01" },
  { id: "QO-10425", customer: "M. Okafor", channel: "Online Store", location: "Al Quoz", state: "published", fulfilment: "Collection", payment: "Paid", amount: "241.75", time: "13:58" },
  { id: "QO-10424", customer: "N. Sharma", channel: "Online Store", location: "Marina Walk", state: "failed", fulfilment: "Delivery", payment: "Authorised", amount: "77.25", time: "13:54", exception: true, issue: "Not sent to POS" },
  { id: "QO-10423", customer: "K. Mensah", channel: "POS", location: "Downtown", state: "published", fulfilment: "Dine-in", payment: "Paid", amount: "128.00", time: "13:49" },
  { id: "QO-10422", customer: "R. Iyer", channel: "Talabat", location: "Al Quoz", state: "paused", fulfilment: "Delivery", payment: "Pending", amount: "54.00", time: "13:41", exception: true, issue: "Payment pending 24m" },
  { id: "QO-10421", customer: "D. Costa", channel: "Online Store", location: "Marina Walk", state: "published", fulfilment: "Collection", payment: "Paid", amount: "33.50", time: "13:37" },
];

const PRODUCTS = [
  { id: "flat-white", name: "Flat white", category: "Coffee", variants: 3, price: "18.00 – 24.00", state: "published", channels: "Online Store, POS, Deliveroo", availability: "12 of 12" },
  { id: "cortado", name: "Cortado", category: "Coffee", variants: 2, price: "16.00", state: "published", channels: "Online Store, POS", availability: "12 of 12" },
  { id: "cold-brew", name: "Cold brew", category: "Coffee", variants: 2, price: "22.00", state: "draft", channels: "—", availability: "0 of 12" },
  { id: "avo-toast", name: "Avocado toast", category: "Kitchen", variants: 1, price: "38.00", state: "published", channels: "Online Store, POS", availability: "9 of 12", exception: true },
  { id: "banana-bread", name: "Banana bread", category: "Bakery", variants: 1, price: "21.00", state: "published", channels: "Online Store, POS, Talabat", availability: "12 of 12" },
  { id: "matcha-latte", name: "Matcha latte", category: "Tea", variants: 3, price: "24.00 – 29.00", state: "archived", channels: "—", availability: "0 of 12" },
];

const LOCATIONS = [
  { id: "marina", name: "Marina Walk", city: "Dubai Marina", state: "warning", channels: "Online Store, POS, Deliveroo", fulfilment: "Delivery, Collection, Dine-in", hours: "Open until 23:00", integration: "error", exception: true },
  { id: "downtown", name: "Downtown", city: "Sheikh Mohammed Bin Rashid Blvd", state: "active", channels: "Online Store, POS", fulfilment: "Collection, Dine-in", hours: "Open until 00:00", integration: "connected" },
  { id: "alquoz", name: "Al Quoz", city: "Alserkal Avenue", state: "active", channels: "Online Store, POS, Talabat", fulfilment: "Delivery, Collection", hours: "Open until 22:00", integration: "connected" },
  { id: "jbr", name: "JBR Beachfront", city: "Jumeirah Beach Residence", state: "paused", channels: "Online Store", fulfilment: "Collection", hours: "Closed · reopens 07:00", integration: "connected" },
];

const CHANNELS = [
  { id: "store", name: "Online Store", kind: "QOS Storefront", icon: "globe", state: "live", locations: "12 of 12", catalogue: "Main menu", sync: "synced", activity: "Release 42 published 4h ago", domain: "quotes.qosapp.com" },
  { id: "pos", name: "Lightspeed POS", kind: "Point of sale", icon: "monitor", state: "error", locations: "12 of 12", catalogue: "Mirrored", sync: "out_of_sync", activity: "9 orders failed since 14:02" },
  { id: "deliveroo", name: "Deliveroo", kind: "Delivery marketplace", icon: "truck", state: "live", locations: "4 of 12", catalogue: "Delivery menu", sync: "synced", activity: "Menu synced 20m ago" },
  { id: "talabat", name: "Talabat", kind: "Delivery marketplace", icon: "truck", state: "paused", locations: "2 of 12", catalogue: "Delivery menu", sync: "synced", activity: "Paused by Jamie Doyle 2d ago" },
  { id: "kiosk", name: "Self-order kiosk", kind: "In-store", icon: "tablet", state: "available", locations: "—", catalogue: "—", sync: "disconnected", activity: "Not connected" },
  { id: "whatsapp", name: "WhatsApp ordering", kind: "Messaging", icon: "message-circle", state: "available", locations: "—", catalogue: "—", sync: "disconnected", activity: "Not connected" },
];

const INTEGRATIONS = [
  { id: "lightspeed", name: "Lightspeed", kind: "POS", state: "error", health: "9 failed calls in the last hour", locations: "12 mapped", icon: "monitor" },
  { id: "stripe", name: "Stripe", kind: "Payments", state: "connected", health: "Healthy · 0 failures today", locations: "12 mapped", icon: "credit-card" },
  { id: "deliveroo", name: "Deliveroo", kind: "Delivery", state: "connected", health: "Healthy · menu synced 20m ago", locations: "4 mapped", icon: "truck" },
  { id: "talabat", name: "Talabat", kind: "Delivery", state: "config_required", health: "Location mapping incomplete", locations: "2 of 3 mapped", icon: "truck" },
  { id: "xero", name: "Xero", kind: "Accounting", state: "available", health: "Not connected", locations: "—", icon: "book-open" },
  { id: "klaviyo", name: "Klaviyo", kind: "CRM", state: "available", health: "Not connected", locations: "—", icon: "users" },
  { id: "finedine", name: "FineDine", kind: "Menu import", state: "connected", health: "Healthy · last import 2d ago", locations: "12 mapped", icon: "package" },
  { id: "twilio", name: "Twilio", kind: "Messaging", state: "available", health: "Not connected", locations: "—", icon: "message-circle" },
];

const RELEASES = [
  { id: 42, version: "Release 42", date: "12 Sep 2026, 09:14", user: "Jamie Doyle", changes: "Homepage hero, 3 pages, opening hours", state: "published", active: true },
  { id: 41, version: "Release 41", date: "08 Sep 2026, 17:02", user: "Priya Nair", changes: "Menu assignment, footer links", state: "published" },
  { id: 40, version: "Release 40", date: "02 Sep 2026, 11:20", user: "Jamie Doyle", changes: "Brand colours, logo", state: "published" },
  { id: 39, version: "Release 39", date: "29 Aug 2026, 08:47", user: "System", changes: "Domain verification", state: "failed" },
];

const ORDER_TREND = [12, 18, 15, 24, 21, 30, 27, 34, 29, 38, 31, 26, 44, 39, 47, 41, 52, 48, 55, 43, 38, 30, 22, 16];
const REVENUE_TREND = [8, 12, 11, 18, 16, 22, 20, 26, 23, 30, 26, 21, 34, 31, 37, 33, 41, 38, 44, 35, 30, 24, 18, 13];

const BLOCKS = [
  { id: "hero", name: "Hero", icon: "image", note: "Image, headline, order button", state: "published" },
  { id: "categories", name: "Category navigation", icon: "layout-grid", note: "6 categories from Main menu", state: "published" },
  { id: "featured", name: "Featured products", icon: "star", note: "4 products · manual selection", state: "draft" },
  { id: "story", name: "Story / brand content", icon: "book-open", note: "Two columns, image left", state: "published" },
  { id: "locations", name: "Locations", icon: "map-pin", note: "All 12 locations, map", state: "published" },
  { id: "hours", name: "Opening hours", icon: "clock", note: "Pulled from location hours", state: "published" },
  { id: "footer", name: "Footer", icon: "panel-bottom", note: "Links, socials, legal", state: "published" },
];

Object.assign(window, { TENANTS, NAV, ORDERS, PRODUCTS, LOCATIONS, CHANNELS, INTEGRATIONS, RELEASES, ORDER_TREND, REVENUE_TREND, BLOCKS });
