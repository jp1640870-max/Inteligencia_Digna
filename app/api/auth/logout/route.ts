import { NextResponse } from "next/server";
import { getPublicOrigin } from "@/lib/public-url";

export async function GET(req: Request) {
  const response = NextResponse.redirect(new URL("/login", getPublicOrigin(req)));

  response.cookies.set("token", "", {
    httpOnly: true,
    maxAge: 0,
    path: "/",
  });

  return response;
}
