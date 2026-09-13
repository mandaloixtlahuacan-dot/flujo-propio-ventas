import { getSupabase, hasSupabaseEnv } from "./supabase";

export type ChatTurn = { role: "user" | "assistant"; content: string };

export type LeadStage =
  | "new"
  | "qualifying"
  | "offered"
  | "waiting_transfer"
  | "waiting_call"
  | "won"
  | "nurture"
  | "lost";

export type LeadRow = {
  id: string;
  wa_jid: string;
  phone?: string | null;
  name?: string | null;
  stage?: string | null;
  summary?: string | null;
  interest_package?: string | null;
  next_followup_at?: string | null;
  metadata?: Record<string, unknown> | null;
  updated_at?: string | null;
  created_at?: string | null;
};

const HOT_KEYWORDS = [
  "transferencia",
  "clabe",
  "videollamada",
  "anticipo",
  "depósito",
  "deposito",
  "quiero el paquete",
];

const PACKAGE_HINTS: { re: RegExp; name: string }[] = [
  { re: /agente\s+personal|paquete\s+personal/i, name: "Agente Personal" },
  { re: /citas\s*&\s*equipo|citas y equipo|paquete\s+citas/i, name: "Citas & Equipo" },
  { re: /flujo\s+negocio|paquete\s+negocio/i, name: "Flujo Negocio" },
  { re: /sistema\s+empresa|paquete\s+empresa/i, name: "Sistema Empresa" },
];

export function detectHotSignals(text: string): {
  hot: boolean;
  stage?: LeadStage;
  interestPackage?: string;
} {
  const lower = (text || "").toLowerCase();
  const hot = HOT_KEYWORDS.some((k) => lower.includes(k.toLowerCase()));

  let stage: LeadStage | undefined;
  if (
    lower.includes("videollamada") ||
    lower.includes("video llamada") ||
    lower.includes("llamada con víctor") ||
    lower.includes("llamada con victor")
  ) {
    stage = "waiting_call";
  } else if (
    lower.includes("transferencia") ||
    lower.includes("clabe") ||
    lower.includes("anticipo") ||
    lower.includes("depósito") ||
    lower.includes("deposito") ||
    lower.includes("quiero el paquete")
  ) {
    stage = "waiting_transfer";
  }

  let interestPackage: string | undefined;
  for (const h of PACKAGE_HINTS) {
    if (h.re.test(text)) {
      interestPackage = h.name;
      break;
    }
  }

  return { hot, stage, interestPackage };
}

function phoneFromJid(waJid: string): string {
  return waJid.split("@")[0].replace(/\D/g, "");
}

/** Upsert lead by wa_jid; returns lead id (or null if supabase unavailable). */
export async function upsertLead(params: {
  waJid: string;
  patch?: {
    stage?: string;
    summary?: string;
    interest_package?: string;
    next_followup_at?: string | null;
    name?: string;
  };
  appendHistory?: ChatTurn[];
}): Promise<string | null> {
  if (!hasSupabaseEnv()) {
    console.warn("[leads] supabase env missing — skip upsert");
    return null;
  }

  const sb = getSupabase();
  const wa_jid = params.waJid;
  const phone = phoneFromJid(wa_jid);

  const { data: existing, error: selErr } = await sb
    .from("leads")
    .select("id, metadata, stage, summary, interest_package")
    .eq("wa_jid", wa_jid)
    .maybeSingle();

  if (selErr) {
    console.error("[leads] select error:", selErr.message);
  }

  const prevMeta =
    (existing?.metadata as Record<string, unknown> | null) || {};
  const prevHistory = Array.isArray(prevMeta.history)
    ? (prevMeta.history as ChatTurn[])
    : [];

  let history = prevHistory;
  if (params.appendHistory?.length) {
    history = [...prevHistory, ...params.appendHistory].slice(-16);
  }

  const lastSummary =
    params.patch?.summary ||
    (history.length
      ? history
          .slice(-4)
          .map((t) => `${t.role}: ${t.content.slice(0, 120)}`)
          .join(" | ")
      : existing?.summary || null);

  const row: Record<string, unknown> = {
    wa_jid,
    phone,
    updated_at: new Date().toISOString(),
    metadata: { ...prevMeta, history, last_messages_summary: lastSummary },
  };

  if (params.patch?.stage) row.stage = params.patch.stage;
  else if (!existing) row.stage = "new";

  if (params.patch?.summary !== undefined) row.summary = params.patch.summary;
  else if (lastSummary) row.summary = lastSummary;

  if (params.patch?.interest_package)
    row.interest_package = params.patch.interest_package;
  if (params.patch?.next_followup_at !== undefined)
    row.next_followup_at = params.patch.next_followup_at;
  if (params.patch?.name) row.name = params.patch.name;

  if (params.appendHistory?.length) {
    const last = params.appendHistory[params.appendHistory.length - 1];
    if (last?.role === "user") row.last_inbound_at = new Date().toISOString();
    if (last?.role === "assistant") row.last_outbound_at = new Date().toISOString();
    for (const t of params.appendHistory) {
      if (t.role === "user") row.last_inbound_at = new Date().toISOString();
      if (t.role === "assistant") row.last_outbound_at = new Date().toISOString();
    }
  }

  if (existing?.id) {
    const { error } = await sb.from("leads").update(row).eq("id", existing.id);
    if (error) {
      console.error("[leads] update error:", error.message);
      return existing.id;
    }
    return existing.id as string;
  }

  row.created_at = new Date().toISOString();
  const { data: inserted, error: insErr } = await sb
    .from("leads")
    .insert(row)
    .select("id")
    .maybeSingle();

  if (insErr) {
    console.error("[leads] insert error:", insErr.message);
    return null;
  }
  return (inserted?.id as string) || null;
}

export async function appendLeadEvent(params: {
  leadId: string | null;
  waJid: string;
  kind: "inbound" | "outbound" | "notify_admin" | "stage_change" | string;
  body?: string;
  meta?: Record<string, unknown>;
}): Promise<void> {
  if (!hasSupabaseEnv() || !params.leadId) return;

  const sb = getSupabase();
  const { error } = await sb.from("lead_events").insert({
    lead_id: params.leadId,
    event_type: params.kind,
    payload: {
      wa_jid: params.waJid,
      body: params.body?.slice(0, 4000) || null,
      ...(params.meta || {}),
    },
    created_at: new Date().toISOString(),
  });
  if (error) console.error("[leads] event error:", error.message);
}

export async function getLeadHistory(waJid: string): Promise<ChatTurn[]> {
  if (!hasSupabaseEnv()) return [];
  const sb = getSupabase();
  const { data, error } = await sb
    .from("leads")
    .select("metadata")
    .eq("wa_jid", waJid)
    .maybeSingle();
  if (error || !data) return [];
  const meta = (data.metadata as Record<string, unknown>) || {};
  const history = Array.isArray(meta.history) ? (meta.history as ChatTurn[]) : [];
  return history.slice(-8);
}

export async function listRecentLeads(limit = 30): Promise<LeadRow[]> {
  if (!hasSupabaseEnv()) return [];
  const sb = getSupabase();
  const { data, error } = await sb
    .from("leads")
    .select(
      "id, wa_jid, phone, name, stage, summary, interest_package, next_followup_at, metadata, updated_at, created_at",
    )
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.error("[leads] list error:", error.message);
    return [];
  }
  return (data || []) as LeadRow[];
}
