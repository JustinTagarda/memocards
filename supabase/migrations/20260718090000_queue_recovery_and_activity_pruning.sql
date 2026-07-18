-- Queue recovery: reclaim stale processing jobs and retry failed jobs with an
-- attempt cap, plus keep the per-user activity feed from growing without bound.

-- 1. Claiming now also picks up:
--    - jobs stuck in 'processing' for more than 5 minutes (worker crashed or
--      timed out mid-batch; previously these were stranded forever), and
--    - 'failed' jobs with fewer than 3 attempts (transient TTS/storage errors
--      previously required a card edit to retry).
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
    where (
        q.status = 'queued'
        or (q.status = 'processing' and q.updated_at < timezone('utc', now()) - interval '5 minutes')
        or (q.status = 'failed' and q.attempts < 3)
      )
      and q.attempts < 5
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

-- 2. Cap the activity feed at 500 rows per user. The app only ever reads the
--    most recent entries; without a cap the table grows one row per action
--    forever. Pruning happens on insert and only scans the inserting user.
create or replace function memocards.prune_user_activity()
returns trigger
language plpgsql
as $$
begin
  delete from memocards.activity a
  where a.user_id = new.user_id
    and a.id in (
      select stale.id
      from memocards.activity stale
      where stale.user_id = new.user_id
      order by stale.created_at desc
      offset 500
    );
  return new;
end;
$$;

drop trigger if exists memocards_prune_user_activity on memocards.activity;
create trigger memocards_prune_user_activity
after insert on memocards.activity
for each row
execute function memocards.prune_user_activity();
