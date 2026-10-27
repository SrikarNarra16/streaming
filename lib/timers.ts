// A set of pending timeouts that can be cancelled all at once (on reset, next question and unmount).
// Setting a timer with a key that is already pending replaces the old one, so the same timer never stacks.
// A cancelled callback never runs. Pure apart from setTimeout/clearTimeout.
export interface TimerSet {
  /** Runs fn after ms. With a key, replaces a pending timer of that key. Returns the timer's id. */
  set(fn: () => void, ms: number, key?: string): number;
  /** Cancels one timer by key or id. Safe to call for a timer that has already run. */
  clear(keyOrId: string | number): void;
  /** Cancels every pending timer. */
  clearAll(): void;
  /** How many timers are pending. */
  readonly pending: number;
}

export function createTimerSet(): TimerSet {
  let nextId = 1;
  const handles = new Map<number, ReturnType<typeof setTimeout>>();
  const keys = new Map<string, number>();

  const cancel = (id: number) => {
    const handle = handles.get(id);
    if (handle !== undefined) clearTimeout(handle);
    handles.delete(id);
    for (const [key, keyed] of keys) if (keyed === id) keys.delete(key);
  };

  return {
    set(fn, ms, key) {
      if (key !== undefined) {
        const old = keys.get(key);
        if (old !== undefined) cancel(old);
      }
      const id = nextId++;
      handles.set(id, setTimeout(() => {
        handles.delete(id);
        if (key !== undefined && keys.get(key) === id) keys.delete(key);
        fn();
      }, ms));
      if (key !== undefined) keys.set(key, id);
      return id;
    },
    clear(keyOrId) {
      const id = typeof keyOrId === "string" ? keys.get(keyOrId) : keyOrId;
      if (id !== undefined) cancel(id);
    },
    clearAll() {
      for (const handle of handles.values()) clearTimeout(handle);
      handles.clear();
      keys.clear();
    },
    get pending() {
      return handles.size;
    },
  };
}
