// A READ-ONLY summary of the `traces` table: counts by status, source, decision reason and model, word counts,
// error codes, timings and the number of ready traces per question. Run with:
//   node_modules/.bin/tsx scripts/trace-report.ts --yes     (or: npx pnpm@8 trace:report -- --yes)
// It only runs SELECT queries, inside a read-only transaction. It selects no learner id and no trace text, and it
// prints the database host and name before it connects, and refuses to connect without --yes.
// The word range comes from the defaults in lib/trace/config.ts, not from any environment variable.
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import postgres from "postgres";
import { TRACE_DEFAULTS } from "../lib/trace/config";
import { buildTraceReport, formatTraceReport, type ReportRow } from "../lib/trace/report";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL not found in environment variables");
  process.exit(1);
}

let target = "(unparseable DATABASE_URL)";
try {
  const u = new URL(connectionString);
  target = `host=${u.host} database=${u.pathname.replace(/^\//, "")}`;
} catch {}
console.log(`Target: ${target}`);

if (!process.argv.includes("--yes")) {
  console.error("Refusing to connect without --yes. This script only reads (SELECT in a read-only transaction).");
  process.exit(1);
}

const sql = postgres(connectionString, { prepare: false });

interface Row {
  id: number;
  question_id: number;
  source: string | null;
  status: string | null;
  decision_reason: string | null;
  model: string | null;
  final_words: number | null;
  error_code: string | null;
  total_ms: number | null;
  warnings: string[] | null;
}

async function main() {
  const rows = await sql.begin("read only", async (tx) => {
    return tx<Row[]>`
      SELECT id, question_id, source, status, decision_reason, model, final_words, error_code, total_ms, warnings
      FROM traces
      ORDER BY id
    `;
  });
  const reportRows: ReportRow[] = rows.map((r) => ({
    id: r.id,
    questionId: r.question_id,
    source: r.source,
    status: r.status,
    decisionReason: r.decision_reason,
    model: r.model,
    finalWords: r.final_words,
    errorCode: r.error_code,
    totalMs: r.total_ms,
    warnings: r.warnings,
  }));
  console.log("");
  console.log(formatTraceReport(buildTraceReport(reportRows, { minWords: TRACE_DEFAULTS.minWords, maxWords: TRACE_DEFAULTS.maxWords })));
}

main()
  .then(async () => {
    await sql.end();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("trace-report failed:", err instanceof Error ? err.name : "Error");
    await sql.end();
    process.exit(1);
  });
