import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import OpenAI from "openai";
import { logger } from "@/lib/logger";
import { requireEnv } from "@/lib/env";

// Only non-sensitive fields: error messages can contain fragments of the API key.
function describeError(error: unknown) {
  const e = error as { name?: string; status?: number; requestID?: string | null };
  return {
    errorName: error instanceof Error ? error.name : typeof error,
    upstreamStatus: e?.status,
    requestId: e?.requestID ?? undefined,
  };
}

export async function POST(request: NextRequest) {
  let userId: string | undefined;
  let prompt = "";
  try {
    const cookieStore = await cookies();
    userId = cookieStore.get("userId")?.value;

    if (!userId) {
      await logger.warn("ai_generate_access_denied", {
        reason: "not_authenticated",
      });
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const { context, type, conversationHistory } = body;
    prompt = body.prompt;

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

    let apiKey: string;
    try {
      apiKey = requireEnv("DEEPSEEK_API_KEY");
    } catch {
      await logger.error(
        "ai_not_configured",
        { variable: "DEEPSEEK_API_KEY" },
        userId
      );
      return NextResponse.json(
        { error: "The AI service could not process this request." },
        { status: 500 }
      );
    }

    const openai = new OpenAI({
      baseURL: "https://api.deepseek.com",
      apiKey,
    });

    let systemPrompt = "";
    let messages: OpenAI.ChatCompletionMessageParam[] = [];

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
          let role: "user" | "assistant" = msg.role;
          if (msg.role === "ai") role = "assistant";
          if (role === "user" || role === "assistant") {
            messages.push({
              role,
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

    // Enable streaming from DeepSeek/OpenAI
    const completion = await openai.chat.completions.create({
      model: "deepseek-chat",
      messages,
      temperature: 0.7,
      max_tokens: 500,
      stream: true,
    });

    // Create a ReadableStream to pipe chunks to the client
    const stream = new ReadableStream({
      async start(controller) {
        let fullContent = "";
        try {
          for await (const chunk of completion) {
            const delta = chunk.choices?.[0]?.delta?.content || "";
            if (delta) {
              controller.enqueue(delta);
              fullContent += delta;
            }
          }
          controller.close();
        } catch (streamError) {
          await logger.error(
            "ai_generate_stream_error",
            {
              ...describeError(streamError),
              userQuestion: prompt,
              partialResponseLength: fullContent.length,
            },
            userId
          );
          controller.error(streamError);
          return;
        }
        // Optionally log the full response after streaming
        await logger.info(
          "ai_generate_success",
          {
            type,
            userQuestion: prompt,
            aiResponse: fullContent,
            responseLength: fullContent.length,
            conversationLength: conversationHistory?.length || 0,
          },
          userId
        );
      }
    });

    return new NextResponse(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Transfer-Encoding": "chunked",
        "Cache-Control": "no-cache"
      }
    });
  } catch (error) {
    await logger.error(
      "ai_generate_error",
      {
        ...describeError(error),
        userQuestion: prompt,
      },
      userId
    );
    console.error("Error:", error);
    return NextResponse.json(
      { error: "The AI service could not process this request." },
      { status: 500 }
    );
  }
}
