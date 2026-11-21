import { useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent } from 'react';
import { PresetEditorStudioModal } from './components/PresetStudio/PresetEditorStudioModal';
import {
  ArrowDownToLine,
  ArrowRight,
  Captions,
  Check,
  ChevronDown,
  CircleHelp,
  Cloud,
  Film,
  FolderOpen,
  HardDriveDownload,
  History,
  Layers,
  LayoutGrid,
  List,
  LockKeyhole,
  LogOut,
  Mail,
  Menu,
  MoreHorizontal,
  MoveRight,
  Pencil,
  Pin,
  Play,
  Plus,
  RotateCcw,
  Search,
  Settings,
  Shapes,
  Smile,
  Sparkles,
  Star,
  Type,
  Upload,
  Users,
  WandSparkles,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import type {
  CreatePresetInput,
  EditorTarget,
  PresetCategory,
  PresetRecord,
  PresetVersionRecord,
  TeamSummary,
} from './domain/preset';
import {
  applyModeFor,
  categories,
  categoryLabels,
  categoryPaths,
  curveLabels,
  defaultCurveFor,
  editorLabels,
  fontLabels,
} from './domain/preset';
import { demoTeam, starterPresets } from './data/starterPresets';
import {
  createLocalTeam,
  deleteLocalPreset,
  getCurrentLocalTeamId,
  getPreferredEditorTarget,
  isStarterPresetId,
  listLocalPresets,
  listLocalPresetVersions,
  listLocalTeams,
  saveLocalPreset,
  setCurrentLocalTeamId,
  setLocalFavorite,
  setPreferredEditorTarget,
} from './lib/localStore';
import { deleteNativeFiles, readNativeFiles, saveNativeFiles } from './lib/assetStore';
import {
  acceptInvite,
  createCloudTeam,
  deleteCloudPreset,
  downloadCloudPreset,
  listCloudPresets,
  listCloudPresetVersions,
  listCloudTeams,
  requestInvite,
  syncLocalPresetsToCloudTeam,
  uploadCloudPreset,
} from './lib/cloudRepository';
import {
  packageFileNameForTarget,
  parsePresetCollectionFile,
  savePresetCollectionPack,
  savePresetPackage,
} from './lib/presetFiles';
import { createFusionTemplate, safePresetFileName, templateFileName } from './lib/templateFactory';
import {
  clearRuntimeCloudConfig,
  getCloudConfig,
  getSupabaseClient,
  isCloudConfiguredNow,
  saveRuntimeCloudConfig,
  testCloudConnection,
} from './lib/supabase';
import {
  applyPresetToEditor,
  fetchLocalEditorsStatus,
  installPresetLocallyInPremiere,
  installPresetLocallyInResolve,
} from './lib/editorHostBridge';
import { PresetPreviewPlayer } from './components/PresetPreviewPlayer';
import { TeamWorkspaceModal, type TeamModalMode } from './components/TeamWorkspaceModal';
import type { LocalEditorsStatus, PremiereContext, ResolveContext } from './env';

type ViewMode = 'all' | 'favorites' | 'created';
type LayoutMode = 'grid' | 'list';
type Notice = { kind: 'success' | 'error' | 'info'; title: string; body?: string };

const LAYOUT_MODE_KEY = 'framebase.layout-mode.v1';

const categoryIcons: Record<PresetCategory, LucideIcon> = {
  transition: MoveRight,
  effect: Zap,
  title: Type,
  subtitle: Captions,
  graphic: Shapes,
  sticker: Smile,
};

const categoryFilters: Array<{ id: 'all' | PresetCategory; label: string }> = [
  { id: 'all', label: 'Todos' },
  ...categories.map((id) => ({ id, label: categoryLabels[id] })),
];

const initialResolveContext: ResolveContext = { connected: false, selectedClipCount: 0 };
const initialPremiereContext: PremiereContext = { connected: false };
const initialEditorsStatus: LocalEditorsStatus = {
  available: false,
  resolveInstalled: false,
  premiereInstalled: false,
};

export function formatResolveVersion(version?: ResolveContext['version']): string {
  if (Array.isArray(version)) {
    const parts = version.filter((part) => typeof part === 'number' || (typeof part === 'string' && /^\d+$/.test(part)));
    if (parts.length > 0) return parts.slice(0, 2).join('.');
  }
  if (typeof version === 'string' && version.trim()) {
    return version.trim().split('.').slice(0, 2).join('.');
  }
  return '21.1';
}

function makePresetRecord(
  input: CreatePresetInput,
  team: TeamSummary,
  existing?: PresetRecord
): PresetRecord {
  const now = new Date().toISOString();
  const id = existing?.id ?? input.id ?? crypto.randomUUID();
  const version = existing ? existing.version + 1 : 1;
  const preset: PresetRecord = {
    id,
    version,
    teamId: team.id,
    name: input.name.trim(),
    description: input.description.trim(),
    category: input.category,
    target: input.target ?? existing?.target ?? 'resolve',
    templateName: existing?.source === 'imported' ? existing.templateName : safePresetFileName(input.name),
    applyMode: applyModeFor(input.category),
    durationSeconds: input.durationSeconds,
    text: input.text.trim() || undefined,
    accent: input.accent,
    secondaryAccent: input.secondaryAccent,
    animation: input.animation,
    curve: input.curve ?? defaultCurveFor(input.category, input.animation),
    positionX: input.positionX,
    positionY: input.positionY,
    anchorPoint: input.anchorPoint,
    pivotX: input.pivotX,
    pivotY: input.pivotY,
    rotationDeg: input.rotationDeg,
    scale: input.scale,
    intensity: input.intensity,
    spread: input.spread,
    fontFamily: input.fontFamily,
    tracking: input.tracking,
    uppercase: input.uppercase,
    shadow: input.shadow,
    backgroundBox: input.backgroundBox,
    plateRadius: input.plateRadius,
    plateOpacity: input.plateOpacity,
    transitionStyle: input.transitionStyle,
    effectStyle: input.effectStyle,
    layers: input.layers,
    bezier: input.bezier,
    timelineMode: input.timelineMode,
    keyframeTracks: input.keyframeTracks,
    timelinePhases: input.timelinePhases,
    audioSfx: input.audioSfx,
    aspectRatio: input.aspectRatio,
    lutName: input.lutName,
    lutMix: input.lutMix,
    lutData: input.lutData,
    tags: input.tags,
    author: existing?.author ?? 'Tú',
    updatedAt: now,
    favorite: existing?.favorite ?? false,
    source: existing?.source === 'imported' ? 'imported' : 'created',
    nativeFiles: existing?.nativeFiles ?? [],
    assetPath: existing?.assetPath,
  };
  if (preset.source !== 'imported') {
    preset.templateName = templateFileName(preset).replace(/\.setting$/i, '');
  }
  return preset;
}

function IconBadge({ category }: { category: PresetCategory }) {
  const Icon = categoryIcons[category];
  return (
    <span className={`category-icon category-icon-${category}`}>
      <Icon size={14} strokeWidth={1.9} />
    </span>
  );
}

function PresetCard({
  preset,
  targetEditor,
  selectedForPack,
  canEdit,
  onToggleSelect,
  onPreview,
  onEdit,
  onApply,
  onFavorite,
  onExport,
  busy,
}: {
  preset: PresetRecord;
  targetEditor: EditorTarget;
  selectedForPack: boolean;
  canEdit: boolean;
  onToggleSelect: () => void;
  onPreview: () => void;
  onEdit: () => void;
  onApply: () => void;
  onFavorite: () => void;
  onExport: () => void;
  busy: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const exportExt = targetEditor === 'premiere'
    ? (['title', 'subtitle', 'graphic', 'sticker'].includes(preset.category) ? '.mogrt' : '.prfpset')
    : '.drfx';

  return (
    <article
      className={`preset-card${selectedForPack ? ' is-selected' : ''}`}
      data-testid="preset-card"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        type="button"
        className={`card-select-btn${selectedForPack ? ' is-checked' : ''}`}
        aria-label={`Seleccionar ${preset.name}`}
        aria-pressed={selectedForPack}
        onClick={onToggleSelect}
        title="Añadir al pack de colección"
      >
        <Check size={13} strokeWidth={2.6} />
      </button>
      <button
        className="preset-art-button"
        onClick={onPreview}
        onFocus={() => setHovered(true)}
        onBlur={() => setHovered(false)}
        type="button"
        aria-label={`Ver ${preset.name}`}
      >
        <PresetPreviewPlayer preset={preset} hoverActive={hovered} />
        <span className="art-hover">
          <Play size={13} fill="currentColor" /> Vista previa
        </span>
      </button>
      <div className="preset-card-info">
        <div className="preset-title-row">
          <button className="preset-name-button" type="button" onClick={onPreview}>
            {preset.name}
          </button>
          <button
            className={`icon-button favorite-button${preset.favorite ? ' is-favorite' : ''}`}
            type="button"
            onClick={onFavorite}
            aria-label={preset.favorite ? 'Quitar de favoritos' : 'Guardar en favoritos'}
          >
            <Star size={15} fill={preset.favorite ? 'currentColor' : 'none'} />
          </button>
        </div>
        <div className="preset-meta-row">
          <span className="preset-category">
            <IconBadge category={preset.category} />
            {categoryLabels[preset.category]}
          </span>
          <span className="preset-duration">
            v{preset.version} · {preset.durationSeconds.toFixed(1)} s
          </span>
        </div>
        <div className="preset-card-footer">
          <span className="preset-author">
            <span className="author-dot">{preset.author.slice(0, 1).toUpperCase()}</span>
            {preset.author}
          </span>
          <div className="preset-quick-actions">
            {canEdit && (
              <button
                className="icon-button"
                type="button"
                title="Personalizar preset"
                aria-label={`Editar ${preset.name}`}
                onClick={onEdit}
              >
                <Pencil size={14} />
              </button>
            )}
            <button
              className="icon-button"
              type="button"
              title={`Exportar ${exportExt}`}
              aria-label={`Exportar ${preset.name}`}
              onClick={onExport}
            >
              <ArrowDownToLine size={15} />
            </button>
            <button className="apply-mini" type="button" disabled={busy} onClick={onApply}>
              {busy ? '...' : 'Aplicar'}
              <ArrowRight size={13} />
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}

function PresetListRow({
  preset,
  targetEditor,
  selectedForPack,
  canEdit,
  onToggleSelect,
  onPreview,
  onEdit,
  onApply,
  onFavorite,
  onExport,
  busy,
}: {
  preset: PresetRecord;
  targetEditor: EditorTarget;
  selectedForPack: boolean;
  canEdit: boolean;
  onToggleSelect: () => void;
  onPreview: () => void;
  onEdit: () => void;
  onApply: () => void;
  onFavorite: () => void;
  onExport: () => void;
  busy: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const exportExt = targetEditor === 'premiere'
    ? (['title', 'subtitle', 'graphic', 'sticker'].includes(preset.category) ? '.mogrt' : '.prfpset')
    : '.drfx';

  return (
    <article
      className={`preset-list-row${selectedForPack ? ' is-selected' : ''}`}
      data-testid="preset-card"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        type="button"
        className={`list-select-btn${selectedForPack ? ' is-checked' : ''}`}
        aria-label={`Seleccionar ${preset.name}`}
        aria-pressed={selectedForPack}
        onClick={onToggleSelect}
      >
        <Check size={12} strokeWidth={2.6} />
      </button>
      <button
        type="button"
        className="preset-list-thumb"
        onClick={onPreview}
        aria-label={`Ver ${preset.name}`}
      >
        <PresetPreviewPlayer preset={preset} hoverActive={hovered} />
      </button>
      <div className="preset-list-main">
        <div className="preset-list-title">
          <button className="preset-name-button" type="button" onClick={onPreview} style={{ flex: '0 1 auto' }}>
            {preset.name}
          </button>
          <span className="version-pill">v{preset.version}</span>
        </div>
        <p className="preset-list-desc">{preset.description}</p>
      </div>
      <div className="preset-list-meta">
        <span className="preset-category">
          <IconBadge category={preset.category} />
          {categoryLabels[preset.category]}
        </span>
        <span className="preset-duration">{preset.durationSeconds.toFixed(1)} s</span>
      </div>
      <div className="preset-quick-actions">
        <button
          className={`icon-button favorite-button${preset.favorite ? ' is-favorite' : ''}`}
          type="button"
          onClick={onFavorite}
          aria-label={preset.favorite ? 'Quitar de favoritos' : 'Guardar en favoritos'}
        >
          <Star size={15} fill={preset.favorite ? 'currentColor' : 'none'} />
        </button>
        {canEdit && (
          <button
            className="icon-button"
            type="button"
            title="Personalizar preset"
            aria-label={`Editar ${preset.name}`}
            onClick={onEdit}
          >
            <Pencil size={14} />
          </button>
        )}
        <button
          className="icon-button"
          type="button"
          title={`Exportar ${exportExt}`}
          aria-label={`Exportar ${preset.name}`}
          onClick={onExport}
        >
          <ArrowDownToLine size={15} />
        </button>
        <button className="apply-mini" type="button" disabled={busy} onClick={onApply}>
          {busy ? '...' : 'Aplicar'}
          <ArrowRight size={13} />
        </button>
      </div>
    </article>
  );
}

function Modal({ children, onClose, className = '' }: { children: React.ReactNode; onClose: () => void; className?: string }) {
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return (
    <div
      className="modal-scrim"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className={`modal-panel ${className}`} role="dialog" aria-modal="true">
        {children}
      </section>
    </div>
  );
}

function PresetDetailsModal({
  preset,
  targetEditor,
  isCloudUser,
  canEdit,
  resolveConnected,
  premiereConnected,
  editorsStatus,
  onClose,
  onEdit,
  onRestoreVersion,
  onApply,
  onExport,
  onFavorite,
  busy,
}: {
  preset: PresetRecord;
  targetEditor: EditorTarget;
  isCloudUser: boolean;
  canEdit: boolean;
  resolveConnected: boolean;
  premiereConnected: boolean;
  editorsStatus: LocalEditorsStatus;
  onClose: () => void;
  onEdit: () => void;
  onRestoreVersion: (versionRecord: PresetVersionRecord) => Promise<void>;
  onApply: () => void;
  onExport: () => void;
  onFavorite: () => void;
  busy: boolean;
}) {
  const [versions, setVersions] = useState<PresetVersionRecord[]>(() =>
    listLocalPresetVersions(preset.id, preset)
  );
  const [restoringVersion, setRestoringVersion] = useState<number | null>(null);

  useEffect(() => {
    const localList = listLocalPresetVersions(preset.id, preset);
    setVersions(localList);
    if (!isCloudUser) return;
    let active = true;
    listCloudPresetVersions(preset.id)
      .then((cloudList) => {
        if (!active || cloudList.length === 0) return;
        const merged = new Map<number, PresetVersionRecord>();
        for (const item of localList) merged.set(item.version, item);
        for (const item of cloudList) merged.set(item.version, item);
        setVersions([...merged.values()].sort((a, b) => b.version - a.version));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [preset, isCloudUser]);

  const activeCurve = preset.curve ?? defaultCurveFor(preset.category, preset.animation);
  const applyLabel = targetEditor === 'premiere'
    ? premiereConnected
      ? 'Insertar en Premiere Pro'
      : 'Instalar en Premiere Pro'
    : resolveConnected
      ? 'Aplicar en Resolve Studio'
      : editorsStatus.resolveInstalled
        ? 'Instalar y abrir en DaVinci Resolve'
        : 'Aplicar en Resolve';

  const exportExt = targetEditor === 'premiere'
    ? (['title', 'subtitle', 'graphic', 'sticker'].includes(preset.category) ? '.mogrt' : '.prfpset')
    : '.drfx';

  return (
    <Modal onClose={onClose} className="details-modal">
      <div className="details-art">
        <PresetPreviewPlayer preset={preset} large autoPlay />
        <button className="icon-button details-close" type="button" onClick={onClose} aria-label="Cerrar">
          <X size={18} />
        </button>
      </div>
      <div className="details-body">
        <div className="details-category">
          <IconBadge category={preset.category} />
          {categoryLabels[preset.category]}
          <span className="details-dot" />
          {preset.durationSeconds.toFixed(1)} s
          <span className="details-dot" />
          {preset.animation}
        </div>
        <h2>{preset.name}</h2>
        <p className="details-description">{preset.description}</p>

        <div className="details-specs-grid">
          {preset.text && (
            <div className="details-text">
              <span>TEXTO BASE</span>
              <strong>{preset.text}</strong>
            </div>
          )}
          {preset.fontFamily && (
            <div className="details-text">
              <span>TIPOGRAFÍA</span>
              <strong>{fontLabels[preset.fontFamily]}</strong>
            </div>
          )}
          <div className="details-text">
            <span>INTERPOLACIÓN</span>
            <strong>{curveLabels[activeCurve]}</strong>
          </div>
          <div className="details-text">
            <span>DESTINO ACTIVO</span>
            <strong>{editorLabels[targetEditor]} ({exportExt})</strong>
          </div>
        </div>

        <div className="details-tags">
          {preset.tags.map((tag) => (
            <span key={tag}>#{tag.replace(/\s+/g, '')}</span>
          ))}
        </div>

        <div className="version-history-panel" data-testid="version-history-panel">
          <div className="version-history-head">
            <span>
              <History size={12} style={{ marginRight: 5, verticalAlign: -2 }} />
              HISTORIAL DE VERSIONES
            </span>
            <span>{versions.length} guardadas</span>
          </div>
          <div className="version-list">
            {versions.map((entry) => {
              const isCurrent = entry.version === preset.version;
              const entryCurve = entry.manifest.curve ?? 'ease-out';
              return (
                <div key={entry.version} className="version-row">
                  <div className="version-row-info">
                    <strong>v{entry.version}</strong>
                    <span>{entry.manifest.name}</span>
                    <small>
                      {entry.manifest.animation} · {curveLabels[entryCurve].split(' ')[0]} ·{' '}
                      {new Date(entry.createdAt).toLocaleDateString('es-ES')}
                    </small>
                  </div>
                  {isCurrent ? (
                    <span className="status-pill status-pill-ok">Actual</span>
                  ) : canEdit ? (
                    <button
                      type="button"
                      className="version-restore-btn"
                      disabled={restoringVersion !== null}
                      aria-label={`Restaurar versión ${entry.version}`}
                      onClick={async () => {
                        setRestoringVersion(entry.version);
                        try {
                          await onRestoreVersion(entry);
                        } finally {
                          setRestoringVersion(null);
                        }
                      }}
                    >
                      <RotateCcw size={11} style={{ marginRight: 4, verticalAlign: -1 }} />
                      {restoringVersion === entry.version ? 'Restaurando...' : 'Restaurar'}
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>

        <div className="details-meta">
          <span className="preset-author">
            <span className="author-dot">{preset.author.slice(0, 1).toUpperCase()}</span>
            Por {preset.author}
          </span>
          <span>Versión {preset.version}</span>
        </div>

        <div className="details-actions">
          <button className="button-primary" type="button" onClick={onApply} disabled={busy}>
            {busy ? 'Procesando...' : applyLabel}
            <ArrowRight size={15} />
          </button>
          {canEdit && (
            <button className="button-secondary" type="button" onClick={onEdit}>
              <Pencil size={14} /> Personalizar
            </button>
          )}
          <button className="button-secondary" type="button" onClick={onExport}>
            <ArrowDownToLine size={15} /> Exportar {exportExt}
          </button>
          <button
            className={`icon-button details-favorite${preset.favorite ? ' is-favorite' : ''}`}
            onClick={onFavorite}
            type="button"
            aria-label="Cambiar favorito"
          >
            <Star size={17} fill={preset.favorite ? 'currentColor' : 'none'} />
          </button>
        </div>
      </div>
    </Modal>
  );
}

function SettingsModal({
  editorsStatus,
  syncingCatalog,
  onSyncCatalog,
  onCloudConfigChanged,
  onClose,
}: {
  editorsStatus: LocalEditorsStatus;
  syncingCatalog: boolean;
  onSyncCatalog: (target: EditorTarget) => Promise<void>;
  onCloudConfigChanged: () => void;
  onClose: () => void;
}) {
  const currentCloud = getCloudConfig();
  const [url, setUrl] = useState(currentCloud.url);
  const [anonKey, setAnonKey] = useState(currentCloud.anonKey);
  const [testing, setTesting] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [error, setError] = useState('');

  async function handleTestConnection() {
    setTesting(true);
    setError('');
    setStatusMessage('');
    const result = await testCloudConnection(url, anonKey);
    setTesting(false);
    if (result.ok) setStatusMessage(result.message);
    else setError(result.message);
  }

  function handleSaveCloud(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setStatusMessage('');
    try {
      saveRuntimeCloudConfig(url, anonKey);
      setStatusMessage('Proyecto Supabase guardado. Ahora puedes iniciar sesión y sincronizar equipos.');
      onCloudConfigChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo guardar la configuración.');
    }
  }

  function handleDisconnectCloud() {
    clearRuntimeCloudConfig();
    const fallback = getCloudConfig();
    setUrl(fallback.url);
    setAnonKey(fallback.anonKey);
    setStatusMessage('Configuración manual desconectada. Framebase continúa en modo local.');
    setError('');
    onCloudConfigChanged();
  }

  return (
    <Modal onClose={onClose} className="settings-modal">
      <header className="modal-header">
        <div>
          <div className="eyebrow">PREFERENCIAS E INTEGRACIONES</div>
          <h2>Ajustes de Framebase</h2>
          <p>Gestiona la instalación automática en DaVinci Resolve y Premiere Pro o conecta tu proyecto Supabase.</p>
        </div>
        <button className="icon-button modal-close" type="button" onClick={onClose} aria-label="Cerrar">
          <X size={18} />
        </button>
      </header>

      <div className="settings-body">
        <div className="settings-card">
          <div className="settings-card-head">
            <h3>Editores detectados en este equipo</h3>
            <span className={`status-pill${editorsStatus.available ? ' status-pill-ok' : ''}`}>
              {editorsStatus.available ? 'Puente local activo' : 'Modo descarga manual'}
            </span>
          </div>
          <div className="editor-path-list">
            <div className="editor-path-item">
              <strong>
                DaVinci Resolve {editorsStatus.resolveInstalled ? '· Detectado' : '· Carpeta de plantillas'}
              </strong>
              <code>
                {editorsStatus.resolveTemplatesDir ?? '%APPDATA%\\Blackmagic Design\\DaVinci Resolve\\Support\\Fusion\\Templates\\Edit'}
              </code>
            </div>
            <div className="editor-path-item">
              <strong>
                Adobe Premiere Pro {editorsStatus.premiereInstalled ? '· Detectado' : '· Motion Graphics Templates'}
              </strong>
              <code>
                {editorsStatus.premiereMogrtDir ?? '%APPDATA%\\Adobe\\Common\\Motion Graphics Templates\\Framebase'}
              </code>
            </div>
          </div>
          <div className="form-actions">
            <button
              type="button"
              className="button-secondary"
              disabled={syncingCatalog}
              onClick={() => void onSyncCatalog('premiere')}
            >
              <HardDriveDownload size={14} /> Instalar catálogo en Premiere
            </button>
            <button
              type="button"
              className="button-primary"
              disabled={syncingCatalog}
              onClick={() => void onSyncCatalog('resolve')}
            >
              <HardDriveDownload size={14} />
              {syncingCatalog ? 'Instalando...' : 'Instalar catálogo en Resolve'}
            </button>
          </div>
        </div>

        <form className="settings-card" onSubmit={handleSaveCloud}>
          <div className="settings-card-head">
            <h3>Equipos y sincronización (Supabase)</h3>
            <span className={`status-pill${currentCloud.configured ? ' status-pill-ok' : ''}`}>
              {currentCloud.configured ? `Conectado (${currentCloud.source === 'env' ? '.env' : 'UI'})` : 'Modo local'}
            </span>
          </div>
          <p style={{ margin: 0, fontSize: '12px', color: 'var(--soft)', lineHeight: 1.5 }}>
            Conecta tu propio proyecto Supabase usando únicamente el URL y la clave pública (<code>anon</code> o{' '}
            <code>sb_publishable_</code>). Las claves privadas permanecen exclusivamente en los secretos del servidor.
          </p>
          <label className="field-label">
            URL del proyecto Supabase
            <input
              type="url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://tu-proyecto.supabase.co"
            />
          </label>
          <label className="field-label">
            Clave pública (anon / publishable)
            <input
              type="password"
              value={anonKey}
              onChange={(event) => setAnonKey(event.target.value)}
              placeholder="eyJhbGciOi... o sb_publishable_..."
            />
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          {statusMessage && (
            <p className="form-message" role="status">
              {statusMessage}
            </p>
          )}
          <div className="form-actions form-actions-split">
            {currentCloud.source === 'runtime' ? (
              <button type="button" className="button-danger" onClick={handleDisconnectCloud}>
                Desconectar nube
              </button>
            ) : (
              <span />
            )}
            <div className="form-actions-right">
              <button type="button" className="button-secondary" disabled={testing} onClick={() => void handleTestConnection()}>
                {testing ? 'Verificando...' : 'Probar conexión'}
              </button>
              <button type="submit" className="button-primary">
                Guardar y conectar
              </button>
            </div>
          </div>
        </form>
      </div>
    </Modal>
  );
}

function AuthGate({ onDone, onContinueLocal }: { onDone: () => void; onContinueLocal: () => void }) {
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const client = getSupabaseClient();
    if (!client) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = isSignUp
        ? await client.auth.signUp({ email, password, options: { data: { name: displayName } } })
        : await client.auth.signInWithPassword({ email, password });
      if (result.error) throw result.error;
      if (result.data.session) onDone();
      else setMessage('Revisa tu correo para confirmar la cuenta y volver a iniciar sesión.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo iniciar sesión.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-glow" />
      <div className="auth-brand">
        <span className="brand-mark">
          <Film size={19} />
        </span>
        <span>framebase</span>
      </div>
      <section className="auth-card">
        <span className="auth-icon">
          <Users size={20} />
        </span>
        <div className="eyebrow">BIBLIOTECA DE EQUIPO</div>
        <h1>{isSignUp ? 'Crea tu cuenta' : 'Bienvenido de nuevo'}</h1>
        <p>Inicia sesión para acceder a los presets compartidos por tu equipo.</p>
        <form onSubmit={submit} className="auth-form">
          {isSignUp && (
            <label className="field-label">
              Nombre
              <input
                autoComplete="name"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                required
                placeholder="Tu nombre"
              />
            </label>
          )}
          <label className="field-label">
            Correo electrónico
            <div className="input-with-icon">
              <Mail size={15} />
              <input
                autoComplete="email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                placeholder="nombre@estudio.com"
              />
            </div>
          </label>
          <label className="field-label">
            Contraseña
            <div className="input-with-icon">
              <LockKeyhole size={15} />
              <input
                autoComplete={isSignUp ? 'new-password' : 'current-password'}
                type="password"
                minLength={8}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                placeholder="8 caracteres como mínimo"
              />
            </div>
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          {message && (
            <p className="form-message" role="status">
              {message}
            </p>
          )}
          <button className="button-primary auth-submit" type="submit" disabled={busy}>
            {busy ? 'Un momento...' : isSignUp ? 'Crear cuenta' : 'Iniciar sesión'}
            <ArrowRight size={15} />
          </button>
          <button className="button-secondary auth-submit" type="button" onClick={onContinueLocal}>
            Continuar en modo local
          </button>
        </form>
        <p className="auth-switch">
          {isSignUp ? '¿Ya tienes cuenta?' : '¿Primera vez aquí?'}{' '}
          <button
            type="button"
            onClick={() => {
              setIsSignUp(!isSignUp);
              setError('');
              setMessage('');
            }}
          >
            {isSignUp ? 'Inicia sesión' : 'Crea una cuenta'}
          </button>
        </p>
      </section>
      <div className="auth-footer">Framebase Presets · Tus archivos de video permanecen en tu computadora.</div>
    </div>
  );
}

function CloudWorkspaceSetup({
  onCreate,
  onJoin,
  onSignOut,
}: {
  onCreate: () => void;
  onJoin: () => void;
  onSignOut: () => void;
}) {
  return (
    <div className="auth-screen">
      <div className="auth-glow" />
      <div className="auth-brand">
        <span className="brand-mark">
          <Film size={19} />
        </span>
        <span>framebase</span>
      </div>
      <section className="auth-card">
        <span className="auth-icon">
          <Users size={20} />
        </span>
        <div className="eyebrow">BIBLIOTECA DE EQUIPO</div>
        <h1>Tu espacio empieza aquí</h1>
        <p>Crea un equipo para guardar presets en la nube o únete con un código de invitación.</p>
        <div className="workspace-setup-actions">
          <button className="button-primary auth-submit" type="button" onClick={onCreate}>
            <Plus size={15} />
            Crear equipo
            <ArrowRight size={15} />
          </button>
          <button className="button-secondary auth-submit" type="button" onClick={onJoin}>
            <Users size={15} />
            Unirme con código
          </button>
        </div>
        <p className="auth-switch">
          <button type="button" onClick={onSignOut}>
            Cerrar sesión
          </button>
        </p>
      </section>
      <div className="auth-footer">Framebase Presets · Tus archivos de video permanecen en tu computadora.</div>
    </div>
  );
}

function Toast({ notice, onClose }: { notice: Notice; onClose: () => void }) {
  useEffect(() => {
    const timer = window.setTimeout(onClose, 5200);
    return () => window.clearTimeout(timer);
  }, [onClose]);
  const Icon = notice.kind === 'success' ? Check : notice.kind === 'error' ? CircleHelp : Cloud;
  return (
    <div className={`toast toast-${notice.kind}`} role="status">
      <span className="toast-icon">
        <Icon size={15} />
      </span>
      <div>
        <strong>{notice.title}</strong>
        {notice.body && <p>{notice.body}</p>}
      </div>
      <button className="icon-button" onClick={onClose} type="button" aria-label="Cerrar aviso">
        <X size={15} />
      </button>
    </div>
  );
}

export default function App() {
  const [teams, setTeams] = useState<TeamSummary[]>(() => listLocalTeams());
  const [teamId, setTeamId] = useState(() => getCurrentLocalTeamId());
  const [presets, setPresets] = useState<PresetRecord[]>(() => listLocalPresets(getCurrentLocalTeamId()));
  const [targetEditor, setTargetEditor] = useState<EditorTarget>(() => getPreferredEditorTarget());
  const [filter, setFilter] = useState<'all' | PresetCategory>('all');
  const [viewMode, setViewMode] = useState<ViewMode>('all');
  const [layoutMode, setLayoutMode] = useState<LayoutMode>(() =>
    localStorage.getItem(LAYOUT_MODE_KEY) === 'list' ? 'list' : 'grid'
  );
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<PresetRecord | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [packName, setPackName] = useState('Pack_Framebase');
  const [exportingPack, setExportingPack] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [alwaysOnTop, setAlwaysOnTop] = useState(false);
  const [editorModal, setEditorModal] = useState<{ open: boolean; preset: PresetRecord | null }>({ open: false, preset: null });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [teamDialog, setTeamDialog] = useState<TeamModalMode | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busyPreset, setBusyPreset] = useState<string | null>(null);
  const [syncingCatalog, setSyncingCatalog] = useState(false);
  const [resolveContext, setResolveContext] = useState<ResolveContext>(initialResolveContext);
  const [premiereContext, setPremiereContext] = useState<PremiereContext>(initialPremiereContext);
  const [editorsStatus, setEditorsStatus] = useState<LocalEditorsStatus>(initialEditorsStatus);
  const [cloudRevision, setCloudRevision] = useState(0);
  const [forceLocalMode, setForceLocalMode] = useState(false);
  const [user, setUser] = useState<{ id: string; email?: string } | null>(null);
  const [authLoading, setAuthLoading] = useState(() => isCloudConfiguredNow());
  const [cloudTeamsReady, setCloudTeamsReady] = useState(() => !isCloudConfiguredNow());
  const [cloudLoading, setCloudLoading] = useState(false);
  const [teamMenuOpen, setTeamMenuOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const dragDepthRef = useRef(0);

  const cloudConfigured = isCloudConfiguredNow() && !forceLocalMode;
  const activeTeam = teams.find((team) => team.id === teamId) ?? demoTeam;
  const isCloudUser = cloudConfigured && Boolean(user);
  const canEdit = activeTeam.role !== 'viewer';
  const canPinWindow = typeof window !== 'undefined' && typeof window.nativeHost?.setAlwaysOnTop === 'function';

  // Global Ctrl+K / Cmd+K search focus shortcut
  useEffect(() => {
    const handleGlobalKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, []);

  // Desktop Electron Always-on-Top window state
  useEffect(() => {
    if (!window.nativeHost?.getAlwaysOnTop) return;
    let active = true;
    window.nativeHost.getAlwaysOnTop().then((pinned) => {
      if (active) setAlwaysOnTop(pinned);
    }).catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  // Supabase Auth subscription (reacts dynamically when user connects Supabase in SettingsModal)
  useEffect(() => {
    const client = getSupabaseClient();
    if (!client || forceLocalMode) {
      setUser(null);
      setAuthLoading(false);
      setCloudTeamsReady(true);
      return;
    }
    let mounted = true;
    setAuthLoading(true);
    client.auth.getSession().then(({ data }) => {
      if (mounted) {
        setUser(data.session?.user ? { id: data.session.user.id, email: data.session.user.email } : null);
        setAuthLoading(false);
      }
    }).catch(() => {
      if (mounted) setAuthLoading(false);
    });
    const { data: authListener } = client.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ? { id: session.user.id, email: session.user.email } : null);
      setAuthLoading(false);
    });
    return () => {
      mounted = false;
      authListener.subscription.unsubscribe();
    };
  }, [cloudRevision, forceLocalMode]);

  // DaVinci Resolve Studio Bridge polling
  useEffect(() => {
    if (!window.resolveBridge) return;
    let active = true;
    const refresh = () =>
      window.resolveBridge!
        .getContext()
        .then((context) => {
          if (active) setResolveContext(context);
        })
        .catch(() => undefined);
    void refresh();
    const timer = window.setInterval(refresh, 5000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  // Adobe Premiere Pro CEP Bridge polling
  useEffect(() => {
    if (!window.premiereBridge) return;
    let active = true;
    const refresh = () =>
      window.premiereBridge!
        .getContext()
        .then((context) => {
          if (active) setPremiereContext(context);
        })
        .catch(() => undefined);
    void refresh();
    const timer = window.setInterval(refresh, 5000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  // Local Host editor installation status check (Desktop Electron or loopback dev server)
  useEffect(() => {
    let active = true;
    fetchLocalEditorsStatus().then((status) => {
      if (active) setEditorsStatus(status);
    });
    return () => {
      active = false;
    };
  }, []);

  async function reloadCloudTeams() {
    if (!isCloudUser || !getSupabaseClient()) return;
    const items = await listCloudTeams();
    setTeams(items);
    if (!items.some((team) => team.id === teamId)) setTeamId(items[0]?.id ?? '');
  }

  // Cloud Teams sync
  useEffect(() => {
    if (!isCloudUser || !getSupabaseClient()) return;
    let active = true;
    setCloudTeamsReady(false);
    setCloudLoading(true);
    listCloudTeams()
      .then((items) => {
        if (!active) return;
        setTeams(items);
        if (!items.some((team) => team.id === teamId)) setTeamId(items[0]?.id ?? '');
      })
      .catch((cause) => {
        if (active) {
          setTeams([]);
          setTeamId('');
          setNotice({
            kind: 'error',
            title: 'No se cargaron los equipos',
            body: cause instanceof Error ? cause.message : undefined,
          });
        }
      })
      .finally(() => {
        if (active) {
          setCloudLoading(false);
          setCloudTeamsReady(true);
        }
      });
    return () => {
      active = false;
    };
  }, [isCloudUser]);

  async function reloadCloudPresetsForActiveTeam(currentTeamId: string) {
    const items = await listCloudPresets(currentTeamId);
    const teamStarters = starterPresets.map((preset) => ({ ...preset, teamId: currentTeamId, source: 'starter' as const }));
    const favoriteMap = JSON.parse(localStorage.getItem('framebase.cloud-favorites.v1') ?? '{}') as Record<string, boolean>;
    const byId = new Map<string, PresetRecord>();
    for (const starter of teamStarters) byId.set(starter.id, starter);
    for (const cloudItem of items) byId.set(cloudItem.id, cloudItem);
    const current = [...byId.values()].map((preset) => ({
      ...preset,
      favorite: favoriteMap[preset.id] ?? preset.favorite,
    }));
    setPresets(current);
  }

  // Presets catalog sync
  useEffect(() => {
    setSelectedIds(new Set());
    if (!isCloudUser || !teamId) {
      if (!isCloudUser) setPresets(listLocalPresets(teamId));
      return;
    }
    let active = true;
    setCloudLoading(true);
    reloadCloudPresetsForActiveTeam(teamId)
      .catch((cause) => {
        if (active) {
          setNotice({
            kind: 'error',
            title: 'No se cargó la biblioteca',
            body: cause instanceof Error ? cause.message : undefined,
          });
        }
      })
      .finally(() => {
        if (active) setCloudLoading(false);
      });
    return () => {
      active = false;
    };
  }, [teamId, isCloudUser]);

  const visiblePresets = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('es');
    return presets.filter((preset) => {
      if (filter !== 'all' && preset.category !== filter) return false;
      if (viewMode === 'favorites' && !preset.favorite) return false;
      if (viewMode === 'created' && preset.source === 'starter') return false;
      if (!query) return true;
      return [preset.name, preset.description, ...preset.tags].some((value) =>
        value.toLocaleLowerCase('es').includes(query)
      );
    });
  }, [filter, presets, search, viewMode]);

  const localCustomPresets = useMemo(
    () => listLocalPresets(getCurrentLocalTeamId()).filter((item) => item.source !== 'starter'),
    [presets, teamId]
  );

  function dismissNotice() {
    setNotice(null);
  }

  function handleTargetEditorChange(next: EditorTarget) {
    setTargetEditor(next);
    setPreferredEditorTarget(next);
  }

  function handleLayoutModeChange(next: LayoutMode) {
    setLayoutMode(next);
    localStorage.setItem(LAYOUT_MODE_KEY, next);
  }

  async function handleToggleAlwaysOnTop() {
    if (!window.nativeHost?.setAlwaysOnTop) return;
    const next = await window.nativeHost.setAlwaysOnTop(!alwaysOnTop);
    setAlwaysOnTop(next);
    setNotice({
      kind: 'info',
      title: next ? 'Ventana fijada siempre visible' : 'Ventana normal restaurada',
      body: next
        ? 'Framebase permanecerá encima de DaVinci Resolve o Premiere Pro para editar lado a lado.'
        : undefined,
    });
  }

  function togglePresetSelection(presetId: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(presetId)) next.delete(presetId);
      else next.add(presetId);
      return next;
    });
  }

  function selectAllVisible() {
    setSelectedIds(new Set(visiblePresets.map((item) => item.id)));
  }

  async function persistPreset(preset: PresetRecord) {
    if (isCloudUser) await uploadCloudPreset(preset, preset.nativeFiles);
    saveLocalPreset(preset);
    await saveNativeFiles(preset.id, preset.nativeFiles);
    setPresets((current) => [preset, ...current.filter((item) => item.id !== preset.id)]);
    setSelected((current) => (current?.id === preset.id ? preset : current));
  }

  async function handleSavePreset(input: CreatePresetInput, existing?: PresetRecord) {
    const preset = makePresetRecord(input, activeTeam, existing);
    let nativeFiles = existing?.nativeFiles?.length ? existing.nativeFiles : await readNativeFiles(preset.id);
    if (preset.source !== 'imported') {
      const preservedAudio =
        input.audioFile ??
        (input.audioSfx?.sfxId === 'custom'
          ? nativeFiles.find((file) => /\.(wav|mp3)$/i.test(file.path))
          : undefined);
      nativeFiles = [
        {
          path: `${categoryPaths[preset.category]}/${templateFileName(preset)}`,
          bytes: createFusionTemplate(preset),
          role: 'template',
        },
        ...(preservedAudio ? [preservedAudio] : []),
      ];
    }
    const record = { ...preset, nativeFiles };
    await persistPreset(record);
    setEditorModal({ open: false, preset: null });
    setNotice({
      kind: 'success',
      title: existing ? 'Preset actualizado' : 'Preset guardado',
      body: existing
        ? `“${record.name}” se actualizó a la versión ${record.version}.`
        : 'Ya está disponible en la biblioteca de tu equipo.',
    });
  }

  async function handleRestoreVersion(currentPreset: PresetRecord, versionEntry: PresetVersionRecord) {
    const m = versionEntry.manifest;
    const restoredInput: CreatePresetInput = {
      id: currentPreset.id,
      name: m.name || currentPreset.name,
      description: m.description || currentPreset.description,
      category: m.category || currentPreset.category,
      target: m.target || currentPreset.target,
      text: m.text ?? '',
      accent: m.accent || currentPreset.accent,
      secondaryAccent: m.secondaryAccent,
      animation: m.animation || currentPreset.animation,
      curve: m.curve,
      positionX: m.positionX,
      positionY: m.positionY,
      anchorPoint: m.anchorPoint,
      pivotX: m.pivotX,
      pivotY: m.pivotY,
      rotationDeg: m.rotationDeg,
      scale: m.scale,
      intensity: m.intensity,
      spread: m.spread,
      fontFamily: m.fontFamily,
      tracking: m.tracking,
      uppercase: m.uppercase,
      shadow: m.shadow,
      backgroundBox: m.backgroundBox,
      plateRadius: m.plateRadius,
      plateOpacity: m.plateOpacity,
      transitionStyle: m.transitionStyle,
      effectStyle: m.effectStyle,
      layers: m.layers,
      bezier: m.bezier,
      timelineMode: m.timelineMode,
      keyframeTracks: m.keyframeTracks,
      timelinePhases: m.timelinePhases,
      audioSfx: m.audioSfx,
      aspectRatio: m.aspectRatio,
      lutName: m.lutName,
      lutMix: m.lutMix,
      lutData: m.lutData,
      durationSeconds: m.durationSeconds || currentPreset.durationSeconds,
      tags: Array.isArray(m.tags) ? m.tags : currentPreset.tags,
    };
    await handleSavePreset(restoredInput, currentPreset);
    setNotice({
      kind: 'success',
      title: `Versión v${versionEntry.version} restaurada`,
      body: `“${restoredInput.name}” se guardó como versión ${currentPreset.version + 1}.`,
    });
  }

  async function handleDeletePreset(preset: PresetRecord) {
    if (isCloudUser && !isStarterPresetId(preset.id)) {
      await deleteCloudPreset(preset.id);
    }
    deleteLocalPreset(preset.id);
    await deleteNativeFiles(preset.id);
    const refreshed = isCloudUser
      ? presets.filter((item) => item.id !== preset.id)
      : listLocalPresets(activeTeam.id);
    setPresets(refreshed);
    setSelectedIds((current) => {
      const next = new Set(current);
      next.delete(preset.id);
      return next;
    });
    setEditorModal({ open: false, preset: null });
    setSelected((current) => (current?.id === preset.id ? null : current));
    setNotice({
      kind: 'info',
      title: isStarterPresetId(preset.id) ? 'Preset restaurado' : 'Preset eliminado',
      body: isStarterPresetId(preset.id)
        ? `“${preset.name}” volvió a sus valores de fábrica.`
        : `“${preset.name}” se quitó de la biblioteca.`,
    });
  }

  async function handleImportFiles(fileList?: FileList | File[] | null) {
    if (!fileList || fileList.length === 0) return;
    if (!canEdit) {
      setNotice({
        kind: 'error',
        title: 'Modo solo lectura',
        body: 'Tu rol en este equipo es Lector. Pide permisos de Editor para importar recursos.',
      });
      return;
    }
    try {
      const files = Array.from(fileList);
      const importedRecords: PresetRecord[] = [];
      for (const file of files) {
        const items = await parsePresetCollectionFile(file, activeTeam.id);
        for (const item of items) {
          await persistPreset(item.preset);
          importedRecords.push(item.preset);
        }
      }
      if (importedRecords.some((item) => item.target === 'premiere')) {
        handleTargetEditorChange('premiere');
      }
      if (importedRecords.length === 1) {
        const single = importedRecords[0];
        setNotice({
          kind: 'success',
          title: 'Recurso importado',
          body: `“${single.name}” (${editorLabels[single.target]}) ya está en tu biblioteca.`,
        });
      } else if (importedRecords.length > 1) {
        setNotice({
          kind: 'success',
          title: 'Pack de colección importado',
          body: `Se añadieron ${importedRecords.length} presets listos para usar.`,
        });
      }
    } catch (cause) {
      setNotice({
        kind: 'error',
        title: 'No se pudo importar',
        body: cause instanceof Error ? cause.message : 'Verifica el formato (.drfx, .zip, .setting, .comp, .mogrt o .prfpset).',
      });
    } finally {
      if (importRef.current) importRef.current.value = '';
    }
  }

  function handleWindowDragEnter(event: DragEvent<HTMLDivElement>) {
    if (!Array.from(event.dataTransfer.types).includes('Files')) return;
    event.preventDefault();
    dragDepthRef.current += 1;
    setIsDragOver(true);
  }

  function handleWindowDragOver(event: DragEvent<HTMLDivElement>) {
    if (!Array.from(event.dataTransfer.types).includes('Files')) return;
    event.preventDefault();
  }

  function handleWindowDragLeave(event: DragEvent<HTMLDivElement>) {
    if (!Array.from(event.dataTransfer.types).includes('Files')) return;
    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsDragOver(false);
  }

  function handleWindowDrop(event: DragEvent<HTMLDivElement>) {
    if (!Array.from(event.dataTransfer.types).includes('Files')) return;
    event.preventDefault();
    dragDepthRef.current = 0;
    setIsDragOver(false);
    void handleImportFiles(event.dataTransfer.files);
  }

  async function nativeFilesFor(preset: PresetRecord) {
    let files = preset.nativeFiles.length ? preset.nativeFiles : await readNativeFiles(preset.id);
    if (files.length === 0 && isCloudUser && preset.assetPath) {
      const hydrated = await downloadCloudPreset(preset);
      files = hydrated.nativeFiles;
    }
    if (files.length === 0) {
      files = [
        {
          path: `${categoryPaths[preset.category]}/${templateFileName(preset)}`,
          bytes: createFusionTemplate(preset),
          role: 'template',
        },
      ];
    }
    return files;
  }

  async function handleExportPack() {
    const chosen = presets.filter((item) => selectedIds.has(item.id));
    if (chosen.length === 0) return;
    setExportingPack(true);
    try {
      const packItems = await Promise.all(
        chosen.map(async (preset) => ({
          preset,
          nativeFiles: await nativeFilesFor(preset),
        }))
      );
      const { saved, fileName } = await savePresetCollectionPack(packItems, packName, targetEditor);
      if (!saved) return;
      setNotice({
        kind: 'success',
        title: `Pack exportado (${chosen.length} recursos)`,
        body: fileName,
      });
    } catch (cause) {
      setNotice({
        kind: 'error',
        title: 'No se pudo exportar el pack',
        body: cause instanceof Error ? cause.message : undefined,
      });
    } finally {
      setExportingPack(false);
    }
  }

  async function handleInstallSelectedPack() {
    const chosen = presets.filter((item) => selectedIds.has(item.id));
    if (chosen.length === 0) return;
    setExportingPack(true);
    try {
      let installed = 0;
      for (const preset of chosen) {
        const files = await nativeFilesFor(preset);
        const res = targetEditor === 'resolve'
          ? await installPresetLocallyInResolve(preset, files, false)
          : await installPresetLocallyInPremiere(preset, files, { openFolder: false });
        if (res?.success) installed += 1;
      }
      setNotice({
        kind: installed > 0 ? 'success' : 'info',
        title: installed > 0 ? `Selección instalada en ${editorLabels[targetEditor]}` : 'Exportación disponible',
        body: installed > 0
          ? `${installed} recursos copiados directamente a tu carpeta local de plantillas.`
          : 'Usa Exportar Pack para guardar la colección en disco.',
      });
    } finally {
      setExportingPack(false);
    }
  }

  async function handleSyncLocalToCloud() {
    if (!isCloudUser || !activeTeam.id) return;
    const count = await syncLocalPresetsToCloudTeam(localCustomPresets, activeTeam.id, nativeFilesFor);
    await reloadCloudPresetsForActiveTeam(activeTeam.id);
    setNotice({
      kind: 'success',
      title: 'Biblioteca local sincronizada',
      body: `${count} presets locales ahora están compartidos con ${activeTeam.name}.`,
    });
  }

  async function handleApply(preset: PresetRecord) {
    setBusyPreset(preset.id);
    try {
      const files = await nativeFilesFor(preset);
      const result = await applyPresetToEditor(preset, files, targetEditor);
      setNotice({
        kind: result.success ? 'success' : 'error',
        title: result.success
          ? result.mode === 'bridge'
            ? 'Preset aplicado'
            : `Enviado a ${editorLabels[targetEditor]}`
          : 'No se pudo aplicar',
        body: result.message,
      });
      if (result.success && result.mode === 'bridge' && targetEditor === 'resolve') {
        setResolveContext((context) => ({ ...context, connected: true }));
      }
    } catch (cause) {
      setNotice({
        kind: 'error',
        title: 'No se pudo aplicar',
        body: cause instanceof Error ? cause.message : `Comprueba la instalación de ${editorLabels[targetEditor]}.`,
      });
    } finally {
      setBusyPreset(null);
    }
  }

  async function handleSyncCatalog(target: EditorTarget = targetEditor) {
    setSyncingCatalog(true);
    try {
      let installedCount = 0;
      for (const preset of presets) {
        const files = await nativeFilesFor(preset);
        const res = target === 'resolve'
          ? await installPresetLocallyInResolve(preset, files, false)
          : await installPresetLocallyInPremiere(preset, files, { openFolder: false });
        if (res?.success) installedCount += 1;
      }
      if (installedCount === 0) {
        setNotice({
          kind: 'info',
          title: 'Descarga individual disponible',
          body: `Exporta cada recurso desde su tarjeta para instalarlo en ${editorLabels[target]}.`,
        });
      } else {
        setNotice({
          kind: 'success',
          title: `Catálogo instalado en ${editorLabels[target]}`,
          body:
            target === 'resolve'
              ? `${installedCount} plantillas listas en Biblioteca de efectos → Títulos, Generadores, Efectos y Transiciones.`
              : `${installedCount} recursos instalados en Motion Graphics Templates y Framebase Presets.`,
        });
      }
    } catch (cause) {
      setNotice({
        kind: 'error',
        title: 'Error al sincronizar el catálogo',
        body: cause instanceof Error ? cause.message : undefined,
      });
    } finally {
      setSyncingCatalog(false);
    }
  }

  async function handleExport(preset: PresetRecord) {
    try {
      const files = await nativeFilesFor(preset);
      const record = { ...preset, nativeFiles: files };
      const saved = await savePresetPackage(record, files, targetEditor);
      if (!saved) return;
      setNotice({
        kind: 'success',
        title: 'Paquete exportado',
        body: packageFileNameForTarget(preset, targetEditor),
      });
    } catch (cause) {
      setNotice({
        kind: 'error',
        title: 'No se pudo exportar',
        body: cause instanceof Error ? cause.message : undefined,
      });
    }
  }

  async function handleToggleFavorite(preset: PresetRecord) {
    const next = { ...preset, favorite: !preset.favorite };
    if (!isCloudUser) setLocalFavorite(preset.id, next.favorite);
    else {
      const key = 'framebase.cloud-favorites.v1';
      const current = JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, boolean>;
      current[preset.id] = next.favorite;
      localStorage.setItem(key, JSON.stringify(current));
    }
    setPresets((current) => current.map((item) => (item.id === preset.id ? next : item)));
    setSelected((current) => (current?.id === preset.id ? next : current));
  }

  async function handleCreateTeam(name: string) {
    const team = isCloudUser ? await createCloudTeam(name) : createLocalTeam(name);
    setTeams((current) => [...current.filter((item) => item.id !== team.id), team]);
    setTeamId(team.id);
    if (!isCloudUser) setCurrentLocalTeamId(team.id);
    setTeamDialog(null);
    setNotice({ kind: 'success', title: 'Equipo creado', body: `Ahora estás en ${team.name}.` });
  }

  async function handleInvite(email: string) {
    if (!isCloudUser) throw new Error('Configura Supabase desde Ajustes e inicia sesión para crear invitaciones.');
    const code = await requestInvite(activeTeam.id, email);
    setNotice({ kind: 'success', title: 'Invitación creada', body: `Comparte el código con ${email}.` });
    return code;
  }

  async function handleAcceptInvite(code: string) {
    if (!isCloudUser) throw new Error('Inicia sesión para aceptar una invitación.');
    const joinedTeamId = await acceptInvite(code);
    const nextTeams = await listCloudTeams();
    setTeams(nextTeams);
    setTeamId(joinedTeamId);
    setTeamDialog(null);
    setNotice({ kind: 'success', title: 'Ya estás en el equipo', body: 'La biblioteca compartida está lista.' });
  }

  function handleTeamChange(id: string) {
    setTeamId(id);
    if (!isCloudUser) setCurrentLocalTeamId(id);
    setTeamMenuOpen(false);
  }

  async function handleSignOut() {
    const client = getSupabaseClient();
    if (client) await client.auth.signOut();
    setCloudTeamsReady(false);
    setTeams(listLocalTeams());
    setTeamId(getCurrentLocalTeamId());
    setPresets(listLocalPresets(getCurrentLocalTeamId()));
  }

  if (authLoading) {
    return (
      <div className="boot-screen">
        <span className="brand-mark">
          <Film size={18} />
        </span>
        <span>Conectando con tu espacio...</span>
      </div>
    );
  }

  if (cloudConfigured && !user) {
    return (
      <AuthGate
        onDone={() => undefined}
        onContinueLocal={() => {
          setForceLocalMode(true);
          setTeams(listLocalTeams());
          setTeamId(getCurrentLocalTeamId());
          setPresets(listLocalPresets(getCurrentLocalTeamId()));
        }}
      />
    );
  }

  if (isCloudUser && !cloudTeamsReady) {
    return (
      <div className="boot-screen">
        <span className="brand-mark">
          <Film size={18} />
        </span>
        <span>Cargando tus equipos...</span>
      </div>
    );
  }

  if (isCloudUser && teams.length === 0) {
    return (
      <>
        <CloudWorkspaceSetup
          onCreate={() => setTeamDialog('create')}
          onJoin={() => setTeamDialog('join')}
          onSignOut={() => void handleSignOut()}
        />
        {teamDialog && (
          <TeamWorkspaceModal
            mode={teamDialog}
            isCloudUser={isCloudUser}
            localCustomCount={localCustomPresets.length}
            onClose={() => setTeamDialog(null)}
            onCreate={handleCreateTeam}
            onInvite={handleInvite}
            onAccept={handleAcceptInvite}
            onSyncLocalToCloud={handleSyncLocalToCloud}
            onOpenCloudSettings={() => setSettingsOpen(true)}
            onTeamsReloaded={reloadCloudTeams}
          />
        )}
        {notice && <Toast notice={notice} onClose={dismissNotice} />}
      </>
    );
  }

  const favoritesCount = presets.filter((preset) => preset.favorite).length;
  const resolveConnected = resolveContext.connected;
  const premiereConnected = premiereContext.connected;
  const activeEditorConnected = targetEditor === 'resolve' ? resolveConnected : premiereConnected;
  const activeEditorReadyLocally = targetEditor === 'resolve'
    ? editorsStatus.resolveInstalled
    : editorsStatus.premiereInstalled || editorsStatus.available;

  return (
    <div
      className="app-shell"
      onDragEnter={handleWindowDragEnter}
      onDragOver={handleWindowDragOver}
      onDragLeave={handleWindowDragLeave}
      onDrop={handleWindowDrop}
    >
      <aside className={`sidebar${sidebarOpen ? ' sidebar-open' : ''}`}>
        <div className="brand-row">
          <span className="brand-mark">
            <Film size={17} strokeWidth={2} />
          </span>
          <span className="brand-name">
            framebase<span>.</span>
          </span>
          <button
            className="icon-button sidebar-close"
            type="button"
            onClick={() => setSidebarOpen(false)}
            aria-label="Cerrar menú"
          >
            <X size={18} />
          </button>
        </div>

        <div className="workspace-label">ESPACIO DE TRABAJO</div>
        <div className="team-switcher-wrap">
          <button
            className="team-switcher"
            type="button"
            onClick={() => setTeamMenuOpen((open) => !open)}
            aria-expanded={teamMenuOpen}
          >
            <span className="team-avatar">{activeTeam.name.slice(0, 1).toUpperCase()}</span>
            <span className="team-switcher-copy">
              <strong>{activeTeam.name}</strong>
              <small>
                {activeTeam.role === 'owner' ? 'Propietario' : activeTeam.role === 'editor' ? 'Editor' : 'Lector'}
              </small>
            </span>
            <ChevronDown size={15} />
          </button>
          {teamMenuOpen && (
            <div className="team-dropdown" role="menu">
              {teams.map((team) => (
                <button
                  key={team.id}
                  type="button"
                  role="menuitem"
                  onClick={() => handleTeamChange(team.id)}
                  className={team.id === teamId ? 'is-current' : ''}
                >
                  <span className="team-avatar team-avatar-small">{team.name.slice(0, 1).toUpperCase()}</span>
                  <span>{team.name}</span>
                  {team.id === teamId && <Check size={14} />}
                </button>
              ))}
              <div className="dropdown-divider" />
              <button
                type="button"
                onClick={() => {
                  setTeamDialog('manage');
                  setTeamMenuOpen(false);
                }}
              >
                <Users size={14} />
                Gestionar miembros y roles
              </button>
              <button
                type="button"
                onClick={() => {
                  setTeamDialog('create');
                  setTeamMenuOpen(false);
                }}
              >
                <Plus size={14} />
                Crear equipo
              </button>
              <button
                type="button"
                onClick={() => {
                  setTeamDialog('join');
                  setTeamMenuOpen(false);
                }}
              >
                <Users size={14} />
                Unirme con código
              </button>
            </div>
          )}
        </div>

        <div className="nav-label">BIBLIOTECA</div>
        <nav className="side-nav" aria-label="Navegación principal">
          <button
            className={`nav-item${viewMode === 'all' ? ' nav-active' : ''}`}
            type="button"
            onClick={() => {
              setViewMode('all');
              setSidebarOpen(false);
            }}
          >
            <LayoutGrid size={17} />
            <span>Todos los presets</span>
            <span className="nav-count">{presets.length}</span>
          </button>
          <button
            className={`nav-item${viewMode === 'favorites' ? ' nav-active' : ''}`}
            type="button"
            onClick={() => {
              setViewMode('favorites');
              setSidebarOpen(false);
            }}
          >
            <Star size={17} />
            <span>Favoritos</span>
            <span className="nav-count">{favoritesCount}</span>
          </button>
          <button
            className={`nav-item${viewMode === 'created' ? ' nav-active' : ''}`}
            type="button"
            onClick={() => {
              setViewMode('created');
              setSidebarOpen(false);
            }}
          >
            <WandSparkles size={17} />
            <span>Mis creaciones</span>
          </button>
        </nav>

        <div className="nav-label category-side-label">CATEGORÍAS</div>
        <nav className="side-categories" aria-label="Categorías">
          {categories.map((category) => {
            const Icon = categoryIcons[category];
            const count = presets.filter((preset) => preset.category === category).length;
            return (
              <button
                key={category}
                type="button"
                className={`side-category${filter === category ? ' side-category-active' : ''}`}
                onClick={() => {
                  setFilter(filter === category ? 'all' : category);
                  setViewMode('all');
                  setSidebarOpen(false);
                }}
              >
                <Icon size={16} />
                <span>{categoryLabels[category]}</span>
                <small>{count}</small>
              </button>
            );
          })}
        </nav>

        <div className="sidebar-bottom">
          <div className="team-storage-card">
            <div className="storage-head">
              <span>Biblioteca de equipo</span>
              <Cloud size={14} />
            </div>
            <div className="storage-meter">
              <span style={{ width: isCloudUser ? '42%' : '100%' }} />
            </div>
            <div className="storage-foot">
              <span>{isCloudUser ? 'Sincronización activa' : 'Guardada en este equipo'}</span>
              <span>{isCloudUser ? 'Nube' : 'Local'}</span>
            </div>
          </div>
          <button
            className="nav-item sidebar-settings"
            type="button"
            onClick={() => {
              setSettingsOpen(true);
              setSidebarOpen(false);
            }}
          >
            <Settings size={16} />
            <span>Ajustes y Nube</span>
          </button>
          {isCloudUser && (
            <button className="nav-item sidebar-settings" type="button" onClick={() => void handleSignOut()}>
              <LogOut size={16} />
              <span>Cerrar sesión</span>
            </button>
          )}
          <div className="profile-row">
            <span className="profile-avatar">{(user?.email ?? 'B').slice(0, 1).toUpperCase()}</span>
            <span className="profile-copy">
              <strong>{user?.email?.split('@')[0] ?? 'Estudio Local'}</strong>
              <small>{user?.email ?? editorLabels[targetEditor]}</small>
            </span>
            <MoreHorizontal size={16} />
          </div>
        </div>
      </aside>

      <main className="main-panel">
        <header className="topbar">
          <button
            className="icon-button menu-toggle"
            type="button"
            onClick={() => setSidebarOpen(true)}
            aria-label="Abrir menú"
          >
            <Menu size={19} />
          </button>
          <div className="breadcrumbs">
            <span>Framebase</span>
            <span className="breadcrumb-divider">/</span>
            <strong>
              {viewMode === 'favorites' ? 'Favoritos' : viewMode === 'created' ? 'Mis creaciones' : 'Biblioteca'}
            </strong>
          </div>

          <div className="topbar-right">
            <div className="editor-switcher" role="group" aria-label="Editor de destino">
              <button
                type="button"
                className={`editor-switch-btn${targetEditor === 'resolve' ? ' is-active' : ''}`}
                onClick={() => handleTargetEditorChange('resolve')}
              >
                Resolve
              </button>
              <button
                type="button"
                className={`editor-switch-btn${targetEditor === 'premiere' ? ' is-active' : ''}`}
                onClick={() => handleTargetEditorChange('premiere')}
              >
                Premiere Pro
              </button>
            </div>

            {canPinWindow && (
              <button
                type="button"
                className={`pin-btn${alwaysOnTop ? ' is-pinned' : ''}`}
                aria-label="Fijar ventana siempre visible"
                aria-pressed={alwaysOnTop}
                title="Mantener encima de DaVinci Resolve o Premiere Pro"
                onClick={() => void handleToggleAlwaysOnTop()}
              >
                <Pin size={13} />
                <span>{alwaysOnTop ? 'Fijada' : 'Fijar'}</span>
              </button>
            )}

            <button
              type="button"
              className={`cloud-status${isCloudUser ? ' status-live' : ''}`}
              onClick={() => {
                if (isCloudConfiguredNow() && forceLocalMode) {
                  setForceLocalMode(false);
                } else {
                  setSettingsOpen(true);
                }
              }}
            >
              <span className="status-dot" />
              {isCloudUser ? 'Sincronizado' : 'Modo local'}
            </button>

            <span className="topbar-divider" />

            <button
              className={`resolve-status${activeEditorConnected ? ' resolve-connected' : activeEditorReadyLocally ? ' resolve-ready' : ''}`}
              type="button"
              onClick={() => setSettingsOpen(true)}
            >
              <span className="resolve-mark">
                <Film size={13} />
              </span>
              <span>
                {targetEditor === 'resolve'
                  ? resolveConnected
                    ? 'Resolve conectado'
                    : editorsStatus.resolveInstalled
                      ? 'DaVinci Resolve listo'
                      : 'DaVinci Resolve'
                  : premiereConnected
                    ? 'Premiere conectado'
                    : 'Adobe Premiere Pro'}
              </span>
              <span className="resolve-version">
                {targetEditor === 'resolve'
                  ? formatResolveVersion(resolveContext.version)
                  : premiereContext.version ?? 'MOGRT'}
              </span>
            </button>

            <button
              className="topbar-help"
              type="button"
              onClick={() =>
                setNotice({
                  kind: 'info',
                  title: 'Flujo rápido en Resolve y Premiere',
                  body: 'Arrastra archivos .drfx/.zip/.mogrt a la ventana, usa Ctrl+K para buscar o selecciona varios recursos para exportar un Pack completo.',
                })
              }
              aria-label="Ayuda"
            >
              <CircleHelp size={17} />
            </button>
          </div>
        </header>

        <div className="content-scroll">
          <div className="page-heading">
            <div>
              <div className="eyebrow page-eyebrow">
                TU ESPACIO CREATIVO <span>·</span> {activeTeam.name.toUpperCase()}
              </div>
              <h1>
                Tu biblioteca <span>creativa.</span>
              </h1>
              <p>
                Plantillas Pro para {editorLabels[targetEditor]}, con tipografía editorial, efectos ópticos, historial de versiones y exportación por packs.
              </p>
            </div>
            <div className="heading-actions">
              {!canEdit && <span className="readonly-pill">Solo lectura · Rol Lector</span>}
              {editorsStatus.available && (
                <button
                  className="button-secondary"
                  type="button"
                  disabled={syncingCatalog}
                  onClick={() => void handleSyncCatalog(targetEditor)}
                >
                  <HardDriveDownload size={15} />
                  {syncingCatalog ? 'Instalando...' : `Sincronizar con ${targetEditor === 'resolve' ? 'Resolve' : 'Premiere'}`}
                </button>
              )}
              {canEdit && (
                <>
                  <button
                    className="button-secondary import-button"
                    type="button"
                    onClick={() => importRef.current?.click()}
                  >
                    <Upload size={15} />
                    Importar
                  </button>
                  <button
                    className="button-primary create-button"
                    type="button"
                    onClick={() => setEditorModal({ open: true, preset: null })}
                  >
                    <Plus size={17} />
                    Crear preset
                  </button>
                </>
              )}
              <input
                ref={importRef}
                type="file"
                multiple
                accept=".drfx,.setting,.comp,.zip,.mogrt,.prfpset"
                className="visually-hidden"
                data-testid="file-import-input"
                onChange={(event) => void handleImportFiles(event.target.files)}
              />
            </div>
          </div>

          <section className="collection-hero">
            <div className="hero-copy">
              <div className="hero-kicker">
                <Sparkles size={13} /> ESTUDIO DE MOVIMIENTO <span className="hero-kicker-line" />
              </div>
              <h2>
                Las ideas buenas
                <br />
                <em>se reutilizan.</em>
              </h2>
              <p>
                Previsualiza a 60 fps sobre tus propios clips, ajusta tipografía y efectos ópticos, o empaqueta colecciones enteras en un clic.
              </p>
              {canEdit && (
                <div className="hero-actions-row">
                  <button
                    type="button"
                    className="hero-link"
                    onClick={() => setEditorModal({ open: true, preset: null })}
                  >
                    Crear un nuevo preset <ArrowRight size={15} />
                  </button>
                </div>
              )}
            </div>
            <div className="hero-art" aria-hidden="true">
              <div className="hero-frame hero-frame-back">
                <span>TIMELINE 24P</span>
              </div>
              <div className="hero-frame hero-frame-main">
                <div className="hero-frame-sun" />
                <div className="hero-frame-horizon" />
                <div className="hero-frame-copy">
                  <span>RESOLVE · PREMIERE</span>
                  <strong>
                    MAKE
                    <br />
                    IT MOVE
                  </strong>
                  <small>FRAMEBASE STUDIO SUITE</small>
                </div>
              </div>
              <div className="hero-frame hero-frame-front">
                <span>LIVE / 60FPS</span>
                <div className="hero-front-dot" />
              </div>
              <div className="hero-orbit hero-orbit-one" />
              <div className="hero-orbit hero-orbit-two" />
              <div className="hero-counter">
                <span>01</span>
                <i />
                {String(presets.length).padStart(2, '0')}
              </div>
            </div>
            <div className="hero-side-note">
              <span>FLUJO DUAL</span>
              <strong>
                FUSION &amp;
                <br />
                MOGRT
              </strong>
              <small>
                DAVINCI 21.1+
                <br />
                PREMIERE PRO
              </small>
            </div>
          </section>

          <section className="library-section">
            <div className="library-title-row">
              <div>
                <div className="section-overline">CATÁLOGO DEL EQUIPO</div>
                <h2>
                  {viewMode === 'favorites'
                    ? 'Tus favoritos'
                    : viewMode === 'created'
                      ? 'Tus creaciones'
                      : 'Recursos para tu próximo corte'}
                  <span className="result-count">{visiblePresets.length.toString().padStart(2, '0')}</span>
                </h2>
              </div>
              <div className="library-tools">
                <label className="search-box">
                  <Search size={15} />
                  <input
                    ref={searchInputRef}
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Buscar recursos..."
                    aria-label="Buscar presets"
                  />
                  {search && (
                    <button type="button" onClick={() => setSearch('')} aria-label="Limpiar búsqueda">
                      <X size={13} />
                    </button>
                  )}
                  <kbd>Ctrl K</kbd>
                </label>

                <div className="layout-switcher" role="group" aria-label="Modo de vista">
                  <button
                    type="button"
                    className={`layout-switch-btn${layoutMode === 'grid' ? ' is-active' : ''}`}
                    aria-label="Vista en cuadrícula"
                    aria-pressed={layoutMode === 'grid'}
                    onClick={() => handleLayoutModeChange('grid')}
                  >
                    <LayoutGrid size={15} />
                  </button>
                  <button
                    type="button"
                    className={`layout-switch-btn${layoutMode === 'list' ? ' is-active' : ''}`}
                    aria-label="Vista en lista"
                    aria-pressed={layoutMode === 'list'}
                    onClick={() => handleLayoutModeChange('list')}
                  >
                    <List size={15} />
                  </button>
                </div>

                <button
                  className={`tool-button${selectedIds.size > 0 ? ' is-active' : ''}`}
                  type="button"
                  onClick={() => {
                    if (selectedIds.size > 0) setSelectedIds(new Set());
                    else selectAllVisible();
                  }}
                  aria-label="Seleccionar varios para crear pack"
                  title="Crear Pack de colección (.drfx / .zip)"
                >
                  <Layers size={15} />
                </button>

                <button
                  className="tool-button"
                  type="button"
                  onClick={() => setTeamDialog('manage')}
                  aria-label="Equipo y miembros"
                  title="Gestionar miembros y roles del equipo"
                >
                  <Users size={15} />
                </button>

                <button
                  className="tool-button"
                  type="button"
                  onClick={() => setSettingsOpen(true)}
                  aria-label="Ajustes de integración"
                  title="Ajustes y nube"
                >
                  <Settings size={15} />
                </button>
              </div>
            </div>

            <div className="filter-tabs" role="tablist" aria-label="Filtrar por tipo">
              {categoryFilters.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={filter === item.id}
                  className={filter === item.id ? 'filter-tab filter-tab-active' : 'filter-tab'}
                  onClick={() => setFilter(item.id)}
                >
                  {item.label}
                  {item.id === 'all' && <span>{presets.length}</span>}
                </button>
              ))}
            </div>

            {cloudLoading && (
              <div className="sync-ribbon">
                <span className="sync-spinner" />
                Sincronizando recursos del equipo...
              </div>
            )}

            {visiblePresets.length ? (
              layoutMode === 'grid' ? (
                <div className="preset-grid" data-testid="preset-grid-view">
                  {visiblePresets.map((preset) => (
                    <PresetCard
                      key={preset.id}
                      preset={preset}
                      targetEditor={targetEditor}
                      selectedForPack={selectedIds.has(preset.id)}
                      canEdit={canEdit}
                      onToggleSelect={() => togglePresetSelection(preset.id)}
                      onPreview={() => setSelected(preset)}
                      onEdit={() => setEditorModal({ open: true, preset })}
                      onApply={() => void handleApply(preset)}
                      onFavorite={() => void handleToggleFavorite(preset)}
                      onExport={() => void handleExport(preset)}
                      busy={busyPreset === preset.id}
                    />
                  ))}
                </div>
              ) : (
                <div className="preset-list" data-testid="preset-list-view">
                  {visiblePresets.map((preset) => (
                    <PresetListRow
                      key={preset.id}
                      preset={preset}
                      targetEditor={targetEditor}
                      selectedForPack={selectedIds.has(preset.id)}
                      canEdit={canEdit}
                      onToggleSelect={() => togglePresetSelection(preset.id)}
                      onPreview={() => setSelected(preset)}
                      onEdit={() => setEditorModal({ open: true, preset })}
                      onApply={() => void handleApply(preset)}
                      onFavorite={() => void handleToggleFavorite(preset)}
                      onExport={() => void handleExport(preset)}
                      busy={busyPreset === preset.id}
                    />
                  ))}
                </div>
              )
            ) : (
              <div className="empty-state">
                <div className="empty-icon">
                  <FolderOpen size={23} />
                </div>
                <h3>No encontramos recursos</h3>
                <p>Prueba otra búsqueda o suelta aquí un paquete .drfx, .zip, .setting, .mogrt o .prfpset.</p>
                <button
                  className="button-secondary"
                  type="button"
                  onClick={() => {
                    setSearch('');
                    setFilter('all');
                    setViewMode('all');
                  }}
                >
                  Ver toda la biblioteca
                  <ArrowRight size={14} />
                </button>
              </div>
            )}

            <div className="catalog-footer">
              <span>
                Mostrando <strong>{visiblePresets.length}</strong> de <strong>{presets.length}</strong> recursos
              </span>
              <span className="catalog-footer-right">
                <span className="online-dot" />
                {isCloudUser ? 'Equipo sincronizado' : 'Biblioteca local'}
                <span className="footer-separator">·</span>
                {editorLabels[targetEditor]} {activeEditorConnected ? 'conectado' : 'listo'}
              </span>
            </div>
          </section>

          <footer className="app-footer">
            <span>
              FRAMEBASE PRESETS <i>·</i> 0.2.0
            </span>
            <span>
              DaVinci Resolve &amp; Adobe Premiere Pro <span className="footer-sparkle">✳</span>
            </span>
          </footer>
        </div>
      </main>

      {selectedIds.size > 0 && (
        <div className="pack-bar" role="region" aria-label="Barra de colección">
          <div className="pack-bar-left">
            <span className="pack-count-badge">{selectedIds.size} seleccionados</span>
            <input
              className="pack-name-input"
              aria-label="Nombre del pack"
              value={packName}
              onChange={(event) => setPackName(event.target.value)}
              placeholder="Nombre de la colección"
            />
            {selectedIds.size < visiblePresets.length && (
              <button type="button" className="button-secondary" onClick={selectAllVisible}>
                Seleccionar visibles ({visiblePresets.length})
              </button>
            )}
          </div>
          <div className="pack-bar-right">
            {editorsStatus.available && (
              <button
                type="button"
                className="button-secondary"
                disabled={exportingPack}
                onClick={() => void handleInstallSelectedPack()}
              >
                <HardDriveDownload size={14} /> Instalar selección
              </button>
            )}
            <button
              type="button"
              className="button-primary"
              disabled={exportingPack}
              onClick={() => void handleExportPack()}
            >
              <ArrowDownToLine size={14} />
              {exportingPack
                ? 'Empaquetando...'
                : `Exportar Pack (${targetEditor === 'premiere' ? '.zip' : '.drfx'})`}
            </button>
            <button
              type="button"
              className="icon-button modal-close"
              aria-label="Cancelar selección"
              onClick={() => setSelectedIds(new Set())}
            >
              <X size={16} />
            </button>
          </div>
        </div>
      )}

      {isDragOver && (
        <div className="dropzone-overlay" data-testid="dropzone-overlay">
          <div className="dropzone-card">
            <Upload size={32} color="#22d3ee" />
            <h3>Suelta tus archivos para importar</h3>
            <p>Compatible con paquetes individuales y colecciones (.drfx, .zip, .setting, .comp, .mogrt, .prfpset).</p>
          </div>
        </div>
      )}

      {editorModal.open && canEdit && (
        <PresetEditorStudioModal
          initialPreset={editorModal.preset}
          defaultTarget={targetEditor}
          onClose={() => setEditorModal({ open: false, preset: null })}
          onSave={handleSavePreset}
          onDuplicate={async (copyInput) => {
            await handleSavePreset(copyInput, undefined);
          }}
          onDelete={handleDeletePreset}
          teamName={activeTeam.name}
        />
      )}

      {selected && (
        <PresetDetailsModal
          preset={selected}
          targetEditor={targetEditor}
          isCloudUser={isCloudUser}
          canEdit={canEdit}
          resolveConnected={resolveConnected}
          premiereConnected={premiereConnected}
          editorsStatus={editorsStatus}
          onClose={() => setSelected(null)}
          onEdit={() => {
            const targetPreset = selected;
            setSelected(null);
            setEditorModal({ open: true, preset: targetPreset });
          }}
          onRestoreVersion={async (versionEntry) => {
            await handleRestoreVersion(selected, versionEntry);
          }}
          onApply={() => void handleApply(selected)}
          onExport={() => void handleExport(selected)}
          onFavorite={() => void handleToggleFavorite(selected)}
          busy={busyPreset === selected.id}
        />
      )}

      {settingsOpen && (
        <SettingsModal
          editorsStatus={editorsStatus}
          syncingCatalog={syncingCatalog}
          onSyncCatalog={handleSyncCatalog}
          onCloudConfigChanged={() => {
            setForceLocalMode(false);
            setCloudRevision((rev) => rev + 1);
          }}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {teamDialog && (
        <TeamWorkspaceModal
          mode={teamDialog}
          team={activeTeam}
          isCloudUser={isCloudUser}
          localCustomCount={localCustomPresets.length}
          onClose={() => setTeamDialog(null)}
          onCreate={handleCreateTeam}
          onInvite={handleInvite}
          onAccept={handleAcceptInvite}
          onSyncLocalToCloud={handleSyncLocalToCloud}
          onOpenCloudSettings={() => setSettingsOpen(true)}
          onTeamsReloaded={reloadCloudTeams}
        />
      )}

      {notice && <Toast notice={notice} onClose={dismissNotice} />}
    </div>
  );
}
