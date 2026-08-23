-- Add priority before functions use it.
alter table public.notification_queue add column if not exists priority text not null default 'MEDIUM' check(priority in ('LOW','MEDIUM','HIGH','URGENT'));
create index if not exists idx_notification_queue_worker on public.notification_queue(status,next_attempt_at,priority,created_at);

-- Queue worker primitives: atomic claim, completion, retry/dead-letter.
create or replace function public.claim_notification_queue(p_limit integer default 25)
returns setof public.notification_queue
language plpgsql
security definer
set search_path=public
as $$
begin
  if auth.role() <> 'service_role' then raise exception 'Worker authorization required' using errcode='42501'; end if;
  return query
  with claimed as (
    select q.id from public.notification_queue q
    where q.status='QUEUED' and q.next_attempt_at <= now()
    order by q.priority desc nulls last, q.created_at
    for update skip locked
    limit least(greatest(coalesce(p_limit,25),1),100)
  )
  update public.notification_queue q
  set status='PROCESSING', attempts=q.attempts+1, next_attempt_at=now()+interval '15 minutes'
  from claimed c where q.id=c.id
  returning q.*;
end;
$$;
revoke all on function public.claim_notification_queue(integer) from public,anon,authenticated;
grant execute on function public.claim_notification_queue(integer) to service_role;

create or replace function public.complete_notification_queue(p_id uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  if auth.role() <> 'service_role' then raise exception 'Worker authorization required' using errcode='42501'; end if;
  update public.notification_queue set status='SENT', sent_at=now(), last_error=null where id=p_id and status='PROCESSING';
end $$;
revoke all on function public.complete_notification_queue(uuid) from public,anon,authenticated;
grant execute on function public.complete_notification_queue(uuid) to service_role;

create or replace function public.fail_notification_queue(p_id uuid,p_error text)
returns void language plpgsql security definer set search_path=public as $$
declare a int;
begin
  if auth.role() <> 'service_role' then raise exception 'Worker authorization required' using errcode='42501'; end if;
  select attempts into a from public.notification_queue where id=p_id for update;
  update public.notification_queue
  set status=case when coalesce(a,0) >= 5 then 'DEAD_LETTER' else 'QUEUED' end,
      last_error=left(coalesce(p_error,'Delivery failed'),2000),
      next_attempt_at=now()+make_interval(mins => least(60,greatest(1,power(2,greatest(coalesce(a,0)-1,0)))::int))
  where id=p_id and status='PROCESSING';
end $$;
revoke all on function public.fail_notification_queue(uuid,text) from public,anon,authenticated;
grant execute on function public.fail_notification_queue(uuid,text) to service_role;


-- Document access testability: forbid public object access at the storage layer.
revoke all on public.document_access_logs from anon;
