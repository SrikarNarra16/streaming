import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import OpenAI from "openai";
import { logger } from "@/lib/logger";

export async function POST(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const userId = cookieStore.get("userId")?.value;

    if (!userId) {
      await logger.warn("ai_generate_access_denied", {
        reason: "not_authenticated",
      });
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { prompt, context, type, conversationHistory } = await request.json();

    await logger.info(
      "ai_generate_request",
      {
        type,
        promptLength: prompt?.length,
        contextLength: context?.length,
        conversationLength: conversationHistory?.length || 0,
        userQuestion: prompt,
      },
      userId
    );

    const openai = new OpenAI({
      baseURL: "https://api.deepseek.com",
      apiKey: process.env.DEEPSEEK_API_KEY,
    });

    let systemPrompt = "";
    let messages = [];

    if (type === "explanation_chat") {
      // For explanation chat questions
      systemPrompt = `You are a helpful AI coding tutor. A student is reading through an explanation and has asked a question about a specific part. Your goal is to:

1. Provide clear, helpful explanations
2. Use simple language and examples when needed
3. Build on what they're already learning
4. Don't give away answers to coding problems directly, but guide their understanding
5. Be encouraging and supportive
6. Keep responses concise but thorough
7. Remember the conversation history and build upon previous questions/answers

The student is currently reading this explanation context:
${context}`;

      // Build messages array with system prompt
      messages = [{ role: "system", content: systemPrompt }];

      // Add conversation history if provided
      if (conversationHistory && Array.isArray(conversationHistory)) {
        conversationHistory.forEach((msg) => {
          if (msg.role === "user" || msg.role === "assistant") {
            messages.push({
              role: msg.role,
              content: msg.message,
            });
          }
        });
      }

      // Add the current user message
      messages.push({
        role: "user",
        content: prompt,
      });
    } else {
      // Default behavior for other types
      messages = [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: prompt },
      ];
    }

    const response = await openai.chat.completions.create({
      model: "deepseek-chat",
      messages,
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
        conversationLength: conversationHistory?.length || 0,
      },
      userId
    );

    return NextResponse.json({
      content: content,
    });
  } catch (error: any) {
    const cookieStore = await cookies();
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
