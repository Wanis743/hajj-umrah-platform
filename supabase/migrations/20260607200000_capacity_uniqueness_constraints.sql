DO $$ BEGIN
 if not exists(select 1 from pg_constraint where conname='packages_capacity_bounds_final') then alter table public.packages add constraint packages_capacity_bounds_final check(seats_available>=0 and (capacity is null or seats_available<=capacity)); end if;
 if not exists(select 1 from pg_constraint where conname='groups_capacity_bounds_final') then alter table public.groups add constraint groups_capacity_bounds_final check(max_capacity>=0 and current_capacity>=0 and current_capacity<=max_capacity); end if;
 if not exists(select 1 from pg_constraint where conname='hotels_room_bounds_final') then alter table public.hotels add constraint hotels_room_bounds_final check(total_rooms>=0 and available_rooms>=0 and available_rooms<=total_rooms); end if;
 if not exists(select 1 from pg_constraint where conname='camps_capacity_bounds_final') then alter table public.holy_site_camps add constraint camps_capacity_bounds_final check(capacity>=0 and occupied>=0 and occupied<=capacity); end if;
 if not exists(select 1 from pg_constraint where conname='transport_vehicle_capacity_final') then alter table public.transport_vehicles add constraint transport_vehicle_capacity_final check(capacity>0); end if;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS uq_packages_code_final ON public.packages(code) WHERE code IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_groups_code_final ON public.groups(code) WHERE code IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_transport_bus_number_final ON public.transport_vehicles(bus_number) WHERE bus_number IS NOT NULL;
