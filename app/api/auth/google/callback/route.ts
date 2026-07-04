import { NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { createUser, getUserByEmail, getUserByGoogleId } from "@/lib/db";
import { signToken } from "@/lib/auth";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const code = searchParams.get("code");

    if (!code) {
      return NextResponse.redirect(
        new URL("/login?error=no_code", req.url)
      );
    }

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const url = new URL(req.url);
    const isPrivateIP = /^(127\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.|0\.)/.test(url.hostname);
    const origin = isPrivateIP
      ? (process.env.NEXTAUTH_URL || "http://localhost:3000")
      : url.origin;
    const redirectUri = `${origin}/api/auth/google/callback`;

    if (!clientId || !clientSecret) {
      return NextResponse.redirect(
        new URL("/login?error=config_error", req.url)
      );
    }

    const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    const tokens = await tokenRes.json();

    if (!tokens.access_token) {
      return NextResponse.redirect(
        new URL("/login?error=token_error", req.url)
      );
    }

    const userRes = await fetch(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    const googleUser = await userRes.json();

    if (!googleUser.email) {
      return NextResponse.redirect(
        new URL("/login?error=email_required", req.url)
      );
    }

    let user = getUserByGoogleId(googleUser.id);

    if (!user) {
      const existingByEmail = getUserByEmail(googleUser.email);
      if (existingByEmail) {
        user = existingByEmail;
      } else {
        const id = uuidv4();
        createUser(
          id,
          googleUser.email,
          googleUser.name || null,
          undefined,
          googleUser.id
        );
        user = { id, email: googleUser.email, name: googleUser.name };
      }
    }

    const token = signToken({ userId: user.id, email: user.email });

    const response = NextResponse.redirect(
      new URL("/", req.url)
    );

    response.cookies.set("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60,
      path: "/",
    });

    return response;
  } catch (e) {
    console.error(e);
    return NextResponse.redirect(
      new URL("/login?error=server_error", req.url)
    );
  }
}
