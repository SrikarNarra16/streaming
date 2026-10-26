import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { questions } from "@/schema";
import { getSessionUserId } from "@/lib/session";
import { readTraceRunConfig } from "@/lib/trace/config";
import { createDbTraceStore } from "@/lib/trace/db-store";
import { getSharedTraceLimiter } from "@/lib/trace/limits";
import { handleTraceRequest } from "@/lib/trace/route-handler";
import { selectTraceProviders } from "@/lib/trace/select-provider";

// A long-lived streaming response that needs the Node runtime and must never be cached.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST { questionId }: starts a live thinking trace for the signed-in user and streams NDJSON events.
// All the logic is in lib/trace/route-handler.ts.
export async function POST(request: NextRequest) {
  const config = readTraceRunConfig();
  return handleTraceRequest(request, {
    getUserId: async () => getSessionUserId(await cookies()),
    findQuestion: async (id) => {
      const rows = await db.select({ id: questions.id, question: questions.question }).from(questions).where(eq(questions.id, id)).limit(1);
      return rows[0] ?? null;
    },
    selectProviders: () => selectTraceProviders(),
    config,
    limiter: getSharedTraceLimiter(config.maxPerHour),
    store: createDbTraceStore(),
  });
}
