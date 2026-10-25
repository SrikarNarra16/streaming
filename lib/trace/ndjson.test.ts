import { describe, expect, it } from "vitest";
import { createDecodeStats, decodeEvents, encodeEvent } from "./ndjson";
import { traceError, type TraceEvent } from "./events";

async function* source<T>(...parts: T[]): AsyncGenerator<T> {
  for (const part of parts) yield part;
}

async function collect(gen: AsyncGenerator<TraceEvent, unknown, undefined>): Promise<TraceEvent[]> {
  const out: TraceEvent[] = [];
  for await (const event of gen) out.push(event);
  return out;
}

const line = (event: TraceEvent) => encodeEvent(event);
const r = (text: string): TraceEvent => ({ type: "reasoning_delta", text });
const a = (text: string): TraceEvent => ({ type: "answer_delta", text });

describe("encodeEvent", () => {
  it("writes one line with a trailing newline that parses back to the event", () => {
    const event = r("two\nlines and \"quotes\"");
    const encoded = encodeEvent(event);
    expect(encoded.endsWith("\n")).toBe(true);
    expect(encoded.slice(0, -1)).not.toContain("\n");
    expect(JSON.parse(encoded)).toEqual(event);
  });

  it("replaces an error message that could carry a key or credentials", () => {
    const encoded = encodeEvent({ type: "error", code: "upstream", message: "Bearer sk-abc123 at https://u:p@host" });
    expect(encoded).not.toMatch(/sk-|Bearer|https?:/);
    expect(JSON.parse(encoded)).toEqual(traceError("upstream"));
  });
});

describe("decodeEvents", () => {
  it("decodes several lines in one chunk", async () => {
    const events = await collect(decodeEvents(source(line(r("a")) + line(a("b")))));
    expect(events).toEqual([r("a"), a("b")]);
  });

  it("joins a line that is split across chunks", async () => {
    const whole = line(r("hello world"));
    const events = await collect(decodeEvents(source(whole.slice(0, 7), whole.slice(7, 20), whole.slice(20))));
    expect(events).toEqual([r("hello world")]);
  });

  it("handles multi-byte characters split across byte chunks", async () => {
    const bytes = new TextEncoder().encode(line(a("héllo 😀 wörld")));
    // one byte at a time splits every multi-byte character
    const oneByOne = Array.from(bytes, (b) => Uint8Array.of(b));
    expect(await collect(decodeEvents(source(...oneByOne)))).toEqual([a("héllo 😀 wörld")]);
    // and a split right inside the emoji
    const cut = bytes.indexOf(0xf0) + 2;
    expect(await collect(decodeEvents(source(bytes.slice(0, cut), bytes.slice(cut))))).toEqual([a("héllo 😀 wörld")]);
  });

  it("accepts CRLF line endings and a last line without a newline", async () => {
    const text = line(r("a")).replace("\n", "\r\n") + line(a("b")).trimEnd();
    expect(await collect(decodeEvents(source(text)))).toEqual([r("a"), a("b")]);
  });

  it("skips and counts blank lines", async () => {
    const stats = createDecodeStats();
    const events = await collect(decodeEvents(source("\n  \n" + line(r("a")) + "\n\n"), { stats }));
    expect(events).toEqual([r("a")]);
    expect(stats).toEqual({ events: 1, blankLines: 4, malformedLines: 0, unknownLines: 0 });
  });

  it("skips and counts malformed and unknown lines without throwing", async () => {
    const stats = createDecodeStats();
    const input = [
      line(r("one")),
      "{not json\n",
      '{"type":"mystery","text":"x"}\n',
      '"just a string"\n',
      '{"type":"answer_delta"}\n',
      line(a("two")),
    ].join("");
    const events = await collect(decodeEvents(source(input), { stats }));
    expect(events).toEqual([r("one"), a("two")]);
    expect(stats).toEqual({ events: 2, blankLines: 0, malformedLines: 1, unknownLines: 3 });
  });

  it("returns the stats when the generator finishes", async () => {
    const gen = decodeEvents(source("garbage\n" + line(r("x"))));
    let step = await gen.next();
    while (!step.done) step = await gen.next();
    expect(step.value).toEqual({ events: 1, blankLines: 0, malformedLines: 1, unknownLines: 0 });
  });

  it("drops a line that is too long, even when it arrives in pieces, and carries on", async () => {
    const stats = createDecodeStats();
    const huge = "x".repeat(50);
    const events = await collect(
      decodeEvents(source(huge.slice(0, 20), huge.slice(20), "\n" + line(r("ok"))), { stats, maxLineChars: 30 })
    );
    expect(events).toEqual([r("ok")]);
    expect(stats.malformedLines).toBe(1);
  });

  it("replaces the message of a decoded error event with the generic one", async () => {
    const dirty = JSON.stringify({ type: "error", code: "limit", message: "Bearer sk-secret" }) + "\n";
    const [event] = await collect(decodeEvents(source(dirty)));
    expect(event).toEqual(traceError("limit"));
  });

  it("turns a throwing source into one generic error event instead of throwing", async () => {
    async function* broken(): AsyncGenerator<string> {
      yield line(r("before"));
      throw new Error("socket closed, key sk-LEAK");
    }
    const events = await collect(decodeEvents(broken()));
    expect(events).toEqual([r("before"), traceError("upstream")]);
    expect(JSON.stringify(events)).not.toContain("sk-");
  });

  it("handles an empty stream", async () => {
    expect(await collect(decodeEvents(source<string>()))).toEqual([]);
  });
});
