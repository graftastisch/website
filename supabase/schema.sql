-- ============================================================================
-- Wochenplan – Datenbankschema für Supabase (Free-Tier), Stand v7
-- Einmalig auf einem NEUEN, leeren Projekt ausführen (SQL Editor → einfügen → Run).
-- Ein bestehendes Projekt (Stand vor v7) stellt supabase/migration-pro-nutzer.sql um.
--
-- ZUGRIFFSMODELL
--   * Jeder angemeldete Nutzer hat seinen eigenen Wochenplan: Jede Zeile gehört
--     einem Konto (user_id) und ist nur für dieses sichtbar und änderbar.
--   * Dateien liegen im privaten Speicher unter <user-id>/<termin-id>/<datei>.
--   * Nutzer anlegen: supabase/add-user.sql. Wichtig: im Dashboard die
--     Selbstregistrierung ausschalten (Authentication → Sign In / Providers →
--     "Allow new users to sign up"), sonst könnte sich jeder ein Konto anlegen.
--   * public.members / is_member() ist eine optionale Freigabeliste für spätere
--     Anwendungen, die nicht jedem Konto offenstehen sollen. Der Wochenplan braucht sie nicht.
-- ============================================================================

-- Optionale Freigabeliste (für spätere Anwendungen)
create table if not exists public.members (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.members enable row level security;
grant select on public.members to authenticated;
create policy "eigene freigabe lesen" on public.members
  for select to authenticated using (user_id = (select auth.uid()));

create or replace function public.is_member()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (select 1 from public.members where user_id = (select auth.uid()));
$$;
revoke execute on function public.is_member() from public, anon;
grant execute on function public.is_member() to authenticated;

-- Felder (Vorlagen). Die beiden Standardfelder ("event", "sport") stehen nur
-- hier, wenn sie angepasst wurden (custom = false).
create table if not exists public.templates (
  id         text not null check (char_length(id) <= 64),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 60),
  emoji      text not null check (char_length(emoji) between 1 and 32),
  color      text not null check (color ~ '^#[0-9a-fA-F]{6}$'),
  dur        integer not null check (dur between 5 and 1440),
  custom     boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (user_id, id)
);

-- Termine. Zeiten als Minuten seit Mitternacht (day: 0 = Montag … 6 = Sonntag).
create table if not exists public.events (
  id          text primary key check (char_length(id) <= 64),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title       text not null check (char_length(title) <= 200),
  description text not null default '' check (char_length(description) <= 10000),
  day         smallint not null check (day between 0 and 6),
  start_min   smallint not null check (start_min between 0 and 1439),
  end_min     smallint not null check (end_min between 1 and 1440),
  tpl_id      text not null check (char_length(tpl_id) <= 64),
  tpl_name    text not null check (char_length(tpl_name) <= 60),
  tpl_emoji   text not null check (char_length(tpl_emoji) <= 32),
  tpl_color   text not null check (tpl_color ~ '^#[0-9a-fA-F]{6}$'),
  loc_text    text not null default '' check (char_length(loc_text) <= 500),
  loc_label   text check (char_length(loc_label) <= 200),
  loc_lat     double precision check (loc_lat between -90 and 90),
  loc_lon     double precision check (loc_lon between -180 and 180),
  media       jsonb not null default '[]'::jsonb
              check (jsonb_typeof(media) = 'array' and jsonb_array_length(media) <= 50),
  created_at  timestamptz not null default now(),
  check (end_min > start_min)
);
create index if not exists events_user_id_idx on public.events (user_id);

alter table public.templates enable row level security;
alter table public.events    enable row level security;

-- Ausdrücklich nur für angemeldete Konten freigeben (nicht für "anon")
grant select, insert, update, delete on public.templates to authenticated;
grant select, insert, update, delete on public.events    to authenticated;

create policy "templates eigene" on public.templates
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "events eigene" on public.events
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Privater Speicher für Bilder, Videos und Dokumente (max. 50 MB pro Datei = Limit des Free-Tiers)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('plan-media', 'plan-media', false, 52428800, array[
  'image/*', 'video/*', 'application/pdf', 'text/plain', 'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Jeder Nutzer nur in seinem Ordner (<user-id>/<termin-id>/<datei>).
-- Ältere Pfade (<termin-id>/<datei>) bleiben für den Besitzer des Termins lesbar.
create policy "plan-media lesen" on storage.objects
  for select to authenticated using (
    bucket_id = 'plan-media' and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or exists (select 1 from public.events e
                 where e.user_id = (select auth.uid()) and e.id = (storage.foldername(name))[1])));
create policy "plan-media hochladen" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'plan-media' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "plan-media loeschen" on storage.objects
  for delete to authenticated using (
    bucket_id = 'plan-media' and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or exists (select 1 from public.events e
                 where e.user_id = (select auth.uid()) and e.id = (storage.foldername(name))[1])));
