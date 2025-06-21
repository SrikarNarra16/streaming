import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { questions } from "@/schema";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
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

    const questionId = parseInt(params.id);
    
    if (isNaN(questionId)) {
      return NextResponse.json(
        { error: "Invalid question ID" },
        { status: 400 }
      );
    }

    const question = await db
      .select()
      .from(questions)
      .where(eq(questions.id, questionId))
      .limit(1);

    if (!question[0]) {
      return NextResponse.json(
        { error: "Question not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ question: question[0] });
  } catch (error) {
    console.error("Error fetching question:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}