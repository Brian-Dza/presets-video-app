import type { EditorTarget, PresetRecord, PresetVersionRecord, TeamSummary } from '../domain/preset';
import { demoTeam, starterPresets } from '../data/starterPresets';
import { buildManifestFromPreset } from './presetFiles';

const PRESET_KEY = 'framebase.presets.v1';
const PRESET_VERSIONS_KEY = 'framebase.preset-versions.v1';
const TEAM_KEY = 'framebase.teams.v1';
const CURRENT_TEAM_KEY = 'framebase.current-team.v1';
const TARGET_EDITOR_KEY = 'framebase.target-editor.v1';
const MAX_VERSIONS_PER_PRESET = 15;

function readJson<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function getPreferredEditorTarget(): EditorTarget {
  if (typeof window !== 'undefined' && window.premiereBridge) return 'premiere';
  if (typeof window !== 'undefined' && window.resolveBridge) return 'resolve';
  const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(TARGET_EDITOR_KEY) : null;
  return stored === 'premiere' ? 'premiere' : 'resolve';
}

export function setPreferredEditorTarget(target: EditorTarget): void {
  localStorage.setItem(TARGET_EDITOR_KEY, target);
}

export function listLocalTeams(): TeamSummary[] {
  const teams = readJson<TeamSummary[]>(TEAM_KEY, [demoTeam]);
  if (!teams.some((team) => team.id === demoTeam.id)) return [demoTeam, ...teams];
  return teams;
}

export function getCurrentLocalTeamId(): string {
  const current = localStorage.getItem(CURRENT_TEAM_KEY);
  return listLocalTeams().some((team) => team.id === current) ? current! : demoTeam.id;
}

export function setCurrentLocalTeamId(teamId: string): void {
  localStorage.setItem(CURRENT_TEAM_KEY, teamId);
}

export function createLocalTeam(name: string): TeamSummary {
  const teams = listLocalTeams();
  const team = { id: crypto.randomUUID(), name: name.trim(), role: 'owner' as const };
  const next = [...teams, team];
  localStorage.setItem(TEAM_KEY, JSON.stringify(next));
  setCurrentLocalTeamId(team.id);
  return team;
}

export function isStarterPresetId(presetId: string): boolean {
  return starterPresets.some((item) => item.id === presetId);
}

export function listLocalPresets(teamId: string): PresetRecord[] {
  const stored = readJson<PresetRecord[]>(PRESET_KEY, []);
  const userPresets = stored.filter((preset) => preset.teamId === teamId);
  const base = teamId === demoTeam.id
    ? starterPresets.map((preset) => ({ ...preset, favorite: preset.favorite || false }))
    : [];
  const byId = new Map<string, PresetRecord>();
  for (const preset of base) {
    byId.set(preset.id, preset);
  }
  for (const preset of userPresets) {
    byId.set(preset.id, preset);
  }
  return [...byId.values()].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

function versionRecordFromPreset(preset: PresetRecord): PresetVersionRecord {
  const filesMeta = (preset.nativeFiles ?? []).map(({ path, role }) => ({ path, role }));
  return {
    presetId: preset.id,
    version: preset.version,
    createdAt: preset.updatedAt,
    manifest: buildManifestFromPreset(preset, filesMeta),
  };
}

export function listLocalPresetVersions(presetId: string, fallbackPreset?: PresetRecord): PresetVersionRecord[] {
  const all = readJson<PresetVersionRecord[]>(PRESET_VERSIONS_KEY, []);
  const matching = all
    .filter((entry) => entry.presetId === presetId)
    .sort((a, b) => b.version - a.version);
  if (matching.length > 0) return matching;
  return fallbackPreset ? [versionRecordFromPreset(fallbackPreset)] : [];
}

function recordLocalPresetVersion(preset: PresetRecord, previous?: PresetRecord): void {
  const all = readJson<PresetVersionRecord[]>(PRESET_VERSIONS_KEY, []);
  const otherPresets = all.filter((entry) => entry.presetId !== preset.id);
  let mine = all.filter((entry) => entry.presetId === preset.id);

  if (previous && previous.version !== preset.version && !mine.some((entry) => entry.version === previous.version)) {
    mine.push(versionRecordFromPreset(previous));
  }

  mine = mine.filter((entry) => entry.version !== preset.version);
  mine.push(versionRecordFromPreset(preset));
  mine.sort((a, b) => b.version - a.version);

  localStorage.setItem(
    PRESET_VERSIONS_KEY,
    JSON.stringify([...mine.slice(0, MAX_VERSIONS_PER_PRESET), ...otherPresets])
  );
}

export function deleteLocalPresetVersions(presetId: string): void {
  const all = readJson<PresetVersionRecord[]>(PRESET_VERSIONS_KEY, []);
  localStorage.setItem(
    PRESET_VERSIONS_KEY,
    JSON.stringify(all.filter((entry) => entry.presetId !== presetId))
  );
}

export function saveLocalPreset(preset: PresetRecord, options?: { recordVersion?: boolean }): void {
  const previous = listLocalPresets(preset.teamId).find((item) => item.id === preset.id);
  const presets = readJson<PresetRecord[]>(PRESET_KEY, []);
  const next = presets.filter((item) => item.id !== preset.id);
  const { nativeFiles: _nativeFiles, ...metadata } = preset;
  localStorage.setItem(PRESET_KEY, JSON.stringify([{ ...metadata, nativeFiles: [] }, ...next]));
  if (options?.recordVersion !== false) {
    recordLocalPresetVersion(preset, previous);
  }
}

export function deleteLocalPreset(presetId: string): void {
  const presets = readJson<PresetRecord[]>(PRESET_KEY, []);
  localStorage.setItem(PRESET_KEY, JSON.stringify(presets.filter((preset) => preset.id !== presetId)));
  deleteLocalPresetVersions(presetId);
}

export function setLocalFavorite(presetId: string, favorite: boolean): PresetRecord | undefined {
  const preset = listLocalPresets(getCurrentLocalTeamId()).find((item) => item.id === presetId);
  if (!preset) return undefined;
  const next = { ...preset, favorite };
  saveLocalPreset(next, { recordVersion: false });
  return next;
}
