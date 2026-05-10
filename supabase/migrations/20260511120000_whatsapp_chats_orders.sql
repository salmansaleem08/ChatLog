-- WhatsApp-linked threads per business + extracted order lines from AI analysis.
alter table public.profiles
  add column if not exists whatsapp_linked_phone_live text;

comment on column public.profiles.whatsapp_linked_phone_live is
  'Latest phone number scraped from WhatsApp Web when logged in; optional.';

-- Allow honest "session ended" state when automation cannot keep a live session.
alter table public.profiles
  drop constraint if exists profiles_whatsapp_link_status_check;

alter table public.profiles
  add constraint profiles_whatsapp_link_status_check
  check (
    whatsapp_link_status in (
      'disconnected',
      'awaiting_scan',
      'connected',
      'session_lost'
    )
  );

create table if not exists public.whatsapp_chat_threads (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.profiles (id) on delete cascade,
  wa_chat_jid text not null,
  phone_digits text not null,
  contact_name text not null default '',
  last_message_preview text,
  last_message_at timestamptz,
  extraction_watermark_at timestamptz,
  last_analyzed_at timestamptz,
  updated_at timestamptz not null default now()
);

comment on table public.whatsapp_chat_threads is
  'Synced WhatsApp Web threads per workspace; keyed by jid from automation.';

create unique index if not exists whatsapp_chat_threads_business_jid_uidx
  on public.whatsapp_chat_threads (business_id, wa_chat_jid);

create index if not exists whatsapp_chat_threads_business_digits_idx
  on public.whatsapp_chat_threads (business_id, phone_digits);

create index if not exists whatsapp_chat_threads_last_msg_idx
  on public.whatsapp_chat_threads (business_id, last_message_at desc nulls last);

create table if not exists public.whatsapp_extracted_order_lines (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.profiles (id) on delete cascade,
  chat_thread_id uuid not null references public.whatsapp_chat_threads (id) on delete cascade,
  product_id uuid references public.products (id) on delete set null,
  product_variant_id uuid references public.product_variants (id) on delete set null,
  quantity numeric(14, 4) not null default 1 check (
    quantity > 0 and quantity <= 1000000000
  ),
  unit_price numeric(14, 4),
  confidence numeric not null default 0 check (
    confidence >= 0::numeric and confidence <= 1::numeric
  ),
  unresolved boolean not null default false,
  evidence text,
  special_instructions text,
  ai_product_label text not null default '',
  ai_variant_label text not null default '',
  created_at timestamptz not null default now()
);

comment on table public.whatsapp_extracted_order_lines is
  'Last AI extraction snapshot for a thread; rewritten on each successful analyse.';

create index if not exists whatsapp_extracted_lines_thread_idx
  on public.whatsapp_extracted_order_lines (chat_thread_id, created_at desc);

alter table public.whatsapp_chat_threads enable row level security;
alter table public.whatsapp_extracted_order_lines enable row level security;

create policy "whatsapp_threads_select_own"
  on public.whatsapp_chat_threads for select
  using (business_id = auth.uid());

create policy "whatsapp_threads_insert_own"
  on public.whatsapp_chat_threads for insert
  with check (business_id = auth.uid());

create policy "whatsapp_threads_update_own"
  on public.whatsapp_chat_threads for update
  using (business_id = auth.uid());

create policy "whatsapp_threads_delete_own"
  on public.whatsapp_chat_threads for delete
  using (business_id = auth.uid());

create policy "whatsapp_extracted_select_own"
  on public.whatsapp_extracted_order_lines for select
  using (business_id = auth.uid());

create policy "whatsapp_extracted_insert_own"
  on public.whatsapp_extracted_order_lines for insert
  with check (business_id = auth.uid());

create policy "whatsapp_extracted_update_own"
  on public.whatsapp_extracted_order_lines for update
  using (business_id = auth.uid());

create policy "whatsapp_extracted_delete_own"
  on public.whatsapp_extracted_order_lines for delete
  using (business_id = auth.uid());

create or replace function public.set_whatsapp_thread_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists whatsapp_chat_threads_updated_at_trg on public.whatsapp_chat_threads;
create trigger whatsapp_chat_threads_updated_at_trg
  before update on public.whatsapp_chat_threads
  for each row execute function public.set_whatsapp_thread_updated_at();
