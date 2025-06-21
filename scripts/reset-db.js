// scripts/reset-db.js
const { drizzle } = require("drizzle-orm/postgres-js");
const postgres = require("postgres");

// Load environment variables
require("dotenv").config({ path: ".env.local" });

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error("❌ DATABASE_URL not found in environment variables");
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
        email VARCHAR(255) NOT NULL UNIQUE,
        password TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT now()
      )
    `;

    // Questions table
    await client`
      CREATE TABLE questions (
        id SERIAL PRIMARY KEY,
        question TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT now()
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

    // Create indexes for logs table
    await client`CREATE INDEX IF NOT EXISTS idx_logs_user_id ON logs(user_id)`;
    await client`CREATE INDEX IF NOT EXISTS idx_logs_action ON logs(action)`;
    await client`CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON logs(timestamp)`;
    await client`CREATE INDEX IF NOT EXISTS idx_logs_level ON logs(level)`;

    console.log("✅ Tables created successfully");
    console.log("");
    console.log("🎉 Database reset complete!");
    console.log("");
    console.log("📋 Empty tables created:");
    console.log("   - users (0 records)");
    console.log("   - questions (0 records)");
    console.log("   - logs (0 records)");
    console.log("");
    console.log("🚀 You can now start your application with: pnpm dev");
  } catch (error) {
    console.error("❌ Error resetting database:", error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

resetDatabase();
