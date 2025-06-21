import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { logger, LogLevel } from "@/lib/logger";

export async function POST(request: NextRequest) {
  try {
    const cookieStore = await cookies(); // Add await here
    const userId = cookieStore.get("userId")?.value;

    const { action, details, level } = await request.json();

    if (!action) {
      return NextResponse.json(
        { error: "Action is required" },
        { status: 400 }
      );
    }

    // Validate log level
    const validLevels: LogLevel[] = ["debug", "info", "warn", "error"];
    const logLevel: LogLevel = validLevels.includes(level) ? level : "info";

    // Use the appropriate logger method
    switch (logLevel) {
      case "debug":
        await logger.debug(action, details || {}, userId);
        break;
      case "info":
        await logger.info(action, details || {}, userId);
        break;
      case "warn":
        await logger.warn(action, details || {}, userId);
        break;
      case "error":
        await logger.error(action, details || {}, userId);
        break;
      default:
        await logger.info(action, details || {}, userId);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Logging error:", error);
    // Don't try to log the logging error to avoid infinite loops
    return NextResponse.json(
      { error: "Failed to log action" },
      { status: 500 }
    );
  }
}
