import { NextResponse } from "next/server";
import { getPoolById, getSnapshots } from "@/server/queries";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const pool = getPoolById(decodeURIComponent(id));
  if (!pool) {
    return NextResponse.json({ error: "pool_not_found", id }, { status: 404 });
  }
  return NextResponse.json({ pool, snapshots: getSnapshots(id, 7) });
}