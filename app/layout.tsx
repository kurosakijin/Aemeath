import type { Metadata } from "next";
import "./globals.css";
import DesktopTitlebar from "./desktop-titlebar";

export const metadata: Metadata = {
  title: "Aemeath — Your people. Your place.",
  description: "Private servers and conversations for you and your friends.",
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
      <body className="antialiased"><DesktopTitlebar/>{children}</body>
    </html>
  );
}

