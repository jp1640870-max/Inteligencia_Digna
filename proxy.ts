import { NextResponse } from "next/server";

export function proxy() {
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/",
    "/login",
    "/((?!_next/static|_next/image|favicon.ico|logo.png|.*\\.svg|api/.*).*)",
  ],
};
