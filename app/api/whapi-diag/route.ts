import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 30;

function authorized(req: NextRequest): boolean {
  const expected =
    process.env.DASHBOARD_SECRET?.trim() ||
    process.env.WEBHOOK_SECRET?.trim() ||
    "";
  if (!expected) return false;
  const got =
    req.headers.get("x-setup-secret") ||
    req.nextUrl.searchParams.get("secret") ||
    "";
  return got === expected;
}

function base(): string {
  return (process.env.WHAPI_BASE_URL || "https://gate.whapi.cloud").replace(
    /\/$/,
    "",
  );
}

function token(): string {
  return process.env.WHAPI_TOKEN?.trim() || "";
}

async function whapi(path: string, init?: RequestInit) {
  const res = await fetch(`${base()}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token()}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
  const text = await res.text().catch(() => "");
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw_len: text.length, preview: text.slice(0, 120) };
  }
  return { status: res.status, ok: res.ok, json };
}

function redact(settings: any) {
  if (!settings || typeof settings !== "object") return settings;
  const copy = JSON.parse(JSON.stringify(settings));
  const hooks = copy.webhooks || copy.after_update?.webhooks || [];
  const list = Array.isArray(hooks) ? hooks : [];
  for (const h of list) {
    if (h?.url && typeof h.url === "string") {
      h.url = h.url.replace(/secret=[^&]+/i, "secret=***");
    }
  }
  return copy;
}

/** GET: channel settings + health probes (no secrets). */
export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (!token()) {
    return NextResponse.json({ ok: false, error: "no WHAPI_TOKEN" }, { status: 500 });
  }

  const settings = await whapi("/settings");
  const health = await whapi("/health");
  const status = await whapi("/status");
  const users = await whapi("/users/login");

  return NextResponse.json({
    ok: true,
    settings: { status: settings.status, body: redact(settings.json) },
    health: { status: health.status, body: health.json },
    channel_status: { status: status.status, body: status.json },
    users_login: { status: users.status, body: users.json },
  });
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (!token()) {
    return NextResponse.json({ ok: false, error: "no WHAPI_TOKEN" }, { status: 500 });
  }

  const action = req.nextUrl.searchParams.get("action") || "ping";

  if (action === "resubscribe") {
    const webhookSecret = process.env.WEBHOOK_SECRET?.trim();
    if (!webhookSecret) {
      return NextResponse.json({ ok: false, error: "no WEBHOOK_SECRET" }, { status: 500 });
    }
    const host =
      req.headers.get("x-forwarded-host") ||
      req.headers.get("host") ||
      "flujo-propio-ventas-mandalo.vercel.app";
    const proto = req.headers.get("x-forwarded-proto") || "https";
    const webhookUrl = `${proto}://${host}/api/webhook?secret=${webhookSecret}`;
    const body = {
      callback_persist: true,
      webhooks: [
        {
          mode: "body",
          url: webhookUrl,
          events: [
            { type: "messages", method: "post" },
            { type: "messages", method: "put" },
            { type: "messages", method: "patch" },
            { type: "statuses", method: "post" },
          ],
        },
      ],
    };
    const patched = await whapi("/settings", {
      method: "PATCH",
      body: JSON.stringify(body),
    });
    return NextResponse.json({
      ok: patched.ok,
      action,
      webhook_host: host,
      whapi: redact(patched.json),
      status: patched.status,
    });
  }

  const admin = (process.env.BOT_ADMIN_PHONE || "").trim() || "5213310184790";
  const to = admin.includes("@") ? admin : `${admin.replace(/\D/g, "")}@s.whatsapp.net`;
  const send = await whapi("/messages/text", {
    method: "POST",
    body: JSON.stringify({
      to,
      body: "Flujo Propio diag: outbound Whapi OK desde Vercel. Si ves esto, el canal sí puede enviar; el problema es inbound/webhook.",
    }),
  });
  return NextResponse.json({
    ok: send.ok,
    action: "ping",
    to_suffix: to.slice(-8),
    status: send.status,
    whapi: send.json,
  });
}
