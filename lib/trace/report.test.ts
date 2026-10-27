import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildTraceReport, formatTraceReport, median, NEWEST_ROWS, type ReportRow } from "./report";

const RANGE = { minWords: 150, maxWords: 500 };

const row = (over: Partial<ReportRow> & { id: number }): ReportRow => ({
  questionId: 1,
  source: "reasoning",
  status: "ready",
  decisionReason: "in_range",
  model: "deepseek-flash",
  finalWords: 300,
  errorCode: null,
  totalMs: 1000,
  warnings: [],
  ...over,
});

const ROWS: ReportRow[] = [
  row({ id: 1, finalWords: 100, totalMs: 500 }), // ready, below the range
  row({ id: 2, finalWords: 150, totalMs: 1500 }), // on the lower edge
  row({ id: 3, finalWords: 500, questionId: 2, source: "steps", decisionReason: "too_long", totalMs: 2500, warnings: ["reasoning_trimmed_to_max_words"] }), // on the upper edge
  row({ id: 4, finalWords: 501, questionId: 2, totalMs: 500 }), // above
  row({ id: 5, status: "failed", errorCode: "upstream", finalWords: 0, totalMs: 4000, source: "steps", model: "other-model" }),
  row({ id: 6, status: "cancelled", errorCode: "cancelled", finalWords: 0, totalMs: null, warnings: null }),
  row({ id: 7, status: "failed", errorCode: "timeout", finalWords: null, totalMs: 3000, source: null, decisionReason: null, model: null }),
];

describe("buildTraceReport", () => {
  const report = buildTraceReport(ROWS, RANGE);

  it("counts rows by status, source, decision reason and model, most common first", () => {
    expect(report.total).toBe(7);
    expect(report.byStatus).toEqual([{ key: "ready", count: 4 }, { key: "failed", count: 2 }, { key: "cancelled", count: 1 }]);
    expect(report.bySource).toEqual([{ key: "reasoning", count: 4 }, { key: "steps", count: 2 }, { key: "(none)", count: 1 }]);
    expect(report.byDecisionReason).toEqual([{ key: "in_range", count: 5 }, { key: "(none)", count: 1 }, { key: "too_long", count: 1 }]);
    expect(report.byModel).toEqual([{ key: "deepseek-flash", count: 5 }, { key: "(none)", count: 1 }, { key: "other-model", count: 1 }]);
  });

  it("summarises finalWords of ready traces: min, median, max", () => {
    expect(report.finalWords).toEqual({ count: 4, min: 100, median: 325, max: 501 }); // (150 + 500) / 2
  });

  it("the share within the word range includes both edges", () => {
    expect(report.withinRange).toEqual({ minWords: 150, maxWords: 500, ready: 4, within: 2, share: 0.5 });
  });

  it("counts error codes, and leaves out rows without one", () => {
    expect(report.errorCodes).toEqual([{ key: "cancelled", count: 1 }, { key: "timeout", count: 1 }, { key: "upstream", count: 1 }]);
  });

  it("average and max totalMs ignore null timings", () => {
    expect(report.totalMs).toEqual({ count: 6, average: (500 + 1500 + 2500 + 500 + 4000 + 3000) / 6, max: 4000 });
  });

  it("counts rows with at least one warning (null and empty do not count)", () => {
    expect(report.rowsWithWarnings).toBe(1);
  });

  it("counts ready traces per question id, in id order, and skips questions with none", () => {
    expect(report.readyByQuestion).toEqual([{ questionId: 1, ready: 2 }, { questionId: 2, ready: 2 }]);
  });

  it("lists the newest rows by id with only id, question id, source and status", () => {
    expect(NEWEST_ROWS).toBe(5);
    expect(report.newest.map((r) => r.id)).toEqual([7, 6, 5, 4, 3]);
    for (const r of report.newest) expect(Object.keys(r).sort()).toEqual(["id", "questionId", "source", "status"]);
    expect(report.newest[0]).toEqual({ id: 7, questionId: 1, source: null, status: "failed" });
  });

  it("does not depend on the order of the input rows", () => {
    expect(buildTraceReport([...ROWS].reverse(), RANGE)).toEqual(report);
  });

  it("does not change its input", () => {
    const copy = JSON.stringify(ROWS);
    buildTraceReport(ROWS, RANGE);
    expect(JSON.stringify(ROWS)).toBe(copy);
  });
});

describe("buildTraceReport with an empty table or null fields", () => {
  it("an empty table gives zeros and nulls, without dividing by zero", () => {
    const report = buildTraceReport([], RANGE);
    expect(report).toEqual({
      total: 0,
      byStatus: [],
      bySource: [],
      byDecisionReason: [],
      byModel: [],
      finalWords: null,
      withinRange: { minWords: 150, maxWords: 500, ready: 0, within: 0, share: null },
      errorCodes: [],
      totalMs: null,
      rowsWithWarnings: 0,
      readyByQuestion: [],
      newest: [],
    });
  });

  it("rows whose optional fields are all null are counted under (none) and break nothing", () => {
    const nulls: ReportRow = { id: 9, questionId: 3, source: null, status: null, decisionReason: null, model: null, finalWords: null, errorCode: null, totalMs: null, warnings: null };
    const report = buildTraceReport([nulls], RANGE);
    expect(report.byStatus).toEqual([{ key: "(none)", count: 1 }]);
    expect(report.finalWords).toBeNull();
    expect(report.totalMs).toBeNull();
    expect(report.withinRange.share).toBeNull();
    expect(report.readyByQuestion).toEqual([]);
    expect(report.rowsWithWarnings).toBe(0);
  });

  it("ready rows with a null word count are ready but not in the word statistics", () => {
    const report = buildTraceReport([row({ id: 1, finalWords: null }), row({ id: 2, finalWords: 200 })], RANGE);
    expect(report.withinRange).toMatchObject({ ready: 2, within: 1, share: 0.5 });
    expect(report.finalWords).toEqual({ count: 1, min: 200, median: 200, max: 200 });
  });

  it("fewer rows than the newest limit lists them all", () => {
    expect(buildTraceReport([row({ id: 2 }), row({ id: 1 })], RANGE).newest.map((r) => r.id)).toEqual([2, 1]);
  });

  it("median of one, two and three values", () => {
    expect(median([5])).toBe(5);
    expect(median([1, 2])).toBe(1.5);
    expect(median([1, 2, 9])).toBe(2);
  });
});

describe("formatTraceReport", () => {
  it("prints every section for a normal table", () => {
    const text = formatTraceReport(buildTraceReport(ROWS, RANGE));
    for (const part of [
      "Traces: 7 rows",
      "By status\n  ready: 4\n  failed: 2\n  cancelled: 1",
      "By source",
      "By decision reason",
      "By model",
      "min 100, median 325, max 501 (4 traces)",
      "within 150 to 500 words",
      "2 of 4 (50%)",
      "Error codes\n  cancelled: 1\n  timeout: 1\n  upstream: 1",
      "average 2000 ms, max 4000 ms (6 rows)",
      "Rows with warnings: 1",
      "question 1: 2\n  question 2: 2",
      "Newest 5 rows",
      "#7  question 1  (none)  failed",
    ]) {
      expect(text, part).toContain(part);
    }
    expect(text.endsWith("\n")).toBe(true);
  });

  it("an empty table says so and stops", () => {
    expect(formatTraceReport(buildTraceReport([], RANGE))).toBe("Traces: 0 rows\n(the traces table is empty)\n");
  });

  it("says (no ...) instead of numbers when there is nothing to average", () => {
    const text = formatTraceReport(buildTraceReport([row({ id: 1, status: "failed", errorCode: "upstream", finalWords: null, totalMs: null })], RANGE));
    expect(text).toContain("Traces: 1 row\n");
    expect(text).toContain("(no ready traces)");
    expect(text).toContain("(no timings)");
    expect(text).not.toMatch(/NaN|undefined|Infinity/);
    expect(text).toContain("Ready traces per question id\n  (none)");
  });

  it("never prints a learner id or trace text (the rows do not have them)", () => {
    const text = formatTraceReport(buildTraceReport(ROWS, RANGE));
    expect(text).not.toMatch(/userId|finalParagraphs|rawReasoning|stepsText/);
  });
});

describe("scripts/trace-report.ts (static guard: it must stay read-only)", () => {
  const source = readFileSync(join(__dirname, "../../scripts/trace-report.ts"), "utf8");
  const code = source.replace(/\/\/.*$/gm, "");

  it("runs only a SELECT, in a read-only transaction", () => {
    expect(code).toMatch(/SELECT [\s\S]*FROM traces/);
    expect(code).toContain('sql.begin("read only"');
    expect(code).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|GRANT)\b/i);
  });

  it("selects no learner id and no trace text", () => {
    const select = code.match(/SELECT[\s\S]*?FROM traces/)![0];
    for (const column of ["user_id", "raw_reasoning", "steps_text", "final_paragraphs", "usage"]) expect(select).not.toContain(column);
  });

  it("prints the target first and refuses without --yes before it connects", () => {
    expect(code.indexOf("Target:")).toBeLessThan(code.indexOf('"--yes"'));
    expect(code.indexOf('"--yes"')).toBeLessThan(code.indexOf("postgres(connectionString"));
    expect(code).toContain("process.exit(1)");
  });

  it("takes the word range from the config defaults, not from the environment", () => {
    expect(code).toContain("TRACE_DEFAULTS.minWords");
    expect(code).not.toMatch(/TRACE_MIN_WORDS|TRACE_MAX_WORDS/);
    expect(code.match(/process\.env\.\w+/g)).toEqual(["process.env.DATABASE_URL"]);
  });

  it("makes no network call and does not call an AI service", () => {
    expect(code).not.toMatch(/\bfetch\s*\(|https?:\/\/|openai|deepseek/i);
  });
});
