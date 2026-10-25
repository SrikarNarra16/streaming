# ThinkTrace (streaming)

A Next.js 15 app (React 19, Tailwind 4, Drizzle ORM, PostgreSQL) for an interactive learning experience. An explanation is streamed to the learner with a typewriter effect, with fill-in-the-blank gaps, a "do you understand?" check after each paragraph, and a doubt-chat backed by the DeepSeek API.

It is a research tool used with study participants, so the data in the database is sensitive.

## Quick Start

Prerequisites: Node.js 20+ (tested here on v26), PostgreSQL, a DeepSeek API key.

1. **Install dependencies**

   ```bash
   npx pnpm@8 install --frozen-lockfile
   ```

   `pnpm-lock.yaml` is the only lockfile (lockfile v6, generated with pnpm 8.15.9, which is also pinned in the `packageManager` field of `package.json`). pnpm 8 is required: pnpm 11 cannot read a v6 lockfile. Do not add `package-lock.json` or `bun.lock`. To change dependencies, use `npx pnpm@8 add <package>` so the lockfile stays in sync.

2. **Configure environment variables**

   ```bash
   cp .env.example .env.local
   ```

   Then edit `.env.local` and fill in your own values:

   ```env
   DATABASE_URL=postgresql://username:password@localhost:5432/database_name
   DEEPSEEK_API_KEY=your_deepseek_api_key_here
   SESSION_SECRET=<at least 32 random characters, for example the output of: openssl rand -hex 32>
   ```

   `.env.local` is git-ignored; never commit it. Only `.env.example` is tracked.

3. **Start PostgreSQL** (skip this if you already have a database). For example, with Docker, bound to localhost only and using a named volume:

   ```bash
   docker run -d --name streaming-pg -p 127.0.0.1:5433:5432 \
     -e POSTGRES_USER=streaming -e POSTGRES_PASSWORD=<choose-a-password> -e POSTGRES_DB=streaming \
     -v streaming-pgdata:/var/lib/postgresql/data postgres:16
   ```

   The matching `DATABASE_URL` is `postgresql://streaming:<choose-a-password>@localhost:5433/streaming`.

4. **Create the tables**

   ```bash
   npx drizzle-kit push
   ```

   `drizzle-kit` reads `DATABASE_URL` from `.env.local`. The `drizzle/` folder holds only one migration file, not a complete history, so use `push`, not migrations.

5. **Seed sample questions**

   ```bash
   npx pnpm@8 db:seed
   ```

   This inserts two short Python questions. It is idempotent (questions that already exist are skipped) and never deletes anything.

6. **Run the app**

   ```bash
   node_modules/.bin/next dev
   ```

   `pnpm dev` fails on pnpm 11 (its dependency check tries to purge `node_modules`), so run Next directly as shown.

   - Register: <http://localhost:3000/auth/register>
   - Login: <http://localhost:3000/auth/login>
   - Learning interface: <http://localhost:3000/streaming> (redirects to login when you are not logged in)

## Scripts

| Command | What it does |
|---|---|
| `npx drizzle-kit push` | Applies `schema.ts` to the database |
| `npx pnpm@8 db:seed` | Inserts the sample questions (idempotent) |
| `npx pnpm@8 db:hash-passwords -- --yes` | Replaces any plain-text passwords with bcrypt hashes. Prints the database host and name first, refuses without `--yes`, never prints passwords or hashes, and skips rows that are already hashed (safe to run twice). |
| `npx pnpm@8 db:reset -- --yes` | **Drops** `users`, `questions` and `logs` and recreates them empty from the schema. Refuses to run without `--yes` and prints the target host and database name (never the password) first. |
| `npx pnpm@8 db:generate` | `drizzle-kit generate` |
| `npx pnpm@8 db:studio` | Opens Drizzle Studio |
| `npx pnpm@8 build` / `start` / `lint` | Next.js build, start and lint |

There is no `db:migrate` script. After `db:reset`, run `db:seed` to get the sample questions back.

## Database schema

`schema.ts` is the source of truth.

- **users**: `id` serial PK, `name` text, `email` varchar(255) unique, `password` text, `created_at` timestamp (default now). All NOT NULL.
- **questions**: `id` serial PK, `question` text, `content` text, `answer` text. All NOT NULL.
- **logs**: `id` serial PK, `user_id` text (nullable), `action` text, `details` jsonb (default `{}`), `level` text, `timestamp` timestamptz (default now).

### Question content format

`questions.content` is the explanation that gets streamed to the learner:

- `$$` separates paragraphs. After each paragraph the learner is asked whether they understood it.
- `BLANK(answer)` marks a fill-in-the-blank gap. The text inside the parentheses is the expected answer.

`questions.answer` is the final answer shown after the explanation, streamed in the same way. It is NOT NULL, so every insert must include it:

```sql
INSERT INTO questions (question, content, answer) VALUES (
  'Write a function is_even(n) that returns True for even n.',
  'An integer is even when it is divisible by 2.$$The modulo operator gives the remainder, so n BLANK(%) 2 equals 0 for even n.',
  'def is_even(n):
    return n % 2 == 0'
);
```

## Project structure

- `app/streaming/page.tsx`: the learning interface. It holds the streaming logic, blank handling, per-paragraph feedback, chat state and logging calls.
- `app/auth/login/page.tsx`, `app/auth/register/page.tsx`: login and registration pages. `app/page.tsx` redirects to `/streaming` or `/auth/login`.
- `app/api/auth/{login,logout,register,me}/route.ts`: authentication endpoints.
- `app/api/questions/route.ts`: returns all questions (401 when not logged in).
- `app/api/generate/route.ts`: streams doubt-chat answers from DeepSeek (the model comes from `DEEPSEEK_CHAT_MODEL`, default `deepseek-flash`, with thinking disabled). Failures return a generic JSON 500 error; details go to the `logs` table.
- `app/api/logs/route.ts`: client-side activity logging. It needs a valid session, takes the user id from the session only, accepts only the actions listed in `lib/log-actions.ts`, and rejects bodies over about 10 KB.
- `components/streaming/`: `ModernBlankInput.tsx` (fill-in-the-blank input), `ChatAccordion.tsx` (per-paragraph doubt chat), `ModernAIOutputDisplay.tsx` (final answer display), `PerformanceSummary.tsx` (progress summary).
- `components/ui/accordion.tsx`: base accordion (shadcn/ui).
- `lib/db.ts`: Drizzle/Postgres connection, created on first use. `lib/env.ts`: `requireEnv()`, which throws a clear error for a missing variable. `lib/session.ts`: signed session tokens. `lib/log-actions.ts`: the list of log actions the client may send. `lib/logger.ts`: writes to the `logs` table. `lib/utils.ts`: class-name helper.
- `middleware.ts`: redirects `/streaming` to `/auth/login` unless the `session` cookie holds a valid, unexpired, correctly signed token.
- `scripts/seed.ts`, `scripts/reset-db.js`: database helpers. `scripts/trace-spike.ts`: standalone DeepSeek thinking-mode measurement script (not part of the app).
- `logs_analyze.py`: analysis helper for exported logs.

## Timing constants

In `app/streaming/page.tsx`:

```typescript
const TYPING_INTERVAL_MS = 10;       // delay between typing ticks
const CHARS_PER_TYPE_INTERVAL = 1;   // characters revealed per tick
const FEEDBACK_DURATION_MS = 1500;   // how long blank feedback is shown
```

Also in that file: the final answer streams one character every 15 ms, and the "show AI answer" prompt appears 500 ms after the content completes.

## Authentication and known limitations

Login sets an HTTP-only `session` cookie (7 days, `sameSite: strict`, `secure` in production). It holds a signed token (`v1.<payload>.<signature>`, HMAC-SHA256 with `SESSION_SECRET`) containing the user id and an expiry; a missing, tampered, malformed or expired token is rejected by `middleware.ts` and by every API route. Passwords are stored as bcrypt hashes (cost 12), and the login response and timing do not reveal whether an email exists. Login attempts are logged without the email address.

Changing `SESSION_SECRET` signs everyone out. Anyone can still register an account: there is no restriction on who may register.

**Before deploying this version to a database that already has users, run `npx pnpm@8 db:hash-passwords -- --yes` against it.** Until then, users whose password is still plain text cannot log in.

## Environment variables

`DATABASE_URL`, `DEEPSEEK_API_KEY` and `SESSION_SECRET` (at least 32 characters) are required, and `DEEPSEEK_CHAT_MODEL` is optional (see `.env.example`). The required ones are read when first needed, not at import time. A missing `DATABASE_URL` raises a clear error on the first database query, and a missing `DEEPSEEK_API_KEY` makes `/api/generate` return a generic 500 and log `ai_not_configured`. A missing or too short `SESSION_SECRET` makes login (and the `/streaming` page and API routes that check the session) fail with a configuration error.

Optional: `DEEPSEEK_CHAT_MODEL` sets the model used by the doubt-chat (default `deepseek-flash`; thinking is disabled for the tutor chat so the short answer is not used up by reasoning tokens).

Optional, for the live thinking-trace provider in `lib/trace/` (not wired into the app yet; read by `readTraceSettingsFromEnv()` in `lib/trace/deepseek-client.ts`):

- `DEEPSEEK_TRACE_MODEL`: the model that produces the reasoning trace (default `deepseek-flash`). A value that is empty or contains characters other than letters, digits, `.`, `_` and `-` is ignored and the default is used.
- `DEEPSEEK_TRACE_MAX_TOKENS`: the `max_tokens` limit for one trace request (default `8000`). Reasoning tokens count inside `max_tokens`, so keep it generous: a trace that hits the limit ends with finish reason `length`. Values that are not whole numbers between 256 and 100000 are ignored and the default is used.

Known issue: `next build` currently fails (lint errors, and `useSearchParams()` in `app/auth/login/page.tsx` is not wrapped in a Suspense boundary), so only `next dev` is verified.

## Known audit findings

`npx pnpm@8 audit` on 2026-10-24, after upgrading to Next.js 15.5.28, drizzle-orm 0.45.4 and sharp 0.35.5 (before the upgrade it reported 4 critical, 19 high, 20 moderate and 2 low). Five findings remain, and they are accepted for now. No overrides are used. Revisit them when Next.js or drizzle-kit ships newer dependencies.

| Package | Severity | Advisory | Pulled in by | Why it is accepted (assessment basis) |
|---|---|---|---|---|
| postcss 8.4.31: arbitrary file read and information disclosure | high | [GHSA-6g55-p6wh-862q](https://github.com/advisories/GHSA-6g55-p6wh-862q) (CVE-2026-45623) | `next` (exact pin, also in 15.5.28) | Judged from the advisory title and how this app uses postcss: the app does not process untrusted CSS (styles come from the repo and are built by Tailwind, which uses its own patched postcss). The full advisory was not reviewed. |
| postcss 8.4.31: path traversal in previous source map auto-loading | high | [GHSA-r28c-9q8g-f849](https://github.com/advisories/GHSA-r28c-9q8g-f849) (CVE-2026-73646) | `next` (exact pin) | Same basis as above: title and app usage only; the full advisory was not reviewed. |
| postcss 8.4.31: incomplete fix of GHSA-6g55-p6wh-862q | moderate | [GHSA-fxqj-rqcc-2cmp](https://github.com/advisories/GHSA-fxqj-rqcc-2cmp) (CVE-2026-69153) | `next` (exact pin) | Same basis as above: title and app usage only; the full advisory was not reviewed. |
| postcss 8.4.31: XSS via unescaped `</style>` in CSS stringify output | moderate | [GHSA-qx2v-qp2m-jg93](https://github.com/advisories/GHSA-qx2v-qp2m-jg93) (CVE-2026-41305) | `next` (exact pin) | Same basis as above: title and app usage only; the full advisory was not reviewed. |
| esbuild 0.18.20: any website can send requests to the development server | moderate | [GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99) | `drizzle-kit` > `@esbuild-kit/esm-loader` > `@esbuild-kit/core-utils` | Judged from the advisory title and how this app uses it: dev tooling only, not part of the running app, and `drizzle-kit` is not known to start esbuild's dev server. The latest drizzle-kit (0.31.11) still depends on these packages. The full advisory was not reviewed. |

Revisit all of these before hosting the app for participants.
