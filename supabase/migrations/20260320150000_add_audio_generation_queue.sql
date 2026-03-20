create extension if not exists pg_net;

create table if not exists memocards.audio_generation_queue (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references common.profiles (id) on delete cascade,
  deck_id uuid not null references memocards.decks (id) on delete cascade,
  card_id uuid not null references memocards.cards (id) on delete cascade,
  side text not null check (side in ('prompt', 'answer')),
  source_text text not null default '',
  status text not null default 'queued' check (status in ('queued', 'processing', 'ready', 'failed')),
  attempts integer not null default 0,
  last_error text,
  requested_at timestamptz not null default timezone('utc', now()),
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists audio_generation_queue_card_side_idx
  on memocards.audio_generation_queue (card_id, side);

create index if not exists audio_generation_queue_user_status_requested_idx
  on memocards.audio_generation_queue (user_id, status, requested_at asc);

create index if not exists audio_generation_queue_deck_status_requested_idx
  on memocards.audio_generation_queue (deck_id, status, requested_at asc);

create or replace function memocards.card_audio_text(card memocards.cards, side text)
returns text
language sql
immutable
as $$
  select case
    when side = 'prompt' then
      case
        when card.type in ('basic', 'term') then coalesce(nullif(card.front, ''), card.prompt)
        else card.prompt
      end
    when side = 'answer' then
      case
        when card.type = 'multiple_choice' then card.answer
        when card.type = 'explanation' then coalesce(nullif(card.expected_answer ->> 'canonical', ''), card.answer)
        else coalesce(nullif(card.back, ''), card.answer)
      end
    else ''
  end
$$;

create or replace function memocards.enqueue_card_audio_generation()
returns trigger
language plpgsql
as $$
declare
  audio_side text;
  audio_text text;
begin
  if tg_op = 'update' then
    if new.type is not distinct from old.type
      and new.front is not distinct from old.front
      and new.back is not distinct from old.back
      and new.prompt is not distinct from old.prompt
      and new.answer is not distinct from old.answer
      and new.explanation is not distinct from old.explanation
      and new.expected_answer is not distinct from old.expected_answer
    then
      return new;
    end if;
  end if;

  for audio_side in select unnest(array['prompt', 'answer']) loop
    audio_text := btrim(memocards.card_audio_text(new, audio_side));
    if audio_text <> '' then
      insert into memocards.audio_generation_queue (
        user_id,
        deck_id,
        card_id,
        side,
        source_text,
        status,
        attempts,
        last_error,
        requested_at,
        started_at,
        finished_at,
        updated_at
      )
      values (
        new.user_id,
        new.deck_id,
        new.id,
        audio_side,
        audio_text,
        'queued',
        0,
        null,
        timezone('utc', now()),
        null,
        null,
        timezone('utc', now())
      )
      on conflict (card_id, side) do update
      set
        user_id = excluded.user_id,
        deck_id = excluded.deck_id,
        source_text = excluded.source_text,
        status = 'queued',
        attempts = 0,
        last_error = null,
        requested_at = timezone('utc', now()),
        started_at = null,
        finished_at = null,
        updated_at = timezone('utc', now());
    end if;
  end loop;

  return new;
end;
$$;

create or replace function memocards.claim_audio_generation_jobs(
  limit_count integer,
  target_user_id uuid default null,
  target_deck_id uuid default null
)
returns setof memocards.audio_generation_queue
language plpgsql
security definer
set search_path = memocards, public
as $$
begin
  return query
  with selected as (
    select q.id
    from memocards.audio_generation_queue q
    where q.status = 'queued'
      and (target_user_id is null or q.user_id = target_user_id)
      and (target_deck_id is null or q.deck_id = target_deck_id)
    order by q.requested_at asc, q.id asc
    for update skip locked
    limit greatest(limit_count, 0)
  )
  update memocards.audio_generation_queue q
  set
    status = 'processing',
    attempts = q.attempts + 1,
    started_at = coalesce(q.started_at, timezone('utc', now())),
    last_error = null,
    updated_at = timezone('utc', now())
  from selected
  where q.id = selected.id
  returning q.*;
end;
$$;

drop trigger if exists memocards_enqueue_card_audio_generation on memocards.cards;
create trigger memocards_enqueue_card_audio_generation
after insert or update on memocards.cards
for each row
execute function memocards.enqueue_card_audio_generation();

alter table memocards.audio_generation_queue enable row level security;

drop policy if exists "audio_generation_queue_all_own" on memocards.audio_generation_queue;
create policy "audio_generation_queue_all_own"
on memocards.audio_generation_queue
for all
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
