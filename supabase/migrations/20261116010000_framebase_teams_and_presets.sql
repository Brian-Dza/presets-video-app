create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.teams (
  id uuid primary key default extensions.gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 2 and 80),
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.team_members (
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'editor', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (team_id, user_id)
);

create index if not exists team_members_user_id_idx on public.team_members(user_id);

create table if not exists public.presets (
  id uuid primary key default extensions.gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 100),
  description text not null default '',
  category text not null check (category in ('transition', 'effect', 'title', 'subtitle', 'graphic', 'sticker')),
  manifest jsonb not null default '{}'::jsonb,
  version integer not null default 1 check (version > 0),
  asset_path text,
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (team_id, name)
);

create index if not exists presets_team_updated_idx on public.presets(team_id, updated_at desc);

create table if not exists public.preset_versions (
  id uuid primary key default extensions.gen_random_uuid(),
  preset_id uuid not null references public.presets(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  version integer not null check (version > 0),
  manifest jsonb not null,
  asset_path text not null,
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (preset_id, version)
);

create index if not exists preset_versions_team_idx on public.preset_versions(team_id, created_at desc);

create table if not exists public.team_invitations (
  id uuid primary key default extensions.gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  email text not null,
  token_hash text not null unique,
  created_by uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists team_invitations_team_idx on public.team_invitations(team_id, expires_at desc);

create or replace function private.is_team_member(p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.team_members as tm
    where tm.team_id = p_team_id and tm.user_id = (select auth.uid())
  );
$$;

create or replace function private.has_team_role(p_team_id uuid, p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.team_members as tm
    where tm.team_id = p_team_id
      and tm.user_id = (select auth.uid())
      and tm.role = any(p_roles)
  );
$$;

revoke all on function private.is_team_member(uuid) from public, anon;
revoke all on function private.has_team_role(uuid, text[]) from public, anon;
grant execute on function private.is_team_member(uuid) to authenticated;
grant execute on function private.has_team_role(uuid, text[]) to authenticated;

create or replace function private.add_team_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.team_members(team_id, user_id, role)
  values (new.id, new.created_by, 'owner');
  return new;
end;
$$;

drop trigger if exists teams_add_owner on public.teams;
create trigger teams_add_owner
after insert on public.teams
for each row execute function private.add_team_owner();

create or replace function private.create_profile_for_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles(id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1), ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists auth_user_profile on auth.users;
create trigger auth_user_profile
after insert on auth.users
for each row execute function private.create_profile_for_user();

alter table public.profiles enable row level security;
alter table public.teams enable row level security;
alter table public.team_members enable row level security;
alter table public.presets enable row level security;
alter table public.preset_versions enable row level security;
alter table public.team_invitations enable row level security;

grant select, insert, update on public.profiles to authenticated;
grant select, insert, update, delete on public.teams to authenticated;
grant select on public.team_members to authenticated;
grant select, insert, update, delete on public.presets to authenticated;
grant select, insert on public.preset_versions to authenticated;
grant all on public.team_invitations to service_role;

create policy "Profiles are visible to their owner" on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy "Users update their own profile" on public.profiles
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy "Members can read their teams" on public.teams
  for select to authenticated using (private.is_team_member(id));
create policy "Users create a team for themselves" on public.teams
  for insert to authenticated with check (created_by = (select auth.uid()));
create policy "Owners update team settings" on public.teams
  for update to authenticated using (private.has_team_role(id, array['owner']))
  with check (private.has_team_role(id, array['owner']));
create policy "Owners delete teams" on public.teams
  for delete to authenticated using (private.has_team_role(id, array['owner']));

create policy "Members can read team memberships" on public.team_members
  for select to authenticated using (private.is_team_member(team_id));

create policy "Members can read team presets" on public.presets
  for select to authenticated using (private.is_team_member(team_id));
create policy "Editors create team presets" on public.presets
  for insert to authenticated with check (private.has_team_role(team_id, array['owner', 'editor']) and created_by = (select auth.uid()));
create policy "Editors update team presets" on public.presets
  for update to authenticated using (private.has_team_role(team_id, array['owner', 'editor']))
  with check (private.has_team_role(team_id, array['owner', 'editor']));
create policy "Editors delete team presets" on public.presets
  for delete to authenticated using (private.has_team_role(team_id, array['owner', 'editor']));

create policy "Members can read preset history" on public.preset_versions
  for select to authenticated using (private.is_team_member(team_id));
create policy "Editors create preset versions" on public.preset_versions
  for insert to authenticated with check (private.has_team_role(team_id, array['owner', 'editor']) and created_by = (select auth.uid()));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('preset-assets', 'preset-assets', false, 52428800, array['application/x-davinci-resolve-template', 'application/octet-stream'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy "Team members read preset packages" on storage.objects
  for select to authenticated using (
    bucket_id = 'preset-assets'
    and exists (select 1 from public.team_members tm where tm.team_id::text = split_part(name, '/', 1) and tm.user_id = (select auth.uid()))
  );
create policy "Team editors upload preset packages" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'preset-assets'
    and exists (select 1 from public.team_members tm where tm.team_id::text = split_part(name, '/', 1) and tm.user_id = (select auth.uid()) and tm.role in ('owner', 'editor'))
  );
create policy "Team editors replace preset packages" on storage.objects
  for update to authenticated using (
    bucket_id = 'preset-assets'
    and exists (select 1 from public.team_members tm where tm.team_id::text = split_part(name, '/', 1) and tm.user_id = (select auth.uid()) and tm.role in ('owner', 'editor'))
  ) with check (
    bucket_id = 'preset-assets'
    and exists (select 1 from public.team_members tm where tm.team_id::text = split_part(name, '/', 1) and tm.user_id = (select auth.uid()) and tm.role in ('owner', 'editor'))
  );
create policy "Team editors delete preset packages" on storage.objects
  for delete to authenticated using (
    bucket_id = 'preset-assets'
    and exists (select 1 from public.team_members tm where tm.team_id::text = split_part(name, '/', 1) and tm.user_id = (select auth.uid()) and tm.role in ('owner', 'editor'))
  );
