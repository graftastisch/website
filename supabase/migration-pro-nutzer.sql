-- ============================================================================
-- Umstellung: jeder Nutzer hat seinen eigenen Wochenplan (+ Dokumente erlaubt)
-- Für ein bestehendes Projekt (Stand vor v7) einmal im SQL-Editor ausführen.
-- Neue Projekte nehmen direkt supabase/schema.sql.
--
-- Vorher vorhandene Daten gehören dem bisher einzigen freigegebenen Konto
-- (public.members). Sind dort mehrere Konten, vorher festlegen, wem sie gehören.
-- ============================================================================

-- 1. Besitzer pro Zeile
alter table public.events    add column if not exists user_id uuid default auth.uid() references auth.users (id) on delete cascade;
alter table public.templates add column if not exists user_id uuid default auth.uid() references auth.users (id) on delete cascade;

update public.events    set user_id = (select user_id from public.members order by created_at limit 1) where user_id is null;
update public.templates set user_id = (select user_id from public.members order by created_at limit 1) where user_id is null;

alter table public.events    alter column user_id set not null;
alter table public.templates alter column user_id set not null;

-- Felder: gleiche Kennung ("sport") darf bei jedem Nutzer vorkommen
alter table public.templates drop constraint templates_pkey;
alter table public.templates add primary key (user_id, id);
create index if not exists events_user_id_idx on public.events (user_id);

-- 2. Zugriff: nur auf die eigenen Zeilen
drop policy if exists "templates nur freigegebene" on public.templates;
drop policy if exists "events nur freigegebene"    on public.events;
create policy "templates eigene" on public.templates
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "events eigene" on public.events
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- 3. Speicher: jeder Nutzer hat einen eigenen Ordner (<user-id>/<termin-id>/<datei>).
--    Alte Pfade (<termin-id>/<datei>) bleiben für den Besitzer des Termins lesbar.
update storage.buckets
   set allowed_mime_types = array['image/*', 'video/*', 'application/pdf', 'text/plain',
                                  'application/msword',
                                  'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
 where id = 'plan-media';

drop policy if exists "plan-media lesen"     on storage.objects;
drop policy if exists "plan-media hochladen" on storage.objects;
drop policy if exists "plan-media loeschen"  on storage.objects;

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
