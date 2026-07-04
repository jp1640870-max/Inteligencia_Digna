export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { extractText } from "@/lib/file-processor";

export async function POST(req: Request) {

  try {
    const form = await req.formData();
    const filesEntry = form.getAll("files") as File[];
    const results: Array<{ name: string; type: string; content: string; size: number }> = [];

    for (const file of filesEntry) {
      const buffer = Buffer.from(await file.arrayBuffer());
      const content = await extractText(buffer, file.name);
      results.push({
        name: file.name,
        type: file.name.split(".").pop()?.toLowerCase() || "unknown",
        content,
        size: file.size,
      });
    }

    return NextResponse.json({ files: results });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Error al procesar archivos" }, { status: 500 });
  }
}
