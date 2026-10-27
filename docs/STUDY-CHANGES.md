# Changes since the baseline that affect participants or logged data

Baseline: `e60b0c7` (the original upload). Built from `git log` and the diffs of each commit. Dates are commit dates. "Affects study data" means: could it change what participants see, what is logged, or the timing between logged events.

## Committed

### 821cbb9 (2026-10-23): doubt-chat error handling
- When a chat request fails, the learner now sees "Sorry, I couldn't process that. Please try again." Before, the error response body was shown as if it were the AI's answer. The server returns a generic JSON error and HTTP 400 for invalid JSON.
- Error log rows for the chat now contain only the error name, HTTP status and request id (no message text). A failure while streaming is logged as `ai_generate_stream_error`.
- Affects study data: **yes**. What is shown on failures changed, and the content of error log rows changed.

### 7197a7b (2026-10-24): environment checks
- A missing `DEEPSEEK_API_KEY` makes `/api/generate` return a generic 500 and log `ai_not_configured`. The database connection is created on first use and fails with a clear error if `DATABASE_URL` is missing.
- Affects study data: **maybe**. Only a misconfigured deployment behaves differently.

### 2a02082 (2026-10-24): `db:reset` rewritten, `db:seed` added
- `db:reset` now matches `schema.ts` and requires `--yes`. It no longer inserts the two original sample questions (the dictionary-keys question and `matrix_max`). `db:seed` adds two different sample questions (`count_vowels`, `is_even`) and skips ones that exist.
- Affects study data: **maybe**. A database that is reset no longer contains the original two questions.

### fd6cfe9 (2026-10-24): security upgrades
- Next.js 15.3.3 to 15.5.28, drizzle-orm 0.44 to 0.45.4, sharp 0.34 to 0.35. The release notes listed no breaking change for this code.
- Affects study data: **maybe**. The page now runs on a newer Next.js. Typing and delays were not re-measured in a browser after the upgrade.

### 31ab1fd (2026-10-25): production build fixes
- Apostrophes in page text are written as HTML entities (the text looks the same). The login form is wrapped in `Suspense` with an empty black fallback, so the form appears once the page has loaded in the browser.
- Affects study data: **no**. Only the login screen changed; no logged event or delay changed.

### 6fe5897 (2026-10-25): doubt-chat model
- The default model is now `deepseek-flash` (it was `deepseek-chat`), with thinking disabled, configurable through `DEEPSEEK_CHAT_MODEL`. Successful chat log rows now also contain `model`, `finishReason` and token usage.
- Affects study data: **yes**. A different model gives different tutor answers and response times, and the chat log rows have new fields.

### a156fbc (2026-10-25): sessions, passwords, logs endpoint
- A signed `session` cookie replaces the unsigned `userId` cookie (everyone was signed out once). Passwords are stored as bcrypt hashes. Registration validates name (1 to 100 characters), email, and password (8 to 72 bytes).
- `/api/logs` requires a valid session, takes the user id from the session (never from the request body), accepts only the nine allowed actions (others get HTTP 400) and rejects bodies over about 10 KB.
- `login_attempt` and `login_failed` no longer log the email address; `login_success` logs only the user id.
- Affects study data: **yes**. It changes who can write log rows, which actions are accepted, and what login rows contain.

### 36359d9 (2026-10-25): `db:hash-passwords`
- A one-off script that replaces plain-text passwords with bcrypt hashes.
- Affects study data: **yes**. Accounts whose password is still plain text cannot log in until it has been run.

### 33af6db (2026-10-25): reset log and answer streaming
- Moving to the next question no longer writes a `reset_button_click` row. Only a real click on Reset does. Before, that spurious row carried the old question's id.
- The AI-answer reveal can now be cancelled (Reset, next question, leaving the page), Reset clears the streaming state at once, and a double click on "Ok" starts one reveal instead of two.
- Affects study data: **yes**. One log row fewer per Next Question click. Because the spurious row used to be the last row of the previous question, `time_spent_question_N` for that question is now shorter by the time between the "Ok" click and the Next Question click (from reading the code, not measured on data).

### 3955c1d (2026-10-25): content parsing and grading extracted
- The `$$` / `BLANK(...)` parsing and the answer check moved to `lib/content.ts`, with tests that pin the current behaviour, including its quirks.
- Affects study data: **no**, intended to be identical. It was verified by tests and a build, not in a browser.

### b73e8d1 (2026-10-26): smarter auto-scroll, reduced motion, typing aria attributes

Changes made in the typing and scrolling task.
- **Auto-scroll** (`app/streaming/page.tsx`, `lib/scroll.ts`): the page follows the text only while the reader is within 120 px of the bottom, at most once per animation frame, instantly while text grows and smoothly when a whole block appears. It never scrolls a reader who scrolled up. With reduced motion it is always instant. Before, it called a smooth scroll on every typed character.
  Affects study data: **maybe**. No delay or logged event changed, but the removed per-character scrolling was main-thread work in a loop whose real speed depends on rendering, so the typewriter may run slightly faster in real time. Measure before and after with `local-setup/measure-typing.js`.
- **Blank input focus** (`components/streaming/ModernBlankInput.tsx`): focused with `focus({ preventScroll: true })` in a layout effect instead of `autoFocus`, so the browser's own scroll no longer competes with the page's. Affects study data: **no**.
- **Reduced motion** (`app/globals.css`): with the operating-system setting on, CSS transitions, the pulse animation, the hover scale and smooth scrolling are off. The spinner and all JavaScript timing are unchanged. Affects study data: **no**.
- **Accessibility** (`app/streaming/page.tsx`): the text container has `aria-live="off"` and `aria-busy` while typing. Affects study data: **no**.

### 57c9de4 (2026-10-27): live trace on the learner page, behind a flag

- **Flag:** `NEXT_PUBLIC_LIVE_TRACE`. It is on only when it is exactly `true`. It is **off by default** (unset, empty or any other value). It is read when the app is built or started, so changing it needs a restart.
- **Flag off:** the page uses the stored question content exactly as before. The new code makes no request, starts no timer and adds no log action. Affects study data: **no**.
- **Flag on:** when the current question is known (before the learner presses Start), the page asks `/api/trace` for a live thinking trace of that question. While it is on its way the button shows the existing gray disabled "Loading..." state. When it is ready, the learner reads the live trace instead of the stored content, with fill-in-the-blank markers that the draft blank generator (`lib/blanks`) placed in it. Start, pause, resume, reset, the understand buttons, blank answers and the AI answer work as they do on stored content, because the same parser (`lib/content.ts`) reads it.
- **Fixed blanks per question:** the generator is given a fixed seed made from the question id (`question-<id>`), so the same trace gives every learner the same blanks. Different traces of the same question (each request generates a new one) can still differ.
- **Fallback:** on any trace error, or when the trace takes longer than 45 seconds, or when the live text cannot be shown safely, the learner sees the stored content from the database, as today, with no message and no new log action. The trace text is never logged. A trace that arrives after the 45 seconds is ignored, so the text never changes under a learner who has started.
- **Affects study data:** **yes, when the flag is on** (different text and different blanks than the stored question). It is a draft: the blank rules are first guesses to be tuned with the professor's criteria.
- Browser checks for the flag-on and flag-off paths have not been run yet; run them before enabling the flag.

### b2a94b1 (2026-10-27): segmenter fences code, lead-in merge, blank generator tweaks

- **Segmenter** (`lib/segment.ts`): code that a trace prints without a ``` fence (an indented run, or two or more flush-left lines that look like code) is now wrapped in a fence, so the page's markdown renderer keeps the indentation. A paragraph under 8 words that ends in a colon ("Here is the code:") is merged with the paragraph after it. Prose is not fenced.
- **Blank generator** (`lib/blanks/propose.ts`): a number with a leading minus such as `-1` is no longer held back as spacing-sensitive, and `O(1)` is never proposed as a blank.
- Affects study data: **only with `NEXT_PUBLIC_LIVE_TRACE=true`** (the segmenter and generator only shape live traces). With the flag off nothing changes. Not checked in a browser.

### Committed, no effect on participants or logged data
`0b27d19` (types), `e8ace9f` (CLAUDE.md), `9f0d101` and `2545791` (trace measurement script), `ea9af57`, `2c432f1`, `07ffd51` (README), `e137cc3` (single pnpm lockfile, same resolved versions), `c4940d9` (vitest), `2d2f4a0` (log analysis script: anonymous labels, no emails; analysis only), and the trace pipeline libraries `2f1e901`, `ef57f92`, `dc9eede`, `2304c41`, `7c3de77` (at that time not connected to the app; the learner page uses them only when the live-trace flag is on, see 57c9de4).
- `4ed0a5e` (2026-10-26): trace route `POST /api/trace`, source policy, limits, and a `traces` table in `schema.ts` (written only by that route, which the page does not call with the flag off; the table has to be created by you with the database command before the route can save traces).
- `073f91f` (2026-10-26): browser trace client, state reducer and `useTrace` hook, plus a development-only test page at `/dev/trace` (a 404 in production).
- `375f508` (2026-10-26): the first draft of the blank generator (`lib/blanks`) and its preview script. Not used by the page at that commit (the page uses the generator only when the live-trace flag is on, see 57c9de4).
- `44f72db` (2026-10-26): blank generator tuning (trace-wide uniqueness, generic-term and give-away filters, spacing hold-back, hand-written fixtures). Not used by the page with the flag off.

## TRACE_REUSE: show every learner the same saved trace (status: awaiting approval, no commit hash yet)

- **Setting:** `TRACE_REUSE` (server side, in `.env.local`). It is on only when it is exactly `true`. It is **off by default**.
- **Off:** nothing changes. A new trace is generated on every request, as before, and no saved trace is looked up.
- **On:** before asking the AI, the server looks for the newest saved trace of that question with status `ready` and at least one paragraph. If it finds one, it sends that trace again: **all learners see the same saved trace for a question**. There is no AI call, no new row is saved, and it does not count toward `TRACE_MAX_PER_HOUR`. If none exists, one is generated and saved as today, and later requests reuse it. Saved rows that failed, were cancelled or are empty are never reused, and a reused trace passes the same checks as a generated one.
- **Not changed:** the database schema. The newest `ready` row is simply the first one saved or the latest generated, so a bad trace stays in use until a newer `ready` one is saved (there is no "retire this trace" switch; that would need a schema change or a manual row edit).
- Affects study data: **no unless set**. With it on, the live trace (flag `NEXT_PUBLIC_LIVE_TRACE=true`) is identical for every learner of a question, which makes blanks and text comparable. Not checked in a browser.

## Trace report script (status: awaiting approval, no commit hash yet)

- A new read-only tool, `npx pnpm@8 trace:report -- --yes` (`scripts/trace-report.ts`, with the number crunching in `lib/trace/report.ts`). It summarises the `traces` table: counts, word counts, error codes, timings and ready traces per question. It only runs SELECT queries in a read-only transaction, selects no learner ids and no trace text, and refuses to connect without `--yes`.
- Affects study data: **no**. It is not part of the app and writes nothing.

## Streaming page: stale timers and Resume (status: awaiting approval, no commit hash yet)

- **Stale timers** (`app/streaming/page.tsx`, `lib/timers.ts`): the 200 ms paragraph-end timer, the 500 ms "Ok" prompt timer and the 1500 ms blank-feedback timer are now cancelled on Reset, on Next Question and when the page is left. Before, one that was still pending when the learner pressed Reset could fire afterwards: the "Am I making sense?" box or the "Ok" prompt could appear on a cleared page, typing could restart without pressing Start, and a blank-feedback timer could leave the next paragraph skipping its feedback box. A 200 ms timer also reads the current pause state when it fires, instead of the state of the render that set it.
- **Resume** (`lib/streaming-flow.ts`): pressing Resume used to restart typing even when the page was waiting for the learner (a blank input, the feedback box, the chat). The next paragraph was then typed onto the unanswered one, so the "I understand" log row (`paragraph`) could hold two paragraphs, or text ran under a blank input. Resume now restarts typing only when the pause interrupted typing in the middle of a paragraph.
- **Delays are unchanged:** typing speed (10 ms per character), 200 ms, 500 ms and 1500 ms are the same. Logged action names are unchanged.
- Affects study data: **maybe, rarely.** In normal use nothing changes. In the cases above (Reset within about 1.5 s of a blank answer or a paragraph end, Pause then Resume while a blank or the feedback box is showing) the page used to produce spurious or merged log rows and now does not. Not checked in a browser.

## Typing speed independent of frame rate (status: awaiting approval, no commit hash yet)

- **Default: `"legacy"`, so typing speed and `time_spent` are unchanged in the study.** `app/streaming/page.tsx` has the constant `TYPING_CLOCK` (`"legacy"` default, `"raf"`). With `"legacy"` the page types exactly as before: one character per 10 ms timer tick, then a 10 ms display step.
- **`"raf"` is built and tested but not enabled until it is calibrated.** It shows floor(active seconds x `CHARS_PER_SECOND`) characters, driven by `requestAnimationFrame` (`lib/typing-clock.ts`). Pause, a blank input, the feedback box and a hidden tab freeze its clock, resume continues from the same place, and a stalled frame counts for at most 100 ms. `prefers-reduced-motion` does not change the speed.
- **Not calibrated:** `CHARS_PER_SECOND = 100` is the nominal rate of the old loop (one character per 10 ms), **not measured**: no measurement of the old typewriter is stored in the repository, and the old loop's real speed was probably lower. A guard test (`lib/typing-clock-guard.test.ts`) fails if `TYPING_CLOCK` is `"raf"` while `CHARS_PER_SECOND` is still 100. Calibration steps are in `docs/BACKLOG.md`.
- **Also in this change:** the typed paragraph is a memoised component (`TypedText`), so typing in a blank input does not render it again. It changes no visible text or timing. It is used with both clocks.
- **Unchanged:** the 200 ms, 500 ms and 1500 ms delays, the pause and resume rules, the logged action names, the `time_spent` calculation, the AI-answer reveal (15 ms per character).
- Affects study data: **no with the default `"legacy"`**. Switching to `"raf"` after calibration would be a possible small change to `time_spent` values and must be recorded then. Not checked in a browser.
