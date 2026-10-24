// Inserts the sample questions. Idempotent: skips questions that already exist, never deletes.
// Run with: node_modules/.bin/tsx scripts/seed.ts  (or: npx pnpm@8 db:seed)
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { eq } from "drizzle-orm";
import { db } from "../lib/db";
import { questions } from "../schema";

// content format: `$$` between paragraphs, BLANK(answer) for fill-in-the-blank markers.
const SAMPLES = [
  {
    question:
      "Write a Python function count_vowels(s) that returns the number of vowels (a, e, i, o, u, case-insensitive) in the string s.",
    content:
      'We need a function that walks through the string and counts vowels.$$First, define the set of vowels. A string like "aeiou" works, and we lower-case the input so that uppercase letters are counted too.$$Then loop over each character and add one to the counter whenever the character is in the vowel set, using the keyword BLANK(in) to test membership.$$Finally, return the counter: BLANK(return) count.',
    answer:
      'def count_vowels(s):\n    count = 0\n    for ch in s.lower():\n        if ch in "aeiou":\n            count += 1\n    return count',
  },
  {
    question:
      "Write a Python function is_even(n) that returns True if n is even and False otherwise.",
    content:
      "An integer is even when it is divisible by 2 with no remainder.$$The modulo operator % gives the remainder, so n BLANK(%) 2 equals 0 exactly when n is even.$$We can return the comparison directly instead of using an if statement.",
    answer: "def is_even(n):\n    return n % 2 == 0",
  },
];

async function main() {
  let inserted = 0;
  let skipped = 0;
  for (const q of SAMPLES) {
    const existing = await db
      .select({ id: questions.id })
      .from(questions)
      .where(eq(questions.question, q.question))
      .limit(1);
    if (existing.length > 0) {
      skipped++;
      continue;
    }
    await db.insert(questions).values(q);
    inserted++;
  }
  console.log(`Seed done: ${inserted} inserted, ${skipped} skipped (already present).`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Seed failed:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
