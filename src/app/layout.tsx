import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Geist_Mono, Inter, Noto_Sans_Arabic, Playfair_Display } from "next/font/google";

import { StaffLocaleProvider } from "@/components/staff/StaffLocaleProvider";
import "./globals.css";

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

const playfair = Playfair_Display({
  variable: "--font-serif",
  subsets: ["latin"],
  weight: ["400", "600", "700"],
});

export const metadata: Metadata = {
  title: "QOS — Business, in perspective",
  description: "QOS staff application",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      data-qos-theme="light"
      className={`${inter.variable} ${notoArabic.variable} ${geistMono.variable} ${playfair.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <StaffLocaleProvider>{children}</StaffLocaleProvider>
      </body>
    </html>
  );
}
