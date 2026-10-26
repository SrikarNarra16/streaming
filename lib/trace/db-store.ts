// Saves one row per trace request in the `traces` table.
import { db } from "@/lib/db";
import { traces } from "@/schema";
import type { TraceStore } from "./run";

export function createDbTraceStore(): TraceStore {
  return {
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
