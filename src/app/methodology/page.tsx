import { getStats, getSyncStatus } from "@/server/queries";
import { formatRelative, formatTimestamp, formatUsd } from "@/lib/format";
import { BRAND, TONE } from "@/lib/brand";

export const dynamic = "force-dynamic";

/** A stated section of the methodology, always with its reasoning attached. */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="panel p-4">
      <h2 className="mb-2 text-sm font-semibold tracking-tight text-fg">{title}</h2>
      <div className="prose-ap space-y-2">{children}</div>
    </section>
  );
}

export default async function MethodologyPage() {
  const stats = getStats();
  const [job] = getSyncStatus();

  return (
    <div className="max-w-3xl space-y-4">
      <header className="space-y-1.5">
        <h1 className="text-xl font-bold tracking-tight text-fg">
          Data sources &amp; methodology
        </h1>
        <p className="text-sm leading-relaxed text-muted">
          ArcPools is an independent analytics tool. It is not affiliated with, endorsed by, or
          connected to Circle or Arc. Everything below describes what the numbers on this site
          actually mean — including where they are incomplete.
        </p>
      </header>

      <section className={`panel p-4 ${TONE.warn.panel}`}>
        <h2 className={`text-sm font-semibold ${TONE.warn.text}`}>Data coverage is still expanding</h2>
        <p className="mt-1 text-sm leading-relaxed text-muted">
          Some Arc pools or individual metrics may still be missing because public data sources
          are incomplete, delayed or rate-limited. Market cap, fee rate, APR, age and volume will
          continue to be supplemented as reliable sources become available; unavailable values
          remain N/A rather than being estimated without evidence.
        </p>
      </section>

      <Section title="What the leaderboard columns mean">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong>POOL</strong> — token pair plus venue. Pools are keyed by chain + DEX +
            identifier. Uniswap v4 pools are identified by a bytes32 Pool ID, not an address, and
            the same pair on different venues or fee tiers stays a separate row.
          </li>
          <li>
            <strong>MCAP</strong> — base-token market cap. CoinMarketCap and DexScreener fallback
            values are explicitly labelled estimated because Arc circulating supply is not
            independently verified. When only FDV is available the column shows N/A; FDV is never
            substituted. A
            market cap that contradicts the token&apos;s own FDV is graded: a cap more than 2× the
            FDV is impossible and both figures are discarded, while a mildly higher cap is kept and
            flagged, because supply figures from upstream are often mismatched rather than wrong.
          </li>
          <li>
            <strong>AGE</strong> — time since the pool&apos;s on-chain creation timestamp. The
            first time ArcPools saw a pool is tracked separately and never used as AGE.
          </li>
          <li>
            <strong>Est. Fee APR</strong> — see the formula below. It is a fee-only annualization.
          </li>
          <li>
            <strong>LIQ</strong> — combined USD value of the pool&apos;s assets. This is the
            ranking metric and is not Arc&apos;s protocol-wide TVL.
          </li>
          <li>
            <strong>VOL 24H</strong> — rolling 24h volume for that specific pool, not token-wide
            volume. Routed trades can be counted in more than one pool.
          </li>
          <li>
            <strong>HOLDERS</strong> — shown on pool detail pages only. It is the base-token holder
            count returned by CoinMarketCap&apos;s keyless DEX endpoint, not the number of liquidity
            providers; tokens that have not been indexed remain N/A.
          </li>
        </ul>
      </Section>

      <Section title="APR formula">
        <pre className="overflow-x-auto rounded-lg border border-line bg-surface-2 p-3 font-mono text-xs text-fg">
{`APR = 24h volume × effective LP fee × 365 ÷ liquidity × 100`}
        </pre>
        <p>
          Worked example:{" "}
          <code>$100,000 volume ÷ $500,000 liquidity × 0.30% × 365 = 21.90%</code>. That case is
          pinned by a unit test so the fee pipeline cannot silently drift by a factor of 100 — fee
          tiers arrive as percentages (`&quot;0.3&quot;`), not fractions, and are normalized on
          ingest.
        </p>
        <p>
          Every APR carries a confidence marker: <strong>verified</strong> (fee read from the pool
          detail endpoint), <strong>estimated</strong> (fee parsed from the pool name — treat as
          approximate), <strong>low history</strong> (pool younger than 24h, so a single day of
          volume must not be read as stable yield), or <strong>N/A</strong>.
        </p>
        <p>
          APR excludes incentive emissions, token price change, impermanent loss, gas and
          rebalancing costs. It is a pool-level figure: on concentrated-liquidity venues your actual
          return depends on your price range and position, and can differ substantially. APR is not
          APY and nothing here compounds.
        </p>
      </Section>

      <Section title="Data sources">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <a href="https://www.geckoterminal.com/arc/pools" target="_blank" rel="noreferrer noopener">
              GeckoTerminal
            </a>{" "}
            — primary source for pool liquidity, 24h volume, market cap, FDV and creation time. Its
            list endpoint does not include fee tiers; those are read from the per-pool detail
            endpoint, which is rate-limited and therefore budgeted to the highest-liquidity pools.
          </li>
          <li>
            <a href="https://dexpaprika.com/arc" target="_blank" rel="noreferrer noopener">
              DexPaprika
            </a>{" "}
            — discovery and cross-validation, including 7-day volume. Its Arc fee field is null, so
            it is never trusted for fees.
          </li>
          <li>
            <a href="https://dexscreener.com/arc" target="_blank" rel="noreferrer noopener">
              DexScreener
            </a>{" "}
            — keyless fallback for pools ArcPools already tracks. It fills missing or stale
            liquidity and 24-hour volume, but never overwrites a fresh primary value. Its market
            cap may fill a gap only as a labelled estimate and is never used for fee tiers.
          </li>
          <li>
            <a
              href="https://coinmarketcap.com/api/documentation/pro-api-reference/keyless-public-api"
              target="_blank"
              rel="noreferrer noopener"
            >
              CoinMarketCap keyless DEX API
            </a>{" "}
            — bounded fallback for token market cap and holder count. Market caps from this route
            are labelled estimated and still pass the FDV consistency check.
          </li>
          <li>
            <a href="https://explorer.arc.io/" target="_blank" rel="noreferrer noopener">
              Arc Explorer
            </a>{" "}
            — contract and transaction verification.
          </li>
        </ul>
        <p>
          When sources disagree on liquidity by more than 25%, a fresh primary value is shown and
          the pool is flagged <em>source conflict</em> — another source is never quietly
          substituted.
        </p>
      </Section>

      <Section title="Coverage and freshness">
        <p>
          ArcPools only ever indexes Arc Mainnet; testnet data is never mixed in.
          GeckoTerminal&apos;s keyless API caps pagination, so{" "}
          <span className="tnum text-fg">{stats.trackedPools}</span> tracked pools is a lower bound
          rather than a census of every Arc pool. Syncing runs every few minutes; each row shows
          when its own data was last updated.
        </p>
        <p>
          When a sync is rate-limited or a source fails, the last successful values are kept and
          marked <em>stale</em> or <em>metric carried</em> rather than blanked. Nothing is ever
          replaced with demo or synthetic data.
        </p>
        <p className="text-xs">
          Current sync state: {job?.status ?? "never run"} · last success{" "}
          <span className="tnum">{formatRelative(job?.lastSuccessAt ?? null)}</span>{" "}
          {job?.lastSuccessAt ? `(${formatTimestamp(job.lastSuccessAt)})` : ""} · tracked liquidity{" "}
          {formatUsd(stats.trackedLiquidityUsd, { compact: true })}.
        </p>
      </Section>

      <Section title="Risk">
        <p>
          ArcPools provides information and estimates. It is not investment advice. Historical
          volume, fees and high APR do not predict future returns. Providing liquidity carries
          impermanent loss, token price risk, smart-contract risk and the risk of being unable to
          exit a position. Many newly created Arc pools are experimental, illiquid or fraudulent.
          Verify every contract address yourself before interacting with it.
        </p>
      </Section>

      <p className="text-xs text-faint">{BRAND.disclaimer}</p>
    </div>
  );
}
