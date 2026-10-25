// Live smoke test of the DeepSeek trace pipeline.
//
// THIS SCRIPT MAKES REAL, BILLED DEEPSEEK REQUESTS. It must be run by a person, never by an automated tool.
// Without --live it prints the usage line and a warning and exits with code 1, before it loads .env.local,
// reads any environment variable or creates a client: only the pure argument parser is imported at the top.
// dotenv and every other module are loaded (dynamically) after that check has passed.
//
// Usage:
//   node_modules/.bin/tsx scripts/trace-live-smoke.ts "<prompt>" --live [--effort low|high|max]
//        [--mode reasoning|steps] [--runs N] [--min-words N] [--max-words N] [--show]
//
// With only --live it makes ONE request and prints the detailed report. Flags:
//   --live                  required: confirms that real, billed requests are intended.
//   --effort low|high|max   reasoning effort for this run (overrides DEEPSEEK_TRACE_EFFORT). Ignored in steps mode.
//   --mode reasoning|steps  reasoning (default): thinking on, the reasoning is the trace.
//                           steps: thinking off, the prompt asks for a step-by-step explanation (lib/trace/steps-prompt.ts)
//                           and the ANSWER text is the trace.
//   --runs N                run N times in sequence (1 to 20) and print one compact line per run plus a summary.
//   --min-words / --max-words  (default 150 / 500) only mark runs as inside or outside that range in the report.
//                           They never change what is requested.
//   --show                  also print the cleaned trace text after the numbers (off by default).
//
// It reads DEEPSEEK_API_KEY (and the optional DEEPSEEK_TRACE_* settings) from .env.local through the client
// factory. It never prints the key, the request URL, any header or environment variable.
import { parseSmokeArgs, SMOKE_LIVE_REQUIRED, type SmokeArgs } from "../lib/trace/smoke-args";
import type { CleanTraceResult } from "../lib/clean-trace";
import type { ConsumeResult } from "../lib/trace/consume";
import type { TraceEffort } from "../lib/trace/deepseek-provider";
import type { SegmentStats } from "../lib/segment";

const USAGE =
  'Usage: tsx scripts/trace-live-smoke.ts "<a short coding prompt>" --live [--effort low|high|max] [--mode reasoning|steps] [--runs N] [--min-words N] [--max-words N] [--show]';

// The modules that touch the environment or the network. Loaded only after the --live check.
interface LiveModules {
  cleanTrace: typeof import("../lib/clean-trace").cleanTrace;
  consumeFromProvider: typeof import("../lib/trace/consume").consumeFromProvider;
  createDeepSeekClientFromEnv: typeof import("../lib/trace/deepseek-client").createDeepSeekClientFromEnv;
  readTraceSettingsFromEnv: typeof import("../lib/trace/deepseek-client").readTraceSettingsFromEnv;
  createDeepSeekProvider: typeof import("../lib/trace/deepseek-provider").createDeepSeekProvider;
  buildStepsPrompt: typeof import("../lib/trace/steps-prompt").buildStepsPrompt;
  DEFAULT_SEGMENT_OPTIONS: typeof import("../lib/segment").DEFAULT_SEGMENT_OPTIONS;
  findTraceArtifacts: typeof import("../lib/segment").findTraceArtifacts;
  segmentTraceWithStats: typeof import("../lib/segment").segmentTraceWithStats;
}

let live!: LiveModules;

async function loadLiveModules(): Promise<void> {
  const dotenv = await import("dotenv");
  dotenv.config({ path: ".env.local" }); // the only place .env.local is loaded
  const [clean, consume, client, provider, steps, segment] = await Promise.all([
    import("../lib/clean-trace"),
    import("../lib/trace/consume"),
    import("../lib/trace/deepseek-client"),
    import("../lib/trace/deepseek-provider"),
    import("../lib/trace/steps-prompt"),
    import("../lib/segment"),
  ]);
  live = {
    cleanTrace: clean.cleanTrace,
    consumeFromProvider: consume.consumeFromProvider,
    createDeepSeekClientFromEnv: client.createDeepSeekClientFromEnv,
    readTraceSettingsFromEnv: client.readTraceSettingsFromEnv,
    createDeepSeekProvider: provider.createDeepSeekProvider,
    buildStepsPrompt: steps.buildStepsPrompt,
    DEFAULT_SEGMENT_OPTIONS: segment.DEFAULT_SEGMENT_OPTIONS,
    findTraceArtifacts: segment.findTraceArtifacts,
    segmentTraceWithStats: segment.segmentTraceWithStats,
  };
}

const words = (text: string) => (text.trim() === "" ? 0 : text.trim().split(/\s+/).length);

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

interface RunOutcome {
  result: ConsumeResult;
  firstReasoningMs: number | null;
  firstAnswerMs: number | null;
  firstTextMs: number | null;
  totalMs: number;
  cleaned: CleanTraceResult;
  stats: SegmentStats;
  paragraphWords: number[];
}

async function runOnce(
  client: ReturnType<LiveModules["createDeepSeekClientFromEnv"]>,
  settings: { model: string; maxTokens: number },
  args: SmokeArgs,
  effort: TraceEffort | undefined
): Promise<RunOutcome> {
  const provider =
    args.mode === "steps"
      ? live.createDeepSeekProvider({ client, model: settings.model, maxTokens: settings.maxTokens, thinking: "disabled" })
      : live.createDeepSeekProvider({ client, model: settings.model, maxTokens: settings.maxTokens, ...(effort ? { effort } : {}) });
  const requestPrompt = args.mode === "steps" ? live.buildStepsPrompt(args.prompt) : args.prompt;

  const started = Date.now();
  let firstReasoningMs = null as number | null;
  let firstAnswerMs = null as number | null;
  const result = await live.consumeFromProvider(provider, requestPrompt, {
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

  // In steps mode the ANSWER is the trace; otherwise the reasoning is.
  const traceText = args.mode === "steps" ? result.answer : result.reasoning;
  const cleaned = live.cleanTrace(traceText);
  const { paragraphs, stats } = live.segmentTraceWithStats(cleaned.text);
  const firstTimes = [firstReasoningMs, firstAnswerMs].filter((t): t is number => t !== null);
  return {
    result,
    firstReasoningMs,
    firstAnswerMs,
    firstTextMs: firstTimes.length ? Math.min(...firstTimes) : null,
    totalMs,
    cleaned,
    stats,
    paragraphWords: paragraphs.map(words),
  };
}

// The original single-run report.
function printDetailed(outcome: RunOutcome): void {
  const { result, totalMs } = outcome;
  console.log("\n== stream");
  console.log(`status: ${result.status}`);
  console.log(`warnings: ${result.warnings.length ? result.warnings.join(", ") : "none"}`);
  if (result.error) console.log(`error: ${result.error.code} (${result.error.message})`);
  console.log(`time: first reasoning ${outcome.firstReasoningMs ?? "-"} ms, first answer ${outcome.firstAnswerMs ?? "-"} ms, total ${totalMs} ms`);
  console.log(`words: reasoning ${words(result.reasoning)}, answer ${words(result.answer)}`);
  console.log(`model: ${result.model ?? "-"} | served model: ${result.servedModel ?? "-"} | finish reason: ${result.finishReason ?? "-"}`);
  console.log(`usage: ${result.usage ? JSON.stringify(result.usage) : "not received"}`);
  if (result.finishReason === "length") console.log("note: the token limit was reached, so the output was cut off");

  console.log("\n== cleaner and segmenter (same columns as scripts/segment-report.ts)");
  const counts = outcome.paragraphWords;
  const maxWords = live.DEFAULT_SEGMENT_OPTIONS.targetMaxWords;
  console.log(["words", "paras", "min", "median", "max", `over${maxWords}`, "code", "split", "tails", "repl", "artifacts", "removed"].join("\t"));
  console.log(
    [
      outcome.stats.inputWords,
      counts.length,
      counts.length ? Math.min(...counts) : 0,
      counts.length ? median(counts) : 0,
      counts.length ? Math.max(...counts) : 0,
      counts.filter((c) => c > maxWords).length,
      outcome.stats.codeParagraphs,
      outcome.stats.longSentencesSplit,
      outcome.stats.tailsMerged,
      outcome.stats.replacements,
      live.findTraceArtifacts(outcome.cleaned.text).length,
      outcome.cleaned.removed.length,
    ].join("\t")
  );
}

function printCompact(index: number, total: number, outcome: RunOutcome | null, args: SmokeArgs): { status: string; words: number; inRange: boolean } {
  if (!outcome) {
    console.log(`run ${index}/${total}: status=crashed | no result`);
    return { status: "crashed", words: 0, inRange: false };
  }
  const { result } = outcome;
  const traceWords = outcome.stats.inputWords;
  const hasText = traceWords > 0;
  const inRange = hasText && traceWords >= args.minWords && traceWords <= args.maxWords;
  const status = result.error ? `${result.status} (${result.error.code})` : result.status;
  const paragraphWords = outcome.paragraphWords;
  console.log(
    `run ${index}/${total}: status=${status} | first text ${outcome.firstTextMs ?? "-"} ms | total ${outcome.totalMs} ms | words ${traceWords} | ` +
      `paragraphs ${paragraphWords.length} | median paragraph words ${paragraphWords.length ? median(paragraphWords) : "-"} | ` +
      `in range ${args.minWords}-${args.maxWords}: ${hasText ? (inRange ? "yes" : "no") : "n/a"}`
  );
  return { status: result.status, words: traceWords, inRange: inRange && result.status === "complete" };
}

async function main() {
  // 1. The guard. Nothing below this block runs without --live. It reads no environment variable,
  //    loads no file and creates no client.
  const parsed = parseSmokeArgs(process.argv.slice(2));
  if (parsed === SMOKE_LIVE_REQUIRED) {
    console.error(`${USAGE}\n${SMOKE_LIVE_REQUIRED}`);
    process.exit(1);
  }
  if (typeof parsed === "string") {
    console.error(`${parsed}\n${USAGE}`);
    process.exit(1);
  }
  const args = parsed;
  if (args.prompt === "") {
    console.error(USAGE);
    process.exit(1);
  }

  // 2. Only now: load .env.local and the modules that read the environment.
  await loadLiveModules();

  let client;
  try {
    client = live.createDeepSeekClientFromEnv();
  } catch {
    console.error("The AI service is not configured (DEEPSEEK_API_KEY is missing in .env.local).");
    process.exit(1);
  }
  const settings = live.readTraceSettingsFromEnv();
  const effort = args.mode === "steps" ? undefined : (args.effort ?? settings.effort);
  console.log(`model: ${settings.model} | max_tokens: ${settings.maxTokens} | prompt: ${args.prompt.length} characters`);
  if (args.anyFlag) {
    console.log(
      `mode: ${args.mode} | thinking: ${args.mode === "steps" ? "disabled" : "enabled"} | effort: ${effort ?? "(default)"}` +
        (args.mode === "steps" && (args.effort ?? settings.effort) ? " (ignored in steps mode)" : "") +
        (args.compact ? ` | runs: ${args.runs} | range: ${args.minWords}-${args.maxWords} words` : "")
    );
  }

  if (!args.compact) {
    const outcome = await runOnce(client, settings, args, effort);
    printDetailed(outcome);
    if (args.show) console.log(`\n== cleaned trace text\n${outcome.cleaned.text}`);
    return;
  }

  // Several runs, in sequence. A failed run is counted and shown; it never stops the others.
  console.log("");
  const outcomes: Array<RunOutcome | null> = [];
  const rows: Array<{ status: string; words: number; inRange: boolean }> = [];
  for (let i = 1; i <= args.runs; i++) {
    let outcome: RunOutcome | null = null;
    try {
      outcome = await runOnce(client, settings, args, effort);
    } catch {
      outcome = null;
    }
    outcomes.push(outcome);
    rows.push(printCompact(i, args.runs, outcome, args));
  }

  const statusCounts = new Map<string, number>();
  for (const row of rows) statusCounts.set(row.status, (statusCounts.get(row.status) ?? 0) + 1);
  const withText = rows.filter((r) => r.words > 0).map((r) => r.words);
  console.log("\n== summary");
  console.log(`runs: ${rows.length} (${[...statusCounts].map(([s, n]) => `${s} ${n}`).join(", ")})`);
  if (withText.length) {
    console.log(`words (${withText.length} run(s) with text): min ${Math.min(...withText)}, median ${median(withText)}, max ${Math.max(...withText)}`);
  } else {
    console.log("words: no run produced any text");
  }
  console.log(`inside ${args.minWords}-${args.maxWords} words (complete runs only): ${rows.filter((r) => r.inRange).length} of ${rows.length}`);

  if (args.show) {
    outcomes.forEach((outcome, i) => {
      if (outcome && outcome.cleaned.text.trim() !== "") console.log(`\n== run ${i + 1}: cleaned trace text\n${outcome.cleaned.text}`);
    });
  }
}

main().catch(() => {
  console.error("The smoke test failed unexpectedly.");
  process.exit(1);
});
