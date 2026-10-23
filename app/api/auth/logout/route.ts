import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { logger } from "@/lib/logger";

export async function POST() {
  try {
    const cookieStore = await cookies(); // Add await here
    const userId = cookieStore.get("userId")?.value;

    if (userId) {
      await logger.info("logout", {}, userId);
    }

    cookieStore.delete("userId");

    return NextResponse.json({ message: "Logged out successfully" });
  } catch (error) {
    await logger.error("logout_error", { error: error.message });
    console.error("Logout error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
