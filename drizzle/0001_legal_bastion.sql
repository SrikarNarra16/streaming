CREATE TABLE "questions" (
	"id" serial PRIMARY KEY NOT NULL,
	"question" text NOT NULL,
	"content" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "created_at" SET DEFAULT '2025-06-21 08:12:40.972';