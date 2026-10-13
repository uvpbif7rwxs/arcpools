import { NextResponse } from "next/server";
import { getStats } from "@/server/queries";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(getStats(), {
    headers: { "cache-control": "public, max-age=60, stale-while-revalidate=180" },
  });
}