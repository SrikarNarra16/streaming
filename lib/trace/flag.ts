// The feature flag for the live trace on the learner page. OFF unless NEXT_PUBLIC_LIVE_TRACE is exactly "true".
// Next.js replaces the literal `process.env.NEXT_PUBLIC_LIVE_TRACE` at build time, so it must be written out in
// full in isLiveTraceEnabled (not read through a variable or a helper that takes the name).

export const LIVE_TRACE_FLAG_NAME = "NEXT_PUBLIC_LIVE_TRACE";

/** true only for the exact string "true" ("TRUE", "1", "yes", " true", "" and unset are all off). */
export const parseLiveTraceFlag = (value: string | undefined): boolean => value === "true";

export const isLiveTraceEnabled = (): boolean => parseLiveTraceFlag(process.env.NEXT_PUBLIC_LIVE_TRACE);
