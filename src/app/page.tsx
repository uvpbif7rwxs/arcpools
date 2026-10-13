import Link from "next/link";
import { StatsCards, CoverageBar } from "@/components/stats-cards";
import { FilterBar, readFilters } from "@/components/filter-bar";
import { Pagination } from "@/components/table-chrome";
import { getStats, getSyncStatus, queryPools, DEFAULT_MIN_LIQ_USD } from "@/server/queries";
import { formatRelative } from "@/lib/format";
import { PoolRowView } from "@/components/pool-row";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const PAGE_SIZE = 50;

type Search = Record<string, string | string[] | undefined>;

export default async function PoolsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const filters = readFilters(sp);
  const stats = getStats();
  const [syncJob] = getSyncStatus();

  const result = queryPools({
    sort: filters.sort,
    order: filters.order === "asc" ? "asc" : "desc",
    page: Number(filters.page) || 1,
    limit: PAGE_SIZE,
    minLiq: filters.minLiq === "all" ? null : Number(filters.minLiq) || DEFAULT_MIN_LIQ_USD,
    minApr: filters.minApr ? Number(filters.minApr) : null,
    maxAgeHours: filters.maxAgeHours ? Number(filters.maxAgeHours) : null,
    dex: filters.dex || null,
    search: filters.search || null,
  });

  const isEmptyDb = stats.trackedPools === 0;

  return (
    <div className="space-y-4">
      <section className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          Arc Liquidity &amp; Yield Explorer
        </h1>
        <p className="max-w-3xl text-sm" style={{ color: "var(--text-muted)" }}>
          Every tracked liquidity pool on Arc Mainnet, ranked by liquidity with fee APR,
          market cap, age and volume alongside. APR is a pool-level fee annualization computed
          from 24h volume and the pool&apos;s own fee tier — not a position return, and not
          investment advice.
        </p>
      </section>

      <StatsCards stats={stats} />
      <CoverageBar stats={stats} status={syncJob} />

      {isEmptyDb ? (
        <div
          className="rounded-lg border p-8 text-sm"
          style={{ borderColor: "var(--color-warn-500)", color: "var(--color-warn-500)" }}
        >
          <p className="font-semibold">No pool data has been synced yet.</p>
          <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
            Run <code className="rounded px-1" style={{ background: "var(--surface-raised)" }}>npm run sync</code>{" "}
            to pull live Arc pools from GeckoTerminal and DexPaprika. Production data is never
            replaced with demo numbers.
          </p>
        </div>
      ) : (
        <>
          <FilterBar filters={filters} dexes={stats.dexes} resultCount={result.total} />

          <div className="scroll-x rounded-lg border" style={{ borderColor: "var(--border)" }}>
            <table className="pool-table">
              <thead>
                <tr>
                  <th className="w-12">#</th>
                  <th>Pool</th>
                  <th className="text-right">MCAP</th>
                  <th className="text-right">AGE</th>
                  <th className="text-right">Est. Fee APR</th>
                  <th className="text-right">LIQ</th>
                  <th className="text-right">VOL 24H</th>
                  <th className="text-right">HOLDERS</th>
                  <th>Flags</th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row, index) => (
                  <PoolRowView key={row.poolKey} row={row} rank={(result.page - 1) * result.limit + index + 1} />
                ))}
              </tbody>
            </table>
          </div>

          {result.rows.length === 0 ? (
            <div
              className="rounded-lg border p-10 text-center text-sm"
              style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
            >
              No pools match these filters.
              <span className="mt-1 block text-xs">
                Many Arc pools sit below the $10K liquidity floor — try “All” liquidity or clear the
                search.
              </span>
            </div>
          ) : null}

          <Pagination
            filters={filters}
            page={result.page}
            pageCount={result.pageCount}
            total={result.total}
            limit={result.limit}
          />

          <section className="grid gap-3 pt-2 text-xs md:grid-cols-3" style={{ color: "var(--text-muted)" }}>
            <p>
              <span className="font-semibold" style={{ color: "var(--text)" }}>
                How to read this table
              </span>
              <br />
              Ranking uses the full tracked set, then the requested page is sliced — filters never
              change what &quot;rank 1&quot; means.
            </p>
            <p>
              <span className="font-semibold" style={{ color: "var(--text)" }}>
                N/A means unknown
              </span>
              <br />
              A missing metric is never shown as 0. Hover any N/A to see why it is unavailable.
            </p>
            <p>
              <span className="font-semibold" style={{ color: "var(--text)" }}>
                Coverage
              </span>
              <br />
              GeckoTerminal&apos;s keyless API caps discovery, so tracked pools are a lower bound —
              not all of Arc. Synced {formatRelative(syncJob?.lastSuccessAt ?? null)}.
              {" "}
              <Link href="/methodology" className="underline">
                Full methodology
              </Link>
              .
            </p>
          </section>
        </>
      )}
    </div>
  );
}
