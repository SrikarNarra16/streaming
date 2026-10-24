import "dotenv/config";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { requireEnv } from "./env";

let _client: ReturnType<typeof postgres> | undefined;
let _db: ReturnType<typeof drizzle> | undefined;

// Created on first use so that importing this module never needs DATABASE_URL.
// Disable prefetch as it is not supported for "Transaction" pool mode
export function getClient() {
  return (_client ??= postgres(requireEnv("DATABASE_URL"), { prepare: false }));
}

export const db = new Proxy({} as ReturnType<typeof drizzle>, {
  get(_target, prop) {
    _db ??= drizzle(getClient());
    return Reflect.get(_db, prop);
  },
});
