export const runtime = "nodejs";

import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const CHAT_FILE = path.join(process.cwd(), "data", "chats.json");

function ensureFile() {
  const dir = path.dirname(CHAT_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(CHAT_FILE)) fs.writeFileSync(CHAT_FILE, "[]");
}

function readChats() {
  ensureFile();
  try {
    return JSON.parse(fs.readFileSync(CHAT_FILE, "utf8"));
  } catch {
    return [];
  }
}

function saveChats(data: any) {
  ensureFile();
  fs.writeFileSync(CHAT_FILE, JSON.stringify(data, null, 2));
}

/* =========================
   GET - OBLIGATORIO JSON
========================= */
export async function GET() {
  try {
    const chats = readChats();
    return NextResponse.json(chats);
  } catch (e) {
    console.error("GET ERROR:", e);
    return NextResponse.json([]);
  }
}

/* =========================
   POST CHAT + QWEN3-VL
========================= */
export async function POST(req: Request) {
  try {
    const form = await req.formData();

    const chatId = (form.get("chatId") as string) || crypto.randomUUID();
    const message = (form.get("message") as string) || "";
    const image = form.get("image") as string | null;

    const model = image ? "qwen3-vl:4b" : "qwen:7b";

    const ollama = await fetch("http://localhost:11434/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt: message,
        images: image ? [image.split(",")[1]] : [],
        stream: false,
      }),
    });

    const text = await ollama.text();

    let reply = "";
    try {
      reply = JSON.parse(text).response || "";
    } catch {
      reply = "Error parseando respuesta";
    }

    const chats = readChats();

    const chat = chats.find((c: any) => c.id === chatId);

    const userMsg = { role: "user", text: message, image };
    const aiMsg = { role: "ai", text: reply };

    if (chat) {
      chat.messages.push(userMsg, aiMsg);
    } else {
      chats.unshift({
        id: chatId,
        title: message.slice(0, 30) || "Nuevo chat",
        messages: [userMsg, aiMsg],
      });
    }

    saveChats(chats);

    return NextResponse.json({ reply });

  } catch (e) {
    console.error("POST ERROR:", e);
    return NextResponse.json({ reply: "error server" });
  }
}