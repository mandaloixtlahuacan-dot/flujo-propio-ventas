import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * One-shot: configure Whapi webhook from Vercel egress (box IP is CF-blocked).
 * Auth: ?secret= or header x-setup-secret matching DASHBOARD_SECRET or WEBHOOK_SECRET.
 */
export async function POST(req: NextRequest) {
  const expected =
    process.env.DASHBOARD_SECRET?.trim() ||
    process.env.WEBHOOK_SECRET?.trim() ||
    "";
  if (!expected) {
    return NextResponse.json({ ok: false, error: "no setup secret" }, { status: 500 });
  }
  const got =
    req.headers.get("x-setup-secret") ||
    req.nextUrl.searchParams.get("secret") ||
    "";
  if (got !== expected) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const token = process.env.WHAPI_TOKEN?.trim();
  const webhookSecret = process.env.WEBHOOK_SECRET?.trim();
  if (!token || !webhookSecret) {
    return NextResponse.json(
      { ok: false, error: "missing WHAPI_TOKEN or WEBHOOK_SECRET" },
      { status: 500 },
    );
  }

  const base =
    (process.env.WHAPI_BASE_URL || "https://gate.whapi.cloud").replace(/\/$/, "");
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
        ],
      },
    ],
  };

  const res = await fetch(`${base}/settings`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text().catch(() => "");
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { raw_len: text.length };
  }

  return NextResponse.json(
    {
      ok: res.ok,
      status: res.status,
      webhook_host: host,
      webhook_path: "/api/webhook?secret=***",
      whapi: parsed,
    },
    { status: res.ok ? 200 : 502 },
  );
}
