-- Persistência do IMPÉRIO GAMECLOUD no Supabase
-- Execute este script uma única vez no SQL Editor do seu projeto Supabase.

create table if not exists public.gamecloud_state (
  id integer primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.gamecloud_state enable row level security;

revoke all on table public.gamecloud_state from anon;
revoke all on table public.gamecloud_state from authenticated;

grant all on table public.gamecloud_state to service_role;
