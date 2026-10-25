// Prints segmentation statistics for saved reasoning traces. Read-only: writes nothing to disk and
// prints numbers and file names only (never trace text, keys or environment variables).
// Usage: node_modules/.bin/tsx scripts/segment-report.ts <trace file or folder> [--clean]
// With --clean each trace goes through lib/clean-trace.ts before segmentation (the "removed" column
// then shows how many artifacts were removed; "artifacts" counts what is still left afterwards).
// A trace file is a .json with a "rawReasoning" field (as saved by scripts/trace-spike.ts) or plain text (.txt).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { cleanTrace } from "../lib/clean-trace";
import { DEFAULT_SEGMENT_OPTIONS, findTraceArtifacts, segmentTraceWithStats } from "../lib/segment";

function listTraceFiles(target: string): string[] {
  if (statSync(target).isDirectory()) {
    return readdirSync(target)
      .filter((name) => name.endsWith(".json") || name.endsWith(".txt"))
      .sort()
      .map((name) => join(target, name));
  }
  return [target];
}

function readTrace(file: string): string | null {
  const content = readFileSync(file, "utf8");
  if (!file.endsWith(".json")) return content;
  try {
    const parsed = JSON.parse(content);
    return typeof parsed.rawReasoning === "string" ? parsed.rawReasoning : null;
  } catch {
    return null;
  }
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const words = (text: string) => (text.trim() === "" ? 0 : text.trim().split(/\s+/).length);

function main() {
  const clean = process.argv.includes("--clean");
  const target = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
  if (!target) {
    console.error("Usage: tsx scripts/segment-report.ts <trace file or folder> [--clean]");
    process.exit(1);
  }
  let files: string[];
  try {
    files = listTraceFiles(target);
  } catch {
    console.error("Could not read the given path.");
    process.exit(1);
  }

  const maxWords = DEFAULT_SEGMENT_OPTIONS.targetMaxWords;
  console.log(`options: min ${DEFAULT_SEGMENT_OPTIONS.targetMinWords}, max ${maxWords}, hard max ${DEFAULT_SEGMENT_OPTIONS.hardMaxWords}, tail ${DEFAULT_SEGMENT_OPTIONS.minTailWords}`);
  console.log(`cleaning: ${clean ? "on" : "off"}`);
  console.log(["trace", "words", "paras", "min", "median", "max", `over${maxWords}`, "code", "split", "tails", "repl", "artifacts", ...(clean ? ["removed"] : [])].join("\t"));

  let skipped = 0;
  for (const file of files) {
    const original = readTrace(file);
    if (original === null) {
      skipped++;
      continue;
    }
    const cleaned = clean ? cleanTrace(original) : null;
    const raw = cleaned ? cleaned.text : original;
    const { paragraphs, stats } = segmentTraceWithStats(raw);
    const counts = paragraphs.map(words);
    const name = basename(file).replace(/^\d{4}-\d{2}-\d{2}T[\d-]+Z_/, "").replace(/\.json$/, "");
    console.log(
      [
        name,
        stats.inputWords,
        paragraphs.length,
        counts.length ? Math.min(...counts) : 0,
        counts.length ? median(counts) : 0,
        counts.length ? Math.max(...counts) : 0,
        counts.filter((c) => c > maxWords).length,
        stats.codeParagraphs,
        stats.longSentencesSplit,
        stats.tailsMerged,
        stats.replacements,
        findTraceArtifacts(raw).length,
        ...(cleaned ? [cleaned.removed.length] : []),
      ].join("\t")
    );
  }
  if (skipped > 0) console.log(`(${skipped} file(s) skipped: no readable rawReasoning/text)`);
}

main();
