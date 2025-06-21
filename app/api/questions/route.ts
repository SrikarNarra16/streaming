import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { questions } from "@/schema";
import { cookies } from "next/headers";

export async function GET() {
  try {
    // Check if user is authenticated
    const cookieStore = cookies();
    const userId = cookieStore.get("userId")?.value;

    if (!userId) {
      return NextResponse.json(
        { error: "Not authenticated" },
        { status: 401 }
      );
    }

    const allQuestions = await db
      .select()
      .from(questions)
      .orderBy(questions.id);

    return NextResponse.json({ questions: allQuestions });
  } catch (error) {
    console.error("Error fetching questions:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}