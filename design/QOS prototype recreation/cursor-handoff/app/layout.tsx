import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "QOS — Business, in perspective",
  description: "QOS interactive design prototype. Orders, catalogue, menus and storefronts in one cinematic workspace.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
