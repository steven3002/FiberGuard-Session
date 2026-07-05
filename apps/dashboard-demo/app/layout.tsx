import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "FiberGuard Dashboard Demo",
  description: "Read-only node and channel access",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <span className="brand">
            FiberGuard <span>Dashboard Demo</span>
          </span>
          <span className="tagline">:3003 · uses @fiberguard/session against the gateway</span>
        </header>
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
