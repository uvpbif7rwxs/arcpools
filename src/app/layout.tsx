import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";
import { ThemeToggle, THEME_BOOTSTRAP } from "@/components/theme-toggle";
import { BRAND, BRAND_COLORS } from "@/lib/brand";
import "./globals.css";

const SITE_DESCRIPTION =
  "Independent Arc liquidity pool leaderboard: POOL, MCAP, AGE, APR, LIQ and VOL 24H for every tracked Arc liquidity pool. Not affiliated with Circle or Arc.";

export const metadata: Metadata = {
  title: "ArcPools — Arc Liquidity & Yield Explorer",
  description: SITE_DESCRIPTION,
  applicationName: BRAND.name,
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? `https://${BRAND.domain}`),
  openGraph: {
    type: "website",
    siteName: BRAND.name,
    title: "ArcPools — Arc Liquidity & Yield Explorer",
    description: SITE_DESCRIPTION,
    url: `https://${BRAND.domain}`,
  },
  twitter: {
    card: "summary",
    title: "ArcPools — Arc Liquidity & Yield Explorer",
    description: SITE_DESCRIPTION,
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: BRAND_COLORS.canvas },
    { media: "(prefers-color-scheme: light)", color: "#f5f7fc" },
  ],
};

const NAV = [
  { href: "/", label: "Pools" },
  { href: "/new", label: "New Pools" },
  { href: "/methodology", label: "Methodology" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body className="flex min-h-screen flex-col antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2 focus:text-sm focus:text-fg"
        >
          Skip to content
        </a>

        <header className="sticky top-0 z-40 border-b border-line bg-canvas/85 backdrop-blur-md">
          <div className="mx-auto flex w-full max-w-[1400px] items-center gap-4 px-4 py-2.5">
            <Link href="/" className="flex shrink-0 items-center gap-2" aria-label={`${BRAND.name} home`}>
              <BrandMark size={28} title={null} />
              <span className="flex flex-col leading-none">
                <span className="text-[15px] font-bold tracking-[-0.01em] text-fg">
                  {BRAND.name}
                </span>
                <span className="text-[10px] font-medium tracking-[0.02em] text-faint">
                  {BRAND.subtitle}
                </span>
              </span>
            </Link>

            <div className="flex items-center gap-1 border-l border-line pl-3">
              <a
                href="https://github.com/uvpbif7rwxs/arcpools"
                target="_blank"
                rel="noreferrer noopener"
                aria-label="ArcPools on GitHub"
                className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-surface-2 hover:text-fg"
              >
                <svg aria-hidden viewBox="0 0 24 24" className="h-[15px] w-[15px] fill-current">
                  <path d="M12 .7a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2.23c-3.22.7-3.9-1.37-3.9-1.37-.53-1.34-1.29-1.69-1.29-1.69-1.05-.72.08-.7.08-.7 1.17.08 1.78 1.2 1.78 1.2 1.04 1.77 2.72 1.26 3.38.96.1-.75.4-1.26.74-1.55-2.57-.29-5.28-1.29-5.28-5.69 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.16 1.18A11 11 0 0 1 12 6.13c.98 0 1.95.13 2.87.39 2.19-1.49 3.15-1.18 3.15-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.41-2.71 5.39-5.29 5.68.42.36.79 1.06.79 2.14v3.25c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .7Z" />
                </svg>
                <span className="hidden lg:inline">GitHub</span>
              </a>
              <a
                href="https://x.com/Arc_Pools"
                target="_blank"
                rel="noreferrer noopener"
                aria-label="ArcPools on X"
                className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-surface-2 hover:text-fg"
              >
                <svg aria-hidden viewBox="0 0 24 24" className="h-[15px] w-[15px] fill-current">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.45-6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77Z" />
                </svg>
                <span className="hidden lg:inline">X</span>
              </a>
            </div>

            <nav aria-label="Main" className="ml-auto flex items-center gap-1">
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-surface-2 hover:text-fg"
                >
                  {item.label}
                </Link>
              ))}
              <span aria-hidden className="mx-1 hidden h-4 w-px bg-line sm:block" />
              <span className="pill pill-strong hidden sm:inline-flex">
                {BRAND.network}
              </span>
              <ThemeToggle />
            </nav>
          </div>
        </header>

        <main id="main" className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-5">
          {children}
        </main>

        <footer className="mt-10 border-t border-line">
          <div className="mx-auto max-w-[1400px] space-y-2 px-4 py-6 text-xs text-muted">
            <p className="font-semibold text-fg">{BRAND.riskNotice}</p>
            <p className="max-w-4xl leading-relaxed">
              Historical volume, fees and high APR do not predict future returns. Active liquidity
              provision carries impermanent loss, token price risk, contract risk and exit risk. APR
              shown here is a pool-level fee annualization, not a position or wallet return, and it
              is not APY.
            </p>
            <p>
              Data sources:{" "}
              <a
                className="text-accent underline-offset-2 hover:underline"
                href="https://www.geckoterminal.com/arc/pools"
                rel="noreferrer noopener"
                target="_blank"
              >
                GeckoTerminal
              </a>
              {", "}
              <a
                className="text-accent underline-offset-2 hover:underline"
                href="https://dexpaprika.com/arc"
                rel="noreferrer noopener"
                target="_blank"
              >
                DexPaprika
              </a>{" "}
              and{" "}
              <a
                className="text-accent underline-offset-2 hover:underline"
                href="https://dexscreener.com/arc"
                rel="noreferrer noopener"
                target="_blank"
              >
                DexScreener
              </a>
              . APR values are estimates computed by ArcPools.
            </p>
            <p className="text-faint">{BRAND.disclaimer}</p>
          </div>
        </footer>
      </body>
    </html>
  );
}
