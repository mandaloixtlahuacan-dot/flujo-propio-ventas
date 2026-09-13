-- Flujo Propio ventas — leads + events
create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  wa_jid text not null unique,
  phone text,
  name text,
  stage text default 'new',
  summary text,
  interest_package text,
  next_followup_at timestamptz,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists leads_updated_at_idx on public.leads (updated_at desc);
create index if not exists leads_stage_idx on public.leads (stage);

create table if not exists public.lead_events (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.leads (id) on delete cascade,
  wa_jid text,
  kind text not null,
  body text,
  meta jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

create index if not exists lead_events_lead_id_idx on public.lead_events (lead_id);
create index if not exists lead_events_created_at_idx on public.lead_events (created_at desc);
