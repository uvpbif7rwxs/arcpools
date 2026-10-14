import Link from "next/link";
import { buildHref, type FilterState } from "./filter-bar";

/**
 * Column order is fixed by the leaderboard's display fields and matches the
 * cell order rendered by `PoolRowView` (POOL, MCAP, AGE, APR, LIQ, VOL 24H; no HOLDERS column).
 *
 * These two lists must stay in step. They drifted once during a redesign — the
 * header was reordered while the body was not — which silently rendered every
 * row's market cap under a "LIQ" heading. `tests/columns.test.ts` asserts the
 * order so the mismatch cannot come back quietly.
 */
const COLUMNS: { key: string; label: string; hint: string }[] = [
  { key: "mcap", label: "MCAP", hint: "Base-token market cap; estimated values are labelled" },
  { key: "age", label: "AGE", hint: "Time since on-chain pool creation" },
  { key: "apr", label: "Est. Fee APR", hint: "24h volume × effective LP fee × 365 ÷ liquidity" },
  { key: "liq", label: "LIQ", hint: "Combined USD value of the pool's assets — the ranking metric" },
  { key: "vol24h", label: "VOL 24H", hint: "Rolling 24h volume for this pool" },
];

/**
 * Column headers are links, so every sort state is a real, shareable URL and the
 * back button works. `aria-sort` is set on the active column so the sort state is
 * available to assistive tech, not just visually.
 */
export function SortableHeader({
  filters,
  basePath = "/",
}: {
  filters: FilterState;
  basePath?: string;
}) {
  const href = (key: string) => {
    const isActive = filters.sort === key;
    const order = isActive && filters.order === "desc" ? "asc" : "desc";
    const params = new URLSearchParams();
    if (filters.search) params.set("search", filters.search);
    if (filters.minLiq && filters.minLiq !== "10000") params.set("minLiq", filters.minLiq);
    if (filters.minApr) params.set("minApr", filters.minApr);
    if (filters.maxAgeHours) params.set("maxAgeHours", filters.maxAgeHours);
    if (filters.dex) params.set("dex", filters.dex);
    params.set("sort", key);
    params.set("order", order);
    return `${basePath}?${params.toString()}`;
  };

  return (
    <>
      <th scope="col" className="w-12">
        #
      </th>
      <th scope="col">Pool</th>
      {COLUMNS.map((column) => {
        const active = filters.sort === column.key;
        return (
          <th
            key={column.key}
            scope="col"
            className="text-right"
            aria-sort={active ? (filters.order === "asc" ? "ascending" : "descending") : "none"}
          >
            <Link
              href={href(column.key)}
              title={column.hint}
              className={`inline-flex items-center gap-1 underline-offset-2 hover:text-fg hover:underline ${
                active ? "text-accent" : ""
              }`}
            >
              {column.label}
              <span aria-hidden className={active ? "text-accent" : "text-faint opacity-40"}>
                {active ? (filters.order === "asc" ? "▲" : "▼") : "▼"}
              </span>
            </Link>
          </th>
        );
      })}
    </>
  );
}

export function Pagination({
  filters,
  page,
  pageCount,
  total,
  limit,
}: {
  filters: FilterState;
  page: number;
  pageCount: number;
  total: number;
  limit: number;
}) {
  if (pageCount <= 1) {
    return (
      <p className="text-xs text-muted">
        <span className="tnum text-fg">{total}</span> pools
      </p>
    );
  }

  const from = (page - 1) * limit + 1;
  const to = Math.min(page * limit, total);
  const window: number[] = [];
  for (let i = Math.max(1, page - 2); i <= Math.min(pageCount, page + 2); i++) window.push(i);

  const pageLink = "rounded-md border border-line px-2 py-1 text-muted transition-colors hover:border-line-strong hover:text-fg";

  return (
    <nav aria-label="Pagination" className="flex flex-wrap items-center gap-2 text-xs">
      <span className="text-muted">
        <span className="tnum text-fg">
          {from}–{to}
        </span>{" "}
        of <span className="tnum text-fg">{total}</span>
      </span>
      <div className="flex items-center gap-1">
        {page > 1 ? (
          <Link href={buildHref(filters, { page: String(page - 1) })} className={pageLink}>
            Prev
          </Link>
        ) : null}
        {window.map((n) => (
          <Link
            key={n}
            href={buildHref(filters, { page: String(n) })}
            aria-current={n === page ? "page" : undefined}
            className={
              n === page
                ? "tnum rounded-md border border-accent/50 bg-accent/15 px-2 py-1 font-semibold text-accent"
                : `tnum ${pageLink}`
            }
          >
            {n}
          </Link>
        ))}
        {page < pageCount ? (
          <Link href={buildHref(filters, { page: String(page + 1) })} className={pageLink}>
            Next
          </Link>
        ) : null}
      </div>
    </nav>
  );
}
