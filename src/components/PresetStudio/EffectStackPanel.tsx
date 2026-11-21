import { useEffect, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Compass,
  Copy,
  Eye,
  EyeOff,
  GripVertical,
  Keyboard,
  Layers,
  Music,
  Palette,
  Plus,
  Sliders,
  Trash2,
  Upload,
  X,
  Zap,
} from 'lucide-react';
import {
  ANCHOR_POINTS_9,
  BLEND_MODE_LABELS,
  createPresetLayer,
  DEFAULT_SPRING_PARAMS,
  type AnchorPoint9,
  type AudioSfxConfig,
  type FontChoice,
  type LayerBlendMode,
  type LayerModulators,
  type LfoBeatDivision,
  type LfoWaveform,
  type MaskRevealConfig,
  type MaskRevealDirection,
  type NativeFile,
  type PresetLayer,
  type PresetLayerKind,
  type PresetLayerType,
  type TrimPathsConfig,
  type TypographyAnimationKind,
} from '../../domain/preset';
import { AudioSfxPanel } from './AudioSfxPanel';
import { PrecisionSlider } from './PrecisionSlider';

export type InspectorTabId = 'style' | 'geometry' | 'modulators' | 'audio-lut';

export interface EffectStackPanelProps {
  layers: PresetLayer[];
  selectedLayerId?: string | null;
  onSelectLayerId?: (id: string | null) => void;
  showTextControls: boolean;
  text: string;
  fontFamily: FontChoice;
  fontOptions: FontChoice[];
  uppercase: boolean;
  shadow: boolean;
  backgroundBox: boolean;
  plateRadius: number;
  plateOpacity: number;
  scalePct: number;
  rotationDeg: number;
  positionX: number;
  positionY: number;
  defaultPosX: number;
  defaultPosY: number;
  trackingPct: number;
  anchorPoint: AnchorPoint9;
  audioSfx: AudioSfxConfig;
  customAudioBytes?: Uint8Array | null;
  lutName?: string;
  lutMix: number;
  onChangeLayers: (layers: PresetLayer[]) => void;
  onChangeText: (value: string) => void;
  onChangeFontFamily: (font: FontChoice) => void;
  onChangeUppercase: (value: boolean) => void;
  onChangeShadow: (value: boolean) => void;
  onChangeBackgroundBox: (value: boolean) => void;
  onChangePlateRadius: (value: number) => void;
  onChangePlateOpacity: (value: number) => void;
  onChangeScalePct: (value: number) => void;
  onChangeRotationDeg: (value: number) => void;
  onChangePositionX: (value: number) => void;
  onChangePositionY: (value: number) => void;
  onChangeTrackingPct: (value: number) => void;
  onChangeAnchorPoint: (anchor: AnchorPoint9) => void;
  onQuickAlign: (alignment: 'lower-third' | 'center' | 'reels-safe') => void;
  onChangeAudioSfx: (next: AudioSfxConfig, file?: NativeFile) => void;
  onChangeLut: (lutName: string | undefined, lutData: string | undefined, lutMix: number) => void;
}

const LAYER_CATALOG: Array<{
  type: PresetLayerType;
  groupLabel: string;
  items: Array<{ kind: PresetLayerKind; label: string }>;
}> = [
  {
    type: 'motion',
    groupLabel: 'Movimiento y Cámara',
    items: [
      { kind: 'punch-in', label: 'Punch-In / Crash Zoom' },
      { kind: 'camera-shake', label: 'Camera Shake' },
      { kind: 'float-drift', label: 'Float / Drift' },
      { kind: 'speed-ramp', label: 'Velocity / Speed Ramp' },
      { kind: 'motion-blur', label: 'Motion Blur Óptico' },
    ],
  },
  {
    type: 'transition',
    groupLabel: 'Transiciones A → B',
    items: [
      { kind: 'dissolve', label: 'Fundido prismático' },
      { kind: 'flash', label: 'Flash de exposición' },
      { kind: 'zoom', label: 'Zoom óptico' },
      { kind: 'whip', label: 'Whip Pan' },
      { kind: 'spin', label: 'Spin / Roll (90°/180°)' },
      { kind: 'glitch', label: 'Glitch / RGB Split' },
      { kind: 'luma-fade', label: 'Luma Fade' },
      { kind: 'directional-swish', label: 'Directional Blur Swish' },
    ],
  },
  {
    type: 'vfx',
    groupLabel: 'VFX, Óptica y Encuadre',
    items: [
      { kind: 'glow', label: 'Glow suave' },
      { kind: 'halation', label: 'Halation 35mm' },
      { kind: 'vignette', label: 'Viñeta anamórfica' },
      { kind: 'film-grain', label: 'Film Grain (8/16/35mm)' },
      { kind: 'chromatic-aberration', label: 'Chromatic Aberration' },
      { kind: 'vhs-crt', label: 'VHS / CRT Scanlines' },
      { kind: 'lens-distortion', label: 'Lens Distortion / Fisheye' },
      { kind: 'blur', label: 'Gaussian / Directional Blur' },
      { kind: 'pip-frame', label: 'Marco PiP / Collage' },
      { kind: 'lut', label: 'LUT (.cube)' },
    ],
  },
  {
    type: 'typography',
    groupLabel: 'Tipografía Cinética',
    items: [
      { kind: 'fade-slide', label: 'Entrada limpia' },
      { kind: 'typewriter', label: 'Typewriter Pro' },
      { kind: 'karaoke', label: 'Karaoke Word Highlight' },
      { kind: 'pop-bounce', label: 'Pop-In / Bounce' },
      { kind: 'glitch-flicker', label: 'Glitch Flicker' },
    ],
  },
];

const TYPO_MODE_OPTIONS: Array<{ kind: TypographyAnimationKind; label: string }> = [
  { kind: 'fade-slide', label: 'Entrada limpia (Fade + Slide)' },
  { kind: 'typewriter', label: 'Typewriter Pro (Write-On)' },
  { kind: 'karaoke', label: 'Karaoke Word Highlight' },
  { kind: 'pop-bounce', label: 'Pop-In / Bounce Elástico' },
  { kind: 'glitch-flicker', label: 'Glitch Flicker Digital' },
];

const TYPE_TAG_LABELS: Record<PresetLayerType, string> = {
  motion: 'CAM',
  transition: 'TRN',
  vfx: 'VFX',
  typography: 'TXT',
};

export function EffectStackPanel({
  layers,
  selectedLayerId: controlledSelectedId,
  onSelectLayerId,
  showTextControls,
  text,
  fontFamily,
  fontOptions,
  uppercase,
  shadow,
  backgroundBox,
  plateRadius,
  plateOpacity,
  scalePct,
  rotationDeg,
  positionX,
  positionY,
  defaultPosX,
  defaultPosY,
  trackingPct,
  anchorPoint,
  audioSfx,
  customAudioBytes,
  lutName,
  lutMix,
  onChangeLayers,
  onChangeText,
  onChangeFontFamily,
  onChangeUppercase,
  onChangeShadow,
  onChangeBackgroundBox,
  onChangePlateRadius,
  onChangePlateOpacity,
  onChangeScalePct,
  onChangeRotationDeg,
  onChangePositionX,
  onChangePositionY,
  onChangeTrackingPct,
  onChangeAnchorPoint,
  onQuickAlign,
  onChangeAudioSfx,
  onChangeLut,
}: EffectStackPanelProps) {
  const [selectedAdd, setSelectedAdd] = useState<string>('motion:punch-in');
  const [internalSelectedId, setInternalSelectedId] = useState<string | null>(layers[0]?.id ?? null);
  const [activeTab, setActiveTab] = useState<InspectorTabId>('style');
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const selectedLayerId =
    controlledSelectedId !== undefined ? controlledSelectedId : internalSelectedId;

  function setSelectedLayerId(nextId: string | null) {
    if (controlledSelectedId === undefined) {
      setInternalSelectedId(nextId);
    }
    onSelectLayerId?.(nextId);
  }

  useEffect(() => {
    if (layers.length === 0) {
      if (selectedLayerId !== null) setSelectedLayerId(null);
      return;
    }
    if (!selectedLayerId || !layers.some((l) => l.id === selectedLayerId)) {
      setSelectedLayerId(layers[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layers, selectedLayerId]);

  const activeLayer = layers.find((l) => l.id === selectedLayerId) ?? layers[0] ?? null;
  const typoLayer =
    (activeLayer?.type === 'typography' ? activeLayer : null) ??
    layers.find((l) => l.type === 'typography') ??
    null;
  const typoKind = (typoLayer?.kind ?? 'fade-slide') as TypographyAnimationKind;

  function handleAddLayer() {
    const [type, kind] = selectedAdd.split(':') as [PresetLayerType, PresetLayerKind];
    const next = createPresetLayer(type, kind);
    onChangeLayers([...layers, next]);
    setSelectedLayerId(next.id);
    setActiveTab('style');
  }

  function updateLayer(id: string, patch: Partial<PresetLayer>) {
    onChangeLayers(layers.map((layer) => (layer.id === id ? { ...layer, ...patch } : layer)));
  }

  function updateParam(id: string, key: string, value: number | string | boolean) {
    onChangeLayers(
      layers.map((layer) =>
        layer.id === id ? { ...layer, params: { ...layer.params, [key]: value } } : layer
      )
    );
  }

  function updateModulators(id: string, patch: Partial<LayerModulators>) {
    onChangeLayers(
      layers.map((layer) =>
        layer.id === id
          ? { ...layer, modulators: { ...layer.modulators, ...patch } }
          : layer
      )
    );
  }

  function updateTrimPaths(id: string, patch: Partial<TrimPathsConfig>) {
    onChangeLayers(
      layers.map((layer) => {
        if (layer.id !== id) return layer;
        const current: TrimPathsConfig = layer.trimPaths ?? {
          enabled: false,
          startPct: 0,
          endPct: 100,
          offsetDeg: 0,
        };
        return { ...layer, trimPaths: { ...current, ...patch } };
      })
    );
  }

  function updateMaskReveal(id: string, patch: Partial<MaskRevealConfig>) {
    onChangeLayers(
      layers.map((layer) => {
        if (layer.id !== id) return layer;
        const current: MaskRevealConfig = layer.maskReveal ?? {
          enabled: false,
          direction: 'bottom',
          featherPx: 14,
        };
        return { ...layer, maskReveal: { ...current, ...patch } };
      })
    );
  }

  function handleTypographyModeChange(nextKind: TypographyAnimationKind) {
    const template = createPresetLayer('typography', nextKind);
    if (typoLayer) {
      const updated = layers.map((layer) =>
        layer.id === typoLayer.id
          ? {
              ...layer,
              kind: nextKind,
              name: template.name,
              params: { ...template.params, ...layer.params, outline: layer.params.outline ?? template.params.outline },
            }
          : layer
      );
      onChangeLayers(updated);
      setSelectedLayerId(typoLayer.id);
    } else {
      onChangeLayers([template, ...layers]);
      setSelectedLayerId(template.id);
    }
  }

  function toggleTypoOutline() {
    if (typoLayer) {
      updateParam(typoLayer.id, 'outline', !Boolean(typoLayer.params.outline));
    } else {
      const created = createPresetLayer('typography', 'fade-slide', {
        params: { alignment: 'lower-third', outline: true },
      });
      onChangeLayers([created, ...layers]);
      setSelectedLayerId(created.id);
    }
  }

  function moveLayer(index: number, delta: -1 | 1) {
    const target = index + delta;
    if (target < 0 || target >= layers.length) return;
    const copy = [...layers];
    const [item] = copy.splice(index, 1);
    copy.splice(target, 0, item);
    onChangeLayers(copy);
  }

  function duplicateLayer(index: number) {
    const source = layers[index];
    const clone = createPresetLayer(source.type, source.kind, {
      ...source,
      id: undefined,
      name: `${source.name} (Copia)`,
      params: { ...source.params },
    });
    const copy = [...layers];
    copy.splice(index + 1, 0, clone);
    onChangeLayers(copy);
    setSelectedLayerId(clone.id);
  }

  function removeLayer(id: string) {
    onChangeLayers(layers.filter((l) => l.id !== id));
  }

  async function handleLutFile(file: File | undefined) {
    if (!file) return;
    const content = await file.text();
    onChangeLut(file.name, content, lutMix || 75);
  }

  const anchorLabel =
    ANCHOR_POINTS_9.find((pt) => pt.id === anchorPoint)?.label ?? 'Centro exacto';

  return (
    <div className="studio-left-stack-inspector">
      {/* ARRIBA: STACK DE CAPAS */}
      <section className="editor-section-box effect-stack-section" aria-label="Stack de Capas">
        <div className="studio-section-head">
          <div className="studio-section-title">
            <Layers size={14} />
            <strong>STACK DE CAPAS ({layers.length})</strong>
          </div>
          <div className="stack-add-bar">
            <select
              aria-label="Seleccionar capa para añadir"
              value={selectedAdd}
              onChange={(e) => setSelectedAdd(e.target.value)}
            >
              {LAYER_CATALOG.map((group) => (
                <optgroup key={group.type} label={group.groupLabel}>
                  {group.items.map((item) => (
                    <option key={`${group.type}:${item.kind}`} value={`${group.type}:${item.kind}`}>
                      {item.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <button
              type="button"
              className="btn-studio-add"
              onClick={handleAddLayer}
              aria-label="Añadir capa al stack"
            >
              <Plus size={13} />
              <span>Añadir</span>
            </button>
          </div>
        </div>

        {layers.length === 0 ? (
          <p className="stack-empty-hint">
            Sin nodos activos. Añade movimiento de cámara, óptica o tipografía cinética al stack.
          </p>
        ) : (
          <div className="effect-stack-list">
            {layers.map((layer, index) => {
              const isSelected = activeLayer?.id === layer.id;
              return (
                <div
                  key={layer.id}
                  draggable
                  onDragStart={() => setDragIndex(index)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => {
                    if (dragIndex === null || dragIndex === index) return;
                    const copy = [...layers];
                    const [moved] = copy.splice(dragIndex, 1);
                    copy.splice(index, 0, moved);
                    onChangeLayers(copy);
                    setDragIndex(null);
                  }}
                  className={`stack-layer-card${layer.enabled ? '' : ' is-disabled'}${isSelected ? ' is-expanded is-selected' : ''}`}
                >
                  <div className="stack-layer-header">
                    <span className="stack-drag-grip" aria-hidden="true" title="Arrastra para reordenar">
                      <GripVertical size={12} />
                    </span>

                    <button
                      type="button"
                      className="stack-layer-toggle"
                      onClick={() => updateLayer(layer.id, { enabled: !layer.enabled })}
                      aria-label={layer.enabled ? `Desactivar ${layer.name}` : `Activar ${layer.name}`}
                      title={layer.enabled ? 'Ocultar nodo' : 'Mostrar nodo'}
                    >
                      {layer.enabled ? <Eye size={13} /> : <EyeOff size={13} />}
                    </button>

                    <button
                      type="button"
                      className="stack-layer-title-btn"
                      onClick={() => {
                        setSelectedLayerId(layer.id);
                        if (layer.kind === 'lut') setActiveTab('audio-lut');
                        else setActiveTab('style');
                      }}
                    >
                      <span className={`layer-type-badge type-${layer.type}`}>
                        {TYPE_TAG_LABELS[layer.type]}
                      </span>
                      <span className="stack-layer-name">{layer.name}</span>
                      <span className="stack-layer-intensity">{Math.round(layer.intensity)}%</span>
                    </button>

                    <div className="stack-layer-actions">
                      <button
                        type="button"
                        className="icon-mini-btn"
                        onClick={() => moveLayer(index, -1)}
                        disabled={index === 0}
                        aria-label={`Subir ${layer.name}`}
                        title="Subir capa"
                      >
                        <ArrowUp size={12} />
                      </button>
                      <button
                        type="button"
                        className="icon-mini-btn"
                        onClick={() => moveLayer(index, 1)}
                        disabled={index === layers.length - 1}
                        aria-label={`Bajar ${layer.name}`}
                        title="Bajar capa"
                      >
                        <ArrowDown size={12} />
                      </button>
                      <button
                        type="button"
                        className="icon-mini-btn"
                        onClick={() => duplicateLayer(index)}
                        aria-label={`Duplicar ${layer.name}`}
                        title="Duplicar capa"
                      >
                        <Copy size={12} />
                      </button>
                      <button
                        type="button"
                        className="icon-mini-btn danger"
                        onClick={() => removeLayer(layer.id)}
                        aria-label={`Eliminar ${layer.name}`}
                        title="Eliminar capa"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ABAJO: INSPECTOR CONTEXTUAL UNIFICADO (3 PESTAÑAS LIMPIAS) */}
      <section className="editor-section-box unified-inspector-section" aria-label="Inspector de la capa activa">
        <div className="inspector-head-bar">
          <div className="studio-section-title">
            <Sliders size={13} />
            <strong>INSPECTOR · {activeLayer ? activeLayer.name.toUpperCase() : 'CAPA ACTIVA'}</strong>
          </div>
          {activeLayer && (
            <span className={`layer-type-badge type-${activeLayer.type}`}>
              {TYPE_TAG_LABELS[activeLayer.type]} · {Math.round(activeLayer.intensity)}%
            </span>
          )}
        </div>

        <div className="inspector-tabs" role="tablist" aria-label="Pestañas del inspector">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'style'}
            className={`inspector-tab-btn${activeTab === 'style' ? ' is-active' : ''}`}
            onClick={() => setActiveTab('style')}
          >
            <Palette size={12} />
            <span>Contenido y Estilo</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'geometry'}
            className={`inspector-tab-btn${activeTab === 'geometry' ? ' is-active' : ''}`}
            onClick={() => setActiveTab('geometry')}
          >
            <Compass size={12} />
            <span>Geometría y Anclaje</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'modulators'}
            className={`inspector-tab-btn${activeTab === 'modulators' ? ' is-active' : ''}`}
            onClick={() => setActiveTab('modulators')}
          >
            <Zap size={12} />
            <span>Moduladores y Física</span>
            {activeLayer?.modulators &&
              (activeLayer.modulators.spring?.enabled ||
                activeLayer.modulators.wiggle?.enabled ||
                activeLayer.modulators.lfo?.enabled ||
                activeLayer.modulators.stagger?.enabled) && <i className="tab-dot-indicator" />}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'audio-lut'}
            className={`inspector-tab-btn${activeTab === 'audio-lut' ? ' is-active' : ''}`}
            onClick={() => setActiveTab('audio-lut')}
          >
            <Music size={12} />
            <span>Audio SFX y LUT</span>
            {(audioSfx.sfxId !== 'none' || Boolean(lutName)) && <i className="tab-dot-indicator" />}
          </button>
        </div>

        {/* TAB 1: CONTENIDO Y ESTILO */}
        {activeTab === 'style' && (
          <div className="inspector-tab-pane">
            {activeLayer && (
              <PrecisionSlider
                label={`Intensidad · ${activeLayer.name}`}
                value={activeLayer.intensity}
                defaultValue={65}
                min={0}
                max={100}
                unit="%"
                onChange={(val) => updateLayer(activeLayer.id, { intensity: val })}
              />
            )}

            {/* Controles ópticos / cámara específicos si la capa seleccionada NO es tipografía */}
            {activeLayer && activeLayer.type !== 'typography' && (
              <div className="inspector-optical-block">
                {activeLayer.kind === 'punch-in' && (
                  <div className="layer-params-grid">
                    <PrecisionSlider
                      label="Escala inicial"
                      value={Number(activeLayer.params.startScale ?? 100)}
                      defaultValue={100}
                      min={80}
                      max={200}
                      unit="%"
                      onChange={(v) => updateParam(activeLayer.id, 'startScale', v)}
                    />
                    <PrecisionSlider
                      label="Escala final"
                      value={Number(activeLayer.params.endScale ?? 128)}
                      defaultValue={128}
                      min={100}
                      max={250}
                      unit="%"
                      onChange={(v) => updateParam(activeLayer.id, 'endScale', v)}
                    />
                    <PrecisionSlider
                      label="Anclaje X"
                      value={Number(activeLayer.params.anchorX ?? 50)}
                      defaultValue={50}
                      min={0}
                      max={100}
                      unit="%"
                      onChange={(v) => updateParam(activeLayer.id, 'anchorX', v)}
                    />
                    <PrecisionSlider
                      label="Anclaje Y"
                      value={Number(activeLayer.params.anchorY ?? 50)}
                      defaultValue={50}
                      min={0}
                      max={100}
                      unit="%"
                      onChange={(v) => updateParam(activeLayer.id, 'anchorY', v)}
                    />
                    <label className="layer-select-field">
                      <span>Tipo de golpe</span>
                      <select
                        value={String(activeLayer.params.impactMode ?? 'punch')}
                        onChange={(e) => updateParam(activeLayer.id, 'impactMode', e.target.value)}
                      >
                        <option value="punch">Golpe seco (In)</option>
                        <option value="progressive">Progresivo</option>
                      </select>
                    </label>
                  </div>
                )}

                {activeLayer.kind === 'camera-shake' && (
                  <div className="layer-params-grid">
                    <PrecisionSlider
                      label="Frecuencia"
                      value={Number(activeLayer.params.frequencyHz ?? 8)}
                      defaultValue={8}
                      min={1}
                      max={24}
                      step={0.5}
                      unit=" Hz"
                      onChange={(v) => updateParam(activeLayer.id, 'frequencyHz', v)}
                    />
                    <PrecisionSlider
                      label="Amplitud X"
                      value={Number(activeLayer.params.amplitudeX ?? 14)}
                      defaultValue={14}
                      min={0}
                      max={48}
                      unit=" px"
                      onChange={(v) => updateParam(activeLayer.id, 'amplitudeX', v)}
                    />
                    <PrecisionSlider
                      label="Amplitud Y"
                      value={Number(activeLayer.params.amplitudeY ?? 10)}
                      defaultValue={10}
                      min={0}
                      max={48}
                      unit=" px"
                      onChange={(v) => updateParam(activeLayer.id, 'amplitudeY', v)}
                    />
                    <PrecisionSlider
                      label="Rotación Shake"
                      value={Number(activeLayer.params.rotationDeg ?? 2.2)}
                      defaultValue={2.2}
                      min={0}
                      max={15}
                      step={0.2}
                      unit="°"
                      onChange={(v) => updateParam(activeLayer.id, 'rotationDeg', v)}
                    />
                    <PrecisionSlider
                      label="Semilla (Seed)"
                      value={Number(activeLayer.params.seed ?? 42)}
                      defaultValue={42}
                      min={1}
                      max={999}
                      onChange={(v) => updateParam(activeLayer.id, 'seed', v)}
                    />
                    <label className="layer-select-field">
                      <span>Modo</span>
                      <select
                        value={String(activeLayer.params.decayMode ?? 'impact')}
                        onChange={(e) => updateParam(activeLayer.id, 'decayMode', e.target.value)}
                      >
                        <option value="impact">Decaimiento tras impacto</option>
                        <option value="continuous">Continuo (Handheld)</option>
                      </select>
                    </label>
                  </div>
                )}

                {activeLayer.kind === 'float-drift' && (
                  <div className="layer-params-grid">
                    <PrecisionSlider
                      label="Deriva X"
                      value={Number(activeLayer.params.amplitudeX ?? 8)}
                      defaultValue={8}
                      min={0}
                      max={30}
                      unit=" px"
                      onChange={(v) => updateParam(activeLayer.id, 'amplitudeX', v)}
                    />
                    <PrecisionSlider
                      label="Deriva Y"
                      value={Number(activeLayer.params.amplitudeY ?? 10)}
                      defaultValue={10}
                      min={0}
                      max={30}
                      unit=" px"
                      onChange={(v) => updateParam(activeLayer.id, 'amplitudeY', v)}
                    />
                    <PrecisionSlider
                      label="Balanceo"
                      value={Number(activeLayer.params.rotationDeg ?? 1.5)}
                      defaultValue={1.5}
                      min={0}
                      max={8}
                      step={0.1}
                      unit="°"
                      onChange={(v) => updateParam(activeLayer.id, 'rotationDeg', v)}
                    />
                    <PrecisionSlider
                      label="Velocidad"
                      value={Number(activeLayer.params.speed ?? 1.2)}
                      defaultValue={1.2}
                      min={0.3}
                      max={4}
                      step={0.1}
                      unit="x"
                      onChange={(v) => updateParam(activeLayer.id, 'speed', v)}
                    />
                  </div>
                )}

                {activeLayer.kind === 'speed-ramp' && (
                  <div className="layer-params-grid">
                    <PrecisionSlider
                      label="Velocidad mínima"
                      value={Number(activeLayer.params.minSpeed ?? 40)}
                      defaultValue={40}
                      min={20}
                      max={100}
                      unit="%"
                      onChange={(v) => updateParam(activeLayer.id, 'minSpeed', v)}
                    />
                    <PrecisionSlider
                      label="Pico máximo"
                      value={Number(activeLayer.params.maxSpeed ?? 260)}
                      defaultValue={260}
                      min={100}
                      max={400}
                      unit="%"
                      onChange={(v) => updateParam(activeLayer.id, 'maxSpeed', v)}
                    />
                  </div>
                )}

                {(activeLayer.kind === 'motion-blur' || activeLayer.type === 'transition') && (
                  <div className="layer-params-grid">
                    <PrecisionSlider
                      label="Shutter Angle"
                      value={Number(activeLayer.params.shutterAngle ?? 180)}
                      defaultValue={180}
                      min={0}
                      max={360}
                      step={15}
                      unit="°"
                      onChange={(v) => updateParam(activeLayer.id, 'shutterAngle', v)}
                    />
                    {activeLayer.type === 'transition' && (
                      <label className="layer-select-field">
                        <span>Dirección</span>
                        <select
                          value={String(activeLayer.params.direction ?? 'right')}
                          onChange={(e) => updateParam(activeLayer.id, 'direction', e.target.value)}
                        >
                          <option value="right">Derecha</option>
                          <option value="left">Izquierda</option>
                          <option value="up">Arriba</option>
                          <option value="down">Abajo</option>
                          <option value="in">In (Acercar)</option>
                          <option value="out">Out (Alejar)</option>
                        </select>
                      </label>
                    )}
                    {activeLayer.kind === 'spin' && (
                      <label className="layer-select-field">
                        <span>Ángulo de giro</span>
                        <select
                          value={String(activeLayer.params.angleDeg ?? 90)}
                          onChange={(e) => updateParam(activeLayer.id, 'angleDeg', Number(e.target.value))}
                        >
                          <option value="90">90° (Cuarto de giro)</option>
                          <option value="180">180° (Medio giro)</option>
                          <option value="360">360° (Vuelta completa)</option>
                        </select>
                      </label>
                    )}
                    {activeLayer.kind === 'glitch' && (
                      <PrecisionSlider
                        label="Cortes RGB"
                        value={Number(activeLayer.params.sliceCount ?? 8)}
                        defaultValue={8}
                        min={2}
                        max={18}
                        onChange={(v) => updateParam(activeLayer.id, 'sliceCount', v)}
                      />
                    )}
                    {activeLayer.kind === 'luma-fade' && (
                      <PrecisionSlider
                        label="Suavizado Luma"
                        value={Number(activeLayer.params.softness ?? 28)}
                        defaultValue={28}
                        min={5}
                        max={80}
                        unit="%"
                        onChange={(v) => updateParam(activeLayer.id, 'softness', v)}
                      />
                    )}
                  </div>
                )}

                {(activeLayer.kind === 'glow' ||
                  activeLayer.kind === 'halation' ||
                  activeLayer.kind === 'vignette') && (
                  <PrecisionSlider
                    label="Difusión óptica"
                    value={Number(activeLayer.params.spread ?? 42)}
                    defaultValue={42}
                    min={10}
                    max={100}
                    unit="%"
                    onChange={(v) => updateParam(activeLayer.id, 'spread', v)}
                  />
                )}

                {activeLayer.kind === 'film-grain' && (
                  <div className="layer-params-grid">
                    <label className="layer-select-field">
                      <span>Película</span>
                      <select
                        value={String(activeLayer.params.stock ?? '35mm')}
                        onChange={(e) => updateParam(activeLayer.id, 'stock', e.target.value)}
                      >
                        <option value="8mm">8mm Vintage</option>
                        <option value="16mm">16mm Documental</option>
                        <option value="35mm">35mm Cine</option>
                      </select>
                    </label>
                    <PrecisionSlider
                      label="Tamaño grano"
                      value={Number(activeLayer.params.grainSize ?? 38)}
                      defaultValue={38}
                      min={10}
                      max={100}
                      unit="%"
                      onChange={(v) => updateParam(activeLayer.id, 'grainSize', v)}
                    />
                  </div>
                )}

                {activeLayer.kind === 'chromatic-aberration' && (
                  <div className="layer-params-grid">
                    <label className="layer-select-field">
                      <span>Modo RGB</span>
                      <select
                        value={String(activeLayer.params.mode ?? 'radial')}
                        onChange={(e) => updateParam(activeLayer.id, 'mode', e.target.value)}
                      >
                        <option value="radial">Radial</option>
                        <option value="directional">Direccional</option>
                      </select>
                    </label>
                    <PrecisionSlider
                      label="Desfase"
                      value={Number(activeLayer.params.shiftPx ?? 8)}
                      defaultValue={8}
                      min={1}
                      max={28}
                      unit=" px"
                      onChange={(v) => updateParam(activeLayer.id, 'shiftPx', v)}
                    />
                  </div>
                )}

                {activeLayer.kind === 'vhs-crt' && (
                  <div className="layer-params-grid">
                    <PrecisionSlider
                      label="Densidad Scanlines"
                      value={Number(activeLayer.params.scanlineDensity ?? 62)}
                      defaultValue={62}
                      min={15}
                      max={100}
                      unit="%"
                      onChange={(v) => updateParam(activeLayer.id, 'scanlineDensity', v)}
                    />
                    <PrecisionSlider
                      label="Vibración VHS"
                      value={Number(activeLayer.params.jitter ?? 30)}
                      defaultValue={30}
                      min={0}
                      max={100}
                      unit="%"
                      onChange={(v) => updateParam(activeLayer.id, 'jitter', v)}
                    />
                  </div>
                )}

                {activeLayer.kind === 'pip-frame' && (
                  <div className="layer-params-grid">
                    <PrecisionSlider
                      label="Radio borde"
                      value={Number(activeLayer.params.borderRadius ?? 18)}
                      defaultValue={18}
                      min={0}
                      max={48}
                      unit=" px"
                      onChange={(v) => updateParam(activeLayer.id, 'borderRadius', v)}
                    />
                    <PrecisionSlider
                      label="Grosor borde"
                      value={Number(activeLayer.params.borderWidth ?? 4)}
                      defaultValue={4}
                      min={0}
                      max={16}
                      unit=" px"
                      onChange={(v) => updateParam(activeLayer.id, 'borderWidth', v)}
                    />
                    <PrecisionSlider
                      label="Drop Shadow"
                      value={Number(activeLayer.params.dropShadow ?? 48)}
                      defaultValue={48}
                      min={0}
                      max={100}
                      unit="%"
                      onChange={(v) => updateParam(activeLayer.id, 'dropShadow', v)}
                    />
                    <PrecisionSlider
                      label="Escala PiP"
                      value={Number(activeLayer.params.pipScale ?? 84)}
                      defaultValue={84}
                      min={40}
                      max={100}
                      unit="%"
                      onChange={(v) => updateParam(activeLayer.id, 'pipScale', v)}
                    />
                  </div>
                )}

                {activeLayer.kind === 'blur' && (
                  <div className="layer-params-grid">
                    <label className="layer-select-field">
                      <span>Modo Blur</span>
                      <select
                        value={String(activeLayer.params.mode ?? 'gaussian')}
                        onChange={(e) => updateParam(activeLayer.id, 'mode', e.target.value)}
                      >
                        <option value="gaussian">Gaussiano</option>
                        <option value="directional">Direccional</option>
                      </select>
                    </label>
                    <PrecisionSlider
                      label="Radio"
                      value={Number(activeLayer.params.radiusPx ?? 12)}
                      defaultValue={12}
                      min={1}
                      max={60}
                      unit=" px"
                      onChange={(v) => updateParam(activeLayer.id, 'radiusPx', v)}
                    />
                    {String(activeLayer.params.mode ?? 'gaussian') === 'directional' && (
                      <PrecisionSlider
                        label="Ángulo direccional"
                        value={Number(activeLayer.params.angleDeg ?? 0)}
                        defaultValue={0}
                        min={0}
                        max={180}
                        unit="°"
                        onChange={(v) => updateParam(activeLayer.id, 'angleDeg', v)}
                      />
                    )}
                  </div>
                )}

                {activeLayer.kind === 'lens-distortion' && (
                  <PrecisionSlider
                    label="Curvatura óptica"
                    value={Number(activeLayer.params.curvature ?? 32)}
                    defaultValue={32}
                    min={-60}
                    max={60}
                    unit="%"
                    onChange={(v) => updateParam(activeLayer.id, 'curvature', v)}
                  />
                )}

                {activeLayer.kind === 'lut' && (
                  <div className="layer-params-grid">
                    <label className="lut-upload-btn">
                      <Upload size={12} />
                      <span>{lutName ? `LUT: ${lutName}` : 'Cargar archivo .cube'}</span>
                      <input
                        type="file"
                        accept=".cube"
                        className="visually-hidden"
                        onChange={(e) => void handleLutFile(e.target.files?.[0])}
                      />
                    </label>
                    <PrecisionSlider
                      label="Mezcla LUT"
                      value={lutMix}
                      defaultValue={75}
                      min={0}
                      max={100}
                      unit="%"
                      onChange={(v) => onChangeLut(lutName, undefined, v)}
                    />
                  </div>
                )}
              </div>
            )}

            {/* MOTOR TIPOGRÁFICO UNIFICADO + TYPEWRITER PRO */}
            {showTextControls && (
              <div className="inspector-typography-unified">
                <div className="field-row">
                  <label className="field-label">
                    Texto en pantalla
                    <input
                      type="text"
                      value={text}
                      onChange={(e) => onChangeText(e.target.value)}
                    />
                  </label>

                  <label className="field-label">
                    Tipografía
                    <select
                      aria-label="Tipografía"
                      value={fontFamily}
                      onChange={(e) => onChangeFontFamily(e.target.value as FontChoice)}
                    >
                      {fontOptions.map((font) => (
                        <option key={font} value={font}>
                          {font}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <label className="layer-select-field">
                  <span>Modo de animación cinética</span>
                  <select
                    aria-label="Modo de animación tipográfica"
                    value={typoKind}
                    onChange={(e) =>
                      handleTypographyModeChange(e.target.value as TypographyAnimationKind)
                    }
                  >
                    {TYPO_MODE_OPTIONS.map((opt) => (
                      <option key={opt.kind} value={opt.kind}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="toggle-pills">
                  <button
                    type="button"
                    className={`toggle-pill${uppercase ? ' is-on' : ''}`}
                    onClick={() => onChangeUppercase(!uppercase)}
                  >
                    Mayúsculas (AA)
                  </button>
                  <button
                    type="button"
                    className={`toggle-pill${shadow ? ' is-on' : ''}`}
                    onClick={() => onChangeShadow(!shadow)}
                  >
                    Sombra de cine
                  </button>
                  <button
                    type="button"
                    className={`toggle-pill${Boolean(typoLayer?.params.outline) ? ' is-on' : ''}`}
                    onClick={toggleTypoOutline}
                  >
                    Contorno (Outline)
                  </button>
                  <button
                    type="button"
                    className={`toggle-pill${backgroundBox ? ' is-on' : ''}`}
                    onClick={() => onChangeBackgroundBox(!backgroundBox)}
                  >
                    Placa de fondo
                  </button>
                </div>

                {backgroundBox && (
                  <div className="layer-params-grid plate-subcontrols">
                    <PrecisionSlider
                      label="Radio de placa"
                      value={plateRadius}
                      defaultValue={14}
                      min={0}
                      max={36}
                      unit=" px"
                      onChange={onChangePlateRadius}
                    />
                    <PrecisionSlider
                      label="Opacidad de placa"
                      value={plateOpacity}
                      defaultValue={86}
                      min={15}
                      max={100}
                      unit="%"
                      onChange={onChangePlateOpacity}
                    />
                  </div>
                )}

                {/* TYPEWRITER PRO DEEP ENGINE PANEL */}
                {typoLayer && typoKind === 'typewriter' && (
                  <div className="typewriter-pro-box" data-testid="typewriter-pro-panel">
                    <div className="typewriter-pro-head">
                      <span className="typewriter-pro-title">
                        <Keyboard size={13} />
                        <strong>MOTOR TYPEWRITER PRO · WRITE-ON</strong>
                      </span>
                      <span className="typewriter-pro-tag">Fusion WriteOn + MOGRT</span>
                    </div>

                    <div className="layer-params-grid">
                      <label className="layer-select-field">
                        <span>Unidad de avance</span>
                        <select
                          aria-label="Unidad de avance"
                          value={String(typoLayer.params.typewriterUnit ?? 'char')}
                          onChange={(e) =>
                            updateParam(typoLayer.id, 'typewriterUnit', e.target.value)
                          }
                        >
                          <option value="char">Por carácter</option>
                          <option value="word">Por palabra</option>
                          <option value="cipher">Cipher / Matrix Decode</option>
                        </select>
                      </label>

                      <label className="layer-select-field">
                        <span>Modo de salida (Out)</span>
                        <select
                          aria-label="Modo de salida Typewriter"
                          value={String(typoLayer.params.outBehavior ?? 'backspace')}
                          onChange={(e) =>
                            updateParam(typoLayer.id, 'outBehavior', e.target.value)
                          }
                        >
                          <option value="backspace">Borrado inverso (Backspace)</option>
                          <option value="fade">Desvanecer suave</option>
                          <option value="cut">Corte seco</option>
                          <option value="glitch">Glitch Scramble</option>
                        </select>
                      </label>

                      <label className="layer-select-field">
                        <span>Símbolo de cursor</span>
                        <select
                          aria-label="Símbolo de cursor"
                          value={
                            typoLayer.params.showCursor === false
                              ? 'none'
                              : String(typoLayer.params.cursorStyle ?? 'bar')
                          }
                          onChange={(e) => {
                            const nextStyle = e.target.value;
                            onChangeLayers(
                              layers.map((l) =>
                                l.id === typoLayer.id
                                  ? {
                                      ...l,
                                      params: {
                                        ...l.params,
                                        cursorStyle: nextStyle,
                                        showCursor: nextStyle !== 'none',
                                      },
                                    }
                                  : l
                              )
                            );
                          }}
                        >
                          <option value="bar">Barra vertical (|)</option>
                          <option value="underscore">Guion bajo (_)</option>
                          <option value="block">Bloque terminal (█)</option>
                          <option value="none">Sin cursor</option>
                        </select>
                      </label>

                      <label className="layer-select-field">
                        <span>Color del cursor</span>
                        <select
                          aria-label="Color del cursor"
                          value={String(typoLayer.params.cursorColorMode ?? 'accent')}
                          onChange={(e) =>
                            updateParam(typoLayer.id, 'cursorColorMode', e.target.value)
                          }
                        >
                          <option value="accent">Acento óptico</option>
                          <option value="white">Blanco puro</option>
                        </select>
                      </label>

                      <PrecisionSlider
                        label="Parpadeo cursor"
                        value={Number(typoLayer.params.cursorBlinkHz ?? 2.5)}
                        defaultValue={2.5}
                        min={0}
                        max={6}
                        step={0.5}
                        unit=" Hz"
                        onChange={(v) => updateParam(typoLayer.id, 'cursorBlinkHz', v)}
                      />

                      <PrecisionSlider
                        label="Cadencia humana (Jitter)"
                        value={Number(typoLayer.params.humanJitter ?? 25)}
                        defaultValue={25}
                        min={0}
                        max={100}
                        unit="%"
                        onChange={(v) => updateParam(typoLayer.id, 'humanJitter', v)}
                      />
                    </div>

                    <div className="typewriter-pro-checks">
                      <label className="layer-check-field">
                        <input
                          type="checkbox"
                          checked={Boolean(typoLayer.params.hideCursorOnComplete)}
                          onChange={(e) =>
                            updateParam(typoLayer.id, 'hideCursorOnComplete', e.target.checked)
                          }
                        />
                        <span>Ocultar cursor al terminar entrada</span>
                      </label>

                      <label className="layer-check-field">
                        <input
                          type="checkbox"
                          checked={Boolean(typoLayer.params.autoTypingSfx)}
                          onChange={(e) =>
                            updateParam(typoLayer.id, 'autoTypingSfx', e.target.checked)
                          }
                        />
                        <span>Auto-SFX mecánico de escritura</span>
                      </label>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* COMPOSICIÓN PRO POR CAPA: BLEND MODE, TRIM PATHS Y MÁSCARA DE REVELADO */}
            {activeLayer && (
              <div className="layer-composition-box">
                <div className="blend-mode-row">
                  <label className="layer-select-field">
                    <span>Modo de Fusión (Blend Mode)</span>
                    <select
                      aria-label="Modo de fusión"
                      value={activeLayer.blendMode ?? 'normal'}
                      onChange={(e) =>
                        updateLayer(activeLayer.id, { blendMode: e.target.value as LayerBlendMode })
                      }
                    >
                      {(Object.keys(BLEND_MODE_LABELS) as LayerBlendMode[]).map((mode) => (
                        <option key={mode} value={mode}>
                          {BLEND_MODE_LABELS[mode]}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="trim-paths-box">
                  <label className="layer-check-field">
                    <input
                      type="checkbox"
                      checked={Boolean(activeLayer.trimPaths?.enabled)}
                      onChange={(e) =>
                        updateTrimPaths(activeLayer.id, { enabled: e.target.checked })
                      }
                    />
                    <span>Animar Trazos (Trim Paths 0% → 100%)</span>
                  </label>
                  {activeLayer.trimPaths?.enabled && (
                    <div className="layer-params-grid">
                      <PrecisionSlider
                        label="Inicio (Start)"
                        value={activeLayer.trimPaths.startPct}
                        defaultValue={0}
                        min={0}
                        max={100}
                        unit="%"
                        onChange={(v) => updateTrimPaths(activeLayer.id, { startPct: v })}
                      />
                      <PrecisionSlider
                        label="Fin (End)"
                        value={activeLayer.trimPaths.endPct}
                        defaultValue={100}
                        min={0}
                        max={100}
                        unit="%"
                        onChange={(v) => updateTrimPaths(activeLayer.id, { endPct: v })}
                      />
                      <PrecisionSlider
                        label="Desfase (Offset)"
                        value={activeLayer.trimPaths.offsetDeg}
                        defaultValue={0}
                        min={-180}
                        max={180}
                        unit="°"
                        onChange={(v) => updateTrimPaths(activeLayer.id, { offsetDeg: v })}
                      />
                    </div>
                  )}
                </div>

                <div className="mask-reveal-box">
                  <label className="layer-check-field">
                    <input
                      type="checkbox"
                      checked={Boolean(activeLayer.maskReveal?.enabled)}
                      onChange={(e) =>
                        updateMaskReveal(activeLayer.id, { enabled: e.target.checked })
                      }
                    />
                    <span>Máscara de Revelado (Crop / Wipe Reveal)</span>
                  </label>
                  {activeLayer.maskReveal?.enabled && (
                    <div className="layer-params-grid">
                      <label className="layer-select-field">
                        <span>Dirección de revelado</span>
                        <select
                          aria-label="Dirección de máscara de revelado"
                          value={activeLayer.maskReveal.direction}
                          onChange={(e) =>
                            updateMaskReveal(activeLayer.id, {
                              direction: e.target.value as MaskRevealDirection,
                            })
                          }
                        >
                          <option value="bottom">Desde abajo</option>
                          <option value="left">Desde la izquierda</option>
                          <option value="right">Desde la derecha</option>
                          <option value="top">Desde arriba</option>
                          <option value="center">Expandir desde centro</option>
                          <option value="diagonal">Corte diagonal</option>
                        </select>
                      </label>
                      <PrecisionSlider
                        label="Suavizado (Feather)"
                        value={activeLayer.maskReveal.featherPx}
                        defaultValue={14}
                        min={0}
                        max={48}
                        unit=" px"
                        onChange={(v) => updateMaskReveal(activeLayer.id, { featherPx: v })}
                      />
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 2: GEOMETRÍA Y ANCLAJE (3x3 ANCHOR GRID + ENCUADRE) */}
        {activeTab === 'geometry' && (
          <div className="inspector-tab-pane">
            <div className="anchor-geometry-top">
              <div className="anchor-grid-wrap">
                <span className="anchor-grid-caption">Anclaje 3×3 (Pivot)</span>
                <div
                  className="anchor-grid-9"
                  role="radiogroup"
                  aria-label="Punto de anclaje 3x3"
                >
                  {ANCHOR_POINTS_9.map((pt) => {
                    const checked = anchorPoint === pt.id;
                    return (
                      <button
                        key={pt.id}
                        type="button"
                        role="radio"
                        aria-checked={checked}
                        aria-label={`Anclaje ${pt.label}`}
                        title={pt.label}
                        className={`anchor-dot-btn${checked ? ' is-active' : ''}`}
                        onClick={() => onChangeAnchorPoint(pt.id)}
                      >
                        <span />
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="anchor-quick-col">
                <span className="anchor-active-readout">{anchorLabel}</span>
                <div className="quick-align-pills">
                  <button
                    type="button"
                    className="bezier-pill"
                    onClick={() => {
                      if (typoLayer) updateParam(typoLayer.id, 'alignment', 'lower-third');
                      onQuickAlign('lower-third');
                    }}
                  >
                    Tercios inferiores
                  </button>
                  <button
                    type="button"
                    className="bezier-pill"
                    onClick={() => {
                      if (typoLayer) updateParam(typoLayer.id, 'alignment', 'center');
                      onQuickAlign('center');
                    }}
                  >
                    Centro exacto
                  </button>
                  <button
                    type="button"
                    className="bezier-pill"
                    onClick={() => {
                      if (typoLayer) updateParam(typoLayer.id, 'alignment', 'reels-safe');
                      onQuickAlign('reels-safe');
                    }}
                  >
                    Zona segura Reels
                  </button>
                </div>
                <small className="anchor-drag-hint">
                  Tip: también puedes arrastrar directamente sobre el monitor 60 fps.
                </small>
              </div>
            </div>

            <div className="layer-params-grid">
              <PrecisionSlider
                label="Escala"
                value={scalePct}
                defaultValue={100}
                min={50}
                max={220}
                unit="%"
                onChange={onChangeScalePct}
              />
              <PrecisionSlider
                label="Rotación"
                value={rotationDeg}
                defaultValue={0}
                min={-45}
                max={45}
                step={0.5}
                unit="°"
                onChange={onChangeRotationDeg}
              />
              <PrecisionSlider
                label="Posición X"
                value={positionX}
                defaultValue={defaultPosX}
                min={8}
                max={92}
                unit="%"
                onChange={onChangePositionX}
              />
              <PrecisionSlider
                label="Posición Y"
                value={positionY}
                defaultValue={defaultPosY}
                min={8}
                max={92}
                unit="%"
                onChange={onChangePositionY}
              />
              {showTextControls && (
                <PrecisionSlider
                  label="Tracking"
                  value={trackingPct}
                  defaultValue={0}
                  min={-8}
                  max={45}
                  unit="%"
                  onChange={onChangeTrackingPct}
                />
              )}
            </div>
          </div>
        )}

        {/* TAB 3: MODULADORES Y FÍSICA REAL */}
        {activeTab === 'modulators' && (
          <div className="inspector-tab-pane" data-testid="modulators-tab-pane">
            {!activeLayer ? (
              <p className="stack-empty-hint">
                Añade o selecciona una capa en el Stack para configurar Física y Moduladores.
              </p>
            ) : (
              <div className="modulators-stack">
                {/* 1. HOOKES LAW SPRING */}
                <div className="modulator-card">
                  <div className="modulator-card-head">
                    <label className="layer-check-field">
                      <input
                        type="checkbox"
                        checked={Boolean(activeLayer.modulators?.spring?.enabled)}
                        onChange={(e) =>
                          updateModulators(activeLayer.id, {
                            spring: {
                              enabled: e.target.checked,
                              stiffness: activeLayer.modulators?.spring?.stiffness ?? DEFAULT_SPRING_PARAMS.stiffness,
                              damping: activeLayer.modulators?.spring?.damping ?? DEFAULT_SPRING_PARAMS.damping,
                              mass: activeLayer.modulators?.spring?.mass ?? DEFAULT_SPRING_PARAMS.mass,
                            },
                          })
                        }
                      />
                      <strong>Física Spring Real (Ley de Hooke)</strong>
                    </label>
                    <span className="modulator-tag">Overshoot + BezierSpline</span>
                  </div>
                  {activeLayer.modulators?.spring?.enabled && (
                    <div className="layer-params-grid">
                      <PrecisionSlider
                        label="Rigidez (Stiffness)"
                        value={activeLayer.modulators.spring.stiffness}
                        defaultValue={DEFAULT_SPRING_PARAMS.stiffness}
                        min={50}
                        max={500}
                        step={5}
                        onChange={(v) =>
                          updateModulators(activeLayer.id, {
                            spring: { ...activeLayer.modulators!.spring!, stiffness: v },
                          })
                        }
                      />
                      <PrecisionSlider
                        label="Amortiguación (Damping)"
                        value={activeLayer.modulators.spring.damping}
                        defaultValue={DEFAULT_SPRING_PARAMS.damping}
                        min={5}
                        max={50}
                        step={1}
                        onChange={(v) =>
                          updateModulators(activeLayer.id, {
                            spring: { ...activeLayer.modulators!.spring!, damping: v },
                          })
                        }
                      />
                      <PrecisionSlider
                        label="Masa (Mass)"
                        value={activeLayer.modulators.spring.mass}
                        defaultValue={DEFAULT_SPRING_PARAMS.mass}
                        min={0.5}
                        max={5}
                        step={0.1}
                        unit=" kg"
                        onChange={(v) =>
                          updateModulators(activeLayer.id, {
                            spring: { ...activeLayer.modulators!.spring!, mass: v },
                          })
                        }
                      />
                    </div>
                  )}
                </div>

                {/* 2. WIGGLE / PERTURB */}
                <div className="modulator-card">
                  <div className="modulator-card-head">
                    <label className="layer-check-field">
                      <input
                        type="checkbox"
                        checked={Boolean(activeLayer.modulators?.wiggle?.enabled)}
                        onChange={(e) =>
                          updateModulators(activeLayer.id, {
                            wiggle: {
                              enabled: e.target.checked,
                              target: activeLayer.modulators?.wiggle?.target ?? 'position',
                              frequencyHz: activeLayer.modulators?.wiggle?.frequencyHz ?? 2.5,
                              amplitude: activeLayer.modulators?.wiggle?.amplitude ?? 18,
                              seed: activeLayer.modulators?.wiggle?.seed ?? 7,
                            },
                          })
                        }
                      />
                      <strong>Modulador Wiggle / Perturb</strong>
                    </label>
                    <span className="modulator-tag">Ruido orgánico</span>
                  </div>
                  {activeLayer.modulators?.wiggle?.enabled && (
                    <div className="layer-params-grid">
                      <label className="layer-select-field">
                        <span>Propiedad afectada</span>
                        <select
                          aria-label="Propiedad Wiggle"
                          value={activeLayer.modulators.wiggle.target}
                          onChange={(e) =>
                            updateModulators(activeLayer.id, {
                              wiggle: {
                                ...activeLayer.modulators!.wiggle!,
                                target: e.target.value as 'position' | 'rotation' | 'scale' | 'glow',
                              },
                            })
                          }
                        >
                          <option value="position">Posición (X, Y)</option>
                          <option value="rotation">Rotación</option>
                          <option value="scale">Escala</option>
                          <option value="glow">Brillo / Glow</option>
                        </select>
                      </label>
                      <PrecisionSlider
                        label="Frecuencia"
                        value={activeLayer.modulators.wiggle.frequencyHz}
                        defaultValue={2.5}
                        min={0.5}
                        max={15}
                        step={0.5}
                        unit=" Hz"
                        onChange={(v) =>
                          updateModulators(activeLayer.id, {
                            wiggle: { ...activeLayer.modulators!.wiggle!, frequencyHz: v },
                          })
                        }
                      />
                      <PrecisionSlider
                        label="Amplitud"
                        value={activeLayer.modulators.wiggle.amplitude}
                        defaultValue={18}
                        min={1}
                        max={100}
                        onChange={(v) =>
                          updateModulators(activeLayer.id, {
                            wiggle: { ...activeLayer.modulators!.wiggle!, amplitude: v },
                          })
                        }
                      />
                      <PrecisionSlider
                        label="Semilla (Seed)"
                        value={activeLayer.modulators.wiggle.seed}
                        defaultValue={7}
                        min={1}
                        max={99}
                        onChange={(v) =>
                          updateModulators(activeLayer.id, {
                            wiggle: { ...activeLayer.modulators!.wiggle!, seed: v },
                          })
                        }
                      />
                    </div>
                  )}
                </div>

                {/* 3. LFO OSCILLATOR */}
                <div className="modulator-card">
                  <div className="modulator-card-head">
                    <label className="layer-check-field">
                      <input
                        type="checkbox"
                        checked={Boolean(activeLayer.modulators?.lfo?.enabled)}
                        onChange={(e) =>
                          updateModulators(activeLayer.id, {
                            lfo: {
                              enabled: e.target.checked,
                              waveform: activeLayer.modulators?.lfo?.waveform ?? 'sine',
                              target: activeLayer.modulators?.lfo?.target ?? 'glow',
                              syncMode: activeLayer.modulators?.lfo?.syncMode ?? 'bpm',
                              frequencyHz: activeLayer.modulators?.lfo?.frequencyHz ?? 1.5,
                              bpm: activeLayer.modulators?.lfo?.bpm ?? 120,
                              beatDivision: activeLayer.modulators?.lfo?.beatDivision ?? '1/4',
                              amplitude: activeLayer.modulators?.lfo?.amplitude ?? 35,
                            },
                          })
                        }
                      />
                      <strong>Oscilador LFO (Sine / Pulse / Saw)</strong>
                    </label>
                    <span className="modulator-tag">Hz o Sync BPM</span>
                  </div>
                  {activeLayer.modulators?.lfo?.enabled && (
                    <div className="layer-params-grid">
                      <label className="layer-select-field">
                        <span>Forma de onda</span>
                        <select
                          aria-label="Forma de onda LFO"
                          value={activeLayer.modulators.lfo.waveform}
                          onChange={(e) =>
                            updateModulators(activeLayer.id, {
                              lfo: {
                                ...activeLayer.modulators!.lfo!,
                                waveform: e.target.value as LfoWaveform,
                              },
                            })
                          }
                        >
                          <option value="sine">Sine (Respiración)</option>
                          <option value="pulse">Pulse (Parpadeo)</option>
                          <option value="sawtooth">Sawtooth (Diente sierra)</option>
                        </select>
                      </label>
                      <label className="layer-select-field">
                        <span>Destino LFO</span>
                        <select
                          aria-label="Destino LFO"
                          value={activeLayer.modulators.lfo.target}
                          onChange={(e) =>
                            updateModulators(activeLayer.id, {
                              lfo: {
                                ...activeLayer.modulators!.lfo!,
                                target: e.target.value as
                                  | 'glow'
                                  | 'scale'
                                  | 'opacity'
                                  | 'rotation'
                                  | 'borderWidth',
                              },
                            })
                          }
                        >
                          <option value="glow">Brillo / Glow</option>
                          <option value="scale">Escala</option>
                          <option value="opacity">Opacidad</option>
                          <option value="rotation">Rotación</option>
                          <option value="borderWidth">Grosor de borde</option>
                        </select>
                      </label>
                      <label className="layer-select-field">
                        <span>Modo de tiempo</span>
                        <select
                          aria-label="Modo de tiempo LFO"
                          value={activeLayer.modulators.lfo.syncMode}
                          onChange={(e) =>
                            updateModulators(activeLayer.id, {
                              lfo: {
                                ...activeLayer.modulators!.lfo!,
                                syncMode: e.target.value as 'hz' | 'bpm',
                              },
                            })
                          }
                        >
                          <option value="bpm">Sincronizado a BPM</option>
                          <option value="hz">Frecuencia libre (Hz)</option>
                        </select>
                      </label>
                      {activeLayer.modulators.lfo.syncMode === 'bpm' ? (
                        <>
                          <PrecisionSlider
                            label="Tempo musical"
                            value={activeLayer.modulators.lfo.bpm}
                            defaultValue={120}
                            min={60}
                            max={180}
                            step={1}
                            unit=" BPM"
                            onChange={(v) =>
                              updateModulators(activeLayer.id, {
                                lfo: { ...activeLayer.modulators!.lfo!, bpm: v },
                              })
                            }
                          />
                          <label className="layer-select-field">
                            <span>Subdivisión rítmica</span>
                            <select
                              aria-label="Subdivisión BPM"
                              value={activeLayer.modulators.lfo.beatDivision}
                              onChange={(e) =>
                                updateModulators(activeLayer.id, {
                                  lfo: {
                                    ...activeLayer.modulators!.lfo!,
                                    beatDivision: e.target.value as LfoBeatDivision,
                                  },
                                })
                              }
                            >
                              <option value="1/1">1/1 (Redonda)</option>
                              <option value="1/2">1/2 (Blanca)</option>
                              <option value="1/4">1/4 (Negra · Beat)</option>
                              <option value="1/8">1/8 (Corchea)</option>
                            </select>
                          </label>
                        </>
                      ) : (
                        <PrecisionSlider
                          label="Frecuencia LFO"
                          value={activeLayer.modulators.lfo.frequencyHz}
                          defaultValue={1.5}
                          min={0.2}
                          max={8}
                          step={0.1}
                          unit=" Hz"
                          onChange={(v) =>
                            updateModulators(activeLayer.id, {
                              lfo: { ...activeLayer.modulators!.lfo!, frequencyHz: v },
                            })
                          }
                        />
                      )}
                      <PrecisionSlider
                        label="Amplitud"
                        value={activeLayer.modulators.lfo.amplitude}
                        defaultValue={35}
                        min={5}
                        max={100}
                        unit="%"
                        onChange={(v) =>
                          updateModulators(activeLayer.id, {
                            lfo: { ...activeLayer.modulators!.lfo!, amplitude: v },
                          })
                        }
                      />
                    </div>
                  )}
                </div>

                {/* 4. TEXT STAGGER CASCADE */}
                {(showTextControls || activeLayer.type === 'typography') && (
                  <div className="modulator-card">
                    <div className="modulator-card-head">
                      <label className="layer-check-field">
                        <input
                          type="checkbox"
                          checked={Boolean(activeLayer.modulators?.stagger?.enabled)}
                          onChange={(e) =>
                            updateModulators(activeLayer.id, {
                              stagger: {
                                enabled: e.target.checked,
                                unit: activeLayer.modulators?.stagger?.unit ?? 'word',
                                delayMs: activeLayer.modulators?.stagger?.delayMs ?? 55,
                                offsetY: activeLayer.modulators?.stagger?.offsetY ?? 18,
                                rotate3dDeg: activeLayer.modulators?.stagger?.rotate3dDeg ?? -28,
                                blurInPx: activeLayer.modulators?.stagger?.blurInPx ?? 6,
                              },
                            })
                          }
                        />
                        <strong>Stagger / Cascada de Texto</strong>
                      </label>
                      <span className="modulator-tag">Letra / Palabra / Línea</span>
                    </div>
                    {activeLayer.modulators?.stagger?.enabled && (
                      <div className="layer-params-grid">
                        <label className="layer-select-field">
                          <span>Granularidad</span>
                          <select
                            aria-label="Unidad de cascada Stagger"
                            value={activeLayer.modulators.stagger.unit}
                            onChange={(e) =>
                              updateModulators(activeLayer.id, {
                                stagger: {
                                  ...activeLayer.modulators!.stagger!,
                                  unit: e.target.value as 'char' | 'word' | 'line',
                                },
                              })
                            }
                          >
                            <option value="char">Por letra</option>
                            <option value="word">Por palabra</option>
                            <option value="line">Por línea</option>
                          </select>
                        </label>
                        <PrecisionSlider
                          label="Retraso (Stagger Delay)"
                          value={activeLayer.modulators.stagger.delayMs}
                          defaultValue={55}
                          min={10}
                          max={250}
                          step={5}
                          unit=" ms"
                          onChange={(v) =>
                            updateModulators(activeLayer.id, {
                              stagger: { ...activeLayer.modulators!.stagger!, delayMs: v },
                            })
                          }
                        />
                        <PrecisionSlider
                          label="Desplazamiento Y"
                          value={activeLayer.modulators.stagger.offsetY}
                          defaultValue={18}
                          min={-40}
                          max={40}
                          unit=" px"
                          onChange={(v) =>
                            updateModulators(activeLayer.id, {
                              stagger: { ...activeLayer.modulators!.stagger!, offsetY: v },
                            })
                          }
                        />
                        <PrecisionSlider
                          label="Rotación 3D X"
                          value={activeLayer.modulators.stagger.rotate3dDeg}
                          defaultValue={-28}
                          min={-90}
                          max={90}
                          unit="°"
                          onChange={(v) =>
                            updateModulators(activeLayer.id, {
                              stagger: { ...activeLayer.modulators!.stagger!, rotate3dDeg: v },
                            })
                          }
                        />
                        <PrecisionSlider
                          label="Desenfoque entrada"
                          value={activeLayer.modulators.stagger.blurInPx}
                          defaultValue={6}
                          min={0}
                          max={20}
                          unit=" px"
                          onChange={(v) =>
                            updateModulators(activeLayer.id, {
                              stagger: { ...activeLayer.modulators!.stagger!, blurInPx: v },
                            })
                          }
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* TAB 4: AUDIO SFX Y LUT (.CUBE) */}
        {activeTab === 'audio-lut' && (
          <div className="inspector-tab-pane">
            <AudioSfxPanel
              embedded
              audioSfx={audioSfx}
              customAudioBytes={customAudioBytes}
              onChange={onChangeAudioSfx}
            />

            <div className="lut-grading-box">
              <div className="sfx-embedded-head">
                <div className="studio-section-title">
                  <Palette size={13} />
                  <strong>COLOR GRADING · LUT 3D (.CUBE)</strong>
                </div>
                <span className={`sfx-badge${lutName ? ' is-linked' : ''}`}>
                  {lutName ?? 'Sin LUT'}
                </span>
              </div>

              <div className="lut-controls-row">
                <label className="lut-upload-btn">
                  <Upload size={12} />
                  <span>{lutName ? `Cambiar (${lutName})` : 'Cargar archivo .cube'}</span>
                  <input
                    type="file"
                    accept=".cube"
                    className="visually-hidden"
                    onChange={(e) => void handleLutFile(e.target.files?.[0])}
                  />
                </label>

                {lutName && (
                  <button
                    type="button"
                    className="icon-mini-btn danger"
                    onClick={() => onChangeLut(undefined, '', lutMix)}
                    aria-label="Quitar LUT activa"
                    title="Quitar LUT"
                  >
                    <X size={13} />
                  </button>
                )}
              </div>

              <PrecisionSlider
                label="Mezcla LUT"
                value={lutMix}
                defaultValue={75}
                min={0}
                max={100}
                unit="%"
                onChange={(v) => onChangeLut(lutName, undefined, v)}
              />
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
