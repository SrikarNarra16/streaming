// Saves one row per trace request in the `traces` table, and finds a saved trace to reuse (TRACE_REUSE).
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { traces } from "@/schema";
import { toReusableTrace, type TraceStore } from "./run";

export function createDbTraceStore(): TraceStore {
  return {
    async findReusableTrace(questionId) {
      const rows = await db
        .select({ source: traces.source, status: traces.status, finalParagraphs: traces.finalParagraphs, model: traces.model })
        .from(traces)
        .where(and(eq(traces.questionId, questionId), eq(traces.status, "ready"), sql`jsonb_array_length(${traces.finalParagraphs}) > 0`))
        .orderBy(desc(traces.createdAt), desc(traces.id))
        .limit(1);
      return rows[0] ? toReusableTrace(rows[0]) : null; // checked again here: never trust the row's shape
    },
    async saveTrace(row) {
      await db.insert(traces).values({
        userId: row.userId,
        questionId: row.questionId,
        source: row.source,
        decisionReason: row.decisionReason,
        model: row.model,
        servedModel: row.servedModel,
        status: row.status,
        rawReasoning: row.rawReasoning,
        stepsText: row.stepsText,
        finalParagraphs: row.finalParagraphs,
        finalWords: row.finalWords,
        usage: row.usage,
        warnings: row.warnings,
        errorCode: row.errorCode,
        totalMs: row.totalMs,
      });
    },
  };
}
