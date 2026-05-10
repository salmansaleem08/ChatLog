-- Store the raw snapshot transcript on the thread so the AI step can read it
-- from the DB instead of requiring the client to pass it back in the request body.
alter table public.whatsapp_chat_threads
  add column if not exists snapshot_transcript       text,
  add column if not exists snapshot_latest_msg_at   timestamptz;
