import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { users } from "@/schema";
import { eq } from "drizzle-orm";
import { logger } from "@/lib/logger";
import { createSessionToken, SESSION_COOKIE, sessionCookieOptions } from "@/lib/session";

// A valid bcrypt (cost 12) hash of a random string. It is compared when the email is unknown,
// so the response time does not reveal which emails exist.
const DUMMY_HASH = "$2b$12$1I.pz5vo0TBL5GYsLlhEOOarKAjDyNQ9UogA32iGDnTSXXCchPMF6";

export async function POST(request: NextRequest) {
  try {
    const { email, password } = await request.json();

    // The email address is deliberately not logged anywhere in this route.
    await logger.info("login_attempt", {});

    if (!email || !password || typeof email !== "string" || typeof password !== "string") {
      await logger.warn("login_failed", { reason: "missing_credentials" });
      return NextResponse.json(
        { error: "Email and password are required" },
        { status: 400 }
      );
    }

    const user = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (user.length === 0) {
      await bcrypt.compare(password, DUMMY_HASH);
      await logger.warn("login_failed", { reason: "user_not_found" });
      return NextResponse.json(
        { error: "Invalid credentials" },
        { status: 401 }
      );
    }

    // Passwords are stored as bcrypt hashes; a stored value that is not a valid hash never matches.
    let isValidPassword = false;
    try {
      isValidPassword = await bcrypt.compare(password, user[0].password);
    } catch {
      isValidPassword = false;
    }

    if (!isValidPassword) {
      await logger.warn("login_failed", { reason: "invalid_password" });
      return NextResponse.json(
        { error: "Invalid credentials" },
        { status: 401 }
      );
    }

    const cookieStore = await cookies();
    cookieStore.set(
      SESSION_COOKIE,
      await createSessionToken(user[0].id),
      sessionCookieOptions()
    );

    await logger.info("login_success", {}, user[0].id.toString());

    return NextResponse.json({
      message: "Login successful",
      user: { id: user[0].id, name: user[0].name, email: user[0].email },
    });
  } catch (error) {
    await logger.error("login_error", { error: error instanceof Error ? error.message : String(error) });
    console.error("Login error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
