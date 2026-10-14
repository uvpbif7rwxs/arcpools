import { StatsCards, CoverageBar } from "@/components/stats-cards";
import { FilterBar, readFilters } from "@/components/filter-bar";
import { Pagination, SortableHeader } from "@/components/table-chrome";
import { getStats, getSyncStatus, queryPools, DEFAULT_MIN_LIQ_USD } from "@/server/queries";
import { PoolRowView } from "@/components/pool-row";
import { TONE } from "@/lib/brand";

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
      <section className="space-y-1.5">
        {/* Brand tagline. "Arc Liquidity & Yield Explorer" is the subtitle and
            belongs in the header, not in the headline slot. */}
        <h1 className="text-xl font-bold tracking-[-0.01em] text-fg sm:text-2xl">
          Find the Best Liquidity Pools on Arc.
        </h1>
        <p className="max-w-3xl text-xs leading-relaxed text-muted sm:text-sm">
          Explore Arc liquidity opportunities by comparing pool depth, trading activity and
          estimated fee APR. ArcPools highlights pools with stronger data coverage and a more
          balanced risk–return profile, helping you research higher-quality yield opportunities
          faster.
        </p>
      </section>

      <StatsCards stats={stats} />
      <CoverageBar stats={stats} status={syncJob} />

      {isEmptyDb ? (
        <div className={`panel p-8 ${TONE.warn.panel}`}>
          <p className={`font-semibold ${TONE.warn.text}`}>No pool data has been synced yet.</p>
          <p className="mt-1 text-xs text-muted">
            Run{" "}
            <code className="rounded border border-line bg-surface-2 px-1 font-mono">npm run sync</code>{" "}
            to pull live Arc pools from GeckoTerminal, DexPaprika and DexScreener. Production data is never
            replaced with demo numbers.
          </p>
        </div>
      ) : (
        <>
          <FilterBar filters={filters} dexes={stats.dexes} resultCount={result.total} />

          <div className="scroll-x panel overflow-hidden">
            <table className="pool-table">
              <thead>
                <tr>
                  <SortableHeader filters={filters} />
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row, index) => (
                  <PoolRowView
                    key={row.poolKey}
                    row={row}
                    rank={(result.page - 1) * result.limit + index + 1}
                  />
                ))}
              </tbody>
            </table>

            {result.rows.length === 0 ? (
              <div className="p-10 text-center text-sm text-muted">
                No pools match these filters.
                <span className="mt-1 block text-xs text-faint">
                  Many Arc pools sit below the $10K liquidity floor — try “All” liquidity or clear the
                  search.
                </span>
              </div>
            ) : null}
          </div>

          <Pagination
            filters={filters}
            page={result.page}
            pageCount={result.pageCount}
            total={result.total}
            limit={result.limit}
          />

          <section className="grid gap-3 pt-1 text-xs leading-relaxed text-muted md:grid-cols-2">
            <p className="panel p-3">
              <span className="font-semibold text-fg">How to read this table</span>
              <br />
              Ranking uses the full tracked set, then the requested page is sliced — filters never
              change what &quot;rank 1&quot; means.
            </p>
            <p className="panel p-3">
              <span className="font-semibold text-fg">N/A means unknown</span>
              <br />
              A missing metric is never shown as 0. Hover any <span className="na">N/A</span> to see
              why it is unavailable.
            </p>
          </section>
        </>
      )}
    </div>
  );
}
