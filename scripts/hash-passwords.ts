// One-off migration: replaces plain-text passwords with bcrypt hashes (cost 12).
// Idempotent: rows whose password already starts with a bcrypt prefix ($2a$, $2b$, $2y$) are skipped.
// Run with: node_modules/.bin/tsx scripts/hash-passwords.ts --yes   (or: npx pnpm@8 db:hash-passwords -- --yes)
// Never prints passwords or hashes; prints only the database host and name, and counts.
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import bcrypt from "bcryptjs";
import postgres from "postgres";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL not found in environment variables");
  process.exit(1);
}

let target = "(unparseable DATABASE_URL)";
try {
  const u = new URL(connectionString);
  target = `host=${u.host} database=${u.pathname.replace(/^\//, "")}`;
} catch {}
console.log(`Target: ${target}`);

if (!process.argv.includes("--yes")) {
  console.error("Refusing to run without --yes. This rewrites the password column of every plain-text user.");
  process.exit(1);
}

const sql = postgres(connectionString, { prepare: false });

async function main() {
  const rows = await sql<{ id: number; password: string }[]>`
    SELECT id, password FROM users WHERE left(password, 4) NOT IN ('$2a$', '$2b$', '$2y$') ORDER BY id
  `;
  let updated = 0;
  let skipped = 0;
  for (const row of rows) {
    const hash = await bcrypt.hash(row.password, 12);
    // Only update if the row still holds the value we read (guards against concurrent changes).
    const result = await sql`UPDATE users SET password = ${hash} WHERE id = ${row.id} AND password = ${row.password}`;
    if (result.count === 1) updated++;
    else skipped++;
  }
  console.log(`Plain-text passwords found: ${rows.length}. Hashed: ${updated}. Skipped (changed meanwhile): ${skipped}.`);
}

main()
  .then(async () => {
    await sql.end();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("hash-passwords failed:", err instanceof Error ? err.name : "Error");
    await sql.end();
    process.exit(1);
  });
