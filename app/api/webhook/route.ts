import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { SALES_SYSTEM_PROMPT } from "@/config/system-prompt";
import { markSeen } from "@/lib/dedupe";
import {
  appendLeadEvent,
  detectHotSignals,
  getLeadHistory,
  upsertLead,
  type ChatTurn,
} from "@/lib/leads";
import { toMexicoWhatsappJid } from "@/lib/mexicoJid";
import { sendText } from "@/lib/whapi";

export const runtime = "nodejs";
export const maxDuration = 60;

type WhapiMessage = {
  id?: string;
  from_me?: boolean;
  fromMe?: boolean;
  chat_id?: string;
  from?: string;
  type?: string;
  text?: { body?: string } | string;
  body?: string;
  location?: { latitude?: number; longitude?: number; caption?: string };
};

function verifySecret(req: NextRequest): boolean {
  const expected = process.env.WEBHOOK_SECRET || "";
  if (!expected) {
    console.warn("[bot] WEBHOOK_SECRET missing — rejecting webhook");
    return false;
  }
  const header =
    req.headers.get("x-bot-webhook-secret") ||
    req.headers.get("X-Bot-Webhook-Secret") ||
    "";
  const query = req.nextUrl.searchParams.get("secret") || "";
  return header === expected || query === expected;
}

function extractText(msg: WhapiMessage & Record<string, unknown>): string | null {
  // location / live_location
  const loc = (msg.location || msg.live_location) as
    | { latitude?: number; longitude?: number; caption?: string }
    | undefined;
  if (msg.type === "location" || msg.type === "live_location" || loc) {
    if (loc?.latitude == null || loc.longitude == undefined) return null;
    const caption = (loc.caption || "").trim();
    const parts = [
      "[El cliente compartió ubicación GPS]",
      `Lat: ${loc.latitude}, Lng: ${loc.longitude}`,
      `Maps: https://maps.google.com/?q=${loc.latitude},${loc.longitude}`,
    ];
    if (caption) parts.push(`Caption: ${caption}`);
    return parts.join("\n");
  }

  if (typeof msg.text === "string" && msg.text.trim()) return msg.text.trim();
  if (msg.text && typeof msg.text === "object" && msg.text.body?.trim()) {
    return msg.text.body.trim();
  }
  if (typeof msg.body === "string" && msg.body.trim()) return msg.body.trim();

  // Whapi variants
  const content = msg.content;
  if (typeof content === "string" && content.trim()) return content.trim();
  if (content && typeof content === "object") {
    const c = content as Record<string, unknown>;
    if (typeof c.body === "string" && c.body.trim()) return c.body.trim();
    if (typeof c.text === "string" && c.text.trim()) return c.text.trim();
    if (c.text && typeof c.text === "object") {
      const t = c.text as { body?: string };
      if (t.body?.trim()) return t.body.trim();
    }
  }

  const caption = msg.caption;
  if (typeof caption === "string" && caption.trim()) {
    return `[Adjunto ${msg.type || "media"}] ${caption.trim()}`;
  }

  // button / list reply
  const btn = msg.button_reply || msg.list_reply || msg.interactive;
  if (btn && typeof btn === "object") {
    const b = btn as Record<string, unknown>;
    const title = [b.title, b.description, b.id]
      .filter((x) => typeof x === "string" && (x as string).trim())
      .join(" — ");
    if (title) return title;
  }

  return null;
}

function collectMessages(payload: unknown): WhapiMessage[] {
  if (!payload || typeof payload !== "object") return [];
  const p = payload as Record<string, unknown>;

  if (Array.isArray(p.messages)) {
    return p.messages.filter((m): m is WhapiMessage => !!m && typeof m === "object");
  }

  if (p.message && typeof p.message === "object") {
    return [p.message as WhapiMessage];
  }
  if (p.data && typeof p.data === "object") {
    const d = p.data as Record<string, unknown>;
    if (Array.isArray(d.messages)) {
      return d.messages.filter(
        (m): m is WhapiMessage => !!m && typeof m === "object",
      );
    }
  }
  return [];
}

function adminJid(): string | null {
  const raw = (process.env.BOT_ADMIN_PHONE || "").trim();
  if (!raw) return null;
  try {
    return toMexicoWhatsappJid(raw);
  } catch {
    return raw.includes("@") ? raw : `${raw}@s.whatsapp.net`;
  }
}

async function generateReply(
  userText: string,
  history: ChatTurn[],
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");

  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const client = new OpenAI({ apiKey });

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: SALES_SYSTEM_PROMPT },
    ...history.slice(-8).map((t) => ({
      role: t.role as "user" | "assistant",
      content: t.content,
    })),
    { role: "user", content: userText },
  ];

  const completion = await client.chat.completions.create({
    model,
    temperature: 0.65,
    messages,
  });

  const reply = (completion.choices[0]?.message?.content || "").trim();
  return (
    reply ||
    "Gracias por escribirnos. En un momento te atendemos. ¿Qué negocio tienes y cómo usas WhatsApp hoy?"
  );
}

async function maybeNotifyAdmin(params: {
  toJid: string;
  userText: string;
  reply: string;
  stage?: string;
  interestPackage?: string;
  leadId: string | null;
}): Promise<void> {
  const signals = detectHotSignals(params.userText);
  if (!signals.hot && !params.stage) return;

  const stage =
    params.stage ||
    signals.stage ||
    "waiting_transfer";

  const interest =
    params.interestPackage || signals.interestPackage || "sin definir";

  const admin = adminJid();
  if (!admin) {
    console.warn("[bot] BOT_ADMIN_PHONE missing — skip notify");
    return;
  }

  const summary = [
    "Lead caliente — Flujo Propio ventas",
    `Cliente JID: ${params.toJid}`,
    `Etapa: ${stage}`,
    `Paquete interés: ${interest}`,
    `Cliente dijo: ${params.userText.slice(0, 280)}`,
    `Bot: ${params.reply.slice(0, 280)}`,
  ].join("\n");

  try {
    await sendText(admin, summary);
    await appendLeadEvent({
      leadId: params.leadId,
      waJid: params.toJid,
      kind: "notify_admin",
      body: summary,
      meta: { stage, interest },
    });
    console.info("[bot] notified admin for %s stage=%s", params.toJid, stage);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[bot] admin notify failed:", message);
  }
}

async function processMessage(msg: WhapiMessage): Promise<void> {
  const msgId = msg.id || "";
  if (!markSeen(msgId)) {
    console.info("[bot] DUPLICATE_MESSAGE id=%s", msgId);
    return;
  }

  const fromMe = msg.from_me === true || msg.fromMe === true;
  if (fromMe) {
    console.info("[bot] ignore fromMe id=%s", msgId);
    return;
  }

  const chatId = msg.chat_id || msg.from;
  if (!chatId) {
    console.warn("[bot] message without chat_id/from id=%s", msgId);
    return;
  }

  const text = extractText(msg as WhapiMessage & Record<string, unknown>);
  if (!text) {
    const keys = Object.keys(msg as object).slice(0, 20).join(",");
    console.info(
      "[bot] ignore non-text type=%s id=%s keys=%s",
      msg.type || "unknown",
      msgId,
      keys,
    );
    return;
  }

  let toJid: string;
  try {
    toJid = toMexicoWhatsappJid(chatId);
  } catch {
    toJid = chatId.includes("@") ? chatId : `${chatId}@s.whatsapp.net`;
  }

  console.info(
    "[bot] inbound id=%s to=%s chars=%s",
    msgId,
    toJid,
    text.length,
  );

  const inboundSignals = detectHotSignals(text);
  let leadId = await upsertLead({
    waJid: toJid,
    patch: {
      stage: inboundSignals.stage || "qualifying",
      interest_package: inboundSignals.interestPackage,
      summary: text.slice(0, 500),
    },
  });

  await appendLeadEvent({
    leadId,
    waJid: toJid,
    kind: "inbound",
    body: text,
    meta: { message_id: msgId },
  });

  const history = await getLeadHistory(toJid);
  const reply = await generateReply(text, history);

  await sendText(toJid, reply);
  console.info("[bot] replied id=%s chars=%s", msgId, reply.length);

  const outboundSignals = detectHotSignals(`${text}\n${reply}`);
  const stage = outboundSignals.stage || inboundSignals.stage || undefined;
  const interestPackage =
    outboundSignals.interestPackage || inboundSignals.interestPackage;

  leadId = await upsertLead({
    waJid: toJid,
    patch: {
      stage: stage || "qualifying",
      interest_package: interestPackage,
      summary: `user: ${text.slice(0, 200)} | bot: ${reply.slice(0, 200)}`,
    },
    appendHistory: [
      { role: "user", content: text },
      { role: "assistant", content: reply },
    ],
  });

  await appendLeadEvent({
    leadId,
    waJid: toJid,
    kind: "outbound",
    body: reply,
    meta: { message_id: msgId },
  });

  if (stage) {
    await appendLeadEvent({
      leadId,
      waJid: toJid,
      kind: "stage_change",
      body: stage,
    });
  }

  // Notify only on clear customer intent — never because the bot said "videollamada".
  // Skip when the chatter IS the admin (self-test from Víctor's phone).
  const admin = adminJid();
  const isSelfTest = Boolean(admin && toJid === admin);
  if (inboundSignals.hot && !isSelfTest) {
    await maybeNotifyAdmin({
      toJid,
      userText: text,
      reply,
      stage: inboundSignals.stage || stage,
      interestPackage,
      leadId,
    });
  } else if (isSelfTest) {
    console.info("[bot] skip admin notify — self-test from admin JID");
  }
}

export async function POST(req: NextRequest) {
  if (!verifySecret(req)) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 },
    );
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid json" },
      { status: 400 },
    );
  }

  const messages = collectMessages(payload);
  if (messages.length === 0) {
    const p = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
    console.info(
      "[bot] no messages in payload keys=%s event=%s",
      Object.keys(p).slice(0, 15).join(","),
      String(p.event_type || p.event || p.type || ""),
    );
    return NextResponse.json({ ok: true, ignored: true });
  }

  const errors: string[] = [];
  for (const msg of messages) {
    try {
      await processMessage(msg);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[bot] process error:", message);
      errors.push(message);
    }
  }

  return NextResponse.json({
    ok: true,
    processed: messages.length,
    errors: errors.length ? errors.length : undefined,
  });
}

export async function GET(req: NextRequest) {
  if (!verifySecret(req)) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 },
    );
  }
  return NextResponse.json({
    ok: true,
    service: "flujo-propio-ventas",
    hint: "Webhook listo. Configura Whapi POST a esta URL con eventos messages / messages.post.",
  });
}
