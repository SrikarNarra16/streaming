import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { logger } from "@/lib/logger";
import { getSessionUserId, SESSION_COOKIE } from "@/lib/session";

export async function POST() {
  try {
    const cookieStore = await cookies(); // Add await here
    const userId = await getSessionUserId(cookieStore);

    if (userId) {
      await logger.info("logout", {}, userId);
    }

    cookieStore.delete(SESSION_COOKIE);

    return NextResponse.json({ message: "Logged out successfully" });
  } catch (error) {
    await logger.error("logout_error", { error: error instanceof Error ? error.message : String(error) });
    console.error("Logout error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
