import { NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { createUser, getUserByEmail, getUserByGoogleId, updateUserPicture, updateUserGoogleId } from "@/lib/db";
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
    const redirectUri = `${new URL(req.url).origin}/api/auth/google/callback`;

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
        updateUserGoogleId(user.id, googleUser.id, googleUser.picture || null);
      } else {
        const id = uuidv4();
        createUser(
          id,
          googleUser.email,
          googleUser.name || null,
          undefined,
          googleUser.id,
          googleUser.picture
        );
        user = { id, email: googleUser.email, name: googleUser.name };
      }
    } else {
      updateUserPicture(user.id, googleUser.picture || null);
    }

    const userRole = user.role || "user";
    const token = signToken({ userId: user.id, email: user.email, role: userRole });

    const baseUrl = new URL(req.url).origin;
    const response = NextResponse.redirect(new URL("/", baseUrl));

    response.cookies.set("token", token, {
      httpOnly: true,
      secure: baseUrl.startsWith("https"),
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
