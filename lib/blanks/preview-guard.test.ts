import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Static guard: the preview script must stay pure (no env, no network, no AI, no database).
const source = readFileSync(join(__dirname, "../../scripts/blanks-preview.ts"), "utf8");
const code = source.replace(/\/\/.*$/gm, ""); // comments may mention the words

describe("scripts/blanks-preview.ts", () => {
  it("reads no environment variable and loads no env file", () => {
    expect(code).not.toMatch(/process\.env|dotenv|\.env/);
  });

  it("makes no network, AI or database call", () => {
    expect(code).not.toMatch(/\bfetch\s*\(|https?:\/\/|node:https?|openai|deepseek|drizzle|postgres|\bpg\b|XMLHttpRequest|WebSocket/i);
  });

  it("imports only node:fs and the pure lib modules", () => {
    const imports = [...code.matchAll(/^import .* from "([^"]+)"/gm)].map((m) => m[1]).sort();
    expect(imports).toEqual([
      "../lib/blanks/apply",
      "../lib/blanks/propose",
      "../lib/clean-trace",
      "../lib/segment",
      "../lib/trace/sample-trace",
      "node:fs",
    ]);
  });
});
