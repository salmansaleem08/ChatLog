-- Drop every index on the two WhatsApp tables and recreate them so that no
-- index touches a raw user-supplied text column directly.  Any column that
-- holds a JID, phone digits, or other scraper-produced string is indexed via
-- md5() so the indexed value is always exactly 32 bytes and can never trigger
-- "index row size exceeds btree maximum" regardless of what the scraper sends.
-- Columns with fixed-size types (uuid, timestamptz) are recreated as-is.

-- ── whatsapp_chat_threads ────────────────────────────────────────────────────

-- Drop all non-primary-key indexes (incl. the one just added by 20260511220000
-- so this migration is the single authoritative definition going forward).
drop index if exists public.whatsapp_chat_threads_business_jid_uidx;
drop index if exists public.whatsapp_chat_threads_business_digits_idx;
drop index if exists public.whatsapp_chat_threads_last_msg_idx;

-- Unique dedup index: keyed on md5(wa_chat_jid) via the generated column added
-- in 20260511220000 — 32-char hex, immune to overflow.
create unique index whatsapp_chat_threads_business_jid_uidx
  on public.whatsapp_chat_threads (business_id, wa_chat_jid_md5);

-- Search/filter index for phone_digits: raw text may contain scraper garbage,
-- so index md5(phone_digits) instead — fixed 32-byte hash, never overflows.
create index whatsapp_chat_threads_business_digits_idx
  on public.whatsapp_chat_threads (business_id, md5(phone_digits));

-- Temporal sort index: last_message_at is timestamptz (8 bytes) — fixed size,
-- safe to index directly.
create index whatsapp_chat_threads_last_msg_idx
  on public.whatsapp_chat_threads (business_id, last_message_at desc nulls last);

-- ── whatsapp_extracted_order_lines ──────────────────────────────────────────

-- Only index is on (chat_thread_id uuid, created_at timestamptz): both types
-- are fixed-size and can never overflow.  Drop and recreate for completeness.
drop index if exists public.whatsapp_extracted_lines_thread_idx;

create index whatsapp_extracted_lines_thread_idx
  on public.whatsapp_extracted_order_lines (chat_thread_id, created_at desc);
