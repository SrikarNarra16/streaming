// A summary of the `traces` table. Two pure functions: buildTraceReport turns rows into a plain object, and
// formatTraceReport turns that object into text. No database, no network, no file access.
//
// The rows hold only what the report needs. They carry no learner id, no trace text and no raw model output.

export interface ReportRow {
  id: number;
  questionId: number;
  source: string | null;
  status: string | null;
  decisionReason: string | null;
  model: string | null;
  finalWords: number | null;
  errorCode: string | null;
  totalMs: number | null;
  warnings: string[] | null;
}

export interface Count {
  key: string;
  count: number;
}

export interface NumberSummary {
  count: number;
  min: number;
  median: number;
  max: number;
}

export interface TraceReport {
  total: number;
  byStatus: Count[];
  bySource: Count[];
  byDecisionReason: Count[];
  byModel: Count[];
  /** Over the ready traces that have a word count. null when there are none. */
  finalWords: NumberSummary | null;
  /** Share of ready traces whose finalWords is within [minWords, maxWords] (inclusive). share is null without ready traces. */
  withinRange: { minWords: number; maxWords: number; ready: number; within: number; share: number | null };
  errorCodes: Count[];
  /** Over the rows that have a totalMs. null when there are none. */
  totalMs: { count: number; average: number; max: number } | null;
  rowsWithWarnings: number;
  readyByQuestion: Array<{ questionId: number; ready: number }>;
  /** The newest rows (highest ids): ids, question id, source and status only. */
  newest: Array<{ id: number; questionId: number; source: string | null; status: string | null }>;
}

export const NONE_LABEL = "(none)";
export const NEWEST_ROWS = 5;

function tally(values: Array<string | null | undefined>): Count[] {
  const counts = new Map<string, number>();
  for (const value of values) {
    const key = value === null || value === undefined || value === "" ? NONE_LABEL : value;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

export function median(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function buildTraceReport(rows: ReportRow[], range: { minWords: number; maxWords: number }): TraceReport {
  const ready = rows.filter((row) => row.status === "ready");

  const words = ready.map((row) => row.finalWords).filter(isNumber).sort((a, b) => a - b);
  const within = words.filter((w) => w >= range.minWords && w <= range.maxWords).length;

  const times = rows.map((row) => row.totalMs).filter(isNumber);

  const perQuestion = new Map<number, number>();
  for (const row of ready) perQuestion.set(row.questionId, (perQuestion.get(row.questionId) ?? 0) + 1);

  return {
    total: rows.length,
    byStatus: tally(rows.map((row) => row.status)),
    bySource: tally(rows.map((row) => row.source)),
    byDecisionReason: tally(rows.map((row) => row.decisionReason)),
    byModel: tally(rows.map((row) => row.model)),
    finalWords: words.length === 0 ? null : { count: words.length, min: words[0], median: median(words), max: words[words.length - 1] },
    withinRange: {
      minWords: range.minWords,
      maxWords: range.maxWords,
      ready: ready.length,
      within,
      share: ready.length === 0 ? null : within / ready.length,
    },
    errorCodes: tally(rows.map((row) => row.errorCode).filter((code) => code !== null && code !== undefined && code !== "")),
    totalMs: times.length === 0 ? null : { count: times.length, average: times.reduce((a, b) => a + b, 0) / times.length, max: Math.max(...times) },
    rowsWithWarnings: rows.filter((row) => Array.isArray(row.warnings) && row.warnings.length > 0).length,
    readyByQuestion: [...perQuestion.entries()].map(([questionId, count]) => ({ questionId, ready: count })).sort((a, b) => a.questionId - b.questionId),
    newest: [...rows]
      .sort((a, b) => b.id - a.id)
      .slice(0, NEWEST_ROWS)
      .map((row) => ({ id: row.id, questionId: row.questionId, source: row.source, status: row.status })),
  };
}

const round1 = (n: number) => String(Math.round(n * 10) / 10);
const percent = (share: number) => `${round1(share * 100)}%`;

function countLines(title: string, counts: Count[]): string[] {
  return [title, ...(counts.length === 0 ? ["  (no rows)"] : counts.map((c) => `  ${c.key}: ${c.count}`))];
}

export function formatTraceReport(report: TraceReport): string {
  const out: string[] = [];
  out.push(`Traces: ${report.total} row${report.total === 1 ? "" : "s"}`);
  if (report.total === 0) {
    out.push("(the traces table is empty)");
    return out.join("\n") + "\n";
  }

  out.push("", ...countLines("By status", report.byStatus));
  out.push("", ...countLines("By source", report.bySource));
  out.push("", ...countLines("By decision reason", report.byDecisionReason));
  out.push("", ...countLines("By model", report.byModel));

  out.push("", "Words in ready traces (finalWords)");
  out.push(report.finalWords ? `  min ${round1(report.finalWords.min)}, median ${round1(report.finalWords.median)}, max ${round1(report.finalWords.max)} (${report.finalWords.count} traces)` : "  (no ready traces)");

  const r = report.withinRange;
  out.push("", `Ready traces within ${r.minWords} to ${r.maxWords} words (the TRACE_MIN_WORDS and TRACE_MAX_WORDS defaults)`);
  out.push(r.share === null ? "  (no ready traces)" : `  ${r.within} of ${r.ready} (${percent(r.share)})`);

  out.push("", ...countLines("Error codes", report.errorCodes));

  out.push("", "Time per request (totalMs)");
  out.push(report.totalMs ? `  average ${round1(report.totalMs.average)} ms, max ${round1(report.totalMs.max)} ms (${report.totalMs.count} rows)` : "  (no timings)");

  out.push("", `Rows with warnings: ${report.rowsWithWarnings}`);

  out.push("", "Ready traces per question id");
  out.push(...(report.readyByQuestion.length === 0 ? ["  (none)"] : report.readyByQuestion.map((q) => `  question ${q.questionId}: ${q.ready}`)));

  out.push("", `Newest ${report.newest.length} row${report.newest.length === 1 ? "" : "s"} (id, question id, source, status)`);
  out.push(...report.newest.map((row) => `  #${row.id}  question ${row.questionId}  ${row.source ?? NONE_LABEL}  ${row.status ?? NONE_LABEL}`));

  return out.join("\n") + "\n";
}
