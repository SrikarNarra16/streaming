// scripts/reset-db.js
const { drizzle } = require("drizzle-orm/postgres-js");
const postgres = require("postgres");

// Load environment variables
require("dotenv").config({ path: [".env.local", ".env"] });

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error("❌ DATABASE_URL not found in environment variables");
  process.exit(1);
}

// Safety: show the target (host and database name only, never the password) and require --yes.
let target = "(unparseable DATABASE_URL)";
try {
  const u = new URL(connectionString);
  target = `host=${u.host} database=${u.pathname.replace(/^\//, "")}`;
} catch {}
console.log(`Target: ${target}`);
if (!process.argv.includes("--yes")) {
  console.error("❌ Refusing to wipe the database without --yes. This DROPS users, questions and logs.");
  console.error("   Re-run with: node scripts/reset-db.js --yes");
  process.exit(1);
}

const client = postgres(connectionString, { prepare: false });
const db = drizzle(client);

async function resetDatabase() {
  try {
    console.log("🔄 Resetting database...");

    // Drop all tables
    console.log("🗑️  Dropping existing tables...");
    await client`DROP TABLE IF EXISTS logs CASCADE`;
    await client`DROP TABLE IF EXISTS questions CASCADE`;
    await client`DROP TABLE IF EXISTS users CASCADE`;

    // Create tables
    console.log("🏗️  Creating tables...");

    // Users table
    await client`
      CREATE TABLE users (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        email VARCHAR(255) NOT NULL,
        password TEXT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT users_email_unique UNIQUE (email)
      )
    `;

    // Questions table
    await client`
      CREATE TABLE questions (
        id SERIAL PRIMARY KEY,
        question TEXT NOT NULL,
        content TEXT NOT NULL,
        answer TEXT NOT NULL
      )
    `;

    // Logs table
    await client`
      CREATE TABLE logs (
        id SERIAL PRIMARY KEY,
        user_id TEXT,
        action TEXT NOT NULL,
        details JSONB DEFAULT '{}'::jsonb,
        level TEXT NOT NULL,
        timestamp TIMESTAMP WITH TIME ZONE DEFAULT now()
      )
    `;

    console.log("✅ Tables created successfully");
    console.log("");
    console.log("🎉 Database reset complete!");
    console.log("");
    console.log("📋 Empty tables created: users, questions, logs");
    console.log("");
    console.log("Next: seed sample questions with: npx pnpm@8 db:seed");
  } catch (error) {
    console.error("❌ Error resetting database:", error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

resetDatabase();
