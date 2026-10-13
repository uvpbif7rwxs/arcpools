import Link from "next/link";
import { PoolRowView } from "@/components/pool-row";
import { getStats, getSyncStatus, queryPools } from "@/server/queries";
import { formatRelative } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * New Pools: sorted by on-chain creation time, newest first.
 * Pools whose creation time is unknown are excluded rather than guessed — a
 * pool discovered today is not a pool created today.
 */
export default async function NewPoolsPage() {
  const stats = getStats();
  const [syncJob] = getSyncStatus();
  const result = queryPools({
    sort: "age",
    order: "desc",
    page: 1,
    limit: 50,
    minLiq: 0,
    search: null,
  });

  const rows = result.rows.filter((row) => row.poolCreatedAt !== null);

  return (
    <div className="space-y-4">
      <section className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">New Pools</h1>
        <p className="max-w-3xl text-sm" style={{ color: "var(--text-muted)" }}>
          Arc pools ordered by on-chain creation time, newest first. Age is measured from the
          pool&apos;s creation timestamp — not from when ArcPools first saw it. Pools whose
          creation time no source reports are left out of this list entirely.
        </p>
      </section>

      <div
        className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border px-3 py-2 text-xs"
        style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
      >
        <span>
          <span className="tnum">{rows.length}</span> pools with a known creation time
        </span>
        <span>
          Last sync <span className="tnum">{formatRelative(syncJob?.lastSuccessAt ?? null)}</span>
        </span>
        <Link href="/" className="ml-auto underline">
          Back to ranking
        </Link>
      </div>

      {rows.length === 0 ? (
        <div
          className="rounded-lg border p-10 text-center text-sm"
          style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
        >
          No pool creation times are available yet.
        </div>
      ) : (
        <div className="scroll-x rounded-lg border" style={{ borderColor: "var(--border)" }}>
          <table className="pool-table">
            <thead>
              <tr>
                <th className="w-12">#</th>
                <th>Pool</th>
                <th className="text-right">MCAP</th>
                <th className="text-right">AGE</th>
                <th className="text-right">Est. Fee APR</th>
                <th className="text-right">LIQ</th>
                <th className="text-right">VOL 24H</th>
                <th className="text-right">HOLDERS</th>
                <th>Flags</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <PoolRowView key={row.poolKey} row={row} rank={index + 1} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
        Low-liquidity, high-volume pools on Arc frequently turn out to be wash-traded. Check the
        flags on each row and treat a sub-$10K pool&apos;s APR as noise.
        {" "}
        <span className="tnum">{stats.trackedPools}</span> pools are tracked in total.
      </p>
    </div>
  );
}