-- ============================================================================
-- Dateien (Seite /files/) – Datenbank und Speicher
-- Einmalig im SQL Editor ausführen (läuft auch ein zweites Mal ohne Fehler durch).
-- Jedes Konto sieht und ändert nur die eigenen Ordner und Dateien.
-- Die Dateien selbst liegen im privaten Bucket "user-files" unter  <user_id>/<datei-id>.
-- ============================================================================

-- Ordner -----------------------------------------------------------------------
create table if not exists public.file_folders (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  parent_id  uuid references public.file_folders(id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 255),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- Dateien ----------------------------------------------------------------------
create table if not exists public.files (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  folder_id  uuid references public.file_folders(id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 255),
  size       bigint not null default 0 check (size >= 0),
  mime       text not null default '',
  kind       text not null default 'other' check (kind in ('image','video','audio','doc','code','archive','other')),
  starred    boolean not null default false,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists file_folders_user_parent_idx on public.file_folders (user_id, parent_id);
create index if not exists files_user_folder_idx        on public.files (user_id, folder_id);
create index if not exists files_user_kind_idx          on public.files (user_id, kind) where deleted_at is null;
create index if not exists files_user_deleted_idx       on public.files (user_id) where deleted_at is not null;
create index if not exists files_folder_fk_idx          on public.files (folder_id);

alter table public.file_folders enable row level security;
alter table public.files        enable row level security;

-- Hilfsfunktion (nicht öffentliches Schema): gehört der Ordner dem Konto? Vermeidet eine Endlosschleife der Regel.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;
create or replace function private.owns_folder(fid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.file_folders f where f.id = fid and f.user_id = (select auth.uid()));
$$;
revoke all on function private.owns_folder(uuid) from public, anon;
grant execute on function private.owns_folder(uuid) to authenticated;

drop policy if exists "ordner eigene" on public.file_folders;
create policy "ordner eigene" on public.file_folders for all to authenticated
  using      (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and (parent_id is null or private.owns_folder(parent_id)));

drop policy if exists "dateien eigene" on public.files;
create policy "dateien eigene" on public.files for all to authenticated
  using      (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and (folder_id is null or private.owns_folder(folder_id)));

grant select, insert, update, delete on public.file_folders, public.files to authenticated;
revoke all on public.file_folders, public.files from anon;

-- Belegter Speicher des angemeldeten Kontos (Summe der eigenen Dateien, auch im Papierkorb)
create or replace function public.files_usage()
returns bigint language sql stable security invoker set search_path = public as $$
  select coalesce(sum(size), 0)::bigint from public.files where user_id = (select auth.uid());
$$;
revoke all on function public.files_usage() from public, anon;
grant execute on function public.files_usage() to authenticated;

-- Speicher (privat, max. 50 MB pro Datei, alle Dateitypen erlaubt) --------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('user-files', 'user-files', false, 52428800, null)
on conflict (id) do update set public = false, file_size_limit = 52428800, allowed_mime_types = null;

drop policy if exists "user-files lesen" on storage.objects;
create policy "user-files lesen" on storage.objects for select to authenticated
  using (bucket_id = 'user-files' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "user-files hochladen" on storage.objects;
create policy "user-files hochladen" on storage.objects for insert to authenticated
  with check (bucket_id = 'user-files' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "user-files aendern" on storage.objects;
create policy "user-files aendern" on storage.objects for update to authenticated
  using      (bucket_id = 'user-files' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'user-files' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "user-files loeschen" on storage.objects;
create policy "user-files loeschen" on storage.objects for delete to authenticated
  using (bucket_id = 'user-files' and (storage.foldername(name))[1] = (select auth.uid())::text);
