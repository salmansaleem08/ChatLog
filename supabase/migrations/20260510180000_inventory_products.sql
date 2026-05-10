-- Inventory: products, variants (flexible attributes JSONB), stock move audit.
-- Tenant isolation: products.business_id = profiles.id = auth.uid(); enforced in RLS.

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.profiles (id) on delete cascade,
  name text not null check (length(trim(name)) >= 1),
  category text not null default '' check (length(category) <= 128),
  cost_price numeric(14, 4) not null default 0 check (cost_price >= 0),
  selling_price numeric(14, 4) not null default 0 check (selling_price >= 0),
  description text check (description is null or length(description) <= 4000),
  low_stock_threshold integer not null default 5 check (
    low_stock_threshold >= 0 and low_stock_threshold <= 1000000000
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists products_business_id_idx on public.products (business_id);
create index if not exists products_business_name_idx on public.products (business_id, lower(name));

comment on table public.products is 'Sellable items per business workspace.';
comment on column public.products.low_stock_threshold is
  'Any variant at or below this quantity counts as low stock for this product.';

create table if not exists public.product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  attributes jsonb not null default '{}'::jsonb check (jsonb_typeof(attributes) = 'object'),
  stock_quantity integer not null default 0 check (
    stock_quantity >= 0 and stock_quantity <= 1000000000
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Note: complex key validation omitted; app sends string values only.

create index if not exists product_variants_product_id_idx
  on public.product_variants (product_id);

comment on table public.product_variants is 'Stock unit; attributes map dimension label → value (e.g. color → Red).';
comment on column public.product_variants.attributes is 'JSON object with string keys and string values.';

create table if not exists public.variant_stock_moves (
  id uuid primary key default gen_random_uuid(),
  variant_id uuid not null references public.product_variants (id) on delete cascade,
  delta integer not null check (delta <> 0),
  reason text not null check (length(trim(reason)) >= 1 and length(reason) <= 500),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null
);

create index if not exists variant_stock_moves_variant_id_idx
  on public.variant_stock_moves (variant_id, created_at desc);

comment on table public.variant_stock_moves is 'Audit log for manual stock adjustments on the product detail screen.';

alter table public.products enable row level security;
alter table public.product_variants enable row level security;
alter table public.variant_stock_moves enable row level security;

create policy "products_select_own"
  on public.products for select
  using (business_id = auth.uid());

create policy "products_insert_own"
  on public.products for insert
  with check (business_id = auth.uid());

create policy "products_update_own"
  on public.products for update
  using (business_id = auth.uid());

create policy "products_delete_own"
  on public.products for delete
  using (business_id = auth.uid());

create policy "product_variants_select_own"
  on public.product_variants for select
  using (
    exists (
      select 1 from public.products p
      where p.id = product_variants.product_id and p.business_id = auth.uid()
    )
  );

create policy "product_variants_insert_own"
  on public.product_variants for insert
  with check (
    exists (
      select 1 from public.products p
      where p.id = product_variants.product_id and p.business_id = auth.uid()
    )
  );

create policy "product_variants_update_own"
  on public.product_variants for update
  using (
    exists (
      select 1 from public.products p
      where p.id = product_variants.product_id and p.business_id = auth.uid()
    )
  );

create policy "product_variants_delete_own"
  on public.product_variants for delete
  using (
    exists (
      select 1 from public.products p
      where p.id = product_variants.product_id and p.business_id = auth.uid()
    )
  );

create policy "variant_stock_moves_select_own"
  on public.variant_stock_moves for select
  using (
    exists (
      select 1 from public.product_variants pv
      join public.products pr on pr.id = pv.product_id
      where pv.id = variant_stock_moves.variant_id and pr.business_id = auth.uid()
    )
  );

create policy "variant_stock_moves_insert_own"
  on public.variant_stock_moves for insert
  with check (
    exists (
      select 1 from public.product_variants pv
      join public.products pr on pr.id = pv.product_id
      where pv.id = variant_stock_moves.variant_id and pr.business_id = auth.uid()
    )
    and (created_by is null or created_by = auth.uid())
  );

-- Atomic stock adjustment with audit (detail page).
create or replace function public.adjust_variant_stock(
  p_variant_id uuid,
  p_delta integer,
  p_reason text
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_new integer;
  v_trim text := trim(p_reason);
begin
  if v_trim is null or length(v_trim) < 1 then
    raise exception 'Reason is required'
      using errcode = '23514';
  end if;

  if p_delta = 0 then
    raise exception 'Change must not be zero'
      using errcode = '23514';
  end if;

  if not exists (
    select 1
    from public.product_variants pv
    join public.products pr on pr.id = pv.product_id
    where pv.id = p_variant_id
      and pr.business_id = auth.uid()
  ) then
    raise exception 'Item not found'
      using errcode = 'P0002';
  end if;

  update public.product_variants pv
  set
    stock_quantity = pv.stock_quantity + p_delta,
    updated_at = now()
  where pv.id = p_variant_id
    and pv.stock_quantity + p_delta >= 0;

  if not found then
    raise exception 'Stock cannot go below zero'
      using errcode = '23514';
  end if;

  select pv.stock_quantity into v_new
  from public.product_variants pv where pv.id = p_variant_id;

  insert into public.variant_stock_moves (variant_id, delta, reason, created_by)
  values (p_variant_id, p_delta, v_trim, auth.uid());

  return v_new;
end;
$$;

grant execute on function public.adjust_variant_stock(uuid, integer, text)
  to authenticated;

create or replace function public.set_updated_at()
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

drop trigger if exists products_set_updated_at on public.products;
create trigger products_set_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

drop trigger if exists product_variants_set_updated_at on public.product_variants;
create trigger product_variants_set_updated_at
  before update on public.product_variants
  for each row execute function public.set_updated_at();
