import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "FiberGuard Merchant Demo",
  description: "Invoice creation without payment authority",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <span className="brand">
            FiberGuard <span>Merchant Demo</span>
          </span>
          <span className="tagline">:3002 · uses @fiberguard/session against the gateway</span>
        </header>
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
