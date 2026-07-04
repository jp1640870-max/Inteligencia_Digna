import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json(
      { error: "Google OAuth no configurado" },
      { status: 500 }
    );
  }

  const referer = req.headers.get("referer") || "";
  const refererOrigin = referer ? new URL(referer).origin : "";
  const refererHostname = referer ? new URL(referer).hostname : "";
  const isPrivateIP = /^(127\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.|0\.)/.test(refererHostname);
  const origin = (!refererOrigin || isPrivateIP)
    ? (process.env.NEXTAUTH_URL || "http://localhost:3000")
    : refererOrigin;
  const redirectUri = `${origin}/api/auth/google/callback`;

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    access_type: "offline",
    prompt: "consent",
  });

  return NextResponse.redirect(
    `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
  );
}
