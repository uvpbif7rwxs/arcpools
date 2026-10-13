import { NextResponse } from "next/server";
import { queryPools, DEFAULT_MIN_LIQ_USD } from "@/server/queries";

export const dynamic = "force-dynamic";

const num = (v: string | null): number | null => {
  if (v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const sp = url.searchParams;

  const minLiqParam = sp.get("minLiq");
  const result = queryPools({
    sort: sp.get("sort") ?? undefined,
    order: sp.get("order") === "asc" ? "asc" : "desc",
    page: num(sp.get("page")) ?? 1,
    limit: num(sp.get("limit")) ?? 50,
    // "all" disables the minimum; absent means the documented $10K default.
    minLiq: minLiqParam === "all" ? null : (num(minLiqParam) ?? DEFAULT_MIN_LIQ_USD),
    minApr: num(sp.get("minApr")),
    maxAgeHours: num(sp.get("maxAgeHours")),
    dex: sp.get("dex"),
    search: sp.get("search"),
  });

  return NextResponse.json(result, {
    headers: { "cache-control": "public, max-age=30, stale-while-revalidate=120" },
  });
}