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
    icon: [
      { url: "/favicon-16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-64.png", sizes: "64x64", type: "image/png" },
      { url: "/favicon.ico", type: "image/x-icon" },
    ],
    shortcut: "/favicon.ico",
    apple: "/apple-touch-icon.png",
  },
  manifest: "/manifest.webmanifest",
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

