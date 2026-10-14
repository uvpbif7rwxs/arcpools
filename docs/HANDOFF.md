# ArcPools — Complete Handoff Document

**Purpose:** a new AI agent (or engineer) with no prior context should be able to read this
file and continue the work without re-discovering anything, re-running experiments that are
already documented, or re-asking the user questions that have been answered.

**Written:** 2026-10-13
**Project root:** repository root
**Live at:** `https://arcpools.website/`

---

## 1. Read this first — the five rules that define this project

These are not style preferences. They are the reason several pieces of code look
over-engineered. If a change violates one of them, it is a bug even if the tests pass.

1. **Real data only. No demo/fallback dataset, ever.** An empty database renders an explicit
   "no pool data has been synced yet" state. It never renders fake numbers to fill the table.
2. **Missing data renders `N/A` with a stated reason.** Never `0`, never `-`, never blank.
   `src/lib/format.ts`'s `NA()` is the single sanctioned "unknown → text" path.
   Upstream `0.0` is coerced to `null` by `positive()` in `src/server/http.ts` before it
   reaches storage, so a zero never becomes a real-looking value.
3. **Market cap and FDV never substitute for one another.** MCAP requires verifiable
   circulating supply. When only FDV exists, the UI says so in words
   ("Circulating supply unverified. FDV is $X") rather than copying FDV into the MCAP field.
4. **Fee rate is never assumed to be 0.30%.** If it cannot be verified it degrades to `N/A`
   with the reason recorded in `fee_source`.
5. **API keys never appear in chat, code, logs, or git.** They live only in `.env.local`,
   which is git-ignored (`.gitignore:8`). Keys are collected via a hidden `osascript` dialog
   so they never pass through the conversation transcript.

---

## 2. Architecture

Next.js 16 (App Router) + TypeScript + Tailwind v4 + better-sqlite3. 5,422 lines across 34
source files. No external database service, no build-time data fetch.

```
src/
  app/
    page.tsx                    leaderboard (137)
    new/page.tsx                newest pools (90)
    pools/[id]/page.tsx         pool detail (252)
    methodology/page.tsx        how every number is derived (161)
    globals.css                 design tokens + full palette (419)
    layout.tsx                  shell, nav, theme (130)
    api/
      pools/route.ts            list + filters + sort (32)
      pools/[id]/route.ts       single pool (15)
      stats/route.ts            headline aggregates (9)
      status/route.ts           last sync + freshness (20)
      sync/route.ts             guarded manual trigger (46)
  components/
    table-chrome.tsx            header/columns/sort (149)  <- COLUMN ORDER lives here
    pool-row.tsx                one data row + caveats (319)
    stats-cards.tsx             stat tiles (183)
    filter-bar.tsx              search/sort/filters (180)
    brand-mark.tsx              logo (73)
    theme-toggle.tsx            light/dark (63)
  lib/
    brand.ts                    colour tokens, single source (109)
    format.ts                   NA(), formatUsd(), etc. (91)
  server/
    http.ts                     fetch + timeout/retry/backoff/host throttle (135)
    db.ts                       SQLite schema + idempotent repair (186)
    types.ts                    domain types + stripNetworkPrefix (167)
    sync.ts                     the collector pipeline (727)  <- largest file
    queries.ts                  SQL read layer (317)
    apr.ts                      APR math + confidence grading (170)
    valuation.ts                MCAP/FDV grading (66)
    sources/geckoterminal.ts    primary adapter (314)
    sources/dexpaprika.ts       discovery + cross-check (209)
scripts/sync.mts                CLI entry (57)
tests/                          32 tests across 3 files
db/schema.sql                   portable Postgres equivalent (102)
docs/UPSTREAM_APIS.md           measured upstream behaviour (131)
```

### The collector pipeline

`src/server/sync.ts` runs six stages:

```
Discover -> Normalize -> Enrich -> Calculate -> Validate -> Upsert
```

- **Discover** — GeckoTerminal pages (rotating window, `SYNC_PAGES=3`), plus DexPaprika
  `/pools/search` when cross-check is enabled.
- **Normalize** — v4 bytes32 pool ids are collapsed so one pool counted once across wrappers
  (`v4_wrapper` flag); dex ids canonicalized; addresses normalized.
- **Enrich** — token metadata (two passes, GeckoTerminal then DexPaprika on separate quota),
  then exact fee from the pool-detail endpoint, budgeted to top pools by liquidity.
- **Calculate** — `apr.ts` derives APR; `valuation.ts` grades MCAP against FDV.
- **Validate** — nothing is deleted on upstream failure. Last good values survive and are
  marked `stale` / `fee_retained` / `metric_carried`.
- **Upsert** — writes pools, tokens, metrics, flags, snapshots, sync_jobs.

Pool identity key is `chain + canonical_dex + pool_identifier`. v4 pools normalize to
`{chain}:v4pool:{bytes32}`.

---

## 3. Current measured state (2026-10-13)

Database `data/arcpools.db` (git-ignored, not shipped).

| Metric | Value | Coverage |
|---|---|---|
| Tracked pools | 313 | — |
| Total liquidity | $174,926,720 | — |
| 24h volume | $24,143,782 | — |
| Liquidity | 218 | 69.6% |
| APR | 114 | 36.4% |
| Volume 7d | 107 | 34.2% |
| Fee tier | 209 | 66.8% |
| Market cap | 12 | 3.8% |
| **Holders** | **0** | **0.0%** |
| Stale | 144 | 46.0% |
| DEXes | 11 | — |

Fee provenance split: `detail_api` 8 (2.6%), `pool_name` 201 (64.2%), unknown 104 (33.2%).
`pool_name` means the tier was parsed out of the pool's display name, not verified by the API.

Baseline commit: branch `baseline/arcpools-v1`, commit `c441025`, tag `baseline-v1`
(39 files / 5,071 lines). **All work since then is uncommitted.** There are meaningful
uncommitted changes across 19 modified files plus 3 untracked; `tsconfig.tsbuildinfo` is
tracked and should probably be git-ignored.

---

## 4. Upstream APIs — what was actually measured

Full detail in [`docs/UPSTREAM_APIS.md`](UPSTREAM_APIS.md). Summary of the things most likely
to be re-litigated by mistake:

- **GeckoTerminal v2 is free and keyless. It ignores `x-cg-pro-api-key`.** Verified: byte-identical
  responses and quota with and without the header. **Obtaining a CoinGecko key cannot improve
  this site's coverage.** The user was offered this route and it is a dead end — do not
  suggest it again.
- Keyless tier rejects `page > 10` with HTTP 401, capping discovery at 200 pools per sweep.
- `pool_fee_percentage` exists **only** on the pool-detail endpoint, never on the list endpoint.
- It is a **percent** (`"1"` = 1%), divided by 100 internally.
- No 7d volume window exists in GT (buckets stop at h24). DexPaprika is the only 7d source and is
  never silently substituted.
- GT returns `market_cap_usd: null` for most Arc tokens — it has no circulating supply for them.
- **DexPaprika**: `/networks/{chain}/pools` returns `endpoint_removed`; use `/pools/search`.
  Its `fee` is always null and `volume_usd_24h` frequently `0`. Neither is trusted.

### Bug found and fixed 2026-10-13 (important context)

86% of token addresses (205 of 237) were stored with GeckoTerminal's `arc_0x…` network prefix,
which its own per-token endpoint rejects with HTTP 404. Those tokens had therefore *never*
been successfully queried. Fixed via `stripNetworkPrefix()` in `types.ts`, applied at every
entry point, plus an idempotent merge-and-delete repair in `db.ts`. Pinned by 8 tests in
`tests/geckoterminal.test.ts`.

After the fix the endpoint returns 200, but `market_cap_usd` is **still** null for most tokens —
the bug was real but it was not the reason MCAP coverage is low. Both facts need to be known:
the prefix bug consumed quota, and the null values are genuine upstream absence.

---

## 5. The open problems, ranked

### P1 — Holder coverage is incremental

GeckoTerminal and DexPaprika still do not expose holder counts, but CoinMarketCap now documents a
keyless public DEX holder-count endpoint. ArcPools uses it with a bounded per-sync budget and keeps
`holders_updated_at` so values can be refreshed rather than silently treated as permanent.

Considerations for whoever builds it:
- The keyless endpoint is one token per request and uses an IP-shared rate pool, so coverage grows
  over multiple runs.
- A future on-chain index would still be useful for independent verification.

### P2 — Market cap fallback is estimated

Confirmed by slow, spaced sampling after the prefix fix: of 12 tokens queried, 6 returned
`mcap=null` with real FDV, 5 were not indexed at all, 1 had a usable cap. CoinGecko simply has
no circulating-supply data for Arc's long tail of small-cap tokens.

Current behavior and one optional extension:
- GT does return **`fdv_usd`** for 213 of 228 tokens (93%). FDV is already surfaced honestly in
  the UI as a stated caveat, never substituted for MCAP. No change needed unless you want FDV
  promoted to its own column.
- CoinMarketCap's keyless token endpoint and DexScreener's batched pair endpoint are wired in as
  fallbacks. Their values are marked `mcap_estimated_cmc` or
  `mcap_estimated_dexscreener` because neither response independently proves circulating supply.
- `GET https://api.coingecko.com/api/v3/coins/list?include_platform=true` works **anonymously**
  and returns 87 Arc tokens with contract addresses. It could seed symbol lookup for free. Not
  currently used.

### P3 — 46% of pools are stale; coverage is quota-bound, not key-bound

Staleness is measured from each row's own age (`SYNC_STALE_AFTER_MS`, default 1h), not from
"was it covered in the last run" — this was a deliberate semantic change.

144 stale pools and the low fee coverage are caused by the GeckoTerminal keyless quota
(~30 req/min, shared residential IP, 2.2s enforced spacing). Since no key raises this ceiling,
the only lever is **syncing more often in smaller time windows** rather than less often in bigger
ones. The rotating-start-page mechanism (`rotatingStartPage()`, 10-minute window) already exists
for this. Raising `SYNC_PAGES` or `SYNC_DETAIL_BUDGET` will make things *worse*, not better.

### P4 — Apr is 36.4% and downstream of fee coverage

APR cannot be computed without a verified fee, so P3 directly caps APR. `apr.ts` grades
confidence (`verified` / `estimated`) and `apr_reason` records why a value is missing. High-APR
rows must keep showing liquidity and data period — that requirement is already implemented in
`pool-row.tsx`; preserve it.

### P5 — Uncommitted work

19 modified files and 3 untracked, including the visual alignment to the reference site, the
column-order fix, dual-source token completion, valuation grading, the address-prefix fix, and
the new `docs/`. Nothing since `c441025` is committed. `tsconfig.tsbuildinfo` is tracked and
should be ignored.

---

## 6. Invariants the tests enforce — do not break these

`npm test` — 32 tests, all passing at time of writing.

- `tests/apr.test.ts` (8) — APR math, page rotation, and MCAP/FDV grading including
  ">2× FDV is discarded", "1.05–2× is kept and flagged", and "zero values are unknown".
- `tests/columns.test.ts` (5) — the leaderboard column order is **fixed** to the PRD's
  `POOL, MCAP, AGE, APR, LIQ, VOL 24H, HOLDERS` by reading the actual source of
  `table-chrome.tsx` and `pool-row.tsx` and comparing them. This exists because a real bug once
  shipped with the header and body in different orders. Also asserts HOLDERS is always an
  explicit `N/A`, never a number.
- `tests/geckoterminal.test.ts` (8) — prefix normalization (idempotence, casing, bytes32 safety)
  and fee parsing (percent-not-fraction, range rejection, name fallback).

Verification commands that were green before handoff:

```bash
npm test          # 32 pass
npx tsc --noEmit  # clean
npm run lint      # clean
npm run build     # succeeds
```

Note `cacheComponents: false` in `next.config.ts` is load-bearing. Re-enabling caching makes the
leaderboard serve stale pools and APR values.

---

## 7. Running things

```bash
npm install
npm run sync      # collector; env vars below control budget
npm run build && npm run start -- -p 3111
npm test
```

Sync CLI flags: `npm run sync -- --pages=N --detail=N --start=N --no-crosscheck`

Tuning knobs in `.env.local`:

| Variable | Default | Meaning |
|---|---|---|
| `GT_MIN_INTERVAL_MS` | 2200 | spacing between GeckoTerminal calls |
| `GT_MAX_PAGE` | 10 | hard page ceiling imposed by the keyless tier |
| `SYNC_PAGES` | 3 | pages per sweep |
| `SYNC_DETAIL_BUDGET` | 30 | pool-detail calls (the only fee source) |
| `SYNC_TOKEN_BUDGET` | 40 | per-token metadata calls |
| `SYNC_STALE_AFTER_MS` | 3600000 | age at which a row is marked stale |
| `CRON_SECRET` / `SYNC_TOKEN` | empty | **empty on purpose**; `/api/sync` returns 503 until set |

`CRON_SECRET` and `SYNC_TOKEN` being blank is intentional: it prevents an anonymous visitor from
burning the upstream quota. Leave them blank locally.

---

## 8. Design system

Colours are defined once in `src/lib/brand.ts` and mirrored in `globals.css`; they were verified
to match the reference site's `BRAND.md` exactly (11/11 primary tokens plus all semantic
colours), so no colour work is outstanding.

- accent `#4f8cff`, accent-strong `#2f6ef0`, positive `#35d39b`
- canvas `#060911`, surface `#0d1322`, foreground `#e9eefb`
- muted `#9aa8c4`, faint `#6b7a99`
- light-mode accent `#1f5fe0`, light-mode positive `#07795a`

**Green is reserved for `verified` data; `estimated` uses amber.** Do not use green for anything
else. High-APR rows must display liquidity and data period alongside the APR.

Column order in `src/components/table-chrome.tsx` `COLUMNS` is locked by test. A separate
read-only reference build was used for visual alignment.

---

## 9. Do not do these

- Do not add a demo/fallback dataset, or any `?? 0` on a metric.
- Do not copy FDV into a market-cap field, or default a fee to 0.30%.
- Do not reintroduce a CoinGecko key as a coverage fix — it provably does nothing here.
- Do not raise `SYNC_PAGES` or `SYNC_DETAIL_BUDGET` expecting better coverage; it increases 429s.
- Do not delete rows when an upstream fails. Retain the last good value and flag it.
- Do not commit `.env.local`, `data/*.db`, or any API key.
- Do not change the column order; a test enforces it.

---

## 10. Suggested next action

Build the **P1 on-chain `Transfer` indexer**. It is the only remaining item that moves a 0%
column, and it simultaneously unlocks self-computed circulating supply for MCAP (P2). Everything
else in this list is either quota-bound (P3, tunable but not fixable) or genuinely absent from
every available upstream (P2).

Before starting, read `docs/UPSTREAM_APIS.md` so the indexer's token list can be seeded from the
existing `tokens` table rather than re-discovered.
