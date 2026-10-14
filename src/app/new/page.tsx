export default function NewPoolsPage() {
  return (
    <div className="relative min-h-[62vh] overflow-hidden rounded-card border border-line bg-surface">
      <div aria-hidden className="absolute inset-[-2rem] grid gap-3 p-8 opacity-45 blur-md">
        <div className="h-16 rounded-xl border border-line bg-surface-2" />
        {Array.from({ length: 7 }, (_, index) => (
          <div
            key={index}
            className="grid h-14 grid-cols-[1.6fr_1fr_1fr_1fr] gap-4 rounded-lg border border-line bg-surface-2 p-4"
          >
            <span className="rounded bg-surface-3" />
            <span className="rounded bg-surface-3" />
            <span className="rounded bg-surface-3" />
            <span className="rounded bg-surface-3" />
          </div>
        ))}
      </div>
      <div className="absolute inset-0 bg-canvas/55 backdrop-blur-sm" />
      <div className="relative flex min-h-[62vh] flex-col items-center justify-center px-6 text-center">
        <span className="pill pill-strong">New Pools</span>
        <h1 className="mt-4 text-3xl font-bold tracking-tight text-fg sm:text-4xl">
          Coming Soon
        </h1>
        <p className="mt-3 max-w-md text-sm leading-relaxed text-muted">
          A focused view for newly created Arc liquidity pools is being prepared.
        </p>
      </div>
    </div>
  );
}
