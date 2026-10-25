// Command-line parsing for scripts/trace-live-smoke.ts, kept here as a pure function so it can be tested
// without running the script (which makes real, billed requests). It reads no environment variable.
import { TRACE_EFFORTS, type TraceEffort } from "./deepseek-provider";

export const SMOKE_MAX_RUNS = 20;

/** Shown (after the usage line) when --live is missing. */
export const SMOKE_LIVE_REQUIRED = "This script makes real, billed DeepSeek requests. Add --live to run it.";

export type SmokeMode = "reasoning" | "steps";

export interface SmokeArgs {
  prompt: string;
  effort?: TraceEffort;
  mode: SmokeMode;
  runs: number;
  /** --runs was given: one compact line per run and a summary. */
  compact: boolean;
  minWords: number;
  maxWords: number;
  show: boolean;
  /** --live was given. Without it the parser returns SMOKE_LIVE_REQUIRED instead of arguments. */
  live: boolean;
  /** Any option other than --live was given. */
  anyFlag: boolean;
}

/**
 * Returns the parsed arguments, or an error message (SMOKE_LIVE_REQUIRED when --live is missing).
 * Accepts `--flag value` and `--flag=value`.
 */
export function parseSmokeArgs(argv: string[]): SmokeArgs | string {
  const args: SmokeArgs = { prompt: "", mode: "reasoning", runs: 1, compact: false, minWords: 150, maxWords: 500, show: false, live: false, anyFlag: false };
  const promptWords: string[] = [];
  const integer = (name: string, value: string | undefined, min: number, max: number): number | string => {
    if (value === undefined || !/^\d{1,6}$/.test(value)) return `${name} needs a whole number`;
    const n = Number(value);
    return n < min || n > max ? `${name} must be between ${min} and ${max}` : n;
  };

  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i];
    if (!raw.startsWith("--")) {
      promptWords.push(raw);
      continue;
    }
    const eq = raw.indexOf("=");
    const name = eq === -1 ? raw : raw.slice(0, eq);
    const takeValue = () => (eq === -1 ? argv[++i] : raw.slice(eq + 1));

    if (name === "--live") {
      args.live = true; // a confirmation, not a setting: it does not count as "any flag"
      continue;
    }
    args.anyFlag = true;
    if (name === "--show") {
      args.show = true;
    } else if (name === "--effort") {
      const value = takeValue();
      const effort = TRACE_EFFORTS.find((e) => e === value);
      if (!effort) return "--effort must be low, high or max";
      args.effort = effort;
    } else if (name === "--mode") {
      const value = takeValue();
      if (value !== "reasoning" && value !== "steps") return "--mode must be reasoning or steps";
      args.mode = value;
    } else if (name === "--runs") {
      const n = integer("--runs", takeValue(), 1, SMOKE_MAX_RUNS);
      if (typeof n === "string") return n;
      args.runs = n;
      args.compact = true;
    } else if (name === "--min-words" || name === "--max-words") {
      const n = integer(name, takeValue(), 0, 100000);
      if (typeof n === "string") return n;
      if (name === "--min-words") args.minWords = n;
      else args.maxWords = n;
    } else {
      return `Unknown option ${name}`;
    }
  }
  if (!args.live) return SMOKE_LIVE_REQUIRED;
  if (args.minWords > args.maxWords) return "--min-words must not be larger than --max-words";
  args.prompt = promptWords.join(" ").trim();
  return args;
}
