// Static checks of the two scripts that call a paid API. They READ the script files as text and never
// run them. They pin the order of the code: the --live guard comes first, and nothing that loads
// .env.local, reads the environment or creates a client can run before it.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(resolve(process.cwd(), file), "utf8");

// Static imports that are not type-only (those are erased and run nothing).
const runtimeImports = (source: string) =>
  [...source.matchAll(/^import\s+(?!type\b)[^;]*?from\s+["']([^"']+)["'];?$/gm)].map((m) => m[1]);

describe("scripts/trace-live-smoke.ts", () => {
  const source = read("scripts/trace-live-smoke.ts");

  it("statically imports only the pure argument parser", () => {
    expect(runtimeImports(source)).toEqual(["../lib/trace/smoke-args"]);
  });

  it("has no static import of dotenv or openai, and never touches process.env itself", () => {
    expect(source).not.toMatch(/^import\s[^;]*["'](dotenv|openai)["']/m);
    expect(source).not.toMatch(/process\.env/);
  });

  it("loads .env.local in exactly one place, inside loadLiveModules()", () => {
    expect(source.match(/dotenv\.config\(/g)).toHaveLength(1);
    expect(source.match(/import\("dotenv"\)/g)).toHaveLength(1);
    const fnStart = source.indexOf("async function loadLiveModules");
    const fnEnd = source.indexOf("\n}\n", fnStart);
    const loadAt = source.indexOf("dotenv.config(");
    expect(loadAt).toBeGreaterThan(fnStart);
    expect(loadAt).toBeLessThan(fnEnd);
  });

  it("checks --live before it calls loadLiveModules(), and exits there", () => {
    const guardAt = source.indexOf("parsed === SMOKE_LIVE_REQUIRED");
    const exitAt = source.indexOf("process.exit(1)", guardAt);
    const callAt = source.indexOf("await loadLiveModules()");
    expect(guardAt).toBeGreaterThan(-1);
    expect(exitAt).toBeGreaterThan(guardAt);
    expect(callAt).toBeGreaterThan(exitAt);
  });

  it("creates the client only after the modules are loaded", () => {
    expect(source.indexOf("live.createDeepSeekClientFromEnv()")).toBeGreaterThan(source.indexOf("await loadLiveModules()"));
  });

  it("prints the usage line and the warning sentence when --live is missing", () => {
    expect(source).toContain("`${USAGE}\\n${SMOKE_LIVE_REQUIRED}`");
    expect(source).toContain("--live");
  });
});

describe("scripts/trace-spike.ts", () => {
  const source = read("scripts/trace-spike.ts");

  it("statically imports only node:fs", () => {
    expect(runtimeImports(source)).toEqual(["node:fs"]);
  });

  it("has no static import of dotenv or openai", () => {
    expect(source).not.toMatch(/^import\s[^;]*["'](dotenv|openai)["']/m);
  });

  it("checks --live and exits before anything else runs", () => {
    const guardAt = source.indexOf('!process.argv.includes("--live")');
    const exitAt = source.indexOf("process.exit(1)", guardAt);
    expect(guardAt).toBeGreaterThan(-1);
    expect(exitAt).toBeGreaterThan(guardAt);
    // nothing environment-related, no client, no argument handling before the guard
    const beforeGuard = source.slice(0, guardAt).replace(/\/\/.*$/gm, ""); // comments may mention these words
    expect(beforeGuard).not.toMatch(/dotenv|process\.env|new OpenAI|import\("openai"\)/);
    expect(beforeGuard).not.toMatch(/process\.argv\.indexOf/);
  });

  it("loads .env.local, reads the key and creates the client only inside main(), after the guard", () => {
    const guardAt = source.indexOf('!process.argv.includes("--live")');
    const mainAt = source.indexOf("async function main()");
    for (const needle of ["import(\"dotenv\")", "dotenv.config(", "process.env.DEEPSEEK_API_KEY", "import(\"openai\")", "new OpenAI("]) {
      const at = source.indexOf(needle);
      expect(at, needle).toBeGreaterThan(mainAt);
      expect(at, needle).toBeGreaterThan(guardAt);
      expect(source.split(needle).length - 1, needle).toBe(1);
    }
  });

  it("mentions --live in its usage line and prints the warning sentence", () => {
    expect(source).toContain("This script makes real, billed DeepSeek requests. Add --live to run it.");
    expect(source).toMatch(/Usage: node_modules\/\.bin\/tsx scripts\/trace-spike\.ts --live/);
  });
});
