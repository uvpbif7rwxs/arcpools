/**
 * ArcPools brand source of truth.
 *
 * The mark is defined once, here, and rendered by `components/brand-mark.tsx`.
 * It is original artwork — deliberately not derived from Circle's or Arc's logo,
 * because a third-party analytics tool has to be visually distinguishable from
 * the network it measures.
 *
 * The idea: an **arc** (the network) drawn as a growth curve, over three
 * ascending **bars** (liquidity levels, ranked), the tallest in the success
 * colour — the top-ranked pool. Three numbers, so it survives 16px.
 */

/** Colours resolved from the design tokens in `globals.css` (dark theme). */
export const BRAND_COLORS = {
  canvas: "#060911",
  canvasGrad: "#0a1020",
  surface: "#0d1322",
  surface2: "#141c2e",
  line: "#212d47",
  fg: "#e9eefb",
  muted: "#9aa8c4",
  accent: "#4f8cff",
  accentStrong: "#2f6ef0",
  pos: "#35d39b",
} as const;

/** The mark's coordinate space. All geometry is expressed in it. */
export const MARK_VIEW_BOX = "0 0 96 96";

/**
 * The arc: a 52-radius circular arc from (15,42) to (81,36) bulging upward.
 * SVG has no conic primitive, so the arc command *is* the curve.
 */
export const MARK_ARC_PATH = "M15 42 A 52 52 0 0 1 81 36";
export const MARK_ARC_WIDTH = 6.4;

/** The two shorter bars: [x, y, height] — 12 wide, 6 radius. */
export const MARK_BARS: ReadonlyArray<readonly [number, number, number]> = [
  [20, 54, 26],
  [42, 47, 33],
];

/** The tallest bar, drawn in the success colour. */
export const MARK_BAR_TOP: readonly [number, number, number] = [64, 40, 40];

export const MARK_BAR_WIDTH = 12;
export const MARK_BAR_RADIUS = 6;

/** Product naming, shared by metadata, the header and the footer. */
export const BRAND = {
  name: "ArcPools",
  domain: "arcpools.website",
  subtitle: "Arc Liquidity & Yield Explorer",
  network: "Arc Mainnet",
  chainId: 5042,
  /** The independence notice, kept visible on every page. */
  disclaimer: "Independent analytics tool; not affiliated with Circle or Arc.",
  /** APR is an annualization of fees, never a promise and never APY. */
  riskNotice: "ArcPools is a research tool, not investment advice.",
} as const;

/**
 * Semantic tone classes.
 *
 * The mapping is the load-bearing part of this file: each tone wraps one
 * meaning, and the components below must not use a tone decoratively. In
 * particular nothing may render green unless the underlying number is verified
 * — a green badge on an estimated APR would be the UI lying about data quality.
 */
export const TONE = {
  accent: {
    text: "text-accent",
    badge: "border-accent/40 bg-accent/10 text-accent",
    panel: "border-accent/45 bg-accent/5",
  },
  pos: {
    text: "text-pos",
    badge: "border-pos/40 bg-pos/10 text-pos",
    panel: "border-pos/45 bg-pos/5",
  },
  warn: {
    text: "text-warn",
    badge: "border-warn/40 bg-warn/10 text-warn",
    panel: "border-warn/45 bg-warn/5",
  },
  neg: {
    text: "text-neg",
    badge: "border-neg/40 bg-neg/10 text-neg",
    panel: "border-neg/45 bg-neg/5",
  },
  info: {
    text: "text-info",
    badge: "border-info/40 bg-info/10 text-info",
    panel: "border-info/45 bg-info/5",
  },
  conflict: {
    text: "text-conflict",
    badge: "border-conflict/40 bg-conflict/10 text-conflict",
    panel: "border-conflict/45 bg-conflict/5",
  },
  neutral: {
    text: "text-muted",
    badge: "border-line bg-surface-2 text-muted",
    panel: "border-line bg-surface",
  },
} as const;

export type ToneName = keyof typeof TONE;
