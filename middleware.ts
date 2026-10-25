import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSessionUserId } from "@/lib/session";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow access to auth routes
  if (pathname.startsWith("/api/auth") || pathname.startsWith("/auth")) {
    return NextResponse.next();
  }

  // Check if user is accessing protected routes: the session token must have a valid signature
  if (pathname.startsWith("/streaming")) {
    const userId = await getSessionUserId(request.cookies);

    if (!userId) {
      return NextResponse.redirect(new URL("/auth/login", request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/streaming/:path*"],
};
