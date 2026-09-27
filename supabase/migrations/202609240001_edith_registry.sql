create extension if not exists pgcrypto;

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  email text,
  avatar_url text,
  last_login_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.devices (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text,
  platform text,
  app_version text,
  workspace_id text,
  last_seen_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspaces (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id text,
  label text,
  local_path text,
  vault_path text,
  portable_mode boolean not null default false,
  layout_version integer not null default 1,
  sync_mode text not null default 'metadata_only' check (sync_mode = 'metadata_only'),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_settings (
  user_id uuid not null references auth.users(id) on delete cascade,
  key text not null,
  value jsonb not null default 'null'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);

create table if not exists public.conversation_metadata (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id text,
  title text,
  provider_id text,
  model_id text,
  message_count integer not null default 0 check (message_count >= 0),
  last_message_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.skill_metadata (
  user_id uuid not null references auth.users(id) on delete cascade,
  skill_id text not null,
  enabled boolean not null default true,
  version text,
  configuration_state text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, skill_id)
);

create table if not exists public.session_metadata (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id text,
  workspace_id text,
  state text not null default 'active',
  started_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  ended_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.sync_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id text,
  workspace_id text,
  entity_type text not null,
  entity_id text,
  operation text not null,
  state text not null default 'pending',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists devices_user_id_idx on public.devices(user_id);
create index if not exists workspaces_user_id_idx on public.workspaces(user_id);
create index if not exists conversations_user_id_idx on public.conversation_metadata(user_id);
create index if not exists sync_events_user_created_idx on public.sync_events(user_id, created_at desc);
create index if not exists sessions_user_last_seen_idx on public.session_metadata(user_id, last_seen_at desc);

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at before update on public.profiles for each row execute function public.set_updated_at();
drop trigger if exists devices_set_updated_at on public.devices;
create trigger devices_set_updated_at before update on public.devices for each row execute function public.set_updated_at();
drop trigger if exists workspaces_set_updated_at on public.workspaces;
create trigger workspaces_set_updated_at before update on public.workspaces for each row execute function public.set_updated_at();
drop trigger if exists settings_set_updated_at on public.user_settings;
create trigger settings_set_updated_at before update on public.user_settings for each row execute function public.set_updated_at();
drop trigger if exists conversations_set_updated_at on public.conversation_metadata;
create trigger conversations_set_updated_at before update on public.conversation_metadata for each row execute function public.set_updated_at();
drop trigger if exists skills_set_updated_at on public.skill_metadata;
create trigger skills_set_updated_at before update on public.skill_metadata for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.devices enable row level security;
alter table public.workspaces enable row level security;
alter table public.user_settings enable row level security;
alter table public.conversation_metadata enable row level security;
alter table public.skill_metadata enable row level security;
alter table public.session_metadata enable row level security;
alter table public.sync_events enable row level security;

do $$
declare table_name text;
begin
  foreach table_name in array array['profiles', 'devices', 'workspaces', 'user_settings', 'conversation_metadata', 'skill_metadata', 'session_metadata', 'sync_events']
  loop
    execute format('drop policy if exists %I on public.%I', table_name || '_own_rows', table_name);
    execute format(
      'create policy %I on public.%I for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)',
      table_name || '_own_rows', table_name
    );
  end loop;
end $$;

revoke all on all tables in schema public from anon;
grant select, insert, update, delete on public.profiles, public.devices, public.workspaces,
  public.user_settings, public.conversation_metadata, public.skill_metadata, public.session_metadata, public.sync_events to authenticated;
