import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTimerSet } from "./timers";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("createTimerSet", () => {
  it("runs a callback after its delay, once, and forgets it", () => {
    const timers = createTimerSet();
    const fn = vi.fn();
    timers.set(fn, 200);
    expect(timers.pending).toBe(1);
    vi.advanceTimersByTime(199);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(timers.pending).toBe(0);
    vi.advanceTimersByTime(5000);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("clearAll cancels every pending timer: a reset, next question or unmount cannot be followed by a stale update", () => {
    // the stale timers of the page: 200 ms paragraph end, 500 ms "Ok" prompt, 1500 ms blank feedback
    const timers = createTimerSet();
    const state = { feedback: false, prompt: false, blankDone: false };
    timers.set(() => (state.feedback = true), 200, "paragraph-end");
    timers.set(() => (state.prompt = true), 500, "show-ai-prompt");
    timers.set(() => (state.blankDone = true), 1500, "blank-feedback");
    vi.advanceTimersByTime(100);
    timers.clearAll(); // Reset
    vi.advanceTimersByTime(10_000);
    expect(state).toEqual({ feedback: false, prompt: false, blankDone: false });
    expect(timers.pending).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("without the helper the same timers DO fire after a reset (the bug being fixed)", () => {
    const state = { feedback: false };
    setTimeout(() => (state.feedback = true), 200); // a plain timer: nothing cancels it on reset
    vi.advanceTimersByTime(100);
    // ...reset happens here...
    vi.advanceTimersByTime(200);
    expect(state.feedback).toBe(true);
  });

  it("a timer set again with the same key replaces the old one (no stacking)", () => {
    const timers = createTimerSet();
    const first = vi.fn();
    const second = vi.fn();
    timers.set(first, 200, "paragraph-end");
    timers.set(second, 200, "paragraph-end");
    expect(timers.pending).toBe(1);
    vi.advanceTimersByTime(200);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("different keys and unkeyed timers are independent", () => {
    const timers = createTimerSet();
    const a = vi.fn();
    const b = vi.fn();
    const c = vi.fn();
    timers.set(a, 100, "a");
    timers.set(b, 100, "b");
    timers.set(c, 100);
    timers.set(c, 100);
    vi.advanceTimersByTime(100);
    expect([a, b].map((f) => f.mock.calls.length)).toEqual([1, 1]);
    expect(c).toHaveBeenCalledTimes(2);
  });

  it("clear cancels one timer by key or by id and is safe for finished or unknown ones", () => {
    const timers = createTimerSet();
    const keyed = vi.fn();
    const byId = vi.fn();
    const kept = vi.fn();
    timers.set(keyed, 100, "k");
    const id = timers.set(byId, 100);
    timers.set(kept, 100, "kept");
    timers.clear("k");
    timers.clear(id);
    timers.clear("unknown");
    timers.clear(9999);
    vi.advanceTimersByTime(100);
    expect([keyed, byId, kept].map((f) => f.mock.calls.length)).toEqual([0, 0, 1]);
    timers.clear("kept"); // already ran
    expect(timers.pending).toBe(0);
  });

  it("a callback may set the same key again while it runs", () => {
    const timers = createTimerSet();
    const calls: number[] = [];
    timers.set(() => {
      calls.push(1);
      timers.set(() => calls.push(2), 100, "x");
    }, 100, "x");
    vi.advanceTimersByTime(250);
    expect(calls).toEqual([1, 2]);
    expect(timers.pending).toBe(0);
  });

  it("a set can be used again after clearAll", () => {
    const timers = createTimerSet();
    timers.clearAll();
    const fn = vi.fn();
    timers.set(fn, 50);
    vi.advanceTimersByTime(50);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
