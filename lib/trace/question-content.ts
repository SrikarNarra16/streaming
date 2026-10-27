// Which content the learner page uses for the current question. Pure, so every state can be tested.
//  - flag off: the stored content, nothing else
//  - flag on: loading while the trace is on its way, the live content when it is ready, and the stored content on
//    an error, on a timeout, or when the live content cannot be shown
export type QuestionContentSource = "stored" | "live";

export interface QuestionContent {
  content: string;
  source: QuestionContentSource;
  loading: boolean;
}

export type TraceStatusForQuestion = "idle" | "loading" | "ready" | "error";

export interface SelectInput {
  enabled: boolean;
  storedContent: string;
  /** The status of the trace for THIS question (a trace of another question counts as "idle"). */
  status: TraceStatusForQuestion;
  /** The live page content when the trace is ready ("" or null when there is none). */
  liveContent: string | null;
  /** The wait ran out for this question: the stored content is used from then on, even if the trace arrives later. */
  timedOut: boolean;
}

export function selectQuestionContent(input: SelectInput): QuestionContent {
  const stored: QuestionContent = { content: input.storedContent, source: "stored", loading: false };
  if (!input.enabled || input.timedOut) return stored;
  if (input.status === "idle" || input.status === "loading") return { content: input.storedContent, source: "stored", loading: true };
  if (input.status === "ready" && input.liveContent) return { content: input.liveContent, source: "live", loading: false };
  return stored; // error, or a ready trace that cannot be shown
}
