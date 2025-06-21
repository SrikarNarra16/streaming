import { NextResponse } from "next/server";
import OpenAI from "openai";

export async function POST(request: Request) {
  try {
    const { prompt, context, type } = await request.json();

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

    return NextResponse.json({
      content: response.choices[0].message.content,
    });
  } catch (error: any) {
    console.error("Error:", error);
    return NextResponse.json(
      { error: `Error occurred: ${error.message}` },
      { status: 500 }
    );
  }
}
