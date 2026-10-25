// Live smoke test of the DeepSeek trace pipeline. Run it yourself; it makes ONE real request.
// Usage: node_modules/.bin/tsx scripts/trace-live-smoke.ts "Write a Python function that counts vowels."
//
// It reads DEEPSEEK_API_KEY (and the optional DEEPSEEK_TRACE_* settings) from .env.local through the
// client factory, streams one trace, then prints the status, warnings, word counts, model and usage,
// and the cleaner/segmenter numbers. It never prints the key, the request URL, any environment
// variable, or the text of the trace itself.
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { cleanTrace } from "../lib/clean-trace";
import { consumeFromProvider } from "../lib/trace/consume";
import { createDeepSeekClientFromEnv, readTraceSettingsFromEnv } from "../lib/trace/deepseek-client";
import { createDeepSeekProvider } from "../lib/trace/deepseek-provider";
import { DEFAULT_SEGMENT_OPTIONS, findTraceArtifacts, segmentTraceWithStats } from "../lib/segment";

const words = (text: string) => (text.trim() === "" ? 0 : text.trim().split(/\s+/).length);

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

async function main() {
  const prompt = process.argv.slice(2).join(" ").trim();
  if (prompt === "") {
    console.error('Usage: tsx scripts/trace-live-smoke.ts "<a short coding prompt>"');
    process.exit(1);
  }

  let client;
  try {
    client = createDeepSeekClientFromEnv();
  } catch {
    console.error("The AI service is not configured (DEEPSEEK_API_KEY is missing in .env.local).");
    process.exit(1);
  }
  const { model, maxTokens } = readTraceSettingsFromEnv();
  console.log(`model: ${model} | max_tokens: ${maxTokens} | prompt: ${prompt.length} characters`);

  const started = Date.now();
  let firstReasoningMs: number | null = null;
  let firstAnswerMs: number | null = null;
  const result = await consumeFromProvider(createDeepSeekProvider({ client, model, maxTokens }), prompt, {
    firstEventTimeoutMs: 60_000,
    idleTimeoutMs: 30_000,
    maxTotalMs: 180_000,
    onReasoning: () => {
      firstReasoningMs ??= Date.now() - started;
    },
    onAnswer: () => {
      firstAnswerMs ??= Date.now() - started;
    },
  });
  const totalMs = Date.now() - started;

  console.log("\n== stream");
  console.log(`status: ${result.status}`);
  console.log(`warnings: ${result.warnings.length ? result.warnings.join(", ") : "none"}`);
  if (result.error) console.log(`error: ${result.error.code} (${result.error.message})`);
  console.log(`time: first reasoning ${firstReasoningMs ?? "-"} ms, first answer ${firstAnswerMs ?? "-"} ms, total ${totalMs} ms`);
  console.log(`words: reasoning ${words(result.reasoning)}, answer ${words(result.answer)}`);
  console.log(`model: ${result.model ?? "-"} | served model: ${result.servedModel ?? "-"} | finish reason: ${result.finishReason ?? "-"}`);
  console.log(`usage: ${result.usage ? JSON.stringify(result.usage) : "not received"}`);
  if (result.finishReason === "length") console.log("note: the token limit was reached, so the output was cut off");

  console.log("\n== cleaner and segmenter (same columns as scripts/segment-report.ts)");
  const cleaned = cleanTrace(result.reasoning);
  const { paragraphs, stats } = segmentTraceWithStats(cleaned.text);
  const counts = paragraphs.map(words);
  const maxWords = DEFAULT_SEGMENT_OPTIONS.targetMaxWords;
  console.log(["words", "paras", "min", "median", "max", `over${maxWords}`, "code", "split", "tails", "repl", "artifacts", "removed"].join("\t"));
  console.log(
    [
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
      findTraceArtifacts(cleaned.text).length,
      cleaned.removed.length,
    ].join("\t")
  );
}

main().catch(() => {
  console.error("The smoke test failed unexpectedly.");
  process.exit(1);
});
