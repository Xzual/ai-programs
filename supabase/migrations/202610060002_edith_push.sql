-- Tokens are AES-GCM encrypted by the Edge Function. Browser/client roles have no access.
create table if not exists public.edith_push_registrations (
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id text not null references public.devices(id) on delete cascade,
  provider text not null default 'fcm' check (provider = 'fcm'),
  ciphertext text not null,
  iv text not null,
  version uuid not null default gen_random_uuid(),
  revoked_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, device_id)
);
create table if not exists public.edith_push_attempts (
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id text not null,
  event_id text not null,
  fingerprint text not null,
  state text not null check (state in ('sending','accepted','unknown','retry_wait','rejected')),
  attempt_id uuid not null default gen_random_uuid(),
  receipt_id text,
  retry_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, device_id, event_id)
);
alter table public.edith_push_registrations enable row level security;
alter table public.edith_push_attempts enable row level security;
revoke all on public.edith_push_registrations, public.edith_push_attempts from public, anon, authenticated;
grant select, insert, update, delete on public.edith_push_registrations, public.edith_push_attempts to service_role;

create or replace function public.edith_push_register(p_user_id uuid, p_device_id text, p_ciphertext text, p_iv text, p_revoke boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.devices where id=p_device_id and user_id=p_user_id and platform='android') then
    raise exception using message='DEVICE_NOT_AUTHORIZED', errcode='42501';
  end if;
  if p_revoke then
    update public.edith_push_registrations set revoked_at=now(), updated_at=now() where user_id=p_user_id and device_id=p_device_id;
    return jsonb_build_object('registered',false,'revoked',true);
  end if;
  if length(p_ciphertext) not between 24 and 8192 or length(p_iv) <> 16 then raise exception 'PUSH_REGISTRATION_INVALID'; end if;
  insert into public.edith_push_registrations(user_id,device_id,ciphertext,iv)
    values(p_user_id,p_device_id,p_ciphertext,p_iv)
    on conflict(user_id,device_id) do update set ciphertext=excluded.ciphertext, iv=excluded.iv,
      version=gen_random_uuid(), revoked_at=null, updated_at=now();
  return jsonb_build_object('registered',true,'revoked',false);
end $$;

-- Ownership is checked again inside the transaction, independently of the HTTP caller.
-- Cloud sync_events is the existing user/device resource metadata registry. No arbitrary content is pushed.
create or replace function public.edith_push_claim(p_user_id uuid, p_device_id text, p_event_id text, p_kind text, p_resource_id text, p_fingerprint text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare registration public.edith_push_registrations; attempt public.edith_push_attempts; created boolean;
begin
  if p_kind not in ('task','transfer') or p_event_id !~ '^[A-Za-z0-9_-]{1,160}$' or p_resource_id !~ '^[A-Za-z0-9_-]{1,160}$' or p_fingerprint !~ '^[a-f0-9]{64}$' then raise exception 'PUSH_INPUT_INVALID'; end if;
  if not exists (select 1 from public.devices where id=p_device_id and user_id=p_user_id and platform='android') then
    raise exception using message='DEVICE_NOT_AUTHORIZED', errcode='42501';
  end if;
  if not exists (select 1 from public.sync_events where user_id=p_user_id and device_id=p_device_id and entity_type=p_kind and entity_id=p_resource_id) then
    raise exception using message='RESOURCE_NOT_AUTHORIZED', errcode='42501';
  end if;
  select * into registration from public.edith_push_registrations where user_id=p_user_id and device_id=p_device_id and revoked_at is null for share;
  if not found then raise exception 'PUSH_REGISTRATION_REQUIRED'; end if;
  insert into public.edith_push_attempts(user_id,device_id,event_id,fingerprint,state)
    values(p_user_id,p_device_id,p_event_id,p_fingerprint,'sending') on conflict do nothing;
  created := found;
  select * into attempt from public.edith_push_attempts where user_id=p_user_id and device_id=p_device_id and event_id=p_event_id for update;
  if attempt.fingerprint <> p_fingerprint then raise exception 'PUSH_IDEMPOTENCY_CONFLICT'; end if;
  if not created then
    if attempt.state='retry_wait' and attempt.retry_at <= now() then
      update public.edith_push_attempts set state='sending',attempt_id=gen_random_uuid(),retry_at=null,updated_at=now()
        where user_id=p_user_id and device_id=p_device_id and event_id=p_event_id returning * into attempt;
    else
      if attempt.state='sending' and attempt.updated_at < now()-interval '2 minutes' then
        update public.edith_push_attempts set state='unknown',updated_at=now() where user_id=p_user_id and device_id=p_device_id and event_id=p_event_id;
        attempt.state := 'unknown';
      end if;
      return jsonb_build_object('state',attempt.state,'receiptId',attempt.receipt_id,'retryAt',attempt.retry_at);
    end if;
  end if;
  return jsonb_build_object('state','claimed','attemptId',attempt.attempt_id,'version',registration.version,'ciphertext',registration.ciphertext,'iv',registration.iv);
end $$;

create or replace function public.edith_push_finish(p_user_id uuid, p_device_id text, p_event_id text, p_attempt_id uuid, p_version uuid, p_state text, p_receipt_id text, p_retry_seconds integer, p_revoke boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if p_state not in ('accepted','unknown','retry_wait','rejected') or (p_state='accepted' and (p_receipt_id is null or length(p_receipt_id)>256)) then raise exception 'PUSH_RESULT_INVALID'; end if;
  update public.edith_push_attempts set state=p_state,receipt_id=p_receipt_id,
    retry_at=case when p_state='retry_wait' then now()+make_interval(secs=>greatest(60,least(coalesce(p_retry_seconds,60),86400))) else null end,updated_at=now()
    where user_id=p_user_id and device_id=p_device_id and event_id=p_event_id and attempt_id=p_attempt_id and state='sending';
  if not found then raise exception 'PUSH_ATTEMPT_STALE'; end if;
  if p_revoke then
    update public.edith_push_registrations set revoked_at=now(),updated_at=now() where user_id=p_user_id and device_id=p_device_id and version=p_version;
  end if;
  return jsonb_build_object('recorded',true);
end $$;
revoke all on function public.edith_push_register(uuid,text,text,text,boolean), public.edith_push_claim(uuid,text,text,text,text,text), public.edith_push_finish(uuid,text,text,uuid,uuid,text,text,integer,boolean) from public, anon, authenticated;
grant execute on function public.edith_push_register(uuid,text,text,text,boolean), public.edith_push_claim(uuid,text,text,text,text,text), public.edith_push_finish(uuid,text,text,uuid,uuid,text,text,integer,boolean) to service_role;
