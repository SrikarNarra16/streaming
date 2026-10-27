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

### Committed, no effect on participants or logged data
`0b27d19` (types), `e8ace9f` (CLAUDE.md), `9f0d101` and `2545791` (trace measurement script), `ea9af57`, `2c432f1`, `07ffd51` (README), `e137cc3` (single pnpm lockfile, same resolved versions), `c4940d9` (vitest), `2d2f4a0` (log analysis script: anonymous labels, no emails; analysis only), and the trace pipeline libraries `2f1e901`, `ef57f92`, `dc9eede`, `2304c41`, `7c3de77` (not connected to the app).

## b73e8d1 (2026-10-26): smarter auto-scroll, reduced motion, typing aria attributes

Changes made in the typing and scrolling task.
- **Auto-scroll** (`app/streaming/page.tsx`, `lib/scroll.ts`): the page follows the text only while the reader is within 120 px of the bottom, at most once per animation frame, instantly while text grows and smoothly when a whole block appears. It never scrolls a reader who scrolled up. With reduced motion it is always instant. Before, it called a smooth scroll on every typed character.
  Affects study data: **maybe**. No delay or logged event changed, but the removed per-character scrolling was main-thread work in a loop whose real speed depends on rendering, so the typewriter may run slightly faster in real time. Measure before and after with `local-setup/measure-typing.js`.
- **Blank input focus** (`components/streaming/ModernBlankInput.tsx`): focused with `focus({ preventScroll: true })` in a layout effect instead of `autoFocus`, so the browser's own scroll no longer competes with the page's. Affects study data: **no**.
- **Reduced motion** (`app/globals.css`): with the operating-system setting on, CSS transitions, the pulse animation, the hover scale and smooth scrolling are off. The spinner and all JavaScript timing are unchanged. Affects study data: **no**.
- **Accessibility** (`app/streaming/page.tsx`): the text container has `aria-live="off"` and `aria-busy` while typing. Affects study data: **no**.

## 57c9de4 (2026-10-27): live trace on the learner page, behind a flag

- **Flag:** `NEXT_PUBLIC_LIVE_TRACE`. It is on only when it is exactly `true`. It is **off by default** (unset, empty or any other value). It is read when the app is built or started, so changing it needs a restart.
- **Flag off:** the page uses the stored question content exactly as before. The new code makes no request, starts no timer and adds no log action. Affects study data: **no**.
- **Flag on:** when the current question is known (before the learner presses Start), the page asks `/api/trace` for a live thinking trace of that question. While it is on its way the button shows the existing gray disabled "Loading..." state. When it is ready, the learner reads the live trace instead of the stored content, with fill-in-the-blank markers that the draft blank generator (`lib/blanks`) placed in it. Start, pause, resume, reset, the understand buttons, blank answers and the AI answer work as they do on stored content, because the same parser (`lib/content.ts`) reads it.
- **Fixed blanks per question:** the generator is given a fixed seed made from the question id (`question-<id>`), so the same trace gives every learner the same blanks. Different traces of the same question (each request generates a new one) can still differ.
- **Fallback:** on any trace error, or when the trace takes longer than 45 seconds, or when the live text cannot be shown safely, the learner sees the stored content from the database, as today, with no message and no new log action. The trace text is never logged. A trace that arrives after the 45 seconds is ignored, so the text never changes under a learner who has started.
- **Affects study data:** **yes, when the flag is on** (different text and different blanks than the stored question). It is a draft: the blank rules are first guesses to be tuned with the professor's criteria.
- Browser checks for the flag-on and flag-off paths have not been run yet; run them before enabling the flag.
