// Standalone measurement of DeepSeek thinking-mode streaming. Not part of the app.
// Usage: node_modules/.bin/tsx scripts/trace-spike.ts --model deepseek-flash --problem spiral [--effort low|high|max] [--effort-in top|thinking]
import * as dotenv from "dotenv";
import OpenAI from "openai";
import { mkdirSync, writeFileSync } from "node:fs";

dotenv.config({ path: ".env.local" });

const MAX_TOKENS = 8000; // hard cap per request
const TIMEOUT_MS = 3 * 60 * 1000;
const IDLE_MS = 30 * 1000; // abort if no chunk for this long
const OUT_DIR = "local-setup/spike-output";

const PROBLEMS: Record<string, string> = {
  vowels: "Write a Python function count_vowels(s) that returns how many vowels (a, e, i, o, u, any case) are in the string s.",
  spiral: "Write a Python function spiral_order(matrix) that takes an m x n matrix (list of lists) and returns its elements in spiral order, starting at the top-left and going clockwise.",
  spiral_full: `Spiral Matrix

Write a function spiral_order(matrix) that takes a two-dimensional list of integers with m rows and n columns and returns a list containing all of its elements in spiral order. Spiral order starts at the top-left element, moves right along the top row, then down the last column, then left along the bottom row, then up the first column, and then continues inward in the same way until every element has been visited exactly once.

Input: matrix, a list of m lists, each containing n integers.
Output: a list of m * n integers in spiral order.

Constraints:
- 1 <= m, n <= 10
- -100 <= matrix[i][j] <= 100

Example:
Input: [[1, 2, 3], [4, 5, 6], [7, 8, 9]]
Output: [1, 2, 3, 6, 9, 8, 7, 4, 5]

You do not need to read input or print anything. Just write the function.`,
  bsearch: "Write a Python function first_index(nums, target) that takes a sorted list that may contain duplicates and returns the index of the first occurrence of target, or -1 if it is absent.",
};

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const model = arg("model");
const problemKey = arg("problem");
const effort = arg("effort"); // undefined = API default
const effortIn = arg("effort-in") ?? "top";
const system = arg("system");
const plain = process.argv.includes("--plain"); // omit thinking/effort params entirely (legacy model names)
if (!model || !problemKey || !PROBLEMS[problemKey] || !["top", "thinking"].includes(effortIn)) {
  console.error("Usage: --model <name> --problem <vowels|spiral|spiral_full|bsearch> [--effort low|high|max] [--effort-in top|thinking]");
  process.exit(1);
}
const apiKey = process.env.DEEPSEEK_API_KEY;
if (!apiKey || apiKey.includes("your_deepseek_api_key")) {
  console.error("DEEPSEEK_API_KEY missing or still the placeholder in .env.local");
  process.exit(1);
}

const keysOf = (o: unknown) => (o && typeof o === "object" ? Object.keys(o as object) : []);
const countWords = (t: string) => (t.trim() ? t.trim().split(/\s+/).length : 0);
const countParagraphs = (t: string) => t.split(/\n\s*\n/).filter((p) => p.trim()).length;

async function main() {
  const client = new OpenAI({ baseURL: "https://api.deepseek.com", apiKey, maxRetries: 0 });

  const body: any = {
    model,
    messages: [...(system ? [{ role: "system", content: system }] : []), { role: "user", content: PROBLEMS[problemKey!] }],
    max_tokens: MAX_TOKENS,
    stream: true,
    stream_options: { include_usage: true },
    thinking: { type: "enabled" },
  };
  if (plain) delete body.thinking;
  if (effort && !plain) {
    if (effortIn === "thinking") body.thinking.reasoning_effort = effort;
    else body.reasoning_effort = effort;
  }

  const fieldNames = { chunk: new Set<string>(), choice: new Set<string>(), delta: new Set<string>(), usage: new Set<string>() };
  let reasoning = "";
  let answer = "";
  let finishReason: string | null = null;
  let servedModel: string | null = null;
  let usage: any = null;
  let chunkCount = 0;
  let tFirstReasoning: number | null = null;
  let tFirstAnswer: number | null = null;
  let error: Record<string, unknown> | null = null;
  let tLastContent: number | null = null;
  let abortedBy: "idle" | "overall" | null = null;
  const redact = (t: string) => t.split(apiKey!).join("[REDACTED]").replace(/sk-[A-Za-z0-9_-]{8,}/g, "[REDACTED]");

  const t0 = performance.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => { abortedBy = "overall"; ctrl.abort(); }, TIMEOUT_MS);
  let idleTimer: NodeJS.Timeout;
  const armIdle = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { abortedBy = "idle"; ctrl.abort(); }, IDLE_MS);
  };
  armIdle();
  try {
    const stream: any = await client.chat.completions.create(body, { signal: ctrl.signal });
    for await (const chunk of stream) {
      chunkCount++;
      if (chunk.model) servedModel = chunk.model;
      armIdle();
      keysOf(chunk).forEach((k) => fieldNames.chunk.add(k));
      const choice = chunk.choices?.[0];
      keysOf(choice).forEach((k) => fieldNames.choice.add(k));
      keysOf(choice?.delta).forEach((k) => fieldNames.delta.add(k));
      if (choice?.finish_reason) finishReason = choice.finish_reason;
      const r = choice?.delta?.reasoning_content;
      const c = choice?.delta?.content;
      if (r || c) tLastContent = performance.now();
      if (r) {
        if (tFirstReasoning === null) tFirstReasoning = performance.now() - t0;
        reasoning += r;
      }
      if (c) {
        if (tFirstAnswer === null) tFirstAnswer = performance.now() - t0;
        answer += c;
      }
      if (chunk.usage) {
        usage = chunk.usage;
        keysOf(chunk.usage).forEach((k) => fieldNames.usage.add(k));
      }
    }
  } catch (e: any) {
    const cause = e?.cause;
    error = {
      name: e?.name ?? "Error",
      status: e?.status,
      code: e?.code ?? cause?.code,
      causeName: cause?.name,
      causeMessage: cause?.message ? redact(String(cause.message)) : undefined,
      message: redact(String(e?.message ?? e)),
      abortedBy,
    };
  } finally {
    clearTimeout(timer);
    clearTimeout(idleTimer!);
  }
  const totalMs = performance.now() - t0;
  const endedNormally = finishReason !== null && !error;
  // "answer_complete_stream_error": answer text arrived, then the stream failed before a finish_reason.
  const outcome = !error ? "ok" : answer.length > 0 && finishReason === null ? "answer_complete_stream_error" : "failure";

  const summary = {
    model,
    servedModel,
    systemPrompt: system ?? null,
    problem: problemKey,
    effort: effort ?? "(default)",
    effortPlacement: effort ? effortIn : null,
    outcome,
    error,
    endedNormally,
    secondsAfterLastContent: tLastContent === null ? null : +((performance.now() - tLastContent) / 1000).toFixed(1),
    fieldNames: Object.fromEntries(Object.entries(fieldNames).map(([k, v]) => [k, [...v]])),
    chunkCount,
    msToFirstReasoning: tFirstReasoning === null ? null : Math.round(tFirstReasoning),
    msToFirstAnswer: tFirstAnswer === null ? null : Math.round(tFirstAnswer),
    totalMs: Math.round(totalMs),
    reasoning: { chars: reasoning.length, words: countWords(reasoning), paragraphs: countParagraphs(reasoning) },
    answerChars: answer.length,
    usage,
    finishReason,
  };

  mkdirSync(OUT_DIR, { recursive: true });
  const file = `${OUT_DIR}/${new Date().toISOString().replace(/[:.]/g, "-")}_${model}_${problemKey}_${effort ?? "default"}.json`;
  writeFileSync(file, JSON.stringify({ ...summary, rawReasoning: reasoning, rawAnswer: answer }, null, 2));

  console.log(JSON.stringify(summary, null, 2));
  console.log(`saved: ${file}`);
}

main();
