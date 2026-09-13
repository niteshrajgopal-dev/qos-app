import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Geist_Mono, Inter, Noto_Sans_Arabic } from "next/font/google";

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

export const metadata: Metadata = {
  title: "QOS",
  description: "QOS staff application",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      data-qos-theme="light"
      className={`${inter.variable} ${notoArabic.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <StaffLocaleProvider>{children}</StaffLocaleProvider>
      </body>
    </html>
  );
}
