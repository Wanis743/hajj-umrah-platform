create table if not exists public.admin_bootstrap(id boolean primary key default true,used_at timestamptz,used_by uuid,constraint admin_bootstrap_single check(id=true));
alter table public.admin_bootstrap enable row level security;
revoke all on public.admin_bootstrap from public,anon,authenticated;
insert into public.admin_bootstrap(id) values(true) on conflict(id) do nothing;
