// Preview of the blank generator (a DRAFT, see lib/blanks/). Pure: it reads one text file you give it (or uses
// the built-in invented sample), cleans and segments it, proposes blanks, applies the best one per paragraph
// and prints the result. It makes no network call and reads no environment variable or env file.
//
// Usage: node_modules/.bin/tsx scripts/blanks-preview.ts [trace-file] [--steps] [--fixture binary|spiral] [--seed N]
//        [--include-code] [--skip-first false] [--include-spacing-sensitive] [--allow-generic] [--allow-repeat]
//   no file      uses the built-in sample reasoning (--steps: the built-in sample step-by-step text;
//                --fixture: the hand-written binary search or spiral matrix trace)
import { readFileSync } from "node:fs";
import { cleanTrace } from "../lib/clean-trace";
import { segmentTraceWithStats } from "../lib/segment";
import { applyBlanks } from "../lib/blanks/apply";
import { BINARY_SEARCH_TRACE, SPIRAL_MATRIX_TRACE } from "../lib/blanks/fixtures";
import { proposeBlanksWithStats } from "../lib/blanks/propose";
import { SAMPLE_REASONING, SAMPLE_STEPS } from "../lib/trace/sample-trace";

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(name);
const value = (name: string) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const valueFlags = new Set(["--seed", "--skip-first", "--fixture"]);
const positional = argv.filter((a, i) => !a.startsWith("--") && !valueFlags.has(argv[i - 1] ?? ""));

const path = positional[0];
const fixture = value("--fixture");
const FIXTURES: Record<string, string> = { binary: BINARY_SEARCH_TRACE, spiral: SPIRAL_MATRIX_TRACE };
if (fixture !== undefined && !(fixture in FIXTURES)) throw new Error(`unknown --fixture "${fixture}" (use binary or spiral)`);
const label = path ? `file ${path}` : fixture ? `fixture ${fixture}` : flag("--steps") ? "built-in sample steps text" : "built-in sample reasoning";
const raw = path ? readFileSync(path, "utf8") : fixture ? FIXTURES[fixture] : flag("--steps") ? SAMPLE_STEPS : SAMPLE_REASONING;
const seed = value("--seed") ?? 0;
const skipFirst = value("--skip-first") !== "false";

const cleaned = cleanTrace(raw);
const { paragraphs } = segmentTraceWithStats(cleaned.text);
const words = (text: string) => (text.trim() === "" ? 0 : text.trim().split(/\s+/).length);

const options = {
  includeCode: flag("--include-code"),
  skipFirst,
  seed,
  includeSpacingSensitive: flag("--include-spacing-sensitive"),
  allowGenericTerms: flag("--allow-generic"),
  allowRepeatAcrossParagraphs: flag("--allow-repeat"),
};
// The best one per paragraph is applied. Three per paragraph are asked for separately, only to show alternatives
// (they are not checked against each other across paragraphs).
const { candidates: best, stats } = proposeBlanksWithStats(paragraphs, { ...options, maxBlanksPerParagraph: 1 });
const proposals = proposeBlanksWithStats(paragraphs, { ...options, maxBlanksPerParagraph: 3 }).candidates;
const content = applyBlanks(paragraphs, best);

console.log(`source: ${label} | cleaned artifacts removed: ${cleaned.removed.length} | paragraphs: ${paragraphs.length} | seed: ${seed}`);
console.log("\n== content with blanks (a line with $$ separates paragraphs) ==\n");
console.log(content.split("$$").join("\n\n$$\n\n"));

console.log("\n== chosen (best candidate per paragraph) ==");
paragraphs.forEach((paragraph, i) => {
  const list = best[i];
  const head = `paragraph ${i + 1} (${words(paragraph)} words)`;
  if (list.length === 0) {
    console.log(`${head}: no blank`);
    return;
  }
  const [pick] = list;
  console.log(`${head}: [${pick.kind}] "${pick.answer}" (${pick.reason})${pick.spacingSensitive ? " [spacing-sensitive]" : ""}`);
  for (const other of proposals[i].filter((c) => c.answer.toLowerCase() !== pick.answer.toLowerCase())) {
    console.log(`    alternative: [${other.kind}] "${other.answer}"`);
  }
});
console.log(`\nblanks: ${best.reduce((n, list) => n + list.length, 0)} in ${paragraphs.length} paragraphs`);
console.log(
  `held back: ${stats.heldBackSpacingSensitive} spacing-sensitive candidates${options.includeSpacingSensitive ? " (included: --include-spacing-sensitive)" : " (add --include-spacing-sensitive to see them)"}, ` +
    `${stats.heldBackGenericTerms} generic terms, ${stats.heldBackGiveAway} give-aways`
);
