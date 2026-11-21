import type {
  MemberRole,
  NativeFile,
  PresetManifest,
  PresetRecord,
  PresetVersionRecord,
  TeamMemberSummary,
  TeamSummary,
} from '../domain/preset';
import { applyModeFor } from '../domain/preset';
import { buildManifestFromPreset, exportPackageForTarget, parsePresetFile } from './presetFiles';
import { saveNativeFiles } from './assetStore';
import { getSupabaseClient } from './supabase';

export interface TeamInvitationSummary {
  id: string;
  email: string;
  expiresAt: string;
  createdAt: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requireClient() {
  const client = getSupabaseClient();
  if (!client) throw new Error('La sincronización de equipos no está configurada.');
  return client;
}

export async function listCloudTeams(): Promise<TeamSummary[]> {
  const client = requireClient();
  const { data, error } = await client
    .from('team_members')
    .select('role, team:teams(id, name)')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).flatMap((row) => {
    const team = Array.isArray(row.team) ? row.team[0] : row.team;
    if (!team) return [];
    return [{ id: team.id, name: team.name, role: row.role } as TeamSummary];
  });
}

export async function createCloudTeam(name: string): Promise<TeamSummary> {
  const client = requireClient();
  const { data, error } = await client.from('teams').insert({ name: name.trim() }).select('id, name').single();
  if (error) throw error;
  return { id: data.id, name: data.name, role: 'owner' };
}

function recordFromRow(row: Record<string, unknown>): PresetRecord {
  const manifest = (row.manifest ?? {}) as Partial<PresetManifest>;
  const category = (row.category ?? manifest.category ?? 'title') as PresetRecord['category'];
  return {
    id: String(row.id),
    version: Number(row.version ?? manifest.version ?? 1),
    teamId: String(row.team_id),
    name: String(row.name ?? manifest.name ?? 'Preset'),
    description: String(row.description ?? manifest.description ?? ''),
    category,
    target: (manifest.target === 'premiere' ? 'premiere' : 'resolve') as PresetRecord['target'],
    templateName: String(manifest.templateName ?? row.name ?? 'Preset'),
    applyMode: (manifest.applyMode ?? applyModeFor(category)) as PresetRecord['applyMode'],
    durationSeconds: Number(manifest.durationSeconds ?? 2.5),
    text: typeof manifest.text === 'string' ? manifest.text : undefined,
    accent: String(manifest.accent ?? '#7c5cff'),
    secondaryAccent: typeof manifest.secondaryAccent === 'string' ? manifest.secondaryAccent : undefined,
    animation: String(manifest.animation ?? 'Desvanecer'),
    curve: manifest.curve,
    positionX: typeof manifest.positionX === 'number' ? manifest.positionX : undefined,
    positionY: typeof manifest.positionY === 'number' ? manifest.positionY : undefined,
    anchorPoint: manifest.anchorPoint,
    pivotX: typeof manifest.pivotX === 'number' ? manifest.pivotX : undefined,
    pivotY: typeof manifest.pivotY === 'number' ? manifest.pivotY : undefined,
    rotationDeg: typeof manifest.rotationDeg === 'number' ? manifest.rotationDeg : undefined,
    scale: typeof manifest.scale === 'number' ? manifest.scale : undefined,
    intensity: typeof manifest.intensity === 'number' ? manifest.intensity : undefined,
    spread: typeof manifest.spread === 'number' ? manifest.spread : undefined,
    fontFamily: manifest.fontFamily,
    tracking: typeof manifest.tracking === 'number' ? manifest.tracking : undefined,
    uppercase: typeof manifest.uppercase === 'boolean' ? manifest.uppercase : undefined,
    shadow: typeof manifest.shadow === 'boolean' ? manifest.shadow : undefined,
    backgroundBox: typeof manifest.backgroundBox === 'boolean' ? manifest.backgroundBox : undefined,
    plateRadius: typeof manifest.plateRadius === 'number' ? manifest.plateRadius : undefined,
    plateOpacity: typeof manifest.plateOpacity === 'number' ? manifest.plateOpacity : undefined,
    transitionStyle: manifest.transitionStyle,
    effectStyle: manifest.effectStyle,
    layers: Array.isArray(manifest.layers) ? manifest.layers : undefined,
    bezier: Array.isArray(manifest.bezier) && manifest.bezier.length === 4 ? manifest.bezier : undefined,
    timelineMode: manifest.timelineMode,
    keyframeTracks: Array.isArray(manifest.keyframeTracks) ? manifest.keyframeTracks : undefined,
    timelinePhases: manifest.timelinePhases,
    audioSfx: manifest.audioSfx,
    aspectRatio: manifest.aspectRatio,
    lutName: typeof manifest.lutName === 'string' ? manifest.lutName : undefined,
    lutMix: typeof manifest.lutMix === 'number' ? manifest.lutMix : undefined,
    lutData: typeof manifest.lutData === 'string' ? manifest.lutData : undefined,
    tags: Array.isArray(manifest.tags) ? manifest.tags.filter((tag): tag is string => typeof tag === 'string') : [],
    author: 'Equipo',
    updatedAt: String(row.updated_at ?? new Date().toISOString()),
    favorite: false,
    source: 'imported',
    nativeFiles: [],
    assetPath: typeof row.asset_path === 'string' ? row.asset_path : undefined,
  };
}

export async function listCloudPresets(teamId: string): Promise<PresetRecord[]> {
  const client = requireClient();
  const { data, error } = await client
    .from('presets')
    .select('id, team_id, name, description, category, manifest, version, asset_path, updated_at')
    .eq('team_id', teamId)
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => recordFromRow(row as Record<string, unknown>));
}

export async function uploadCloudPreset(preset: PresetRecord, nativeFiles: PresetRecord['nativeFiles']): Promise<void> {
  const client = requireClient();
  const cloudId = UUID_RE.test(preset.id) ? preset.id : crypto.randomUUID();
  const normalizedPreset: PresetRecord = cloudId === preset.id ? preset : { ...preset, id: cloudId };
  const exported = exportPackageForTarget(normalizedPreset, nativeFiles, normalizedPreset.target);
  const manifest = buildManifestFromPreset(
    normalizedPreset,
    nativeFiles.map(({ path, role }) => ({ path, role }))
  );
  const assetPath = `${normalizedPreset.teamId}/${normalizedPreset.id}/v${normalizedPreset.version}.${exported.extension}`;
  const { error: uploadError } = await client.storage.from('preset-assets').upload(assetPath, exported.bytes, {
    contentType: 'application/octet-stream',
    upsert: true,
  });
  if (uploadError) throw uploadError;

  const row = {
    id: normalizedPreset.id,
    team_id: normalizedPreset.teamId,
    name: normalizedPreset.name,
    description: normalizedPreset.description,
    category: normalizedPreset.category,
    manifest,
    version: normalizedPreset.version,
    asset_path: assetPath,
  };
  const { error: presetError } = await client.from('presets').upsert(row);
  if (presetError) throw presetError;
  const { error: versionError } = await client.from('preset_versions').upsert(
    {
      preset_id: normalizedPreset.id,
      team_id: normalizedPreset.teamId,
      version: normalizedPreset.version,
      manifest,
      asset_path: assetPath,
    },
    { onConflict: 'preset_id,version' }
  );
  if (versionError) throw versionError;
}

export async function listCloudPresetVersions(presetId: string): Promise<PresetVersionRecord[]> {
  const client = requireClient();
  if (!UUID_RE.test(presetId)) return [];
  const { data, error } = await client
    .from('preset_versions')
    .select('preset_id, version, manifest, asset_path, created_at')
    .eq('preset_id', presetId)
    .order('version', { ascending: false })
    .limit(15);
  if (error) throw error;
  return (data ?? []).map((row) => ({
    presetId: String(row.preset_id),
    version: Number(row.version),
    createdAt: String(row.created_at ?? new Date().toISOString()),
    manifest: (row.manifest ?? {}) as PresetManifest,
    assetPath: typeof row.asset_path === 'string' ? row.asset_path : undefined,
  }));
}

export async function deleteCloudPreset(presetId: string): Promise<void> {
  const client = requireClient();
  const { error } = await client.from('presets').delete().eq('id', presetId);
  if (error) throw error;
}

export async function downloadCloudPreset(preset: PresetRecord): Promise<PresetRecord> {
  const client = requireClient();
  if (!preset.assetPath) return preset;
  const { data, error } = await client.storage.from('preset-assets').download(preset.assetPath);
  if (error) throw error;
  const extMatch = preset.assetPath.match(/\.(drfx|mogrt|prfpset)$/i);
  const ext = extMatch ? extMatch[1].toLowerCase() : 'drfx';
  const imported = await parsePresetFile(new File([data], `${preset.name}.${ext}`), preset.teamId);
  await saveNativeFiles(preset.id, imported.nativeFiles);
  return { ...preset, nativeFiles: imported.nativeFiles };
}

export async function listCloudTeamMembers(teamId: string): Promise<TeamMemberSummary[]> {
  const client = requireClient();
  const [{ data: authData }, { data, error }] = await Promise.all([
    client.auth.getUser(),
    client
      .from('team_members')
      .select('user_id, role, created_at')
      .eq('team_id', teamId)
      .order('created_at', { ascending: true }),
  ]);
  if (error) throw error;

  const rows = data ?? [];
  const userIds = rows.map((row) => String(row.user_id));
  const profileNames = new Map<string, string>();

  if (userIds.length > 0) {
    const { data: profiles } = await client
      .from('profiles')
      .select('id, display_name')
      .in('id', userIds);
    for (const profile of profiles ?? []) {
      if (profile.display_name) {
        profileNames.set(String(profile.id), String(profile.display_name));
      }
    }
  }

  const selfId = authData.user?.id;
  return rows.map((row) => {
    const userId = String(row.user_id);
    const isSelf = userId === selfId;
    const fallbackName = isSelf
      ? authData.user?.email?.split('@')[0] ?? 'Tú'
      : `Miembro ${userId.slice(0, 6)}`;
    return {
      userId,
      displayName: profileNames.get(userId) || fallbackName,
      role: row.role as MemberRole,
      joinedAt: String(row.created_at ?? new Date().toISOString()),
      isSelf,
    };
  });
}

export async function updateCloudMemberRole(teamId: string, userId: string, role: MemberRole): Promise<void> {
  const client = requireClient();
  const { error } = await client
    .from('team_members')
    .update({ role })
    .eq('team_id', teamId)
    .eq('user_id', userId);
  if (error) throw error;
}

export async function removeCloudTeamMember(teamId: string, userId: string): Promise<void> {
  const client = requireClient();
  const { error } = await client
    .from('team_members')
    .delete()
    .eq('team_id', teamId)
    .eq('user_id', userId);
  if (error) throw error;
}

export async function listCloudPendingInvitations(teamId: string): Promise<TeamInvitationSummary[]> {
  const client = requireClient();
  const { data, error } = await client
    .from('team_invitations')
    .select('id, email, expires_at, accepted_at, created_at')
    .eq('team_id', teamId)
    .is('accepted_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false });
  if (error) return [];
  return (data ?? []).map((row) => ({
    id: String(row.id),
    email: String(row.email),
    expiresAt: String(row.expires_at),
    createdAt: String(row.created_at),
  }));
}

export async function revokeCloudInvitation(invitationId: string): Promise<void> {
  const client = requireClient();
  const { error } = await client.from('team_invitations').delete().eq('id', invitationId);
  if (error) throw error;
}

export async function syncLocalPresetsToCloudTeam(
  localPresets: PresetRecord[],
  targetTeamId: string,
  getFiles: (preset: PresetRecord) => Promise<NativeFile[]>
): Promise<number> {
  const existing = await listCloudPresets(targetTeamId);
  const existingByName = new Map(existing.map((item) => [item.name.trim().toLowerCase(), item]));
  let syncedCount = 0;

  for (const localPreset of localPresets) {
    const key = localPreset.name.trim().toLowerCase();
    const match = existingByName.get(key);
    const files = await getFiles(localPreset);
    const cloudRecord: PresetRecord = {
      ...localPreset,
      id: match ? match.id : crypto.randomUUID(),
      teamId: targetTeamId,
      version: match ? match.version + 1 : Math.max(1, localPreset.version),
      updatedAt: new Date().toISOString(),
    };
    await uploadCloudPreset(cloudRecord, files);
    syncedCount += 1;
  }

  return syncedCount;
}

export async function requestInvite(teamId: string, email: string): Promise<string> {
  const client = requireClient();
  const { data, error } = await client.functions.invoke('create-team-invite', { body: { teamId, email } });
  if (error) throw error;
  return String(data?.code ?? '');
}

export async function acceptInvite(code: string): Promise<string> {
  const client = requireClient();
  const { data, error } = await client.functions.invoke('accept-team-invite', { body: { code } });
  if (error) throw error;
  if (typeof data?.teamId !== 'string') throw new Error('La invitación se aceptó, pero no se pudo identificar el equipo.');
  return data.teamId;
}
