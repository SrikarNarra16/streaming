import { 
  pgTable, 
  serial, 
  text, 
  varchar, 
  timestamp,
  jsonb,
  integer
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

// One row per live thinking-trace request (written once per request, whatever the outcome).
export const traces = pgTable("traces", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  questionId: integer("question_id").notNull().references(() => questions.id),
  source: text("source").notNull(), // "reasoning" or "steps": which kind of text became the trace
  decisionReason: text("decision_reason").notNull(), // why, for example "in_range", "too_long", "setting_steps"
  model: text("model").notNull(), // the model that was asked
  servedModel: text("served_model"), // the model the server reported, if any
  status: text("status").notNull(), // "ready", "failed" or "cancelled"
  rawReasoning: text("raw_reasoning"), // the reasoning exactly as received (before cleaning)
  stepsText: text("steps_text"), // the step-by-step answer exactly as received (before cleaning)
  finalParagraphs: jsonb("final_paragraphs").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  finalWords: integer("final_words").notNull().default(0),
  usage: jsonb("usage"), // token usage per call: { reasoning?: {...}, steps?: {...} }
  warnings: jsonb("warnings").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  errorCode: text("error_code"),
  totalMs: integer("total_ms"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});
