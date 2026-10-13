import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "ArcPools — Arc Liquidity & Yield Explorer",
  description:
    "Independent Arc liquidity pool leaderboard: POOL, MCAP, AGE, APR, LIQ, VOL 24H and HOLDERS for every tracked Arc liquidity pool. Not affiliated with Circle or Arc.",
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://arcpools.website"),
};

const NAV = [
  { href: "/", label: "Pools" },
  { href: "/new", label: "New Pools" },
  { href: "/methodology", label: "Methodology" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark">
      <body className="min-h-screen antialiased">
        <header className="border-b" style={{ borderColor: "var(--border)" }}>
          <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-6 gap-y-3 px-4 py-4">
            <Link href="/" className="flex items-baseline gap-2">
              <span className="text-lg font-semibold tracking-tight">ArcPools</span>
              <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                Arc Liquidity &amp; Yield Explorer
              </span>
            </Link>
            <nav className="flex items-center gap-1 text-sm">
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="rounded-md px-3 py-1.5 transition-colors hover:bg-[var(--surface-raised)]"
                  style={{ color: "var(--text-muted)" }}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
            <div
              className="ml-auto flex items-center gap-2 text-xs"
              style={{ color: "var(--text-muted)" }}
            >
              <span className="rounded border px-2 py-0.5">Arc Mainnet · 5042</span>
              <span>Independent analytics tool; not affiliated with Circle or Arc.</span>
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-[1400px] px-4 py-6">{children}</main>

        <footer
          className="mt-10 border-t py-6 text-xs"
          style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
        >
          <div className="mx-auto max-w-[1400px] px-4 space-y-2">
            <p className="font-semibold" style={{ color: "var(--text)" }}>
              ArcPools is a research tool, not investment advice.
            </p>
            <p>
              Historical volume, fees and high APR do not predict future returns. Active
              liquidity provision carries impermanent loss, token price risk, contract risk and
              exit risk. APR shown here is a pool-level fee annualization, not a position or wallet
              return.
            </p>
            <p>
              Data sources:{" "}
              <a className="underline" href="https://www.geckoterminal.com/arc/pools" rel="noreferrer noopener" target="_blank">
                GeckoTerminal
              </a>{" "}
              and{" "}
              <a className="underline" href="https://dexpaprika.com/arc" rel="noreferrer noopener" target="_blank">
                DexPaprika
              </a>
              . APR values are estimates computed by ArcPools.
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}