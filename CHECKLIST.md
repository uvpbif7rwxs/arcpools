# Production launch checklist

Verified against a live sync on Arc Mainnet; re-check each item before a public launch.

## Data correctness
- [x] **Mainnet only.** Every adapter pins `chain_id = 5042`; testnet pools cannot enter the store.
- [x] **Real data, never demo data.** The UI shows an explicit empty state until `npm run sync` runs.
- [x] **Ranking is over the full tracked set**, then the page slice is applied in SQL — never ranked per page.
- [x] **Every pool is uniquely identified** by chain + DEX + identifier; Uniswap v4 uses its bytes32
      Pool ID and the fee tier / hook context is preserved.
- [x] **Duplicate pools collapsed.** DEX ids are canonicalized across sources and the same v4 Pool ID
      reached through different wrappers is counted once (`v4_wrapper` flag).
- [x] **MCAP and FDV never mix.** Unverified supply renders N/A; FDV appears in its own field.
- [x] **AGE uses on-chain creation time.** `first_seen_at` is stored separately and never substituted.
- [x] **APR is reproducible.** `npm test` pins the $100k/$500k/0.30% → 21.90% case plus the degradation paths.
- [x] **Unknown fees degrade to N/A**; no pool is assumed to be 0.30%.
- [x] **HOLDERS is N/A and labelled as such**, never a count of LP providers.
- [x] **Cross-source conflicts are flagged** (>25% liquidity drift) rather than silently overwritten.
- [x] **Extreme values are flagged** — dust liquidity, zero liquidity, volume ≫ liquidity, and
      `high apr low liq` for headline APRs on sub-$50K pools.
- [x] **Placeholder token addresses are not rendered as identities** — pools whose native side
      DexPaprika reports as a zero address are labelled `token unidentified`.

## Resilience
- [x] Retry with exponential backoff on 429/5xx, per-host throttling, explicit timeouts.
- [x] A failed source never deletes data; rows keep last-known values and show `stale` / `metric carried` / `fee retained`.
- [x] Verified fee rates survive a rate-limited sync instead of reverting to N/A.
- [x] **Page rotation** keeps repeated syncs inside the upstream quota instead of re-crawling the
      same head of the list; verified by unit tests.
- [x] Pools missing from a rotated run are marked `stale` rather than deleted.
- [x] `/api/sync` refuses to run without `CRON_SECRET` or `SYNC_TOKEN`.
- [x] `/api/status` exposes sync health, last success and last error.

## Product surface
- [x] Search by token symbol, address or pool ID.
- [x] Filters for liquidity, APR, age and DEX; sorting on every numeric column; pagination in the URL.
- [x] Distinct loading / empty / stale / failure states.
- [x] Sources, coverage, last-update time and risk disclaimer shown on the page.
- [x] Mobile: table scrolls horizontally without layout breakage.
- [x] Dark by default; no third-party logos or copied layouts.

## Security & ops
- [x] All API keys server-side via environment variables (`.env.example` documents every key).
- [x] `.env*` and the SQLite database are git-ignored.
- [ ] Free-tier API keys added for GeckoTerminal and DexPaprika before relying on 5-minute refresh.
- [ ] `CRON_SECRET` / `SYNC_TOKEN` set in the production environment.
- [ ] Database migrated to Postgres (`db/schema.sql`) if deploying to serverless.
- [ ] Provider terms reviewed for commercial use and attribution requirements met.
- [ ] Domain arcpools.website pointed at the deployment, `NEXT_PUBLIC_SITE_URL` set.

## Known gaps to disclose on launch
- HOLDERS unavailable (no Arc holder source yet).
- Coverage is a lower bound: GeckoTerminal's keyless tier caps discovery at 10 pages × 20 pools.
- Fee verification is partial per sync; unverified fees are labelled `estimated`.
- 7D APR stays N/A until a full snapshot window exists.
