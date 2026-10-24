# ThinkTrace (streaming)

A Next.js 15 app (React 19, Tailwind 4, Drizzle ORM, PostgreSQL) for an interactive learning experience. An explanation is streamed to the learner with a typewriter effect, with fill-in-the-blank gaps, a "do you understand?" check after each paragraph, and a doubt-chat backed by the DeepSeek API.

It is a research tool used with study participants, so the data in the database is sensitive.

## Quick Start

Prerequisites: Node.js 18+ (tested here on v26), PostgreSQL, a DeepSeek API key.

1. **Install dependencies**

   ```bash
   npx pnpm@8 install --no-lockfile
   ```

   The repo contains three lockfiles (`package-lock.json`, `pnpm-lock.yaml`, `bun.lock`). `pnpm-lock.yaml` is lockfile v6 and is out of date (it is missing `nprogress`), so `pnpm install --frozen-lockfile` fails, and pnpm 11 refuses to read it at all. The command above uses pnpm 8 and ignores the lockfile, so versions are resolved fresh from `package.json` and no lockfile is written.

2. **Configure environment variables**

   ```bash
   cp .env.example .env.local
   ```

   Then edit `.env.local` and fill in your own values:

   ```env
   DATABASE_URL=postgresql://username:password@localhost:5432/database_name
   DEEPSEEK_API_KEY=your_deepseek_api_key_here
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
- `app/api/generate/route.ts`: streams doubt-chat answers from DeepSeek (model `deepseek-chat`). Failures return a generic JSON 500 error; details go to the `logs` table.
- `app/api/logs/route.ts`: client-side activity logging.
- `components/streaming/`: `ModernBlankInput.tsx` (fill-in-the-blank input), `ChatAccordion.tsx` (per-paragraph doubt chat), `ModernAIOutputDisplay.tsx` (final answer display), `PerformanceSummary.tsx` (progress summary).
- `components/ui/accordion.tsx`: base accordion (shadcn/ui).
- `lib/db.ts`: Drizzle/Postgres connection, created on first use. `lib/env.ts`: `requireEnv()`, which throws a clear error for a missing variable. `lib/logger.ts`: writes to the `logs` table. `lib/utils.ts`: class-name helper.
- `middleware.ts`: redirects `/streaming` to `/auth/login` when the `userId` cookie is missing.
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

Login sets an HTTP-only `userId` cookie (7 days, `sameSite: strict`). The cookie is a plain user id: it is not signed, so it can be forged. Passwords are stored and compared in plain text (`bcryptjs` is installed but not used). There is no `NEXTAUTH_SECRET`; nothing reads one. Do not use real passwords, and do not deploy this as is.

## Environment variables

Only two are read by the code: `DATABASE_URL` and `DEEPSEEK_API_KEY` (see `.env.example`). Both are read when first needed, not at import time. A missing `DATABASE_URL` raises a clear error on the first database query, and a missing `DEEPSEEK_API_KEY` makes `/api/generate` return a generic 500 and log `ai_not_configured`.

Known issue: `next build` currently fails (lint errors, and `useSearchParams()` in `app/auth/login/page.tsx` is not wrapped in a Suspense boundary), so only `next dev` is verified.
