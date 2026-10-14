import Link from "next/link";
import { RotateCcw, SlidersHorizontal } from "lucide-react";

/**
 * Server-rendered filter bar.
 *
 * Filters live in the URL, so a filtered leaderboard is shareable and the back
 * button works. Sorting and filtering are applied in SQL before pagination — the
 * ranking always reflects the whole tracked set, never just the current page.
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
    sort: first("sort", "default"),
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
  if (merged.sort && merged.sort !== "default") params.set("sort", merged.sort);
  if (merged.order && merged.order !== "desc") params.set("order", merged.order);
  if (merged.page && merged.page !== "1") params.set("page", merged.page);
  const qs = params.toString();
  return qs ? `/?${qs}` : "/";
}

/** A labelled control. The label is paired to the control, not just nearby. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-medium uppercase tracking-[0.05em] text-faint">{label}</span>
      {children}
    </label>
  );
}

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
    <form action="/" method="get" className="panel flex flex-wrap items-end gap-3 p-4">
      <div className="flex w-full flex-wrap items-center gap-2 border-b border-line pb-2.5">
        <SlidersHorizontal aria-hidden className="h-4 w-4 text-accent" />
        <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-fg">Filters</span>
        <span className="text-[11px] text-muted">
          Default view: complete data first · 24H volume ↓ · liquidity ≥ $10K
        </span>
        {active ? (
          <Link
            href="/"
            className="ml-auto inline-flex items-center gap-1 text-[11px] text-muted underline-offset-2 hover:text-fg hover:underline"
          >
            <RotateCcw aria-hidden className="h-3 w-3" />
            Reset
          </Link>
        ) : null}
      </div>

      <Field label="Search">
        <input
          type="search"
          name="search"
          defaultValue={filters.search}
          placeholder="Symbol, name, token address"
          className="field w-64"
        />
      </Field>

      <Field label="Min liquidity">
        <select name="minLiq" defaultValue={filters.minLiq} className="field">
          {LIQ_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Est. fee APR">
        <select name="minApr" defaultValue={filters.minApr} className="field">
          {APR_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Pool age">
        <select name="maxAgeHours" defaultValue={filters.maxAgeHours} className="field">
          {AGE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </Field>

      <Field label="DEX">
        <select name="dex" defaultValue={filters.dex} className="field max-w-52">
          <option value="">All venues</option>
          {dexes.map((dex) => (
            <option key={dex.id} value={dex.id}>
              {dex.id} ({dex.pools})
            </option>
          ))}
        </select>
      </Field>

      {filters.sort !== "default" ? <input type="hidden" name="sort" value={filters.sort} /> : null}
      <input type="hidden" name="order" value={filters.order} />

      <button type="submit" className="btn btn-primary">
        Apply
      </button>
      <span className="ml-auto text-xs text-muted">
        <span className="tnum text-fg">{resultCount}</span> pools
        {active ? <span className="text-faint"> · filtered</span> : null}
      </span>
    </form>
  );
}
