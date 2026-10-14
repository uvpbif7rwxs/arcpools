import Link from "next/link";
import { Activity, Droplets, Gauge, Repeat2 } from "lucide-react";
import { formatAge, formatApr, formatNumber, formatRelative, formatUsd, NA } from "@/lib/format";
import { TONE } from "@/lib/brand";
import type { Stats } from "@/server/queries";

/**
 * Header summary cards.
 *
 * Each card carries its own caveat, because these are the numbers most likely to
 * be quoted out of context: "Tracked Liquidity" is not Arc's TVL, and the
 * headline APR is one pool out of a set that contains a lot of wash-traded dust.
 *
 * The complete caveat list is also rendered verbatim underneath the cards, so a
 * caveat can never be lost because it did not fit beside one number.
 */
export function StatsCards({ stats }: { stats: Stats }) {
  const cards = [
    {
      id: "liquidity" as const,
      label: "Tracked Liquidity",
      value: formatUsd(stats.trackedLiquidityUsd, { compact: true }),
      hint: "Summed across tracked pools.",
      caveat: "Tracked Liquidity is the sum across pools ArcPools has catalogued. It is not Arc's total value locked.",
      Icon: Droplets,
      tone: "accent" as const,
    },
    {
      id: "pools" as const,
      label: "Tracked Pools",
      value: formatNumber(stats.trackedPools),
      hint: "Arc mainnet pools recorded by the sync job.",
      caveat: `Only pools a configured source returned are counted; a DEX we do not index is absent.${stats.stalePools ? ` ${stats.stalePools} are marked stale because the latest sync did not reach them.` : ""}`,
      Icon: Activity,
      tone: "neutral" as const,
    },
    {
      id: "volume" as const,
      label: "Tracked 24H Volume",
      value: formatUsd(stats.trackedVolume24hUsd, { compact: true }),
      hint: "Swap volume across tracked pools, last 24 hours.",
      caveat: "Tracked 24H Volume may double-count value that routes through more than one pool.",
      Icon: Repeat2,
      tone: "neutral" as const,
    },
    {
      id: "apr" as const,
      label: "Highest Est. Fee APR",
      value: stats.highestApr ? formatApr(stats.highestApr.apr24h) : NA,
      hint: stats.highestApr
        ? `${stats.highestApr.baseSymbol ?? "?"}/${stats.highestApr.quoteSymbol ?? "?"} · ${formatUss(
            stats.highestApr.liquidityUsd,
          )} liquidity · ${stats.highestApr.confidence}`
        : "No pool currently clears the liquidity floor with a usable fee rate.",
      caveat:
        "Highest Est. Fee APR only considers pools above $10,000 of liquidity with a usable confidence rating, so it is a floor on the maximum, not the maximum.",
      Icon: Gauge,
      // The headline APR is only allowed a success colour when the fee behind it
      // was actually read from the detail endpoint rather than guessed from a name.
      tone:
        stats.highestApr?.confidence === "verified"
          ? ("pos" as const)
          : stats.highestApr
            ? ("warn" as const)
            : ("neutral" as const),
      href: stats.highestApr ? `/pools/${encodeURIComponent(stats.highestApr.poolKey)}` : null,
      aside: stats.highestApr
        ? `${formatUsd(stats.highestApr.volume24hUsd, { compact: true })} 24h volume, pool age ${formatAge(stats.highestApr.poolCreatedAt)}.`
        : null,
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => {
          const body = (
            <>
              <div className="flex items-start justify-between gap-2">
                <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-faint">
                  {card.label}
                </div>
                <card.Icon aria-hidden className={`h-4 w-4 shrink-0 ${TONE[card.tone].text}`} />
              </div>
              <div className={`tnum mt-1.5 text-2xl font-bold tracking-tight ${TONE[card.tone].text}`}>
                {card.value}
              </div>
              <div className="mt-1 text-[11px] leading-snug text-muted">{card.hint}</div>
              {card.aside ? (
                <div className="mt-1 text-[11px] leading-snug text-faint">{card.aside}</div>
              ) : null}
              <div className="mt-2 border-t border-line pt-2 text-[11px] leading-snug text-faint">
                {card.caveat}
              </div>
            </>
          );

          return card.href ? (
            <Link key={card.id} href={card.href} className="panel panel-link p-4">
              {body}
            </Link>
          ) : (
            <div key={card.id} className="panel p-4">
              {body}
            </div>
          );
        })}
      </div>

      {/* Every caveat, verbatim, so none is lost to a layout decision. */}
      <section className="panel border-info/40 p-4">
        <h2 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-info">
          <span aria-hidden>ⓘ</span>
          Data caveats for these figures
        </h2>
        <ul className="mt-2 space-y-1 text-[11px] leading-snug text-muted">
          {cards.map((card) => (
            <li key={card.id}>{card.caveat}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function formatUss(value: number | null | undefined): string {
  return formatUsd(value, { compact: true });
}

/**
 * Coverage strip.
 *
 * This is the honesty line for the whole leaderboard: it states how much of Arc
 * is actually covered and when the data was last refreshed, so a reader can tell
 * a complete picture from a partial one. Each metric is counted separately
 * because they are collected from different places and age very differently —
 * a column that is nearly empty is a limitation, not a rendering bug.
 */
export function CoverageBar({
  stats,
  status,
}: {
  stats: Stats;
  status: { lastSuccessAt: string | null; lastError: string | null } | undefined;
}) {
  const updated = status?.lastSuccessAt ?? stats.updatedAt;
  const degraded = Boolean(status?.lastError);

  const metrics: { label: string; count: number }[] = [
    { label: "liquidity", count: stats.poolsWithLiquidity },
    { label: "APR", count: stats.poolsWithApr },
    { label: "market cap", count: stats.poolsWithMcap },
  ];

  return (
    <div className={`coverage-strip ${degraded ? TONE.warn.panel : ""}`}>
      <span className="font-semibold uppercase tracking-[0.06em]">Coverage</span>
      {metrics.map((metric) => (
        <span key={metric.label}>
          {metric.label}{" "}
          <span className={`tnum ${metric.count === 0 ? "text-faint" : "text-fg"}`}>
            {formatNumber(metric.count)}
          </span>
        </span>
      ))}
      <span>
        pools tracked{" "}
        <span className="tnum text-fg">{formatNumber(stats.trackedPools)}</span>
      </span>
      <span>
        Last sync <span className="tnum text-fg">{formatRelative(updated)}</span>
      </span>
      {degraded ? (
        <span className={TONE.warn.text}>
          Last sync reported a problem — showing the most recent successful values.
        </span>
      ) : null}
      <Link href="/methodology" className="ml-auto text-accent underline-offset-2 hover:underline">
        Data sources &amp; methodology
      </Link>
    </div>
  );
}
