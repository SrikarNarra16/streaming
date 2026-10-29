# Study deploy checklist

Moving this work onto the real study database. Go in order. Tick a step only after its "Check" passes. Stop at the first failure.

Conventions: **You** run it yourself. **Claude Code** may help, but never runs anything that touches a database, `.env.local`, or the DeepSeek API. Nothing secret goes into this repo, a commit, or a chat. In the commands below, `$STUDY_DB` stands for the real database's connection string, kept in your own shell and never pasted anywhere.

Two things are **not verified yet** and must be done before the study (steps 4 and 7):
- the database query `findReusableTrace` (used only with `TRACE_REUSE=true`) has never run against a real database;
- the integration browser checks (flag off and flag on) have not been run.

## 1. Back up the database first (You)

1. `pg_dump -Fc "$STUDY_DB" -f study-backup-$(date +%F).dump`
2. Check the restore works. Create an empty scratch database and restore into it:
   `createdb study_restore_check` then `pg_restore --no-owner -d study_restore_check study-backup-*.dump`
3. Compare row counts, in both databases: `SELECT count(*) FROM users;`, `... FROM questions;`, `... FROM logs;`. The numbers must match.
4. Keep the dump somewhere safe and private (it holds emails and password hashes or plain passwords). The scratch database is used again in step 2; drop it when the whole checklist is done.

**Check:** the counts match. No backup, no further steps.

## 2. Hash passwords: on a restored copy first, then for real (You)

The script loads `.env.local`, so Claude Code never runs it. A `DATABASE_URL` already set in your shell wins over `.env.local` (dotenv does not override).

1. On the scratch copy from step 1: `DATABASE_URL="postgresql://.../study_restore_check" npx pnpm@8 db:hash-passwords -- --yes`
2. Read the `Target: host=... database=...` line it prints before doing anything. It must name the **copy**.
3. Expected: `Plain-text passwords found: N. Hashed: N. Skipped (changed meanwhile): 0.` Run it a second time: `found: 0`.
4. Log in once as a test user against the copy (step 7 can be reused for this).
5. Only then the real database: same command with the real `DATABASE_URL`. Read the `Target:` line again.

**Check:** second run reports 0 found; a user can log in. Until the real database is hashed, users with plain-text passwords cannot log in with this version.

## 3. Set SESSION_SECRET (You)

1. Generate it where nobody watches: `openssl rand -hex 32` (64 characters; at least 32 are required).
2. Put it in the server's environment only (hosting settings or the server's `.env.local`). Never in the repo, a commit, a screenshot or a chat.
3. Changing it later signs everyone out.

**Check:** the app starts and login works. The secret is required (at least 32 characters); without a valid one, login and the logged-in pages will not work.

## 4. Create the `traces` table (You, not Claude Code)

`drizzle-kit push` writes to the database, so only you run it. Try it on the restored copy first, then on the real database.

1. Point `DATABASE_URL` at the copy (inline, as in step 2) and run `npx drizzle-kit push --verbose --strict`. It reads `schema.ts` and shows the SQL before asking you to approve.
2. **Expected:** one `CREATE TABLE "traces"` (with its foreign keys to `users` and `questions`) and nothing else, then a message that changes were applied.
3. **If it also wants to drop or alter anything in `users`, `questions` or `logs`, or warns about data loss: answer No and stop.** The real tables may differ from `schema.ts`; tell Claude Code what it printed (without secrets) so the difference can be understood first.
4. Repeat on the real database.
5. Not verified yet: the reuse query (only needed if you ever set `TRACE_REUSE=true`). To try it: with a mock-provider trace saved on the copy, set `TRACE_REUSE=true` and check that the second request for the same question makes no new row in `traces` and no provider call.

**Check:** `\d traces` in `psql` shows the table; the three existing tables are unchanged.

## 5. Rotate and set the DeepSeek key and the TRACE_* settings (You)

1. Create a new API key in the DeepSeek console, set it as `DEEPSEEK_API_KEY` in the server environment, then revoke the old key. Never paste it anywhere else.
2. Settings (all optional; the value shown is the default; a missing or invalid value falls back to it):

| Variable | Default | What it does |
|---|---|---|
| `DEEPSEEK_API_KEY` | none (required) | Key for the doubt-chat and the trace. |
| `DEEPSEEK_CHAT_MODEL` | `deepseek-flash` | Model for the doubt-chat (thinking off). |
| `DEEPSEEK_TRACE_MODEL` | `deepseek-flash` | Model that writes the trace. |
| `DEEPSEEK_TRACE_MAX_TOKENS` | `8000` | Token limit for one trace request. Reasoning counts inside it, keep it generous. |
| `DEEPSEEK_TRACE_EFFORT` | unset | `low`, `high` or `max`. Unset leaves DeepSeek's default. |
| `TRACE_PROVIDER` | `deepseek` | `mock` replays an invented sample and needs no key (for testing only). |
| `TRACE_SOURCE` | `auto` | `reasoning`, `steps`, or `auto` (reasoning if its word count is within the limits, else a step-by-step text). |
| `TRACE_MIN_WORDS` / `TRACE_MAX_WORDS` | `150` / `500` | Word range for `auto`. A reasoning that passes the maximum is stopped and cut at a paragraph. |
| `TRACE_REUSE` | `false` | `true`: every learner sees the newest saved ready trace of a question (no new AI call, not counted in the hourly limit). Leave off unless you want identical traces. |
| `TRACE_MAX_PER_HOUR` | `20` | Generated traces per user per hour (counted in memory, per server process). |
| `TRACE_FIRST_EVENT_TIMEOUT_MS` / `TRACE_IDLE_TIMEOUT_MS` / `TRACE_TOTAL_TIMEOUT_MS` | `30000` / `30000` / `180000` | Waiting limits for each AI call. |

**Check:** the chat still answers. Remember that the live trace is on by default (step 6): without a working key learners fall back to the stored questions.

## 6. Decide NEXT_PUBLIC_LIVE_TRACE before you build (You)

The live trace is **on by default**: it is on unless `NEXT_PUBLIC_LIVE_TRACE` is exactly `false`. With it on, every learner request for a question can call the paid model (limits in step 5). It is fixed into the build, so changing it needs a rebuild.

- To use the live trace in the study: leave it unset (or `true`) and build. The blank rules are a draft, so get the professor's approval first.
- To keep the study on the stored questions: set `NEXT_PUBLIC_LIVE_TRACE=false` **before** `next build`.

**Check:** with `false`, the browser's network tab shows no request to `/api/trace` (step 7b). With it on, there is one `POST /api/trace` per question.

## 7. Browser checks (You; Claude Code can write down what you see)

Run them on the restored copy with `node_modules/.bin/next dev`, **not** on the real study database. Use `TRACE_PROVIDER=mock` for the flag-on checks, so no key is used. Not run yet.

a. **Login and logout.** Log in, reload `/streaming`, log out. Expected: you land on the login page after logout and cannot open `/streaming` until you log in again.
b. **Flag off** (`NEXT_PUBLIC_LIVE_TRACE=false`, rebuild). Open `/streaming`, press Start and finish one question. Expected: the button says "Start" at once, and the network tab shows **no** `/api/trace` request.
c. **Logs for every action.** Press Start, Pause, Resume, Reset, "Yes, continue", "I don't understand", answer a blank, press Ok on the AI answer, then Logout. Expected: one `logs` row for each of the nine actions (`start_button_click`, `pause_button_click`, `resume_button_click`, `reset_button_click`, `understand_button_click`, `dont_understand_button_click`, `blank_answer_submit`, `ok_ai_output_button_click`, `logout_button_click`), and no log row from moving to the next question.
d. **Flag on, mock provider** (`NEXT_PUBLIC_LIVE_TRACE` unset or `true`, `TRACE_PROVIDER=mock`, restart). Expected: "Loading..." (gray, disabled) for a moment, then "Start"; **one** `POST /api/trace` per question (also in strict mode); the trace types out with some blanks; after **Reset** and Start the text and blanks are **identical** and no new request is made.
e. **Error fallback.** With the flag on and the provider unavailable (for example `TRACE_PROVIDER=deepseek` and no `DEEPSEEK_API_KEY` set on the copy), reload. Expected: "Loading..." for well under a second, then the stored question text, no error message, and no new log action.
f. **Animation checks (any flag value).** Scroll up while text is typing: the page must not jump back down. When a blank appears its input must be focused without the page scrolling. With the operating system's "reduce motion" on: no smooth scrolling or hover scaling.

**Check:** every "Expected" above is seen. Write down anything else you notice.

## 8. Run the trace report (You)

After any real or mock traces exist on the copy (and again later on the real database): `npx pnpm@8 trace:report -- --yes`. It prints the host and database first and only reads. A healthy result looks like:
- most rows `ready`; a few `failed` or `cancelled` is normal, many are not;
- error codes mostly empty; repeated `timeout` or `upstream` means check the key, limits and network;
- word counts between your `TRACE_MIN_WORDS` and `TRACE_MAX_WORDS` for most ready traces (the report shows the share);
- `source` and `decision reason` roughly as you expect for `TRACE_SOURCE`;
- average time per request well below `TRACE_TOTAL_TIMEOUT_MS` (a maximum near it means calls are timing out);
- every question you plan to use has at least one ready trace.

## 9. Old log rows that contain emails (You, with Claude Code reading the result)

Older versions wrote the email address into the `details` of the `login_attempt`, `login_failed` and `login_success` log rows. The current code does not. Approach:

1. Take the backup from step 1 first.
2. Find them (read-only): `SELECT action, count(*) FROM logs WHERE details::text ~* '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}' GROUP BY action ORDER BY 2 DESC;`
3. Look at a few: `SELECT id, action, timestamp FROM logs WHERE details::text ~* '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}' ORDER BY id LIMIT 20;` and, only if needed, one row's `details` on your own screen.
4. Decide with the study's data rules what to do: remove only the `email` key from `details`, or delete those rows if the login rows are not needed for analysis. This checklist deliberately has no UPDATE or DELETE statement. When you have decided, ask Claude Code to write the exact statement, read it line by line, run it first on the restored copy, and compare the counts from step 2 before and after.

**Check:** the SELECT from step 2 returns no rows afterwards, and other rows are unchanged.

## 10. Rollback (You)

- **Turn the live trace off quickly:** set `NEXT_PUBLIC_LIVE_TRACE=false` (unsetting it is **not** enough: unset means on) and **rebuild and restart** (it is fixed into the build). Or redeploy the previous build. Learners then see the stored questions again, exactly as before. Nothing else needs to change.
- **Quick server-side off switch:** removing `DEEPSEEK_API_KEY` (then restart) makes every trace fail, so the page falls back to the stored text, but it also stops the doubt-chat. Setting `NEXT_PUBLIC_LIVE_TRACE=false` needs a rebuild and restart. Use the key switch only as an emergency.
- `TRACE_REUSE`: remove it or set it to anything but `true`, restart. Saved traces stay in the table and are ignored.
- **Database:** the `traces` table is only written by the trace route and can stay unused. Nothing in the app needs it with the flag set to `false`. To undo hashed passwords or any bigger mistake, restore the dump from step 1 into a fresh database (`pg_restore`) and point `DATABASE_URL` at it, after checking it as in step 1.
- Keep the step 1 dump until the study is over.
