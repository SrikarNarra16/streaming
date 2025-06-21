import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { db } from "@/db";
import { users } from "@/schema";
import { eq } from "drizzle-orm";
import { logger } from "@/lib/logger";

export async function POST(request: NextRequest) {
  try {
    const { email, password } = await request.json();

    await logger.info("login_attempt", { email });

    if (!email || !password) {
      await logger.warn("login_failed", {
        email,
        reason: "missing_credentials",
      });
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
      await logger.warn("login_failed", { email, reason: "user_not_found" });
      return NextResponse.json(
        { error: "Invalid credentials" },
        { status: 401 }
      );
    }

    const isValidPassword = await bcrypt.compare(password, user[0].password);

    if (!isValidPassword) {
      await logger.warn("login_failed", { email, reason: "invalid_password" });
      return NextResponse.json(
        { error: "Invalid credentials" },
        { status: 401 }
      );
    }

    const cookieStore = cookies();
    cookieStore.set("userId", user[0].id.toString(), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 60 * 60 * 24 * 7, // 1 week
    });

    await logger.info(
      "login_success",
      { email, userId: user[0].id.toString() },
      user[0].id.toString()
    );

    return NextResponse.json({
      message: "Login successful",
      user: { id: user[0].id, name: user[0].name, email: user[0].email },
    });
  } catch (error) {
    await logger.error("login_error", { error: error.message });
    console.error("Login error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
