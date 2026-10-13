# ArcPools

**Arc Liquidity & Yield Explorer** — an Arc Mainnet liquidity-pool leaderboard.

ArcPools ranks every tracked liquidity pool on Arc (chain ID 5042) by liquidity and shows
seven metrics next to it: `POOL`, `MCAP`, `AGE`, `Est. Fee APR`, `LIQ`, `VOL 24H`, `HOLDERS`.

> Independent analytics tool. Not affiliated with, endorsed by, or connected to Circle or Arc.
> Not investment advice.

---

## Handoff notes (read this first)

**What this project is.** A Next.js site that ranks Arc liquidity pools. It is *not* related to any
other folder in the parent directory — ignore anything sitting alongside it.

**Before you can see any data, run the collector.** The site deliberately has no fallback dataset;
with an empty database it renders an explicit "no pool data has been synced yet" state rather than
demo numbers.

```bash
npm install && npm run sync && npm run dev
```

**`data/arcpools.db` is git-ignored.** If you received this project via git or an archive, the
database is not there and the app starts empty. That is intentional — recreate it with `npm run sync`.

**Next.js here is v16, which breaks from older conventions.** Route segment config such as
`export const dynamic = "force-dynamic"` is rejected while `cacheComponents` is enabled; this
project disables it in `next.config.ts` because the leaderboard must read the database on every
request. If you re-enable caching or partial prefetching, the ranking will start serving stale
pools and APR values. See `AGENTS.md` for the upstream note, and
`node_modules/next/dist/docs/` for the current API.

**This project exists to be honest about unknown data.** Several behaviours look like over-
engineering and are load-bearing:

- A missing metric is never rendered as `0`, `-`, or an empty cell. `NA()` in `src/lib/format.ts`
  is the only path from "unknown" to text, and every N/A explains itself on hover.
- Fee rates are never assumed to be 0.30%. Unverifiable fees produce N/A, not a guess.
- Market cap and FDV never substitute for each other, and a market cap that contradicts its own
  FDV is discarded rather than displayed.
- APR always ships a confidence marker and is always accompanied by the pool's liquidity, volume
  and age, because Arc's real data contains many $10K pools quoting 1,000–3,000% APR.
- A failed or rate-limited source never deletes data; rows keep their last known values and are
  flagged.

Please keep those invariants when changing the display or the pipeline.

**Upstream rate limits are the main operational constraint.** GeckoTerminal's keyless tier was
measured at roughly 30 requests/minute with a hard page cap of 10. Repeatedly re-syncing exhausts
it and every other pool starts showing as `stale`. Free API keys (see `.env.example`) raise the
ceiling. See "Known limitations" at the bottom for the current state.

**Verification commands.** `npm test` (19 unit tests covering the APR formula, fee-unit handling,
DEX dedup, page rotation and the valuation invariant), `npx tsc --noEmit`, `npm run lint`,
`npm run build`.

---

## Quick start

```bash
npm install
cp .env.example .env.local      # optional: add API keys to raise rate limits
npm run sync                    # pull live Arc pools into ./data/arcpools.db
npm run dev                     # http://localhost:3000
```

`npm run sync` is required before the site shows anything. The UI never falls back to demo data —
an empty database renders an explicit "no pool data synced yet" state.

```bash
npm run sync -- --pages=4                 # quicker local pass
npm run sync -- --detail=40                # more exact fee lookups
npm run sync -- --start=3                 # fetch from a specific page
npm run sync -- --no-crosscheck           # GeckoTerminal only
npm test                                  # APR unit tests
npm run build && npm start                # production
```

---

## Architecture

```
GeckoTerminal + DexPaprika + (Arc RPC later)
        │
        ▼
  collector (scripts/sync.mts)  ── Discover → Normalize → Enrich
        │                                  → Calculate → Validate → Upsert
        ▼
  SQLite (pools / tokens / pool_metrics / pool_snapshots / pool_flags / sync_jobs)
        │
        ▼
  internal API (/api/pools, /api/pools/[id], /api/stats, /api/status, /api/sync)
        │
        ▼
  Next.js server components — sorting, filtering and pagination all happen in SQL
```

Client requests never touch a third-party API directly. All upstream keys stay server-side.

### Data sources (verified against live APIs)

| Source | Used for | Verified behaviour |
| --- | --- | --- |
| [GeckoTerminal](https://api.geckoterminal.com/api/v2/networks/arc/pools) | liquidity, 24h volume, MCAP/FDV, creation time | list endpoint returns **no fee**; fee only on the per-pool detail endpoint; keyless tier rejects page > 10 and rate-limits to ~30 req/min |
| [DexPaprika](https://api.dexpaprika.com/networks/arc/pools/search) | discovery, 7d volume, cross-validation | `/networks/arc/pools` now returns `endpoint_removed`; the `search` endpoint works; `fee` is null and `volume_usd_24h` can be 0 — so it is **never** trusted for fees |
| [Arc Explorer](https://explorer.arc.io/) | contract links | — |

Findings from those probes shaped the code, and are worth knowing before changing it:

- **`pool_fee_percentage` is a percent, not a fraction.** GeckoTerminal returns `"0.3"` for a
  0.3% fee; `percentToFraction()` normalizes it. Getting this backwards inflates APR by 100×.
- **Fee is absent from the list endpoint.** It is read from the detail endpoint, which costs one
  rate-limit slot per pool, so those calls are budgeted to the top-liquidity pools
  (`SYNC_DETAIL_BUDGET`). When the pool name encodes a tier (`"cirbtc / USDC 0.01%"`) it is parsed
  as a fallback and labelled **estimated**.
- **The two sources disagree about liquidity.** The same Uniswap v3 pool was reported at ~$11.5M by
  GeckoTerminal and ~$94M by DexPaprika. The primary source wins and the pool is flagged
  `source conflict`; the other value is never silently substituted.
- **DEX ids are not canonical across sources** (`uniswap-v3-arc` vs `uniswap_v3`). Keying on the raw
  label split one pool into two rows and inflated Tracked Liquidity by ~7%. `canonicalDexId()`
  normalizes them.
- **The same v4 Pool ID appears under several wrapper labels** (peach, faze, uniswap_v4). A bytes32
  Pool ID is a hash of the PoolKey, so an identical ID is the same pool: v4 pools key on the ID and
  the extra labels are reported as a `v4_wrapper` flag.
- **GeckoTerminal has no 7-day bucket** (only m5/m15/m30/h1/h6/h24), so 7D volume comes from
  DexPaprika and 7D APR stays N/A until enough snapshots exist.
- **The keyless quota cannot sustain a full crawl every few minutes.** A 10-page run that repeats on
  every tick ends in a hard 429 part-way through, which is what a real sync did during development.
  Each run therefore **rotates its start page** (`rotatingStartPage()`, covered by tests): a full
  refresh walks every page across `maxPages` runs instead of re-crawling the head of the list.
  Add free API keys to lift this ceiling.
- **DexPaprika reports a placeholder address for the native side of a pool.** Those pools keep their
  real liquidity but are labelled `token unidentified` rather than shown as `0x0000…0000`.

---

## Metric definitions

| Column | Meaning | When it shows N/A |
| --- | --- | --- |
| POOL | pair + venue + fee tier, keyed by chain + DEX + pool identifier (v4 uses a bytes32 Pool ID) | — |
| MCAP | base-token price × verified circulating supply | only FDV is known (FDV is shown separately, never substituted) |
| AGE | now − on-chain `pool_created_at` | creation time unavailable upstream |
| Est. Fee APR | `24h volume × effective LP fee × 365 ÷ liquidity × 100` | fee rate unverifiable, or liquidity/volume missing |
| LIQ | combined USD value of the pool's assets — the ranking metric | upstream reports nothing usable |
| VOL 24H | rolling 24h volume for that pool | upstream reports nothing usable |
| HOLDERS | base-token non-zero-balance addresses | **always, for now** — needs an on-chain Arc ERC-20 index; also *not* the number of LP providers |

`$100,000 volume ÷ $500,000 liquidity × 0.30% × 365 = 21.90%` is pinned by a unit test so the fee
pipeline cannot silently drift.

### Valuation sanity checks

Upstream market data is checked against itself before display. A market cap above the token's own
FDV is impossible, so it is graded rather than blindly printed:

- **cap > 2× FDV** → both figures are discarded, the column shows N/A and the pool is flagged
  `mcap inconsistent`. This is not hypothetical: GeckoTerminal reported USDC with a **$72.68B**
  market cap against a **$0.51B** FDV, a 140× gap.
- **1.05× < cap ≤ 2× FDV** → the cap is kept and flagged. cirbtc arrives as $517M against a $444M
  FDV, most likely an upstream supply mismatch; discarding a believable headline number would be
  the wrong trade.
- Zero values are treated as unknown, never as a real valuation.

### APR honesty rules

- The label is always **Estimated Fee APR** — a pool-level fee annualization, not a position return.
- Every value carries a confidence marker: `verified` (fee from the detail endpoint), `estimated`
  (fee parsed from the pool name), `low history` (pool < 24h old — a single day of volume is not a
  stable yield), or `N/A`.
- Pools under 24h cannot produce a `verified` 7D APR at all, and 7D APR additionally requires ≥ 12
  liquidity snapshots in `pool_snapshots`, which accumulate as the collector runs.
- A **missing input never becomes 0**. There is no code path that renders an unknown metric as 0,
  `-` or an empty cell; `NA()` in `src/lib/format.ts` is the only way unknown becomes text, and every
  N/A explains itself on hover.
- APR excludes incentive tokens, price change, impermanent loss, gas and rebalancing. APR is not APY.

### Data-quality flags

`source conflict`, `v4 wrapper`, `fee unknown`, `fee from name`, `fee retained`, `metric carried`,
`dust liquidity`, `zero liquidity`, `extreme volume ratio`, `high apr low liq`, `symbol pending`,
`token unidentified`, `unknown created at`.

`high apr low liq` exists because the live data demanded it: every one of Arc's top APR rows was a
~$10K pool quoting 1,000–3,000%. That is wash-trading far more often than yield, and a leaderboard
that prints it without a warning is misleading by construction.

A flag never removes a row — it annotates it, so a suspicious pool is visible instead of invisible.

---

## Failure behaviour

- Upstream `429`/5xx → exponential backoff with jitter, per-host request throttling, and the last
  successful values are kept. Rows are marked `stale`, `metric carried` or `fee retained`.
- A pool missing from a sync is **never deleted** — it keeps its last known values, so one flaky
  upstream response cannot erase the leaderboard. A row is marked `stale` only once *its own* data
  is older than `SYNC_STALE_AFTER_MS` (default 1h): with page rotation, "absent from this run" only
  means the pool's page was not part of this run's slice, which is not staleness.
- A source that fails outright (e.g. DexPaprika credits exhausted) is skipped; the sync continues on
  GeckoTerminal alone and records the reason in `sync_jobs`.
- `/api/sync` returns `503` unless `CRON_SECRET` or `SYNC_TOKEN` is configured, so nobody can burn
  your quota through an open endpoint.

---

## Internal API

| Endpoint | Purpose |
| --- | --- |
| `GET /api/pools` | `sort, order, page, limit, minLiq, minApr, maxAgeHours, dex, search` — server-side sort + pagination over the full tracked set |
| `GET /api/pools/[id]` | one pool with flags, sources and snapshot history |
| `GET /api/stats` | header cards and coverage counters |
| `GET /api/status` | sync health, last success, last error |
| `GET/POST /api/sync` | run a sync (bearer-protected) |

---

## Deployment

### Vercel + Supabase (as specified in the PRD)

1. Provision Supabase and run `db/schema.sql` against it.
2. Replace the SQLite adapter in `src/server/db.ts` with the Postgres driver (the schema uses only
   portable types: `TEXT` keys, `REAL`/`NUMERIC` amounts, `NULL` for missing).
3. Set the environment variables from `.env.example`, including `CRON_SECRET`.
4. Add a Vercel Cron entry calling `GET /api/sync` with `Authorization: Bearer $CRON_SECRET`. The
   default rotation assumes a 10-minute cadence; if you schedule it more often, lower the rotation
   window in `rotatingStartPage()` or reduce pages per run, otherwise the crawl outruns the
   keyless quota and every other pool is marked `stale`.
5. Point `NEXT_PUBLIC_SITE_URL` at the domain.

Local and single-node deployments work as-is with SQLite:

```bash
DATABASE_FILE=/var/lib/arcpools/arcpools.db npm run start
*/5 * * * * curl -fsS -X POST https://your-host/api/sync -H "Authorization: Bearer $SYNC_TOKEN"
```

---

## Project layout

```
src/
  app/
    page.tsx                 leaderboard (server-rendered, SQL-side sort/filter/paginate)
    new/page.tsx             newest pools by on-chain creation time
    pools/[id]/page.tsx      pool detail, APR explanation, snapshot history
    methodology/page.tsx     sources, formulas, coverage, risk
    api/…                    pools, stats, status, sync
  components/                pool-row, filter-bar, table-chrome, stats-cards
  server/
    db.ts                    schema + connection
    http.ts                  timeout, retry, backoff, per-host throttle
    apr.ts                   APR engine (pure, unit-tested)
    queries.ts               read layer
    sync.ts                  the pipeline
    sources/                 geckoterminal.ts, dexpaprika.ts
  lib/format.ts              display formatting; NA() is the only unknown→text path
scripts/sync.mts             CLI collector
tests/apr.test.ts           APR unit tests
```

---

## Known limitations

- **HOLDERS is N/A everywhere.** No connected source exposes Arc ERC-20 holder counts; this needs an
  on-chain index (Phase 2).
- **Coverage is a lower bound.** GeckoTerminal's keyless tier caps discovery at 10 pages × 20 pools,
  so "Tracked Pools" is not a census of Arc.
- **Fee verification is partial.** Only the top `SYNC_DETAIL_BUDGET` pools get a detail-endpoint fee
  per sync; the rest rely on the pool name and are labelled `estimated`.
- **7D APR needs history.** It stays N/A until the snapshot table has a full 7-day window.
- **No analytics, alerts, watchlists or wallet tools** — those are Phases 3–4 and are deliberately
  not faked.

## License & data attribution

Pool data comes from GeckoTerminal and DexPaprika; APR and all derived metrics are computed by
ArcPools. Review each provider's terms and rate limits before commercial use.