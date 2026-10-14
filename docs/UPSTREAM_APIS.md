# Upstream API reference (measured, not documented)

Everything here was verified by calling the live endpoints from this machine.
Where our source disagrees with the vendor's published docs, the measured
behaviour wins and the code comment says so. Do not "fix" the adapters back to
the documented shape.

Last verified: 2026-10-13, from this machine (shared residential IP).

---

## 1. GeckoTerminal — primary source

Base: `https://api.geckoterminal.com/api/v2`
Network id: `arc`

The public v2 API is **free and keyless**. It is a separate product from
CoinGecko's metered API and **ignores the `x-cg-pro-api-key` header entirely** —
verified: identical 200 responses with and without the header, identical quota.
Do not spend effort obtaining a CoinGecko key for this site; it changes nothing.

### Measured facts

| Endpoint | Measured behaviour |
|---|---|
| `GET /networks/arc/pools?page=N&include=base_token,quote_token,dex` | 20 pools/page. Returns `reserve_in_usd`, `volume_usd.h24`, `market_cap_usd`, `fdv_usd`, `pool_created_at`. **Does NOT return `pool_fee_percentage`.** |
| `GET /networks/arc/pools/{id}` | Only endpoint that returns `pool_fee_percentage`. Costs one quota slot, so it is budgeted separately (`SYNC_DETAIL_BUDGET`). |
| `GET /networks/arc/tokens/{address}` | Per-token `price_usd`, `market_cap_usd`, `fdv_usd`, `decimals`, `image_url`. See "market cap is mostly absent" below. |
| `GET /networks/arc/dexes` | DEX list. |

- `pool_fee_percentage` is a **percent** (`"1"` = 1%), not a fraction. Divided by 100.
- Volume buckets are `m5/m15/m30/h1/h6/h24` only. **There is no 7d window**, so
  `volume_7d_usd` is never claimed from GeckoTerminal — DexPaprika is the sole
  source for 7d and is never silently substituted.
- Keyless tier rejects `page > 10` with HTTP 401
  ("Your request exceeds the allowed max number for page (10)"), capping
  discoverable coverage at 20 × 10 = 200 pools per sweep.
- Pool ids are `arc_<address>` for v2/v3 and `arc_<bytes32>` for Uniswap v4.
  66-char ids are bytes32 pool ids and are deduplicated across wrappers.

### Market cap is mostly absent — and that is not a rate-limit problem

`market_cap_usd` on the token endpoint is missing or unusable for most Arc
tokens because CoinGecko has no circulating supply for them. Measured on the
ten highest-liquidity Arc tokens:

| Result | Count | Example |
|---|---|---|
| usable `market_cap_usd` | 1 | cirbtc $510.3M |
| `0.0` (must degrade to `N/A`) | 2 | WETH, USDB |
| `null` mcap but real `fdv_usd` | 2 | BTC fdv $6.45B, syrupUSDC fdv $54.4M |
| token not indexed at all | 5 | ARGUS, EURC, XAUM, ARCMAN, TOLLY |

Consequences, enforced in code:

- MCAP and FDV are **never** substituted for one another.
- `0.0` from upstream is coerced to `null` by `positive()` so it renders `N/A`,
  never `0`.
- Adding a CoinGecko key does not change this table.

---

## 2. DexPaprika — discovery + cross-check only

Base: `https://api.dexpaprika.com`

### Measured facts

- `GET /networks/arc/pools` returns **`endpoint_removed`**. Discovery must use
  `GET /pools/search` instead.
- `fee` is **always null** and `volume_usd_24h` is frequently `0`. Neither is
  ever trusted for fee or 24h volume.
- Auth header is `x-api-key`. Free tier is 100K credits/month, no card required.
- Used for: pool discovery beyond GeckoTerminal's 200-pool page cap, 7d volume,
  and token symbol/name fallback on a **separate quota** from GeckoTerminal.

---

## 3. CoinGecko metered API — evaluated and rejected

Base: `https://api.coingecko.com` (Demo) / `https://pro-api.coingecko.com` (Pro)

- Demo key: 10k calls/month, 100 req/min, no card.
- A console key must be `CG-` + ~64 hex chars (≈67 total). The console displays
  keys **masked** (`CG-LZP******************Zk`) and can hand out a 27-char
  stub that is not a usable credential.
- An unrecognised credential is rejected with HTTP 400 and a *self-contradictory*
  pair of messages: `api.coingecko.com` says "you are using a Pro key, use
  pro-api", while `pro-api.coingecko.com` says "you are using a Demo key, use
  api". A valid key never produces this.
- Worse, sending an invalid key **breaks requests that would otherwise succeed**:
  `/coins/markets` returns full BTC market data keyless, but 400s with a bad key.

### Why it is not wired in

GeckoTerminal v2 does not honour `x-cg-pro-api-key` (verified above), and
CoinGecko itself reports `market_cap_usd: null` for most Arc tokens. So a
CoinGecko key cannot fix fee coverage, MCAP coverage, or the 429s.

The only genuinely useful, unauthenticated CoinGecko endpoint found is
`GET /api/v3/coins/list?include_platform=true`, which returns 87 Arc tokens with
contract addresses and could seed symbol lookups for free. Not yet wired in;
tracked as a possible follow-up, not a coverage blocker.

---

## 4. DexScreener — known-pool fallback

Base: `https://api.dexscreener.com`

- `GET /latest/dex/pairs/arc/{comma-separated-pool-ids}` accepts up to 30 pool
  ids per request and is rate-limited to 300 requests/minute.
- In the 2026-10-14 live run, 271 of 318 known pools matched in 11 requests,
  including v2/v3 addresses and v4 bytes32 pool ids.
- It returns liquidity, 24h volume, USD price, 24h price change and pool creation
  time. It does not return the effective LP fee or 7-day volume.
- It is a fallback only: fresh GeckoTerminal values win; missing or stale values
  may be filled and the row records `dexscreener` in its source.
- Its `marketCap` field is not accepted as verified MCAP. In a live sample, 240
  of 242 tokens reported MCAP exactly equal to FDV, which does not prove a
  verified circulating supply. It may fill a gap only as `mcap_estimated_dexscreener`
  after the FDV consistency check.
- After the bulk fallback, address pools still missing 24h volume get a small,
  capped GeckoTerminal detail pass. This recovered the last missing 24h-volume
  row without spending the slower detail quota on complete pools.

---

## 5. CoinMarketCap — keyless token fallback

Base: `https://pro-api.coinmarketcap.com/public-api`

- `GET /v1/dex/token?platform=arc&address={token}` returns token-level `mcap`.
- `GET /v1/dex/holders/count?platform=arc&tokenAddress={token}` returns holder count.
- Both endpoints are officially documented as keyless and use an IP-shared public rate pool.
- ARCAT returned 6,694–6,701 holders during live checks, matching the rounded 6.8K shown on
  GeckoTerminal and the 6,823 screenshot from DexScreener at an earlier observation time.
- CMC MCAP is kept only after the existing FDV consistency check and is labelled estimated.

---

## 6. Coverage targets and what actually moves them

Measured 2026-10-14 after the fallback sync against 318 pools / $175.67M
tracked liquidity / 11 DEXes.

| Metric | Coverage | Blocker |
|---|---|---|
| base symbol | 292 / 318 (91.8%) | quota |
| quote symbol | 267 / 318 (84.0%) | quota |
| liquidity | 273 / 318 (85.8%) | the 45 remaining gaps are v4 pools whose detail response reports zero reserve |
| volume 24h | 318 / 318 (100%) | — |
| fee tier | 211 / 318 (66.4%) | quota (detail endpoint only) |
| APR | 166 / 318 (52.2%) | depends on fee + liquidity |
| volume 7d | 121 / 318 (38.1%) | DexPaprika only |
| market cap | 200 / 318 pool rows (62.9%) | GeckoTerminal plus labelled CoinMarketCap/DexScreener estimates |
| holders | 131 / 318 pool rows (41.2%) | CoinMarketCap keyless holder endpoint, refreshed gradually |

### Holders and circulating supply are separate problems

CoinMarketCap documents a keyless `GET /public-api/v1/dex/holders/count` endpoint.
Arc accepts `platform=arc`; the live ARCAT response matched the GeckoTerminal and
DexScreener pages. ArcPools refreshes a bounded high-liquidity subset per sync so
the shared IP-based public rate pool is not exhausted.

The holder count does not by itself prove circulating supply. Circulating supply also
requires token-specific treatment of treasury, vesting, bridge, burn and locked
addresses, so CoinMarketCap fallback MCAP is explicitly labelled estimated rather
than presented as a verified circulating-supply calculation.

Quota-bound rows (fee, APR, liquidity) improve only by syncing more often in
smaller time windows, not by adding keys.
