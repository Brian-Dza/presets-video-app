-- Migración aditiva Fase 3: gestión de miembros, roles, invitaciones pendientes y versiones en equipos

create or replace function private.shares_team_with(p_target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.team_members as me
    join public.team_members as peer
      on peer.team_id = me.team_id
    where me.user_id = (select auth.uid())
      and peer.user_id = p_target_user_id
  );
$$;

revoke all on function private.shares_team_with(uuid) from public, anon;
grant execute on function private.shares_team_with(uuid) to authenticated;

drop policy if exists "Co-members can read teammate profiles" on public.profiles;
create policy "Co-members can read teammate profiles" on public.profiles
  for select to authenticated
  using (private.shares_team_with(id));

grant update (role), delete on public.team_members to authenticated;

drop policy if exists "Owners update teammate roles" on public.team_members;
create policy "Owners update teammate roles" on public.team_members
  for update to authenticated
  using (
    private.has_team_role(team_id, array['owner'])
    and user_id <> (select auth.uid())
  )
  with check (
    private.has_team_role(team_id, array['owner'])
    and user_id <> (select auth.uid())
    and role in ('owner', 'editor', 'viewer')
  );

drop policy if exists "Owners remove members or members leave" on public.team_members;
create policy "Owners remove members or members leave" on public.team_members
  for delete to authenticated
  using (
    (private.has_team_role(team_id, array['owner']) and user_id <> (select auth.uid()))
    or (user_id = (select auth.uid()) and role <> 'owner')
  );

grant update on public.preset_versions to authenticated;

drop policy if exists "Editors update preset versions" on public.preset_versions;
create policy "Editors update preset versions" on public.preset_versions
  for update to authenticated
  using (private.has_team_role(team_id, array['owner', 'editor']))
  with check (private.has_team_role(team_id, array['owner', 'editor']));

grant select (id, team_id, email, created_by, expires_at, accepted_at, created_at), delete
  on public.team_invitations to authenticated;

drop policy if exists "Team editors view invitations" on public.team_invitations;
create policy "Team editors view invitations" on public.team_invitations
  for select to authenticated
  using (private.has_team_role(team_id, array['owner', 'editor']));

drop policy if exists "Team owners revoke invitations" on public.team_invitations;
create policy "Team owners revoke invitations" on public.team_invitations
  for delete to authenticated
  using (private.has_team_role(team_id, array['owner', 'editor']));
