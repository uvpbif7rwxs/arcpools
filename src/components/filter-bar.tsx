import Link from "next/link";

/**
 * Server-rendered filter bar.
 *
 * Filters live in the URL, so a filtered leaderboard is shareable and the
 * browser back button works. Sorting and filtering are applied in SQL before
 * pagination — the ranking always reflects the whole tracked set.
 */

const LIQ_OPTIONS = [
  { value: "10000", label: "$10K" },
  { value: "50000", label: "$50K" },
  { value: "100000", label: "$100K" },
  { value: "500000", label: "$500K" },
  { value: "all", label: "All" },
];

const APR_OPTIONS = [
  { value: "", label: "Any APR" },
  { value: "10", label: ">10%" },
  { value: "20", label: ">20%" },
  { value: "50", label: ">50%" },
  { value: "100", label: ">100%" },
];

const AGE_OPTIONS = [
  { value: "", label: "Any age" },
  { value: "24", label: "<24H" },
  { value: "168", label: "<7D" },
  { value: "720", label: "<30D" },
];

export type FilterState = {
  minLiq: string;
  minApr: string;
  maxAgeHours: string;
  dex: string;
  search: string;
  sort: string;
  order: string;
  page: string;
};

export function readFilters(sp: Record<string, string | string[] | undefined>): FilterState {
  const first = (key: string, fallback = "") => {
    const v = sp[key];
    return Array.isArray(v) ? (v[0] ?? fallback) : (v ?? fallback);
  };
  return {
    minLiq: first("minLiq", "10000"),
    minApr: first("minApr"),
    maxAgeHours: first("maxAgeHours"),
    dex: first("dex"),
    search: first("search"),
    sort: first("sort", "liq"),
    order: first("order", "desc"),
    page: first("page", "1"),
  };
}

export function buildHref(filters: Partial<FilterState>, overrides: Partial<FilterState> = {}): string {
  const merged = { ...filters, ...overrides };
  const params = new URLSearchParams();
  if (merged.search) params.set("search", merged.search);
  if (merged.minLiq && merged.minLiq !== "10000") params.set("minLiq", merged.minLiq);
  if (merged.minApr) params.set("minApr", merged.minApr);
  if (merged.maxAgeHours) params.set("maxAgeHours", merged.maxAgeHours);
  if (merged.dex) params.set("dex", merged.dex);
  if (merged.sort && merged.sort !== "liq") params.set("sort", merged.sort);
  if (merged.order && merged.order !== "desc") params.set("order", merged.order);
  if (merged.page && merged.page !== "1") params.set("page", merged.page);
  const qs = params.toString();
  return qs ? `/?${qs}` : "/";
}

const selectStyle = {
  background: "var(--surface-raised)",
  border: "1px solid var(--border)",
  color: "var(--text)",
} as const;

export function FilterBar({
  filters,
  dexes,
  resultCount,
}: {
  filters: FilterState;
  dexes: { id: string; pools: number }[];
  resultCount: number;
}) {
  const active =
    filters.search || filters.minApr || filters.maxAgeHours || filters.dex || filters.minLiq !== "10000";

  return (
    <form
      action="/"
      method="get"
      className="flex flex-wrap items-end gap-3 rounded-lg border p-3"
      style={{ borderColor: "var(--border)", background: "var(--surface-raised)" }}
    >
      <label className="flex flex-col gap-1 text-xs" style={{ color: "var(--text-muted)" }}>
        Search
        <input
          type="search"
          name="search"
          defaultValue={filters.search}
          placeholder="Symbol, token or pool address"
          className="w-56 rounded-md px-2.5 py-1.5 text-sm outline-none"
          style={selectStyle}
        />
      </label>

      <label className="flex flex-col gap-1 text-xs" style={{ color: "var(--text-muted)" }}>
        Min liquidity
        <select name="minLiq" defaultValue={filters.minLiq} className="rounded-md px-2.5 py-1.5 text-sm" style={selectStyle}>
          {LIQ_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-xs" style={{ color: "var(--text-muted)" }}>
        Est. fee APR
        <select name="minApr" defaultValue={filters.minApr} className="rounded-md px-2.5 py-1.5 text-sm" style={selectStyle}>
          {APR_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-xs" style={{ color: "var(--text-muted)" }}>
        Pool age
        <select name="maxAgeHours" defaultValue={filters.maxAgeHours} className="rounded-md px-2.5 py-1.5 text-sm" style={selectStyle}>
          {AGE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-xs" style={{ color: "var(--text-muted)" }}>
        DEX
        <select name="dex" defaultValue={filters.dex} className="rounded-md px-2.5 py-1.5 text-sm" style={selectStyle}>
          <option value="">All venues</option>
          {dexes.map((dex) => (
            <option key={dex.id} value={dex.id}>
              {dex.id} ({dex.pools})
            </option>
          ))}
        </select>
      </label>

      <input type="hidden" name="sort" value={filters.sort} />
      <input type="hidden" name="order" value={filters.order} />

      <button
        type="submit"
        className="rounded-md px-3.5 py-1.5 text-sm font-medium text-white"
        style={{ background: "var(--color-accent-500)" }}
      >
        Apply
      </button>
      {active ? (
        <Link href="/" className="rounded-md px-2.5 py-1.5 text-sm underline" style={{ color: "var(--text-muted)" }}>
          Reset
        </Link>
      ) : null}

      <span className="ml-auto text-xs" style={{ color: "var(--text-muted)" }}>
        <span className="tnum">{resultCount}</span> pools
      </span>
    </form>
  );
}

