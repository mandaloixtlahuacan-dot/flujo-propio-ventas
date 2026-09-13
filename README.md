# Flujo Propio — Bot de Ventas (WhatsApp)

Bot comercial: **Whapi → Vercel webhook → OpenAI (prompt de ventas) → Supabase leads → reply Whapi**.

Repo: `mandaloixtlahuacan-dot/flujo-propio-ventas`

## Qué incluye

| Pieza | Rol |
|-------|-----|
| `app/api/webhook/route.ts` | Secret, Mexico JID, fromMe, dedupe, leads, LLM, reply, notify admin |
| `config/system-prompt.ts` | `SALES_SYSTEM_PROMPT` (vendedor Flujo Propio) |
| `lib/supabase.ts` | Cliente service-role (server only) |
| `lib/leads.ts` | Upsert lead, history metadata, hot keywords, events |
| `lib/whapi.ts` | `sendText` |
| `lib/mexicoJid.ts` | Normaliza a `521…@s.whatsapp.net` |
| `app/admin/page.tsx` | Lista leads si `?secret=` = `DASHBOARD_SECRET` |
| `supabase/migrations/0001_leads.sql` | Tablas `leads` y `lead_events` |

## Variables de entorno

Copia `.env.example` → `.env.local` (nunca commits de secretos reales):

```bash
WHAPI_TOKEN=
WHAPI_BASE_URL=https://gate.whapi.cloud
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o-mini
WEBHOOK_SECRET=
BOT_ADMIN_PHONE=5213310184790
SUPABASE_URL=https://glxhkvjeyhxqedxfpswl.supabase.co
SUPABASE_SERVICE_ROLE_KEY=
DASHBOARD_SECRET=
```

## Auth del webhook

1. Preferido: header `x-bot-webhook-secret: <WEBHOOK_SECRET>`
2. Fallback: `?secret=<WEBHOOK_SECRET>`

Sin `WEBHOOK_SECRET` → 401.

## Deploy

1. Aplica `supabase/migrations/0001_leads.sql` en el proyecto Supabase.
2. Deploy en Vercel con las env vars.
3. En Whapi: webhook POST a `https://<proyecto>.vercel.app/api/webhook`, eventos `messages` / `messages.post`, `callback_persist` on.
4. Smoke: `GET /api/health` (booleans de env, nunca valores).

## Hot leads

Si el texto del cliente o la reply del bot contiene: transferencia, CLABE, videollamada, anticipo, depósito, "quiero el paquete" → etapa `waiting_transfer` o `waiting_call` + notify a `BOT_ADMIN_PHONE`.

## Local

```bash
cp .env.example .env.local
npm install
npm run build
npm run dev
```
