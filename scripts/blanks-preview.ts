// Preview of the blank generator (a DRAFT, see lib/blanks/). Pure: it reads one text file you give it (or uses
// the built-in invented sample), cleans and segments it, proposes blanks, applies the best one per paragraph
// and prints the result. It makes no network call and reads no environment variable or env file.
//
// Usage: node_modules/.bin/tsx scripts/blanks-preview.ts [trace-file] [--steps] [--seed N] [--include-code] [--skip-first false]
//   no file      uses the built-in sample reasoning (--steps: the built-in sample step-by-step text)
import { readFileSync } from "node:fs";
import { cleanTrace } from "../lib/clean-trace";
import { segmentTraceWithStats } from "../lib/segment";
import { applyBlanks } from "../lib/blanks/apply";
import { proposeBlanks } from "../lib/blanks/propose";
import { SAMPLE_REASONING, SAMPLE_STEPS } from "../lib/trace/sample-trace";

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(name);
const value = (name: string) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const valueFlags = new Set(["--seed", "--skip-first"]);
const positional = argv.filter((a, i) => !a.startsWith("--") && !valueFlags.has(argv[i - 1] ?? ""));

const path = positional[0];
const label = path ? `file ${path}` : flag("--steps") ? "built-in sample steps text" : "built-in sample reasoning";
const raw = path ? readFileSync(path, "utf8") : flag("--steps") ? SAMPLE_STEPS : SAMPLE_REASONING;
const seed = value("--seed") ?? 0;
const skipFirst = value("--skip-first") !== "false";

const cleaned = cleanTrace(raw);
const { paragraphs } = segmentTraceWithStats(cleaned.text);
const words = (text: string) => (text.trim() === "" ? 0 : text.trim().split(/\s+/).length);

// Three per paragraph, so the alternatives can be seen; only the best one is applied.
const proposals = proposeBlanks(paragraphs, { maxBlanksPerParagraph: 3, includeCode: flag("--include-code"), skipFirst, seed });
const best = proposals.map((list) => list.slice(0, 1));
const content = applyBlanks(paragraphs, best);

console.log(`source: ${label} | cleaned artifacts removed: ${cleaned.removed.length} | paragraphs: ${paragraphs.length} | seed: ${seed}`);
console.log("\n== content with blanks (a line with $$ separates paragraphs) ==\n");
console.log(content.split("$$").join("\n\n$$\n\n"));

console.log("\n== chosen (best candidate per paragraph) ==");
paragraphs.forEach((paragraph, i) => {
  const list = proposals[i];
  const head = `paragraph ${i + 1} (${words(paragraph)} words)`;
  if (list.length === 0) {
    console.log(`${head}: no blank`);
    return;
  }
  const [pick, ...others] = list;
  console.log(`${head}: [${pick.kind}] "${pick.answer}" (${pick.reason})`);
  for (const other of others) console.log(`    alternative: [${other.kind}] "${other.answer}"`);
});
console.log(`\nblanks: ${best.reduce((n, list) => n + list.length, 0)} in ${paragraphs.length} paragraphs`);
