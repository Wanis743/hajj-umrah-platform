-- Internalize privileged implementations while keeping stable, non-definer
-- public wrappers for the Data API and RLS policies.
-- Idempotent on production and fresh installs.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

do $$
declare
  fn text;
  r record;
  call_args text;
  sql text;
  functions text[] := array[
    'has_permission','row_in_staff_scope','staff_role','staff_agency_id','staff_branch_id',
    'current_staff_agency_id','current_staff_branch_id','is_staff','is_admin',
    'cancel_booking_transaction','cancel_reservation_request','close_fiscal_period',
    'confirm_reservation_transaction','create_invoice_transaction','enqueue_notification',
    'post_invoice_journal','reconcile_bank_statement','record_payment_transaction',
    'reverse_payment_transaction','transition_booking_state','update_booking_optimistic',
    'update_departure_setting','update_visa_status'
  ];
begin
  foreach fn in array functions loop
    select p.oid, pg_get_function_arguments(p.oid) full_args,
           pg_get_function_identity_arguments(p.oid) id_args,
           pg_get_function_result(p.oid) result, p.pronargs
      into r
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='private' and p.proname=fn
    order by p.oid desc limit 1;

    if r.oid is null then
      select p.oid, pg_get_function_arguments(p.oid) full_args,
             pg_get_function_identity_arguments(p.oid) id_args,
             pg_get_function_result(p.oid) result, p.pronargs
        into r
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname=fn
      order by p.oid desc limit 1;
      if r.oid is null then continue; end if;

      if r.pronargs=0 then
        call_args := '';
      else
        select string_agg('$'||g, ', ' order by g) into call_args
        from generate_series(1,r.pronargs) g;
      end if;

      execute format('alter function public.%I(%s) set schema private', fn, r.id_args);
      execute format('grant execute on function private.%I(%s) to authenticated', fn, r.id_args);
      execute format('revoke execute on function private.%I(%s) from anon, public', fn, r.id_args);
    else
      if r.pronargs=0 then
        call_args := '';
      else
        select string_agg('$'||g, ', ' order by g) into call_args
        from generate_series(1,r.pronargs) g;
      end if;
    end if;

    sql := format(
      'create or replace function public.%I(%s) returns %s language sql security invoker set search_path=public,pg_catalog as $fn$ select private.%I(%s) $fn$',
      fn, r.full_args, r.result, fn, call_args
    );
    execute sql;
    execute format('revoke execute on function public.%I(%s) from anon, public', fn, r.id_args);
    execute format('grant execute on function public.%I(%s) to authenticated', fn, r.id_args);
  end loop;
end $$;

comment on schema private is 'Internal implementation schema. Never expose through Supabase Data API.';
