-- Replace the plain btree unique index on wa_chat_jid (which overflows when JID
-- values exceed ~2700 bytes) with one that indexes the fixed-size md5 hash.
-- A generated stored column is used so PostgREST upsert conflict detection
-- can still reference a real column name rather than an expression.

alter table public.whatsapp_chat_threads
  add column if not exists wa_chat_jid_md5 text generated always as (md5(wa_chat_jid)) stored;

drop index if exists public.whatsapp_chat_threads_business_jid_uidx;

create unique index whatsapp_chat_threads_business_jid_uidx
  on public.whatsapp_chat_threads (business_id, wa_chat_jid_md5);
