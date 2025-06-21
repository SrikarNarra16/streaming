CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" varchar(255) NOT NULL,
	"password" text NOT NULL,
	"created_at" timestamp DEFAULT '2025-06-21 07:56:43.648' NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
