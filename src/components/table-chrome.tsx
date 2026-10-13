import Link from "next/link";
import type { PoolRow } from "@/server/types";
import { buildHref, type FilterState } from "./filter-bar";

const COLUMNS: { key: string; label: string; className?: string }[] = [
  { key: "liq", label: "LIQ", className: "text-right" },
  { key: "mcap", label: "MCAP", className: "text-right" },
  { key: "apr", label: "Est. Fee APR", className: "text-right" },
  { key: "vol24h", label: "VOL 24H", className: "text-right" },
  { key: "age", label: "AGE", className: "text-right" },
  { key: "holders", label: "HOLDERS", className: "text-right" },
];

/** Column headers are links, so every sort state is a real, shareable URL. */
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
      <th>Pool</th>
      {COLUMNS.map((column) => {
        const active = filters.sort === column.key;
        return (
          <th key={column.key} className={column.className}>
            <Link href={href(column.key)} className="inline-flex items-center gap-1 hover:underline">
              {column.label}
              <span style={{ opacity: active ? 1 : 0.25 }}>
                {active ? (filters.order === "asc" ? "▲" : "▼") : "▲"}
              </span>
            </Link>
          </th>
        );
      })}
      <th>Flags</th>
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
      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
        <span className="tnum">{total}</span> pools
      </p>
    );
  }

  const from = (page - 1) * limit + 1;
  const to = Math.min(page * limit, total);
  const window: number[] = [];
  for (let i = Math.max(1, page - 2); i <= Math.min(pageCount, page + 2); i++) window.push(i);

  const linkStyle = {
    border: "1px solid var(--border)",
    color: "var(--text-muted)",
  } as const;

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span style={{ color: "var(--text-muted)" }}>
        <span className="tnum">
          {from}–{to}
        </span>{" "}
        of <span className="tnum">{total}</span>
      </span>
      <div className="flex items-center gap-1">
        {page > 1 ? (
          <Link href={buildHref(filters, { page: String(page - 1) })} className="rounded px-2 py-1" style={linkStyle}>
            Prev
          </Link>
        ) : null}
        {window.map((n) => (
          <Link
            key={n}
            href={buildHref(filters, { page: String(n) })}
            className="rounded px-2 py-1"
            style={
              n === page
                ? { ...linkStyle, color: "white", background: "var(--color-accent-500)" }
                : linkStyle
            }
          >
            {n}
          </Link>
        ))}
        {page < pageCount ? (
          <Link href={buildHref(filters, { page: String(page + 1) })} className="rounded px-2 py-1" style={linkStyle}>
            Next
          </Link>
        ) : null}
      </div>
    </div>
  );
}

export type { PoolRow };