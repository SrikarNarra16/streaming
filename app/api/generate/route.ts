import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import OpenAI from "openai";
import { logger } from "@/lib/logger";

export async function POST(request: NextRequest) {
  try {
    const cookieStore = await cookies(); // Add await here
    const userId = cookieStore.get("userId")?.value;

    if (!userId) {
      await logger.warn("ai_generate_access_denied", {
        reason: "not_authenticated",
      });
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { prompt, context, type } = await request.json();

    await logger.info(
      "ai_generate_request",
      {
        type,
        promptLength: prompt?.length,
        contextLength: context?.length,
        userQuestion: prompt,
      },
      userId
    );

    const openai = new OpenAI({
      baseURL: "https://api.deepseek.com",
      apiKey: process.env.DEEPSEEK_API_KEY,
    });

    let systemPrompt = "";
    let userPrompt = "";

    if (type === "explanation_chat") {
      // For explanation chat questions
      systemPrompt = `You are a helpful AI coding tutor. A student is reading through an explanation and has asked a question about a specific part. Your goal is to:

1. Provide clear, helpful explanations
2. Use simple language and examples when needed
3. Build on what they're already learning
4. Don't give away answers to coding problems directly, but guide their understanding
5. Be encouraging and supportive
6. Keep responses concise but thorough

The student is currently reading this explanation context:
${context}`;

      userPrompt = `The student asks: "${prompt}"

Please provide a helpful response that clarifies their doubt about this explanation.`;
    } else {
      // Default behavior for other types
      systemPrompt = "You are a helpful assistant.";
      userPrompt = prompt;
    }

    const response = await openai.chat.completions.create({
      model: "deepseek-chat",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.7,
      max_tokens: 500,
    });

    const content = response.choices[0].message.content;

    await logger.info(
      "ai_generate_success",
      {
        type,
        userQuestion: prompt,
        aiResponse: content,
        responseLength: content?.length,
      },
      userId
    );

    return NextResponse.json({
      content: content,
    });
  } catch (error: any) {
    const cookieStore = await cookies(); // Add await here too
    const userId = cookieStore.get("userId")?.value;

    await logger.error(
      "ai_generate_error",
      {
        error: error.message,
        userQuestion: prompt,
      },
      userId
    );
    console.error("Error:", error);
    return NextResponse.json(
      { error: `Error occurred: ${error.message}` },
      { status: 500 }
    );
  }
}
