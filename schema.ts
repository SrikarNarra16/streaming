import { 
  pgTable, 
  serial, 
  text, 
  varchar, 
  timestamp, 
  jsonb 
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  password: text("password").notNull(),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

export const questions = pgTable("questions", {
  id: serial("id").primaryKey(),
  question: text("question").notNull(),
  content: text("content").notNull(),
  answer: text("answer").notNull(),
});

// Fix logs table to match logger expectations
export const logs = pgTable("logs", {
  id: serial("id").primaryKey(),
  userId: text("user_id"), // Changed to text and made nullable
  action: text("action").notNull(), // This was missing!
  details: jsonb("details").default(sql`'{}'::jsonb`), // This was missing!
  level: text("level").notNull(),
  timestamp: timestamp("timestamp", { withTimezone: true }).default(sql`now()`),
  // Removed message field since logger doesn't use it
});
