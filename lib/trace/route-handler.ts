// The logic of POST /api/trace, with every dependency passed in so it can be tested without Next.js,
// a database or a network. app/api/trace/route.ts only wires the real dependencies to it.
//
// Rules: a valid session is required; the prompt ALWAYS comes from the database for the given question id and
// is never taken from the client; every error answer is generic JSON; the success answer is an NDJSON stream.
import { encodeEvent } from "./ndjson";
import type { TraceRunConfig } from "./config";
import type { TraceLimiter } from "./limits";
import { startTraceRun, type TraceStore } from "./run";
import type { SelectProvidersResult } from "./select-provider";

export interface TraceRouteDeps {
  /** The signed-in user's id (digits), or null. */
  getUserId(): Promise<string | null>;
  findQuestion(id: number): Promise<{ id: number; question: string } | null>;
  selectProviders(): SelectProvidersResult;
  config: TraceRunConfig;
  limiter: TraceLimiter;
  store: TraceStore;
}

const MAX_BODY_CHARS = 1024;

function json(body: unknown, status: number, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers } });
}

export async function handleTraceRequest(request: Request, deps: TraceRouteDeps): Promise<Response> {
  // 1. session
  const rawUserId = await deps.getUserId();
  const userId = rawUserId !== null && /^[1-9][0-9]{0,9}$/.test(rawUserId) ? Number(rawUserId) : null;
  if (userId === null) return json({ error: "Unauthorized" }, 401);

  // 2. validation: { questionId: <positive integer> }; any other field (such as a prompt) is ignored
  let questionId: number;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_CHARS) return json({ error: "Invalid request" }, 400);
    const body = JSON.parse(text);
    if (!body || typeof body !== "object" || !Number.isInteger(body.questionId) || body.questionId < 1) {
      return json({ error: "Invalid request" }, 400);
    }
    questionId = body.questionId;
  } catch {
    return json({ error: "Invalid request" }, 400);
  }

  // 3. the question, and with it the prompt, come from the database
  let question: { id: number; question: string } | null;
  try {
    question = await deps.findQuestion(questionId);
  } catch {
    return json({ error: "Internal server error" }, 500);
  }
  if (!question) return json({ error: "Question not found" }, 404);

  // 4. configuration
  const selected = deps.selectProviders();
  if (!selected.ok) return json({ error: "The AI service is not available." }, 503);

  // 5. limits
  const abort = new AbortController();
  const started = startTraceRun(deps.limiter, {
    userId,
    questionId: question.id,
    prompt: question.question,
    model: selected.providers.model,
    reasoningProvider: selected.providers.reasoning,
    stepsProvider: selected.providers.steps,
    setting: deps.config.setting,
    limits: deps.config.limits,
    store: deps.store,
    signal: abort.signal,
  });
  if (!started.ok) {
    const message = started.reason === "busy" ? "A trace is already running." : "Too many requests.";
    return json({ error: message }, 429, { "Retry-After": String(started.retryAfterSeconds) });
  }

  // 6. the stream. When the client goes away the run is aborted, but it still ends and is still saved.
  if (request.signal.aborted) abort.abort();
  else request.signal.addEventListener("abort", () => abort.abort(), { once: true });

  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of started.events) {
          try {
            controller.enqueue(encoder.encode(encodeEvent(event)));
          } catch {
            /* the client is gone: keep running to the end so the trace is saved */
          }
        }
      } finally {
        started.release();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
    cancel() {
      abort.abort();
    },
  });

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
