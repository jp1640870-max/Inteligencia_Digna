import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { createUser, getUserByEmail, getUserByGoogleId, updateUserPicture, updateUserGoogleId } from "@/lib/db";
import { signToken, isUserRole } from "@/lib/auth";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const code = searchParams.get("code");
    const state = searchParams.get("state");
    const cookieStore = await cookies();
    const expectedState = cookieStore.get("google_oauth_state")?.value;
    const verifier = cookieStore.get("google_oauth_verifier")?.value;

    if (!code) return NextResponse.redirect(new URL("/login?error=no_code", req.url));
    if (!state || !expectedState || state !== expectedState || !verifier) {
      return NextResponse.redirect(new URL("/login?error=invalid_state", req.url));
    }

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const origin = process.env.NEXTAUTH_URL || new URL(req.url).origin;
    const redirectUri = `${origin}/api/auth/google/callback`;
    if (!clientId || !clientSecret) return NextResponse.redirect(new URL("/login?error=config_error", req.url));

    const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
        code_verifier: verifier,
      }),
    });
    const tokens = await tokenRes.json() as { access_token?: string };
    if (!tokenRes.ok || !tokens.access_token) return NextResponse.redirect(new URL("/login?error=token_error", req.url));

    const userRes = await fetch(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const googleUser = await userRes.json() as {
      id?: string;
      email?: string;
      name?: string;
      picture?: string;
      verified_email?: boolean;
    };
    if (!userRes.ok || !googleUser.id || !googleUser.email || googleUser.verified_email === false) {
      return NextResponse.redirect(new URL("/login?error=email_required", req.url));
    }

    let user = await getUserByGoogleId(googleUser.id);
    if (!user) {
      const existingByEmail = await getUserByEmail(googleUser.email);
      if (existingByEmail) {
        user = existingByEmail;
        await updateUserGoogleId(user.id, googleUser.id, googleUser.picture || null);
      } else {
        const id = uuidv4();
        await createUser(id, googleUser.email, googleUser.name || null, undefined, googleUser.id, googleUser.picture);
        user = {
          id,
          email: googleUser.email,
          name: googleUser.name || null,
          password_hash: null,
          google_id: googleUser.id,
          picture: googleUser.picture || null,
          role: "user",
          created_at: new Date().toISOString(),
        };
      }
    } else {
      await updateUserPicture(user.id, googleUser.picture || null);
    }

    if (!isUserRole(user.role)) return NextResponse.redirect(new URL("/login?error=server_error", req.url));
    const baseUrl = process.env.NEXTAUTH_URL || new URL(req.url).origin;
    const response = NextResponse.redirect(new URL("/", baseUrl));
    response.cookies.set("token", signToken({ userId: user.id, email: user.email, role: user.role }), {
      httpOnly: true,
      secure: baseUrl.startsWith("https"),
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60,
      path: "/",
    });
    response.cookies.delete("google_oauth_state");
    response.cookies.delete("google_oauth_verifier");
    return response;
  } catch (error) {
    console.error(error);
    return NextResponse.redirect(new URL("/login?error=server_error", req.url));
  }
}
