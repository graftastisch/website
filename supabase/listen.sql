-- ============================================================================
-- Listen (Seite /lists/) – Datenbank
-- Einmalig im SQL Editor ausführen (läuft auch ein zweites Mal ohne Fehler durch).
-- Jedes Konto sieht und ändert nur die eigenen Listen und Einträge.
-- ============================================================================

create table if not exists public.lists (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 100),
  kind       text not null default 'general' check (kind in ('todo','books','movies','shopping','general')),
  icon       text not null default '📋' check (char_length(icon) between 1 and 16),
  color      text not null default '#007aff' check (color ~ '^#[0-9a-fA-F]{6}$'),
  pos        double precision not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.list_items (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  list_id     uuid not null references public.lists(id) on delete cascade,
  title       text not null check (char_length(title) between 1 and 300),
  subtitle    text not null default '' check (char_length(subtitle) <= 300),   -- z. B. Autor, Regie, Menge
  notes       text not null default '' check (char_length(notes) <= 10000),
  done        boolean not null default false,
  due_date    date,
  due_time    time,
  place       text not null default '' check (char_length(place) <= 300),
  url         text not null default '' check (char_length(url) <= 2000),
  rating      smallint not null default 0 check (rating between 0 and 5),
  priority    smallint not null default 0 check (priority between 0 and 3),
  pos         double precision not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists lists_user_pos_idx          on public.lists (user_id, pos);
create index if not exists list_items_list_idx         on public.list_items (list_id, pos);
create index if not exists list_items_user_due_idx     on public.list_items (user_id, due_date) where done = false;

alter table public.lists      enable row level security;
alter table public.list_items enable row level security;

drop policy if exists "listen eigene" on public.lists;
create policy "listen eigene" on public.lists for all to authenticated
  using      (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "eintraege eigene" on public.list_items;
create policy "eintraege eigene" on public.list_items for all to authenticated
  using      (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid())
              and exists (select 1 from public.lists l where l.id = list_id and l.user_id = (select auth.uid())));

grant select, insert, update, delete on public.lists, public.list_items to authenticated;
revoke all on public.lists, public.list_items from anon;

-- "geändert am" automatisch setzen
create or replace function public.touch_list_item()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin new.updated_at = now(); return new; end;
$$;
drop trigger if exists list_items_touch on public.list_items;
create trigger list_items_touch before update on public.list_items
  for each row execute function public.touch_list_item();
