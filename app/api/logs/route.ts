import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { logger, LogLevel } from "@/lib/logger";
import { getSessionUserId } from "@/lib/session";
import { ALLOWED_LOG_ACTIONS } from "@/lib/log-actions";

const MAX_BODY_CHARS = 10 * 1024; // about 10 KB
const allowedActions: ReadonlySet<string> = new Set(ALLOWED_LOG_ACTIONS);

export async function POST(request: NextRequest) {
  try {
    // The user id comes only from the signed session, never from the request body.
    const cookieStore = await cookies();
    const userId = await getSessionUserId(cookieStore);

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const declaredLength = Number(request.headers.get("content-length") ?? 0);
    if (declaredLength > MAX_BODY_CHARS) {
      return NextResponse.json({ error: "Request body too large" }, { status: 413 });
    }
    const rawBody = await request.text();
    if (rawBody.length > MAX_BODY_CHARS) {
      return NextResponse.json({ error: "Request body too large" }, { status: 413 });
    }

    let body: { action?: unknown; details?: unknown; level?: unknown };
    try {
      body = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const { action, details, level } = body;

    if (typeof action !== "string" || !action) {
      return NextResponse.json(
        { error: "Action is required" },
        { status: 400 }
      );
    }
    if (!allowedActions.has(action)) {
      return NextResponse.json(
        { error: "Action is not allowed" },
        { status: 400 }
      );
    }

    // Validate log level
    const validLevels: LogLevel[] = ["debug", "info", "warn", "error"];
    const logLevel: LogLevel = validLevels.includes(level as LogLevel) ? (level as LogLevel) : "info";

    const logDetails =
      details && typeof details === "object" && !Array.isArray(details)
        ? (details as Record<string, unknown>)
        : {};

    // Use the appropriate logger method
    switch (logLevel) {
      case "debug":
        await logger.debug(action, logDetails, userId);
        break;
      case "info":
        await logger.info(action, logDetails, userId);
        break;
      case "warn":
        await logger.warn(action, logDetails, userId);
        break;
      case "error":
        await logger.error(action, logDetails, userId);
        break;
      default:
        await logger.info(action, logDetails, userId);
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
