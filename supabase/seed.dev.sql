-- Development-only sample data.
-- NEVER run this file against production.
-- It is intentionally separate from migrations.

insert into public.packages
  (code, name, name_ar, name_fr, price_dzd, price_sar, duration_days, seats_available, status, type, duration_label, tagline, image_url, includes)
values
  ('DEMO-UMRAH-RAMADAN', 'Ramadan Umrah', 'عمرة رمضان', 'Omra Ramadan', 290000, 0, 10, 100, 'ACTIVE', 'UMRAH', '10 days', 'Sample development package', null, '["Umrah visa","Hotel accommodation","Transport"]'::jsonb),
  ('DEMO-HAJJ-PREMIUM', 'Premium Hajj', 'باقة الحج المتميزة', 'Forfait Hajj Premium', 1200000, 0, 15, 100, 'ACTIVE', 'HAJJ', '15 days', 'Sample development package', null, '["Hajj visa","Hotel accommodation","Mina/Arafat camps","Transport"]'::jsonb)
on conflict (code) do nothing;
