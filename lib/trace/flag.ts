// The feature flag for the live trace on the learner page. ON unless NEXT_PUBLIC_LIVE_TRACE is exactly "false".
// Unset, "true", empty and any other value all mean on. To turn it off, set it to "false" and rebuild.
// Next.js replaces the literal `process.env.NEXT_PUBLIC_LIVE_TRACE` at build time, so it must be written out in
// full in isLiveTraceEnabled (not read through a variable or a helper that takes the name).

export const LIVE_TRACE_FLAG_NAME = "NEXT_PUBLIC_LIVE_TRACE";

/** false only for the exact string "false" ("FALSE", "0", "no", " false", "" and unset are all on). */
export const parseLiveTraceFlag = (value: string | undefined): boolean => value !== "false";

export const isLiveTraceEnabled = (): boolean => parseLiveTraceFlag(process.env.NEXT_PUBLIC_LIVE_TRACE);
