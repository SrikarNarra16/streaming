// An in-memory TraceStore for tests and local experiments. It keeps every saved row and finds a reusable trace
// by the same rules as the database store: the newest row of the question with status "ready" and paragraphs.
import { toReusableTrace, type TraceRow, type TraceStore } from "./run";

export function createMemoryTraceStore(initial: TraceRow[] = []): TraceStore & { rows: TraceRow[] } {
  const rows: TraceRow[] = [...initial];
  return {
    rows,
    async saveTrace(row) {
      rows.push(row);
    },
    async findReusableTrace(questionId) {
      for (let i = rows.length - 1; i >= 0; i--) {
        if (rows[i].questionId !== questionId) continue;
        const reusable = toReusableTrace(rows[i]);
        if (reusable) return reusable; // newest first; rows that must not be reused are skipped
      }
      return null;
    },
  };
}
