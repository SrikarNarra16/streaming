import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { questions } from "@/schema";
import { logger } from "@/lib/logger";

export async function GET() {
  try {
    const cookieStore = await cookies(); // Add await here
    const userId = cookieStore.get("userId")?.value;

    if (!userId) {
      await logger.warn("questions_access_denied", {
        reason: "not_authenticated",
      });
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await logger.info("questions_fetched", {}, userId);

    const allQuestions = await db
      .select({
        id: questions.id,
        question: questions.question,
        content: questions.content,
        answer: questions.answer,
      })
      .from(questions)
      .orderBy(questions.id);

    return NextResponse.json({ questions: allQuestions });
  } catch (error) {
    await logger.error("questions_fetch_error", { error: error.message });
    console.error("Error fetching questions:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
