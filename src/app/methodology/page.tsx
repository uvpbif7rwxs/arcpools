import { getStats, getSyncStatus } from "@/server/queries";
import { formatRelative, formatTimestamp, formatUsd } from "@/lib/format";

export const dynamic = "force-dynamic";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      <div className="space-y-2 text-sm" style={{ color: "var(--text-muted)" }}>
        {children}
      </div>
    </section>
  );
}

export default async function MethodologyPage() {
  const stats = getStats();
  const [job] = getSyncStatus();

  return (
    <div className="max-w-3xl space-y-7">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Data sources &amp; methodology</h1>
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          ArcPools is an independent analytics tool. It is not affiliated with, endorsed by, or
          connected to Circle or Arc. Everything below describes what the numbers on this site
          actually mean — including where they are incomplete.
        </p>
      </header>

      <Section title="What the seven columns mean">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong>POOL</strong> — token pair plus venue. Pools are keyed by chain + DEX +
            identifier. Uniswap v4 pools are identified by a bytes32 Pool ID, not an address, and
            the same pair on different venues or fee tiers stays a separate row.
          </li>
          <li>
            <strong>MCAP</strong> — price × verified circulating supply of the base token. When
            only FDV is available the column shows N/A; FDV is never substituted for market cap. A
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
            <strong>HOLDERS</strong> — currently N/A everywhere. Base-token holder addresses
            require an on-chain ERC-20 index that no connected source provides for Arc yet. This
            is not the number of LP providers and not a count of people.
          </li>
        </ul>
      </Section>

      <Section title="How Estimated Fee APR is calculated">
        <p>
          <code className="rounded px-1" style={{ background: "var(--surface-raised)" }}>
            APR_24h = 24h volume × effective LP fee rate × 365 ÷ liquidity × 100
          </code>
        </p>
        <p>
          Worked example: $100,000 of 24h volume, $500,000 liquidity and a 0.30% LP fee gives
          21.90%. This exact case is covered by a unit test so the pipeline cannot drift.
        </p>
        <p>
          The fee rate is the real LP share of that pool&apos;s fee. It is never assumed to be
          0.30% for pools that do not report one. Protocol fees and hook fees that do not accrue
          to LPs are excluded where they can be determined, and where the effective rate cannot
          be established the column shows N/A with the reason on hover.
        </p>
        <p>
          Every APR carries a confidence marker:{" "}
          <strong>verified</strong> (fee read from the pool detail endpoint),{" "}
          <strong>estimated</strong> (fee parsed from the pool name — treat as approximate),{" "}
          <strong>low history</strong> (pool younger than 24h, so a single day of volume must not
          be read as stable yield), or <strong>N/A</strong>.
        </p>
        <p>
          APR excludes incentive emissions, token price change, impermanent loss, gas and
          rebalancing costs. It is a pool-level figure: on concentrated-liquidity venues your
          actual return depends on your price range and position, and can differ substantially.
          APR is not APY and nothing here compounds.
        </p>
      </Section>

      <Section title="Data sources">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <a className="underline" href="https://www.geckoterminal.com/arc/pools" target="_blank" rel="noreferrer noopener">
              GeckoTerminal
            </a>{" "}
            — primary source for pool liquidity, 24h volume, market cap, FDV and creation time.
            Its list endpoint does not include fee tiers; those are read from the per-pool detail
            endpoint, which is rate-limited and therefore budgeted to the highest-liquidity pools.
          </li>
          <li>
            <a className="underline" href="https://dexpaprika.com/arc" target="_blank" rel="noreferrer noopener">
              DexPaprika
            </a>{" "}
            — discovery and cross-validation, including 7-day volume. Its Arc fee field is null,
            so it is never trusted for fees.
          </li>
          <li>
            <a className="underline" href="https://explorer.arc.io/" target="_blank" rel="noreferrer noopener">
              Arc Explorer
            </a>{" "}
            — contract and transaction verification.
          </li>
        </ul>
        <p>
          When two sources disagree on liquidity by more than 25%, the primary source is shown and
          the pool is flagged <em>source conflict</em> — the lower number is never quietly
          substituted.
        </p>
      </Section>

      <Section title="Coverage and freshness">
        <p>
          ArcPools only ever indexes Arc Mainnet (chain ID 5042); testnet data is never mixed in.
          GeckoTerminal&apos;s keyless API caps pagination, so{" "}
          <span className="tnum">{stats.trackedPools}</span> tracked pools is a lower bound rather
          than a census of every Arc pool. Syncing runs every few minutes; each row shows when its
          own data was last updated.
        </p>
        <p>
          When a sync is rate-limited or a source fails, the last successful values are kept and
          marked <em>stale</em> or <em>metric carried</em> rather than blanked. Nothing is ever
          replaced with demo or synthetic data.
        </p>
        <p className="text-xs">
          Current sync state:{" "}
          {job?.status ?? "never run"} · last success{" "}
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
    </div>
  );
}