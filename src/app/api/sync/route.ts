import { NextResponse } from "next/server";
import { runSync } from "@/server/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Sync trigger. Two callers:
 *  - Vercel Cron (GET) — protected by CRON_SECRET;
 *  - `npm run sync` / local triggers (POST) — protected by SYNC_TOKEN.
 *
 * Both are optional; when neither secret is configured the endpoint refuses to
 * run so an unauthenticated visitor cannot burn the upstream quota.
 */
async function handler(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const syncToken = process.env.SYNC_TOKEN;
  const auth = request.headers.get("authorization");

  if (!cronSecret && !syncToken) {
    return NextResponse.json(
      { error: "sync_disabled", message: "Set CRON_SECRET or SYNC_TOKEN to enable sync over HTTP." },
      { status: 503 },
    );
  }

  const provided = auth?.replace(/^Bearer\s+/i, "") ?? "";
  const expected = request.method === "GET" ? cronSecret : syncToken;
  if (!expected || provided !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await runSync({
      detailBudget: Number(new URL(request.url).searchParams.get("detailBudget") ?? "") || undefined,
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: "sync_failed", message: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

export const GET = handler;
export const POST = handler;