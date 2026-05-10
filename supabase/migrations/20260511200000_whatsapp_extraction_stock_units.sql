-- Track inventory units reserved per extracted line so deletion can restore stock.
alter table public.whatsapp_extracted_order_lines
  add column if not exists stock_units_applied integer;

comment on column public.whatsapp_extracted_order_lines.stock_units_applied is
  'Whole units subtracted from inventory when this line was saved; restored when analysis is removed.';

alter table public.whatsapp_extracted_order_lines
  drop constraint if exists whatsapp_extracted_order_lines_stock_units_applied_check;

alter table public.whatsapp_extracted_order_lines
  add constraint whatsapp_extracted_order_lines_stock_units_applied_check
  check (stock_units_applied is null or (stock_units_applied >= 0 and stock_units_applied <= 1000000000));
