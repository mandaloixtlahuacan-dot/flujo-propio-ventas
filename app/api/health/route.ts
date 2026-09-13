import { NextResponse } from "next/server";

export const runtime = "nodejs";

function flag(name: string): boolean {
  return Boolean(process.env[name]?.trim());
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "flujo-propio-ventas",
    env: {
      WHAPI_TOKEN: flag("WHAPI_TOKEN"),
      OPENAI_API_KEY: flag("OPENAI_API_KEY"),
      WEBHOOK_SECRET: flag("WEBHOOK_SECRET"),
      SUPABASE_URL: flag("SUPABASE_URL"),
      SUPABASE_SERVICE_ROLE_KEY: flag("SUPABASE_SERVICE_ROLE_KEY"),
      BOT_ADMIN_PHONE: flag("BOT_ADMIN_PHONE"),
      DASHBOARD_SECRET: flag("DASHBOARD_SECRET"),
    },
    model: process.env.OPENAI_MODEL || "gpt-4o-mini",
  });
}
