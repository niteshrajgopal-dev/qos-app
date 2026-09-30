import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Geist_Mono, Inter, Noto_Sans_Arabic } from "next/font/google";
import localFont from "next/font/local";

import { StaffLocaleProvider } from "@/components/staff/StaffLocaleProvider";
import "./globals.css";

/* QOS Display and QOS Sans ship with the approved portal design as OpenType binaries.
   Licence: src/app/fonts/LICENSE.txt (URW base35, AGPL-3 with font exception). */
const qosDisplay = localFont({
  src: "./fonts/qos-display.otf",
  variable: "--font-qos-display",
  display: "swap",
});

const qosSans = localFont({
  src: [
    { path: "./fonts/qos-sans.otf", weight: "400", style: "normal" },
    { path: "./fonts/qos-sans-bold.otf", weight: "700", style: "normal" },
  ],
  variable: "--font-qos-sans",
  display: "swap",
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const notoArabic = Noto_Sans_Arabic({
  variable: "--font-arabic",
  subsets: ["arabic"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "QOS",
  description: "QOS staff application",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      data-qos-theme="dark"
      className={`${qosDisplay.variable} ${qosSans.variable} ${inter.variable} ${notoArabic.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <StaffLocaleProvider>{children}</StaffLocaleProvider>
      </body>
    </html>
  );
}
