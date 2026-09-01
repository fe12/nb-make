-- nb-make community platform schema.
--
-- Idempotent: safe to run repeatedly (`npm run db:push`). Every object is
-- created with `if not exists`, and policies are dropped before being recreated
-- because Postgres has no `create policy if not exists`.
--
-- The security model is row-level security, not application code. A notebook is
-- readable by its owner, by anyone once published, and by admins. Nothing in
-- the browser is trusted to enforce that.

create extension if not exists pgcrypto;

-- ============================================================== profiles ==

create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  email         text not null,
  display_name  text not null default '',
  bio           text not null default '',
  role          text not null default 'user' check (role in ('user', 'admin')),
  -- Set by an admin. Checked by the policies below, so a ban takes effect on
  -- the next request rather than the next sign-in.
  banned_at     timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.profiles add column if not exists bio text not null default '';
alter table public.profiles add column if not exists banned_at timestamptz;

-- `security definer` so it bypasses RLS on profiles. A plain query here would
-- recurse: the profiles policy calls is_admin(), which reads profiles, which
-- applies the policy again.
create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $fn$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and banned_at is null
  );
$fn$;

create or replace function public.is_banned()
returns boolean
language sql
security definer
stable
set search_path = public
as $fn$
  select exists (
    select 1 from public.profiles where id = auth.uid() and banned_at is not null
  );
$fn$;

-- A profile row must exist for every account, so it is created by a trigger on
-- auth.users rather than by the sign-up form -- that way it cannot be skipped
-- by a client that never calls back after registering.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$fn$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Role and ban state are administrative fields. Without this an authenticated
-- user could PATCH their own row to role='admin' -- the update policy permits
-- writing to their profile, and RLS cannot compare old and new values.
-- Deliberately NOT `security definer`.
--
-- Inside a security-definer function `current_user` is the function's *owner*
-- (postgres), not the caller, so the exemption below would match every caller
-- and hand out admin to anyone who PATCHed their own profile. As an invoker
-- function `current_user` is the role PostgREST switched to -- `authenticated`
-- for a signed-in user, `service_role` for the secret key, `postgres` for the
-- seed script's direct connection -- which is exactly the distinction needed.
create or replace function public.guard_profile_privileges()
returns trigger
language plpgsql
set search_path = public
as $fn$
begin
  -- `is_admin()` is false for the service role, whose JWT has no `sub` and so
  -- no auth.uid(). Without the current_user arm the seed script could create an
  -- admin and have this trigger silently strip the role straight back off.
  if not (
    public.is_admin()
    or current_user in ('service_role', 'postgres', 'supabase_admin')
  ) then
    new.role := old.role;
    new.banned_at := old.banned_at;
  end if;
  new.updated_at := now();
  return new;
end;
$fn$;

drop trigger if exists guard_profile_privileges on public.profiles;
create trigger guard_profile_privileges
  before update on public.profiles
  for each row execute function public.guard_profile_privileges();

-- ============================================================= notebooks ==

create table if not exists public.notebooks (
  -- Matches the id the browser generated, so local and remote copies of a
  -- notebook are the same row and sync needs no id mapping table.
  id              text primary key,
  owner_id        uuid not null references public.profiles(id) on delete cascade,
  name            text not null default 'Untitled notebook',
  description     text not null default '',
  -- The whole Notebook document, exactly as the editor stores it locally.
  doc             jsonb not null,
  -- Incremented on every accepted push. A push carrying a lower revision than
  -- the stored row is stale and is rejected rather than overwriting.
  revision        integer not null default 1,
  page_count      integer not null default 0,
  template_count  integer not null default 0,
  page_size_label text not null default '',
  is_published    boolean not null default false,
  is_featured     boolean not null default false,
  published_at    timestamptz,
  like_count      integer not null default 0,
  save_count      integer not null default 0,
  view_count      integer not null default 0,
  rating_count    integer not null default 0,
  rating_sum      integer not null default 0,
  rating_avg      numeric(3,2) generated always as (
    case when rating_count = 0 then 0
         else round(rating_sum::numeric / rating_count, 2) end
  ) stored,
  -- A tombstone rather than a delete: a device that was offline when the
  -- notebook was deleted would otherwise push it straight back.
  deleted_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Public URLs of the images a published notebook references, keyed by asset id.
-- Populated on publish. Without it another user's browser has no way to resolve
-- an image that lives in the author's IndexedDB.
alter table public.notebooks
  add column if not exists asset_urls jsonb not null default '{}'::jsonb;

create index if not exists notebooks_owner_idx
  on public.notebooks (owner_id, updated_at desc);
create index if not exists notebooks_published_idx
  on public.notebooks (is_published, published_at desc) where deleted_at is null;
create index if not exists notebooks_rating_idx
  on public.notebooks (rating_avg desc, rating_count desc) where is_published;
create index if not exists notebooks_likes_idx
  on public.notebooks (like_count desc) where is_published;

-- ================================================ likes / saves / ratings ==

create table if not exists public.notebook_likes (
  notebook_id text not null references public.notebooks(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (notebook_id, user_id)
);

create table if not exists public.notebook_saves (
  notebook_id text not null references public.notebooks(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (notebook_id, user_id)
);

create index if not exists notebook_saves_user_idx
  on public.notebook_saves (user_id, created_at desc);

create table if not exists public.notebook_ratings (
  notebook_id text not null references public.notebooks(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  rating      smallint not null check (rating between 1 and 5),
  review      text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (notebook_id, user_id)
);

create table if not exists public.notebook_reports (
  id          uuid primary key default gen_random_uuid(),
  notebook_id text not null references public.notebooks(id) on delete cascade,
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reason      text not null,
  status      text not null default 'open' check (status in ('open', 'dismissed', 'actioned')),
  created_at  timestamptz not null default now()
);

-- ======================================================= count triggers ==

-- Kept denormalised so the community listing can sort by popularity with an
-- index scan instead of aggregating every like on every page load.

create or replace function public.sync_like_count()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  if tg_op = 'INSERT' then
    update public.notebooks set like_count = like_count + 1 where id = new.notebook_id;
  else
    update public.notebooks set like_count = greatest(0, like_count - 1) where id = old.notebook_id;
  end if;
  return null;
end;
$fn$;

drop trigger if exists sync_like_count on public.notebook_likes;
create trigger sync_like_count
  after insert or delete on public.notebook_likes
  for each row execute function public.sync_like_count();

create or replace function public.sync_save_count()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  if tg_op = 'INSERT' then
    update public.notebooks set save_count = save_count + 1 where id = new.notebook_id;
  else
    update public.notebooks set save_count = greatest(0, save_count - 1) where id = old.notebook_id;
  end if;
  return null;
end;
$fn$;

drop trigger if exists sync_save_count on public.notebook_saves;
create trigger sync_save_count
  after insert or delete on public.notebook_saves
  for each row execute function public.sync_save_count();

create or replace function public.sync_rating_totals()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  if tg_op = 'INSERT' then
    update public.notebooks
       set rating_count = rating_count + 1, rating_sum = rating_sum + new.rating
     where id = new.notebook_id;
  elsif tg_op = 'UPDATE' then
    update public.notebooks
       set rating_sum = rating_sum - old.rating + new.rating
     where id = new.notebook_id;
  else
    update public.notebooks
       set rating_count = greatest(0, rating_count - 1),
           rating_sum = greatest(0, rating_sum - old.rating)
     where id = old.notebook_id;
  end if;
  return null;
end;
$fn$;

drop trigger if exists sync_rating_totals on public.notebook_ratings;
create trigger sync_rating_totals
  after insert or update or delete on public.notebook_ratings
  for each row execute function public.sync_rating_totals();

-- Publishing timestamp is derived, not supplied by the client.
create or replace function public.touch_notebook()
returns trigger language plpgsql as $fn$
begin
  new.updated_at := now();
  if new.is_published and not coalesce(old.is_published, false) then
    new.published_at := now();
  elsif not new.is_published then
    new.published_at := null;
  end if;
  return new;
end;
$fn$;

drop trigger if exists touch_notebook on public.notebooks;
create trigger touch_notebook
  before update on public.notebooks
  for each row execute function public.touch_notebook();

-- =================================================== row-level security ==

alter table public.profiles         enable row level security;
alter table public.notebooks        enable row level security;
alter table public.notebook_likes   enable row level security;
alter table public.notebook_saves   enable row level security;
alter table public.notebook_ratings enable row level security;
alter table public.notebook_reports enable row level security;

-- profiles ----------------------------------------------------------------
-- Readable by anyone: the community listing shows author names. Anything
-- private would belong in a separate table; the email is filtered out by the
-- public_profiles view that the client actually queries.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select using (true);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

drop policy if exists profiles_insert_self on public.profiles;
create policy profiles_insert_self on public.profiles
  for insert with check (id = auth.uid());

-- notebooks ---------------------------------------------------------------
drop policy if exists notebooks_select on public.notebooks;
create policy notebooks_select on public.notebooks
  for select using (
    owner_id = auth.uid()
    or (is_published and deleted_at is null)
    or public.is_admin()
  );

drop policy if exists notebooks_insert_own on public.notebooks;
create policy notebooks_insert_own on public.notebooks
  for insert with check (owner_id = auth.uid() and not public.is_banned());

drop policy if exists notebooks_update_own on public.notebooks;
create policy notebooks_update_own on public.notebooks
  for update using (
    (owner_id = auth.uid() and not public.is_banned()) or public.is_admin()
  )
  with check (owner_id = auth.uid() or public.is_admin());

drop policy if exists notebooks_delete_own on public.notebooks;
create policy notebooks_delete_own on public.notebooks
  for delete using (owner_id = auth.uid() or public.is_admin());

-- engagement --------------------------------------------------------------
-- Rows are visible so counts and reviews can be shown; writing is restricted
-- to your own row, which is what stops vote stuffing.

drop policy if exists likes_select on public.notebook_likes;
create policy likes_select on public.notebook_likes for select using (true);

drop policy if exists likes_insert_own on public.notebook_likes;
create policy likes_insert_own on public.notebook_likes
  for insert with check (user_id = auth.uid() and not public.is_banned());

drop policy if exists likes_delete_own on public.notebook_likes;
create policy likes_delete_own on public.notebook_likes
  for delete using (user_id = auth.uid());

-- Saves are a private bookmark list, so unlike likes they are not public.
drop policy if exists saves_select_own on public.notebook_saves;
create policy saves_select_own on public.notebook_saves
  for select using (user_id = auth.uid() or public.is_admin());

drop policy if exists saves_insert_own on public.notebook_saves;
create policy saves_insert_own on public.notebook_saves
  for insert with check (user_id = auth.uid() and not public.is_banned());

drop policy if exists saves_delete_own on public.notebook_saves;
create policy saves_delete_own on public.notebook_saves
  for delete using (user_id = auth.uid());

drop policy if exists ratings_select on public.notebook_ratings;
create policy ratings_select on public.notebook_ratings for select using (true);

drop policy if exists ratings_insert_own on public.notebook_ratings;
create policy ratings_insert_own on public.notebook_ratings
  for insert with check (user_id = auth.uid() and not public.is_banned());

drop policy if exists ratings_update_own on public.notebook_ratings;
create policy ratings_update_own on public.notebook_ratings
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists ratings_delete_own on public.notebook_ratings;
create policy ratings_delete_own on public.notebook_ratings
  for delete using (user_id = auth.uid() or public.is_admin());

drop policy if exists reports_insert_own on public.notebook_reports;
create policy reports_insert_own on public.notebook_reports
  for insert with check (reporter_id = auth.uid());

drop policy if exists reports_select on public.notebook_reports;
create policy reports_select on public.notebook_reports
  for select using (reporter_id = auth.uid() or public.is_admin());

drop policy if exists reports_update_admin on public.notebook_reports;
create policy reports_update_admin on public.notebook_reports
  for update using (public.is_admin()) with check (public.is_admin());

-- =============================================================== views ==

-- The listing needs an author name next to each notebook. Going through a view
-- keeps the email address out of the payload.
create or replace view public.public_profiles
with (security_invoker = true) as
  select id, display_name, bio, created_at from public.profiles;

grant select on public.public_profiles to anon, authenticated;

-- ============================================================== storage ==

insert into storage.buckets (id, name, public)
values ('notebook-assets', 'notebook-assets', true)
on conflict (id) do update set public = true;

-- Images are stored at `<user-id>/<asset-id>`, so the first path segment is
-- the authorisation check: you may write only inside your own folder.
do $do$
begin
  drop policy if exists assets_public_read on storage.objects;
  create policy assets_public_read on storage.objects
    for select using (bucket_id = 'notebook-assets');

  drop policy if exists assets_owner_insert on storage.objects;
  create policy assets_owner_insert on storage.objects
    for insert with check (
      bucket_id = 'notebook-assets'
      and (storage.foldername(name))[1] = auth.uid()::text
    );

  drop policy if exists assets_owner_update on storage.objects;
  create policy assets_owner_update on storage.objects
    for update using (
      bucket_id = 'notebook-assets'
      and (storage.foldername(name))[1] = auth.uid()::text
    );

  drop policy if exists assets_owner_delete on storage.objects;
  create policy assets_owner_delete on storage.objects
    for delete using (
      bucket_id = 'notebook-assets'
      and (storage.foldername(name))[1] = auth.uid()::text
    );
exception when insufficient_privilege then
  raise notice 'Skipped storage policies: this role cannot alter storage.objects. Add them from the Supabase dashboard.';
end
$do$;

-- ================================================================ rpcs ==

-- Revision-guarded upsert, used by every sync push including the unload
-- beacon.
--
-- Deliberately not `security definer`: it runs as the caller so the notebooks
-- policies still apply, and it cannot be used to write to someone else's row.
-- The point of doing it in SQL is atomicity -- a read-then-write from the
-- client would let two devices interleave and lose an edit between the check
-- and the update.
create or replace function public.push_notebook(
  p_id             text,
  p_doc            jsonb,
  p_revision       integer,
  p_name           text,
  p_description    text,
  p_page_count     integer,
  p_template_count integer,
  p_page_size_label text,
  p_created_at     timestamptz,
  p_updated_at     timestamptz
)
returns json
language plpgsql
as $fn$
declare
  existing public.notebooks%rowtype;
  saved    public.notebooks%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  select * into existing from public.notebooks where id = p_id;

  -- Ownership is checked here rather than being left to the row policies.
  -- `notebooks_update_own` intentionally allows admins to edit any row so they
  -- can moderate, which would otherwise let an admin's *sync* silently
  -- overwrite another account's notebook if a local id ever collided. Sync only
  -- ever writes your own work; moderation goes through its own explicit paths.
  if found and existing.owner_id <> auth.uid() then
    raise exception 'that notebook belongs to another account'
      using errcode = '42501';
  end if;

  -- Another device has already claimed this revision or a later one. Hand its
  -- copy back rather than overwriting; the client resolves it.
  --
  -- `>=`, not `>`. A client derives the revision it sends from the last one the
  -- server acknowledged *to it*, so an incoming revision that merely equals the
  -- stored one means some other device got there first with different content.
  -- Accepting the tie silently discarded that device's work.
  if found and existing.revision >= p_revision then
    return json_build_object(
      'status',     'stale',
      'revision',   existing.revision,
      'doc',        existing.doc,
      'updated_at', existing.updated_at
    );
  end if;

  insert into public.notebooks (
    id, owner_id, name, description, doc, revision,
    page_count, template_count, page_size_label, created_at, updated_at
  )
  values (
    p_id, auth.uid(), p_name, p_description, p_doc, greatest(p_revision, 1),
    p_page_count, p_template_count, p_page_size_label,
    coalesce(p_created_at, now()), coalesce(p_updated_at, now())
  )
  on conflict (id) do update
     set name            = excluded.name,
         description     = excluded.description,
         doc             = excluded.doc,
         revision        = excluded.revision,
         page_count      = excluded.page_count,
         template_count  = excluded.template_count,
         page_size_label = excluded.page_size_label,
         updated_at      = excluded.updated_at,
         -- Re-pushing a notebook that was deleted on another device revives it,
         -- which is what the user means by editing it again.
         deleted_at      = null
  returning * into saved;

  return json_build_object('status', 'ok', 'revision', saved.revision);
end;
$fn$;

grant execute on function public.push_notebook(
  text, jsonb, integer, text, text, integer, integer, text, timestamptz, timestamptz
) to authenticated;

create or replace function public.increment_notebook_view(target text)
returns void
language sql
security definer
set search_path = public
as $fn$
  update public.notebooks
     set view_count = view_count + 1
   where id = target and is_published and deleted_at is null;
$fn$;

-- One round trip for the admin dashboard instead of a dozen counts. Raises
-- rather than returning empty so a non-admin caller gets an explicit error.
create or replace function public.admin_overview()
returns json
language plpgsql
security definer
set search_path = public
as $fn$
declare result json;
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;

  select json_build_object(
    'users',       (select count(*) from public.profiles),
    'admins',      (select count(*) from public.profiles where role = 'admin'),
    'banned',      (select count(*) from public.profiles where banned_at is not null),
    'newUsers7d',  (select count(*) from public.profiles where created_at > now() - interval '7 days'),
    'notebooks',   (select count(*) from public.notebooks where deleted_at is null),
    'published',   (select count(*) from public.notebooks where is_published and deleted_at is null),
    'likes',       (select count(*) from public.notebook_likes),
    'saves',       (select count(*) from public.notebook_saves),
    'ratings',     (select count(*) from public.notebook_ratings),
    'openReports', (select count(*) from public.notebook_reports where status = 'open'),
    'avgRating',   (select coalesce(round(avg(rating_avg), 2), 0)
                      from public.notebooks where rating_count > 0),
    'totalPages',  (select coalesce(sum(page_count), 0)
                      from public.notebooks where deleted_at is null),
    'signupsByDay', (
      select coalesce(json_agg(row_to_json(d) order by d.day), '[]'::json) from (
        select date_trunc('day', created_at)::date as day, count(*) as count
          from public.profiles
         where created_at > now() - interval '30 days'
         group by 1
      ) d
    )
  ) into result;

  return result;
end;
$fn$;

grant execute on function public.admin_overview() to authenticated;
grant execute on function public.increment_notebook_view(text) to anon, authenticated;
