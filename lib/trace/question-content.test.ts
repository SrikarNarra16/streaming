import { describe, expect, it } from "vitest";
import { selectQuestionContent, type SelectInput, type TraceStatusForQuestion } from "./question-content";

const base: SelectInput = { enabled: true, storedContent: "stored text", status: "idle", liveContent: null, timedOut: false };
const statuses: TraceStatusForQuestion[] = ["idle", "loading", "ready", "error"];

describe("selectQuestionContent", () => {
  it("flag off: always the stored content, never loading, whatever else is passed", () => {
    for (const status of statuses) {
      for (const timedOut of [false, true]) {
        expect(selectQuestionContent({ ...base, enabled: false, status, liveContent: "live text", timedOut })).toEqual({ content: "stored text", source: "stored", loading: false });
      }
    }
  });

  it("loading: the stored content is not used yet and loading is true", () => {
    for (const status of ["idle", "loading"] as const) {
      expect(selectQuestionContent({ ...base, status })).toEqual({ content: "stored text", source: "stored", loading: true });
    }
  });

  it("ready: the live content", () => {
    expect(selectQuestionContent({ ...base, status: "ready", liveContent: "live$$text" })).toEqual({ content: "live$$text", source: "live", loading: false });
  });

  it("ready but nothing that can be shown (empty or null): the stored content", () => {
    for (const liveContent of ["", null]) {
      expect(selectQuestionContent({ ...base, status: "ready", liveContent })).toEqual({ content: "stored text", source: "stored", loading: false });
    }
  });

  it("error: the stored content, not loading", () => {
    expect(selectQuestionContent({ ...base, status: "error" })).toEqual({ content: "stored text", source: "stored", loading: false });
  });

  it("timed out: the stored content even while loading, and even if the trace turns out ready", () => {
    for (const status of statuses) {
      expect(selectQuestionContent({ ...base, status, liveContent: "live text", timedOut: true })).toEqual({ content: "stored text", source: "stored", loading: false });
    }
  });
});
