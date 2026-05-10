-- WhatsApp Web linking state per business (profiles row = one workspace).

alter table public.profiles
  add column if not exists whatsapp_phone_e164 text,
  add column if not exists whatsapp_link_status text not null default 'disconnected',
  add column if not exists whatsapp_updated_at timestamptz;

comment on column public.profiles.whatsapp_phone_e164 is
  'Optional E.164 hint the seller enters; session links whichever account scans QR.';
comment on column public.profiles.whatsapp_link_status is
  'disconnected | awaiting_scan | connected — synced from automation service via app.';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_whatsapp_link_status_check'
  ) then
    alter table public.profiles
      add constraint profiles_whatsapp_link_status_check
      check (
        whatsapp_link_status in ('disconnected', 'awaiting_scan', 'connected')
      );
  end if;
end $$;
