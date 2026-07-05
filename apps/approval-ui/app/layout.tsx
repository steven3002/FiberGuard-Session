import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "FiberGuard Approval",
  description: "Approve, deny, and revoke FiberGuard payment sessions",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <a href="/" className="brand">
            FiberGuard <span>Session</span>
          </a>
          <span className="tagline">Scoped, revocable, spend-limited Fiber access</span>
        </header>
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
