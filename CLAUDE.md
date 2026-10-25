# ThinkTrace (streaming) - working rules

Project: Next.js 15 + React 19 + Drizzle ORM + PostgreSQL + DeepSeek API. It is a research tool used with study participants, so their data is sensitive.

Rules for every task:
- Local only. Never run git push, git pull or git fetch. No remote exists. Do not create pull requests.
- Never commit unless I say so. Show the diff and the verification output, then wait. When I approve, commit with exactly the message I give.
- Never print or log secrets (API key, DATABASE_URL, passwords, session secret). Never commit .env files, except .env.example.
- Do not add dependencies without asking first (say what, why and the size).
- No unrelated refactors or drive-by fixes. List other issues you notice in your report instead.
- After changes, run node_modules/.bin/tsc --noEmit. Report any errors, and my changes must add none.
- Package manager: use `npx pnpm@8 ...` for installs. `pnpm dev` fails on pnpm 11, so run the app with node_modules/.bin/next dev.
- Database: local Docker container streaming-pg on 127.0.0.1:5433. Never run db:reset or drop data on the main database. Use a throwaway database for destructive tests, and drop it afterwards.
- Do not change the learner-facing flow (typing, gates, blanks, chat) unless the task says so.
- Question content format: `$$` between paragraphs, BLANK(answer) for fill-in-the-blank markers, stored in questions.content.
- Never execute a script that loads `.env.local` or calls a paid API (currently `scripts/trace-live-smoke.ts` and `scripts/trace-spike.ts`), not even with a flag, a pipe (for example `| head`) or an unset variable: the script loads `.env.local` itself, and a request can start before a pipe closes. Unit-test the pure parts instead. If a live check is needed, ask me to run it.
- Never execute a script that writes to or resets a database (`scripts/seed.ts`, `scripts/reset-db.js`, `scripts/hash-passwords.ts`) or run `drizzle-kit push`, `migrate` or `studio`. You may read and edit them and unit-test their pure parts. If a database change is needed, tell me the exact command and I will run it.
- Reports must say what changed, how it was verified (with real output), and what could not be verified.
