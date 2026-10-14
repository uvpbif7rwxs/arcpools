import { BRAND, MARK_ARC_PATH, MARK_ARC_WIDTH, MARK_BAR_RADIUS, MARK_BAR_TOP, MARK_BAR_WIDTH, MARK_BARS, MARK_VIEW_BOX } from "@/lib/brand";
import { cn } from "@/lib/format";

/**
 * The ArcPools mark.
 *
 * Rendered inline rather than as an image so it costs no request, stays crisp at
 * any size, and re-themes with the light/dark switch without a second asset.
 *
 * Colour is applied with Tailwind utilities (`stroke-accent`, `fill-pos`) rather
 * than a `stroke`/`fill` attribute holding `var(--…)`: a `var()` reference inside
 * an SVG *presentation attribute* does not resolve and paints black, whereas the
 * utility compiles to a CSS declaration and does. Do not "simplify" this back.
 */
export function BrandMark({
  size = 28,
  className,
  variant = "token",
  title = BRAND.name,
}: {
  size?: number;
  className?: string;
  /** `token` follows the theme; `coats` is single-colour, for a plate or avatar. */
  variant?: "token" | "coats";
  /** Accessible label. Pass `null` when adjacent text already names the brand. */
  title?: string | null;
}) {
  const onPlate = variant === "coats";
  const arcClass = onPlate ? "stroke-white" : "stroke-accent";
  const barClass = onPlate ? "fill-white" : "fill-accent";
  const topClass = onPlate ? "fill-white" : "fill-pos";

  return (
    <svg
      viewBox={MARK_VIEW_BOX}
      width={size}
      height={size}
      className={cn("shrink-0", className)}
      role={title ? "img" : "presentation"}
      aria-label={title ?? undefined}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      <path
        d={MARK_ARC_PATH}
        fill="none"
        className={arcClass}
        strokeWidth={MARK_ARC_WIDTH}
        strokeLinecap="round"
      />
      {MARK_BARS.map(([x, y, height]) => (
        <rect
          key={x}
          x={x}
          y={y}
          width={MARK_BAR_WIDTH}
          height={height}
          rx={MARK_BAR_RADIUS}
          className={barClass}
        />
      ))}
      <rect
        x={MARK_BAR_TOP[0]}
        y={MARK_BAR_TOP[1]}
        width={MARK_BAR_WIDTH}
        height={MARK_BAR_TOP[2]}
        rx={MARK_BAR_RADIUS}
        className={topClass}
      />
    </svg>
  );
}
