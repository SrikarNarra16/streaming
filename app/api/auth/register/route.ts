import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { users } from "@/schema";
import { eq } from "drizzle-orm";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { email, password } = body;
    const name = typeof body.name === "string" ? body.name.trim() : body.name;

    if (!name || !email || !password) {
      return NextResponse.json(
        { error: "Name, email, and password are required" },
        { status: 400 }
      );
    }

    if (typeof name !== "string" || name.length < 1 || name.length > 100) {
      return NextResponse.json(
        { error: "Name must be 1 to 100 characters" },
        { status: 400 }
      );
    }
    if (typeof email !== "string" || email.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json(
        { error: "Email address is not valid" },
        { status: 400 }
      );
    }
    if (typeof password !== "string" || password.length < 8) {
      return NextResponse.json(
        { error: "Password must be at least 8 characters" },
        { status: 400 }
      );
    }
    // bcrypt only uses the first 72 bytes of a password, so longer ones are rejected.
    if (new TextEncoder().encode(password).length > 72) {
      return NextResponse.json(
        { error: "Password must be at most 72 bytes" },
        { status: 400 }
      );
    }

    // Check if user already exists
    const existingUser = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (existingUser[0]) {
      return NextResponse.json(
        { error: "User already exists" },
        { status: 400 }
      );
    }

    // Store only the bcrypt hash (cost 12)
    const newUser = await db
      .insert(users)
      .values({
        name,
        email,
        password: await bcrypt.hash(password, 12),
      })
      .returning();

    return NextResponse.json({
      message: "User created successfully",
      user: {
        id: newUser[0].id,
        name: newUser[0].name,
        email: newUser[0].email,
      },
    });
  } catch (error) {
    console.error("Registration error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}