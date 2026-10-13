import Link from "next/link";
import { formatAge, formatApr, formatNumber, formatRelative, formatUsd, NA } from "@/lib/format";
import type { Stats } from "@/server/queries";

/**
 * Header summary cards. Each card states its own caveat, because these are the
 * numbers most likely to be quoted out of context.
 */
export function StatsCards({ stats }: { stats: Stats }) {
  const cards = [
    {
      label: "Tracked Liquidity",
      value: formatUsd(stats.trackedLiquidityUsd, { compact: true }),
      hint: "Sum of liquidity across tracked pools — not Arc's total TVL.",
    },
    {
      label: "Tracked Pools",
      value: formatNumber(stats.trackedPools),
      hint: `${stats.stalePools} pool(s) missing from the latest sync are marked stale.`,
    },
    {
      label: "Tracked 24H Volume",
      value: formatUsd(stats.trackedVolume24hUsd, { compact: true }),
      hint: "Pool-level volume; routed trades may be counted more than once.",
    },
    {
      label: "Highest Est. Fee APR",
      value: stats.highestApr ? formatApr(stats.highestApr.apr24h) : NA,
      hint: stats.highestApr
        ? `${stats.highestApr.baseSymbol ?? "?"}/${
            stats.highestApr.quoteSymbol ?? "?"
          } · ${formatUsd(stats.highestApr.liquidityUsd, { compact: true })} liquidity, ${
            formatUsd(stats.highestApr.volume24hUsd, { compact: true })
          } 24h volume, age ${formatAge(stats.highestApr.poolCreatedAt)} · ${
            stats.highestApr.confidence
          }. Pools under $10K are excluded, but size the number against its liquidity.`
        : "No pool currently has a verifiable fee rate above the liquidity floor.",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {cards.map((card) => {
        const body = (
          <>
            <div className="text-xs uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
              {card.label}
            </div>
            <div className="tnum mt-1 text-2xl font-semibold">{card.value}</div>
            <div className="mt-1 text-[11px] leading-snug" style={{ color: "var(--text-muted)" }}>
              {card.hint}
            </div>
          </>
        );
        const href =
          card.label === "Highest Est. Fee APR" && stats.highestApr
            ? `/pools/${encodeURIComponent(stats.highestApr.poolKey)}`
            : null;
        return href ? (
          <Link
            key={card.label}
            href={href}
            className="rounded-lg border p-4 transition-colors hover:border-[var(--color-accent-500)]"
            style={{ borderColor: "var(--border)", background: "var(--surface-raised)" }}
          >
            {body}
          </Link>
        ) : (
          <div
            key={card.label}
            className="rounded-lg border p-4"
            style={{ borderColor: "var(--border)", background: "var(--surface-raised)" }}
          >
            {body}
          </div>
        );
      })}
    </div>
  );
}

export function CoverageBar({
  stats,
  status,
}: {
  stats: Stats;
  status: { lastSuccessAt: string | null; lastError: string | null } | undefined;
}) {
  const updated = status?.lastSuccessAt ?? stats.updatedAt;
  const degraded = Boolean(status?.lastError);
  return (
    <div
      className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border px-3 py-2 text-xs"
      style={{
        borderColor: degraded ? "color-mix(in srgb, var(--color-warn-500) 45%, transparent)" : "var(--border)",
        color: "var(--text-muted)",
      }}
    >
      <span>
        Arc Mainnet · chainId <span className="tnum">{stats.chainId}</span> ·{" "}
        {formatNumber(stats.trackedPools)} pools tracked
      </span>
      <span>
        Last sync: <span className="tnum">{formatRelative(updated)}</span>
      </span>
      <span>
        APR available for{" "}
        <span className="tnum">
          {stats.poolsWithApr}/{stats.trackedPools}
        </span>{" "}
        pools
      </span>
      {degraded ? (
        <span style={{ color: "var(--color-warn-500)" }}>
          Last sync reported a problem — showing the most recent successful values.
        </span>
      ) : null}
      <Link href="/methodology" className="ml-auto underline">
        Data sources &amp; methodology
      </Link>
    </div>
  );
}