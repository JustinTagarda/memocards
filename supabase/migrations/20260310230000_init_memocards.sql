create extension if not exists pgcrypto;

create schema if not exists common;
create schema if not exists memocards;

grant usage on schema common to authenticated, service_role;
grant usage on schema memocards to authenticated, service_role;

grant all on all tables in schema common to authenticated, service_role;
grant all on all tables in schema memocards to authenticated, service_role;
grant all on all routines in schema common to authenticated, service_role;
grant all on all routines in schema memocards to authenticated, service_role;
grant all on all sequences in schema common to authenticated, service_role;
grant all on all sequences in schema memocards to authenticated, service_role;

alter default privileges for role postgres in schema common
grant all on tables to authenticated, service_role;

alter default privileges for role postgres in schema memocards
grant all on tables to authenticated, service_role;

alter default privileges for role postgres in schema common
grant all on routines to authenticated, service_role;

alter default privileges for role postgres in schema memocards
grant all on routines to authenticated, service_role;

alter default privileges for role postgres in schema common
grant all on sequences to authenticated, service_role;

alter default privileges for role postgres in schema memocards
grant all on sequences to authenticated, service_role;

create table if not exists common.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  full_name text,
  avatar_url text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists memocards.user_settings (
  user_id uuid primary key references common.profiles (id) on delete cascade,
  daily_goal integer not null default 25 check (daily_goal between 1 and 500),
  default_voice text not null default 'en-US-Neural2-F',
  default_locale text not null default 'en-US',
  auto_play_audio boolean not null default false,
  study_streak integer not null default 0,
  longest_streak integer not null default 0,
  last_study_date timestamptz,
  total_sessions integer not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists memocards.folders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references common.profiles (id) on delete cascade,
  name text not null,
  color text not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists memocards.decks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references common.profiles (id) on delete cascade,
  title text not null,
  description text not null default '',
  folder_id uuid references memocards.folders (id) on delete set null,
  tags text[] not null default '{}',
  counts jsonb not null default '{}'::jsonb,
  preferences jsonb not null default '{}'::jsonb,
  export_config jsonb not null default '{"enabled": true, "formatVersion": 1}'::jsonb,
  ai_config jsonb not null default '{"enabled": false, "provider": "not_configured", "rubricVersion": "future-v1"}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  last_studied_at timestamptz
);

create table if not exists memocards.cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references common.profiles (id) on delete cascade,
  deck_id uuid not null references memocards.decks (id) on delete cascade,
  type text not null check (type in ('basic', 'term', 'multiple_choice', 'explanation')),
  front text not null default '',
  back text not null default '',
  prompt text not null default '',
  answer text not null default '',
  explanation text not null default '',
  choices jsonb not null default '[]'::jsonb,
  expected_answer jsonb not null default '{}'::jsonb,
  tags text[] not null default '{}',
  is_favorite boolean not null default false,
  review_state jsonb not null default '{}'::jsonb,
  study_stats jsonb not null default '{}'::jsonb,
  audio jsonb not null default '{}'::jsonb,
  ai_evaluation jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists memocards.activity (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references common.profiles (id) on delete cascade,
  type text not null,
  title text not null,
  description text not null,
  deck_id uuid references memocards.decks (id) on delete set null,
  card_id uuid references memocards.cards (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists memocards.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references common.profiles (id) on delete cascade,
  deck_id uuid not null,
  deck_title text not null,
  mode text not null check (mode in ('review', 'learn', 'cram')),
  started_at timestamptz not null,
  ended_at timestamptz not null,
  cards_studied integer not null default 0,
  correct integer not null default 0,
  incorrect integer not null default 0,
  duration_seconds integer not null default 0,
  results jsonb not null default '[]'::jsonb
);

create table if not exists memocards.answer_evaluations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references common.profiles (id) on delete cascade,
  deck_id uuid not null,
  card_id uuid not null,
  prompt text not null,
  expected_answer jsonb not null default '{}'::jsonb,
  submitted_answer text not null,
  status text not null check (status in ('pending', 'disabled', 'processing', 'ready', 'failed')),
  processor text,
  pipeline_version text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz
);

create unique index if not exists folders_user_name_idx on memocards.folders (user_id, lower(name));
create unique index if not exists decks_user_title_idx on memocards.decks (user_id, lower(title));
create index if not exists decks_user_updated_at_idx on memocards.decks (user_id, updated_at desc);
create index if not exists cards_user_deck_created_at_idx on memocards.cards (user_id, deck_id, created_at);
create index if not exists activity_user_created_at_idx on memocards.activity (user_id, created_at desc);
create index if not exists sessions_user_ended_at_idx on memocards.sessions (user_id, ended_at desc);
create index if not exists answer_evaluations_user_created_at_idx
  on memocards.answer_evaluations (user_id, created_at desc);

create or replace function memocards.enforce_owned_folder()
returns trigger
language plpgsql
as $$
begin
  if new.folder_id is null then
    return new;
  end if;

  if not exists (
    select 1
    from memocards.folders
    where id = new.folder_id
      and user_id = new.user_id
  ) then
    raise exception 'Folder does not belong to the current MemoCards user.';
  end if;

  return new;
end;
$$;

create or replace function memocards.enforce_owned_deck()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1
    from memocards.decks
    where id = new.deck_id
      and user_id = new.user_id
  ) then
    raise exception 'Deck does not belong to the current MemoCards user.';
  end if;

  return new;
end;
$$;

drop trigger if exists memocards_enforce_owned_folder on memocards.decks;
create trigger memocards_enforce_owned_folder
before insert or update on memocards.decks
for each row
execute function memocards.enforce_owned_folder();

drop trigger if exists memocards_enforce_owned_deck on memocards.cards;
create trigger memocards_enforce_owned_deck
before insert or update on memocards.cards
for each row
execute function memocards.enforce_owned_deck();

alter table common.profiles enable row level security;
alter table memocards.user_settings enable row level security;
alter table memocards.folders enable row level security;
alter table memocards.decks enable row level security;
alter table memocards.cards enable row level security;
alter table memocards.activity enable row level security;
alter table memocards.sessions enable row level security;
alter table memocards.answer_evaluations enable row level security;

drop policy if exists "profiles_select_own" on common.profiles;
create policy "profiles_select_own"
on common.profiles
for select
to authenticated
using ((select auth.uid()) = id);

drop policy if exists "profiles_insert_own" on common.profiles;
create policy "profiles_insert_own"
on common.profiles
for insert
to authenticated
with check ((select auth.uid()) = id);

drop policy if exists "profiles_update_own" on common.profiles;
create policy "profiles_update_own"
on common.profiles
for update
to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

drop policy if exists "user_settings_all_own" on memocards.user_settings;
create policy "user_settings_all_own"
on memocards.user_settings
for all
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "folders_all_own" on memocards.folders;
create policy "folders_all_own"
on memocards.folders
for all
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "decks_all_own" on memocards.decks;
create policy "decks_all_own"
on memocards.decks
for all
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "cards_all_own" on memocards.cards;
create policy "cards_all_own"
on memocards.cards
for all
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "activity_all_own" on memocards.activity;
create policy "activity_all_own"
on memocards.activity
for all
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "sessions_all_own" on memocards.sessions;
create policy "sessions_all_own"
on memocards.sessions
for all
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "answer_evaluations_all_own" on memocards.answer_evaluations;
create policy "answer_evaluations_all_own"
on memocards.answer_evaluations
for all
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('memocards-audio', 'memocards-audio', false, 10485760, array['audio/mpeg'])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "memocards_audio_select_own" on storage.objects;
create policy "memocards_audio_select_own"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'memocards-audio'
  and split_part(name, '/', 1) = (select auth.uid())::text
);

drop policy if exists "memocards_audio_insert_own" on storage.objects;
create policy "memocards_audio_insert_own"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'memocards-audio'
  and split_part(name, '/', 1) = (select auth.uid())::text
);

drop policy if exists "memocards_audio_update_own" on storage.objects;
create policy "memocards_audio_update_own"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'memocards-audio'
  and split_part(name, '/', 1) = (select auth.uid())::text
)
with check (
  bucket_id = 'memocards-audio'
  and split_part(name, '/', 1) = (select auth.uid())::text
);

drop policy if exists "memocards_audio_delete_own" on storage.objects;
create policy "memocards_audio_delete_own"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'memocards-audio'
  and split_part(name, '/', 1) = (select auth.uid())::text
);
