import { NextResponse } from "next/server";
import { getActiveAnnouncements } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const announcements = getActiveAnnouncements();
    return NextResponse.json({ announcements });
  } catch {
    return NextResponse.json({ announcements: [] });
  }
}
