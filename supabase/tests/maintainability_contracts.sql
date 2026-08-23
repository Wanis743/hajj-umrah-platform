-- Maintainability/architecture invariants.
-- Run against a fresh or production-like Supabase database.

do $$
declare
  duplicate_count integer;
begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    select count(*) into duplicate_count
    from (
      select regexp_replace(version,'_.*$','') as ts, count(*) as c
      from supabase_migrations.schema_migrations
      group by 1
      having count(*) > 1
    ) x;
    if duplicate_count > 0 then raise exception 'Migration timestamp collision detected'; end if;
  end if;
end $$;

do $$
begin
  if to_regprocedure('public.get_finance_summary(date,date,uuid,uuid)') is null then
    raise exception 'Finance summary RPC missing';
  end if;
  if to_regprocedure('public.transition_booking_state(uuid,text,text)') is null then
    raise exception 'Booking transition command missing';
  end if;
  if to_regprocedure('public.transition_pilgrim_state(uuid,text)') is null then
    raise exception 'Pilgrim transition command missing';
  end if;
  if to_regprocedure('public.transition_visa_status(uuid,text)') is null then
    raise exception 'Visa transition command missing';
  end if;
end $$;

do $$
begin
  if has_function_privilege(current_user,'public.patch_scoped_command_row(regclass,uuid,jsonb)','EXECUTE') then
    raise exception 'Private generic command helper must not be executable by callers';
  end if;
end $$;
