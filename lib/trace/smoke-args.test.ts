import { describe, expect, it } from "vitest";
import { parseSmokeArgs, SMOKE_LIVE_REQUIRED, SMOKE_MAX_RUNS, type SmokeArgs } from "./smoke-args";

// Most tests pass --live, because without it nothing else is parsed successfully.
const ok = (argv: string[]): SmokeArgs => {
  const parsed = parseSmokeArgs(["--live", ...argv]);
  if (typeof parsed === "string") throw new Error(`expected success, got: ${parsed}`);
  return parsed;
};
const bad = (argv: string[]) => parseSmokeArgs(["--live", ...argv]);

describe("--live", () => {
  it("is required: without it the parser returns the warning sentence instead of arguments", () => {
    expect(SMOKE_LIVE_REQUIRED).toBe("This script makes real, billed DeepSeek requests. Add --live to run it.");
    expect(parseSmokeArgs(["Write", "a", "function"])).toBe(SMOKE_LIVE_REQUIRED);
    expect(parseSmokeArgs([])).toBe(SMOKE_LIVE_REQUIRED);
    expect(parseSmokeArgs(["q", "--runs", "3", "--mode", "steps"])).toBe(SMOKE_LIVE_REQUIRED);
    expect(parseSmokeArgs(["q", "--show", "--effort", "high"])).toBe(SMOKE_LIVE_REQUIRED);
  });

  it("is accepted anywhere in the argument list", () => {
    expect(ok(["q"]).live).toBe(true);
    expect((parseSmokeArgs(["q", "--live"]) as SmokeArgs).live).toBe(true);
    expect((parseSmokeArgs(["q", "--runs", "2", "--live"]) as SmokeArgs).live).toBe(true);
  });

  it("is a confirmation, not a setting: it does not count as 'any flag' (so the default report is unchanged)", () => {
    expect(ok(["q"]).anyFlag).toBe(false);
    expect(ok(["q", "--show"]).anyFlag).toBe(true);
  });

  it("is not enough on its own to make an empty prompt valid (the script prints its usage for that)", () => {
    expect(ok([]).prompt).toBe("");
  });

  it("does not need, read or touch any environment variable", () => {
    const realEnv = process.env;
    const touched: string[] = [];
    const trap = new Proxy({} as NodeJS.ProcessEnv, {
      get: (_t, key) => (touched.push(String(key)), undefined),
      has: (_t, key) => (touched.push(String(key)), false),
      ownKeys: () => (touched.push("(keys)"), []),
      getOwnPropertyDescriptor: (_t, key) => (touched.push(String(key)), undefined),
    });
    try {
      Object.defineProperty(process, "env", { value: trap, configurable: true, writable: true });
      // the guard path (no --live) and a successful parse
      expect(parseSmokeArgs(["q"])).toBe(SMOKE_LIVE_REQUIRED);
      expect(typeof parseSmokeArgs(["q", "--live", "--effort", "low", "--runs", "2"])).toBe("object");
      expect(parseSmokeArgs(["q", "--live", "--bogus"])).toBe("Unknown option --bogus");
    } finally {
      Object.defineProperty(process, "env", { value: realEnv, configurable: true, writable: true });
    }
    expect(touched).toEqual([]);
  });
});

describe("parseSmokeArgs: defaults (only --live given)", () => {
  it("a prompt and --live: one detailed run in reasoning mode, nothing else changed", () => {
    expect(ok(["Write", "a", "function"])).toEqual({
      prompt: "Write a function",
      mode: "reasoning",
      runs: 1,
      compact: false,
      minWords: 150,
      maxWords: 500,
      show: false,
      live: true,
      anyFlag: false,
    });
  });
});

describe("parseSmokeArgs: flags", () => {
  it("parses all flags together, in either position relative to the prompt", () => {
    const args = ok(["--effort", "high", "Solve", "it", "--mode", "steps", "--runs", "5", "--min-words", "100", "--max-words", "300", "--show"]);
    expect(args).toEqual({
      prompt: "Solve it",
      effort: "high",
      mode: "steps",
      runs: 5,
      compact: true,
      minWords: 100,
      maxWords: 300,
      show: true,
      live: true,
      anyFlag: true,
    });
  });

  it("accepts --flag=value", () => {
    expect(ok(["q", "--effort=low", "--runs=2"])).toMatchObject({ effort: "low", runs: 2, compact: true });
  });

  it("accepts low, high and max", () => {
    for (const effort of ["low", "high", "max"]) expect(ok(["q", "--effort", effort]).effort).toBe(effort);
  });

  it("an explicit --runs 1 still asks for the compact report", () => {
    expect(ok(["q", "--runs", "1"])).toMatchObject({ runs: 1, compact: true });
  });

  it("--show and --mode alone keep a single detailed run", () => {
    expect(ok(["q", "--show"])).toMatchObject({ compact: false, runs: 1, show: true, anyFlag: true });
    expect(ok(["q", "--mode", "steps"])).toMatchObject({ compact: false, mode: "steps" });
  });
});

describe("parseSmokeArgs: errors", () => {
  it("rejects values outside the allowed set", () => {
    expect(bad(["q", "--effort", "medium"])).toBe("--effort must be low, high or max");
    expect(bad(["q", "--effort"])).toBe("--effort must be low, high or max");
    expect(bad(["q", "--mode", "fast"])).toBe("--mode must be reasoning or steps");
  });

  it("limits --runs to 1 through 20", () => {
    expect(SMOKE_MAX_RUNS).toBe(20);
    expect(bad(["q", "--runs", "0"])).toBe("--runs must be between 1 and 20");
    expect(bad(["q", "--runs", "21"])).toBe("--runs must be between 1 and 20");
    expect(ok(["q", "--runs", "20"]).runs).toBe(20);
    expect(bad(["q", "--runs", "abc"])).toBe("--runs needs a whole number");
    expect(bad(["q", "--runs", "2.5"])).toBe("--runs needs a whole number");
    expect(bad(["q", "--runs"])).toBe("--runs needs a whole number");
  });

  it("rejects a word range where the minimum is above the maximum, and non-numbers", () => {
    expect(bad(["q", "--min-words", "600", "--max-words", "100"])).toBe("--min-words must not be larger than --max-words");
    expect(bad(["q", "--min-words", "x"])).toBe("--min-words needs a whole number");
    expect(bad(["q", "--max-words", "-5"])).toBe("--max-words needs a whole number");
  });

  it("rejects unknown options", () => {
    expect(bad(["q", "--bogus"])).toBe("Unknown option --bogus");
  });
});
