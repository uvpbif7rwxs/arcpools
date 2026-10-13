import { NextResponse } from "next/server";
import { getSyncStatus } from "@/server/queries";

export const dynamic = "force-dynamic";

export async function GET() {
  const jobs = getSyncStatus().map((job) => ({
    ...job,
    stats: job.statsJson ? safeParse(job.statsJson) : null,
    statsJson: undefined,
  }));
  return NextResponse.json({ jobs, generatedAt: new Date().toISOString() });
}

function safeParse(value: string) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}