import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Copy,
  FileText,
  GitCommitHorizontal,
  Palette,
  RotateCcw,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import {
  ANCHOR_POINTS_9,
  applyModeFor,
  BEZIER_PRESETS,
  categoryLabels,
  createDefaultLayersForCategory,
  DEFAULT_SPRING_PARAMS,
  DEFAULT_TIMELINE_PHASES,
  defaultCurveFor,
  defaultPositionFor,
  editorLabels,
  PRO_RECIPES,
  type AnchorPoint9,
  type AnimationCurve,
  type AspectRatioPreset,
  type AudioSfxConfig,
  type BezierHandles,
  type CreatePresetInput,
  type EditorTarget,
  type FontChoice,
  type KeyframeInterpolation,
  type KeyframePoint,
  type KeyframeTrack,
  type KeyframeTrackId,
  type NativeFile,
  type PresetCategory,
  type PresetLayer,
  type PresetRecord,
  type ProRecipePreset,
  type SpringParams,
  type TimelineMode,
  type TimelinePhases,
} from '../../domain/preset';
import { sortKeyframes } from '../../lib/animationEngine';
import { isStarterPresetId } from '../../lib/localStore';
import {
  normalizeScaleMultiplier,
  normalizeTrackingSpacing,
  normalizeUnitCoord,
} from '../../lib/nleCompiler';
import { PresetPreviewPlayer } from '../PresetPreviewPlayer';
import { BezierCurveEditor } from './BezierCurveEditor';
import { EffectStackPanel } from './EffectStackPanel';
import {
  KeyframeTrackEditor,
  type DopeTrackRowId,
  type SelectedSegmentRef,
} from './KeyframeTrackEditor';

interface PresetEditorStudioModalProps {
  initialPreset?: PresetRecord | null;
  defaultTarget: EditorTarget;
  onClose: () => void;
  onSave: (input: CreatePresetInput, existing?: PresetRecord) => Promise<void>;
  onDuplicate?: (input: CreatePresetInput) => Promise<void>;
  onDelete?: (preset: PresetRecord) => Promise<void>;
  teamName: string;
}

const FONT_OPTIONS: FontChoice[] = [
  'Segoe UI',
  'Georgia',
  'Impact',
  'Consolas',
  'Trebuchet MS',
];

const ACCENT_SWATCHES = ['#7c5cff', '#22d3ee', '#f97316', '#ec4899', '#10b981', '#fbbf24'];

export function PresetEditorStudioModal({
  initialPreset,
  defaultTarget,
  onClose,
  onSave,
  onDuplicate,
  onDelete,
  teamName,
}: PresetEditorStudioModalProps) {
  const isEditing = Boolean(initialPreset);
  const initialCategory: PresetCategory = initialPreset?.category ?? 'title';
  const initialPos = defaultPositionFor(initialCategory);
  const initialCurve =
    initialPreset?.curve ?? defaultCurveFor(initialCategory, initialPreset?.animation ?? '');

  const [name, setName] = useState(initialPreset?.name ?? '');
  const [description, setDescription] = useState(initialPreset?.description ?? '');
  const [descOpen, setDescOpen] = useState(false);
  const [category, setCategory] = useState<PresetCategory>(initialCategory);
  const [target, setTarget] = useState<EditorTarget>(initialPreset?.target ?? defaultTarget);
  const [durationSeconds, setDurationSeconds] = useState(initialPreset?.durationSeconds ?? 2.4);
  const [text, setText] = useState(initialPreset?.text ?? 'Título Principal');
  const [accent, setAccent] = useState(initialPreset?.accent ?? '#7c5cff');
  const [secondaryAccent, setSecondaryAccent] = useState<string | undefined>(
    initialPreset?.secondaryAccent
  );
  const [curve, setCurve] = useState<AnimationCurve>(initialCurve);
  const [bezier, setBezier] = useState<BezierHandles>(
    initialPreset?.bezier ?? BEZIER_PRESETS[initialCurve]
  );
  const [timelinePhases, setTimelinePhases] = useState<TimelinePhases>(
    initialPreset?.timelinePhases ?? DEFAULT_TIMELINE_PHASES
  );
  const [timelineMode, setTimelineMode] = useState<TimelineMode>(
    initialPreset?.timelineMode ?? (initialPreset?.keyframeTracks?.length ? 'keyframes' : 'phases')
  );
  const [keyframeTracks, setKeyframeTracks] = useState<KeyframeTrack[]>(
    initialPreset?.keyframeTracks ?? []
  );
  const [autoKeyframe, setAutoKeyframe] = useState(false);
  const [playheadTime, setPlayheadTime] = useState(0);
  const [selectedDopeRow, setSelectedDopeRow] = useState<DopeTrackRowId>('position');
  const [selectedSegment, setSelectedSegment] = useState<SelectedSegmentRef | null>(null);
  const [aspectRatio, setAspectRatio] = useState<AspectRatioPreset>(
    initialPreset?.aspectRatio ?? '16:9'
  );
  const [layers, setLayers] = useState<PresetLayer[]>(() =>
    initialPreset?.layers?.length
      ? initialPreset.layers
      : createDefaultLayersForCategory(initialCategory, initialPreset ?? undefined)
  );
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(() =>
    initialPreset?.layers?.[0]?.id ?? null
  );
  const [pivotX, setPivotX] = useState<number | undefined>(initialPreset?.pivotX);
  const [pivotY, setPivotY] = useState<number | undefined>(initialPreset?.pivotY);
  const [audioSfx, setAudioSfx] = useState<AudioSfxConfig>(
    initialPreset?.audioSfx ?? { sfxId: 'none', offsetMs: 0, gainDb: 0 }
  );
  const [audioFile, setAudioFile] = useState<NativeFile | undefined>(() =>
    initialPreset?.nativeFiles.find((file) => /\.(wav|mp3)$/i.test(file.path))
  );
  const [lutName, setLutName] = useState<string | undefined>(initialPreset?.lutName);
  const [lutData, setLutData] = useState<string | undefined>(initialPreset?.lutData);
  const [lutMix, setLutMix] = useState<number>(initialPreset?.lutMix ?? 75);

  const [positionX, setPositionX] = useState(() =>
    Math.round(normalizeUnitCoord(initialPreset?.positionX, initialPos.x) * 100)
  );
  const [positionY, setPositionY] = useState(() =>
    Math.round(normalizeUnitCoord(initialPreset?.positionY, initialPos.y) * 100)
  );
  const [anchorPoint, setAnchorPoint] = useState<AnchorPoint9>(
    initialPreset?.anchorPoint ?? 'center'
  );
  const [rotationDeg, setRotationDeg] = useState<number>(initialPreset?.rotationDeg ?? 0);
  const [scalePct, setScalePct] = useState(() =>
    Math.round(normalizeScaleMultiplier(initialPreset?.scale, 1) * 100)
  );
  const [fontFamily, setFontFamily] = useState<FontChoice>(initialPreset?.fontFamily ?? 'Segoe UI');
  const [trackingPct, setTrackingPct] = useState(() =>
    Math.round((normalizeTrackingSpacing(initialPreset?.tracking) - 1) * 100)
  );
  const [uppercase, setUppercase] = useState(Boolean(initialPreset?.uppercase));
  const [shadow, setShadow] = useState(initialPreset?.shadow ?? true);
  const [backgroundBox, setBackgroundBox] = useState(
    initialPreset?.backgroundBox ?? initialCategory === 'subtitle'
  );
  const [plateRadius, setPlateRadius] = useState<number>(initialPreset?.plateRadius ?? 14);
  const [plateOpacity, setPlateOpacity] = useState<number>(initialPreset?.plateOpacity ?? 86);
  const [tagsRaw, setTagsRaw] = useState((initialPreset?.tags ?? ['estudio', 'pro']).join(', '));

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forceBefore, setForceBefore] = useState(false);
  const [timeCommand, setTimeCommand] = useState<{
    seq: number;
    action: 'toggle' | 'step-back' | 'step-forward';
  }>({ seq: 0, action: 'toggle' });

  function handleCategoryChange(nextCat: PresetCategory) {
    setCategory(nextCat);
    const nextPos = defaultPositionFor(nextCat);
    const nextCurve = defaultCurveFor(nextCat, '');
    setPositionX(Math.round(nextPos.x * 100));
    setPositionY(Math.round(nextPos.y * 100));
    setCurve(nextCurve);
    setBezier(BEZIER_PRESETS[nextCurve]);
    setBackgroundBox(nextCat === 'subtitle');
    setLayers(createDefaultLayersForCategory(nextCat));
  }

  function handleQuickAlign(alignment: 'lower-third' | 'center' | 'reels-safe') {
    if (alignment === 'center') {
      setPositionX(50);
      setPositionY(50);
    } else if (alignment === 'reels-safe') {
      setPositionX(50);
      setPositionY(28);
    } else {
      setPositionX(50);
      setPositionY(18);
    }
  }

  function applyProRecipe(recipeId: string) {
    const recipe: ProRecipePreset | undefined = PRO_RECIPES.find((r) => r.id === recipeId);
    if (!recipe) return;
    if (!name.trim() || PRO_RECIPES.some((r) => r.name === name.trim())) {
      setName(recipe.name);
    }
    setDescription(recipe.description);
    setCategory(recipe.category);
    setDurationSeconds(recipe.durationSeconds);
    setAspectRatio(recipe.aspectRatio);
    setBezier(recipe.bezier);
    setTimelinePhases(recipe.timelinePhases);
    setAudioSfx(recipe.audioSfx);
    if (recipe.text) setText(recipe.text);
    setAccent(recipe.accent);
    setSecondaryAccent(recipe.secondaryAccent);
    setAnchorPoint(recipe.anchorPoint ?? 'center');
    setTagsRaw(recipe.tags.join(', '));
    setLayers(recipe.layers.map((l) => ({ ...l, params: { ...l.params } })));
    const nextPos = defaultPositionFor(recipe.category);
    setPositionX(
      recipe.anchorPoint?.endsWith('left')
        ? 14
        : recipe.anchorPoint?.endsWith('right')
          ? 86
          : Math.round(nextPos.x * 100)
    );
    setPositionY(Math.round(nextPos.y * 100));
    setBackgroundBox(recipe.category === 'subtitle');
  }

  const normalizedScale = Number((scalePct / 100).toFixed(2));
  const normalizedTracking = Number((1 + trackingPct / 100).toFixed(2));
  const normalizedPosX = Number((positionX / 100).toFixed(2));
  const normalizedPosY = Number((positionY / 100).toFixed(2));
  const activeLayer = layers.find((l) => l.id === selectedLayerId) ?? layers[0] ?? null;
  const activeTrackLayerId = activeLayer?.id;

  function makeKfId(): string {
    return `kf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  }

  function upsertTrackKeyframe(
    property: KeyframeTrackId,
    timeSec: number,
    value: number,
    layerId: string | undefined = activeTrackLayerId
  ) {
    const t = Number(Math.max(0, Math.min(durationSeconds, timeSec)).toFixed(3));
    setKeyframeTracks((prev) => {
      const idx = prev.findIndex(
        (tr) => tr.property === property && (tr.layerId ?? '') === (layerId ?? '')
      );
      if (idx === -1) {
        const nextTrack: KeyframeTrack = {
          id: `trk-${property}-${Date.now().toString(36)}`,
          layerId,
          property,
          keyframes: [
            {
              id: makeKfId(),
              time: t,
              value,
              interpolation: 'bezier',
              bezier,
            },
          ],
        };
        return [...prev, nextTrack];
      }
      const existing = prev[idx];
      const nearIdx = existing.keyframes.findIndex((kf) => Math.abs(kf.time - t) < 0.03);
      let nextKfs: KeyframePoint[];
      if (nearIdx >= 0) {
        nextKfs = existing.keyframes.map((kf, kIdx) =>
          kIdx === nearIdx ? { ...kf, time: t, value } : kf
        );
      } else {
        nextKfs = [
          ...existing.keyframes,
          {
            id: makeKfId(),
            time: t,
            value,
            interpolation: 'bezier',
            bezier,
          },
        ];
      }
      const updatedTrack: KeyframeTrack = { ...existing, keyframes: sortKeyframes(nextKfs) };
      return prev.map((tr, i) => (i === idx ? updatedTrack : tr));
    });
  }

  function upsertRowKeyframeAt(row: DopeTrackRowId, explicitTime?: number) {
    const t = explicitTime ?? playheadTime;
    if (row === 'position') {
      upsertTrackKeyframe('positionX', t, normalizedPosX);
      upsertTrackKeyframe('positionY', t, normalizedPosY);
    } else if (row === 'scale') {
      upsertTrackKeyframe('scale', t, normalizedScale);
    } else if (row === 'rotation') {
      upsertTrackKeyframe('rotation', t, rotationDeg);
    } else if (row === 'opacity') {
      upsertTrackKeyframe('opacity', t, 100);
    } else if (row === 'opticalIntensity') {
      upsertTrackKeyframe('opticalIntensity', t, activeLayer?.intensity ?? 65);
    }
  }

  function moveKeyframe(
    property: KeyframeTrackId,
    keyframeId: string,
    newTime: number,
    layerId?: string
  ) {
    const clamped = Number(Math.max(0, Math.min(durationSeconds, newTime)).toFixed(3));
    setKeyframeTracks((prev) =>
      prev.map((tr) => {
        if (tr.property !== property) return tr;
        if (layerId !== undefined && tr.layerId && tr.layerId !== layerId) return tr;
        return {
          ...tr,
          keyframes: sortKeyframes(
            tr.keyframes.map((kf) => (kf.id === keyframeId ? { ...kf, time: clamped } : kf))
          ),
        };
      })
    );
  }

  function deleteKeyframe(property: KeyframeTrackId, keyframeId: string, layerId?: string) {
    const targetProps: KeyframeTrackId[] =
      property === 'positionX' ? ['positionX', 'positionY'] : [property];
    setKeyframeTracks((prev) =>
      prev
        .map((tr) => {
          if (!targetProps.includes(tr.property)) return tr;
          if (layerId !== undefined && tr.layerId && tr.layerId !== layerId) return tr;
          if (tr.property === property) {
            return { ...tr, keyframes: tr.keyframes.filter((kf) => kf.id !== keyframeId) };
          }
          // Keep paired positionY synced if matching index/time removed
          const paired = prev.find((p) => p.property === property && p.layerId === tr.layerId);
          const removedKf = paired?.keyframes.find((k) => k.id === keyframeId);
          if (!removedKf) return tr;
          return {
            ...tr,
            keyframes: tr.keyframes.filter((kf) => Math.abs(kf.time - removedKf.time) >= 0.025),
          };
        })
        .filter((tr) => tr.keyframes.length > 0)
    );
    if (selectedSegment?.keyframeId === keyframeId) {
      setSelectedSegment(null);
    }
  }

  function handleMotionPathHandleChange(
    keyframeIndex: number,
    handleType: 'out' | 'in',
    dx: number,
    dy: number
  ) {
    setKeyframeTracks((prev) =>
      prev.map((tr) => {
        if (tr.property !== 'positionX' && tr.property !== 'positionY') return tr;
        const sorted = sortKeyframes(tr.keyframes);
        const target = sorted[keyframeIndex];
        if (!target) return tr;
        const nextKfs = tr.keyframes.map((kf) => {
          if (kf.id !== target.id) return kf;
          return handleType === 'out'
            ? { ...kf, spatialOut: { dx, dy } }
            : { ...kf, spatialIn: { dx, dy } };
        });
        return { ...tr, keyframes: nextKfs };
      })
    );
  }

  function applyPositionChange(nextPctX: number, nextPctY: number) {
    setPositionX(nextPctX);
    setPositionY(nextPctY);
    if (autoKeyframe) {
      if (timelineMode !== 'keyframes') setTimelineMode('keyframes');
      upsertTrackKeyframe('positionX', playheadTime, Number((nextPctX / 100).toFixed(2)));
      upsertTrackKeyframe('positionY', playheadTime, Number((nextPctY / 100).toFixed(2)));
    }
  }

  function applyScaleChange(nextPct: number) {
    setScalePct(nextPct);
    if (autoKeyframe) {
      if (timelineMode !== 'keyframes') setTimelineMode('keyframes');
      upsertTrackKeyframe('scale', playheadTime, Number((nextPct / 100).toFixed(2)));
    }
  }

  function applyRotationChange(nextDeg: number) {
    setRotationDeg(nextDeg);
    if (autoKeyframe) {
      if (timelineMode !== 'keyframes') setTimelineMode('keyframes');
      upsertTrackKeyframe('rotation', playheadTime, nextDeg);
    }
  }

  const selectedSegmentKeyframe = useMemo(() => {
    if (!selectedSegment) return null;
    const track = keyframeTracks.find(
      (tr) =>
        tr.property === selectedSegment.property &&
        (!selectedSegment.layerId || !tr.layerId || tr.layerId === selectedSegment.layerId)
    );
    return track?.keyframes.find((kf) => kf.id === selectedSegment.keyframeId) ?? null;
  }, [selectedSegment, keyframeTracks]);

  function updateSelectedSegmentCurve(
    nextCurve: AnimationCurve,
    nextBezier: BezierHandles,
    nextInterpolation?: KeyframeInterpolation,
    nextSpring?: SpringParams
  ) {
    if (!selectedSegment) {
      setCurve(nextCurve);
      setBezier(nextBezier);
      return;
    }
    const targetProps: KeyframeTrackId[] =
      selectedSegment.property === 'positionX' ? ['positionX', 'positionY'] : [selectedSegment.property];
    const sourceTrack = keyframeTracks.find((tr) => tr.property === selectedSegment.property);
    const sourceKf = sourceTrack?.keyframes.find((k) => k.id === selectedSegment.keyframeId);
    setKeyframeTracks((prev) =>
      prev.map((tr) => {
        if (!targetProps.includes(tr.property)) return tr;
        return {
          ...tr,
          keyframes: tr.keyframes.map((kf) => {
            const matches =
              kf.id === selectedSegment.keyframeId ||
              (sourceKf !== undefined && Math.abs(kf.time - sourceKf.time) < 0.025);
            if (!matches) return kf;
            return {
              ...kf,
              bezier: nextBezier,
              interpolation: nextInterpolation ?? kf.interpolation ?? 'bezier',
              spring: nextSpring ?? kf.spring ?? DEFAULT_SPRING_PARAMS,
            };
          }),
        };
      })
    );
  }

  function buildInput(): CreatePresetInput {
    const active = layers.filter((l) => l.enabled);
    const primaryLayer = active[0] ?? layers[0];
    const firstTransition =
      active.find((l) => l.type === 'transition') ?? layers.find((l) => l.type === 'transition');
    const firstVfx = active.find((l) => l.type === 'vfx') ?? layers.find((l) => l.type === 'vfx');
    const transitionStyle = firstTransition
      ? (firstTransition.kind as CreatePresetInput['transitionStyle'])
      : initialPreset?.transitionStyle;
    const effectStyle =
      firstVfx &&
      (firstVfx.kind === 'glow' || firstVfx.kind === 'halation' || firstVfx.kind === 'vignette')
        ? firstVfx.kind
        : initialPreset?.effectStyle;

    return {
      id: initialPreset?.id,
      name: name.trim() || 'Preset Studio',
      description:
        description.trim() || 'Preset profesional multicapa generado con Framebase Studio.',
      category,
      target,
      text,
      accent,
      secondaryAccent,
      animation: primaryLayer?.name ?? 'Multicapa',
      curve,
      bezier,
      timelineMode,
      keyframeTracks: keyframeTracks.length > 0 ? keyframeTracks : undefined,
      timelinePhases,
      audioSfx,
      audioFile,
      aspectRatio,
      lutName,
      lutMix,
      lutData: lutData || undefined,
      layers,
      positionX: normalizedPosX,
      positionY: normalizedPosY,
      anchorPoint,
      pivotX,
      pivotY,
      rotationDeg,
      scale: normalizedScale,
      intensity: Number(((primaryLayer?.intensity ?? 65) / 100).toFixed(2)),
      spread: Math.round(Number(firstVfx?.params.spread ?? 40) * 0.35),
      fontFamily,
      tracking: normalizedTracking,
      uppercase,
      shadow,
      backgroundBox,
      plateRadius,
      plateOpacity,
      transitionStyle,
      effectStyle,
      durationSeconds,
      tags: tagsRaw
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
    };
  }

  async function submitSave() {
    if (!name.trim()) {
      setError('Escribe un nombre para identificar el preset.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(buildInput(), initialPreset ?? undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo guardar el preset.');
    } finally {
      setSaving(false);
    }
  }

  async function handleFormSubmit(event: FormEvent) {
    event.preventDefault();
    await submitSave();
  }

  async function handleDuplicateClick() {
    if (!onDuplicate || !initialPreset) return;
    const copy = buildInput();
    copy.id = undefined;
    const baseTitle = name.trim() || initialPreset.name;
    copy.name = /\(copia\)$/i.test(baseTitle) ? baseTitle : `${baseTitle} (Copia)`;
    setSaving(true);
    setError(null);
    try {
      await onDuplicate(copy);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo duplicar el preset.');
    } finally {
      setSaving(false);
    }
  }

  const handlersRef = useRef({
    submitSave,
    onClose,
    insertKeyframeShortcut: () => {
      setTimelineMode('keyframes');
      upsertRowKeyframeAt(selectedDopeRow, playheadTime);
    },
  });
  handlersRef.current = {
    submitSave,
    onClose,
    insertKeyframeShortcut: () => {
      setTimelineMode('keyframes');
      upsertRowKeyframeAt(selectedDopeRow, playheadTime);
    },
  };

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void handlersRef.current.submitSave();
        return;
      }
      if (event.key === 'Escape') {
        handlersRef.current.onClose();
        return;
      }
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (event.code === 'Space') {
        event.preventDefault();
        setTimeCommand((prev) => ({ seq: prev.seq + 1, action: 'toggle' }));
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        setTimeCommand((prev) => ({ seq: prev.seq + 1, action: 'step-back' }));
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        setTimeCommand((prev) => ({ seq: prev.seq + 1, action: 'step-forward' }));
      } else if (event.key.toLowerCase() === 'k') {
        event.preventDefault();
        handlersRef.current.insertKeyframeShortcut();
      } else if (event.key === '\\') {
        setForceBefore(true);
      }
    }

    function onKeyUp(event: KeyboardEvent) {
      if (event.key === '\\') setForceBefore(false);
    }

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  const livePreviewPreset: PresetRecord = useMemo(
    () => ({
      id: initialPreset?.id ?? 'studio-preview',
      version: initialPreset?.version ?? 1,
      teamId: initialPreset?.teamId ?? 'preview',
      name: name.trim() || 'Preset Studio',
      description: description.trim() || 'Vista previa en tiempo real',
      category,
      target,
      templateName: 'Preview',
      applyMode: applyModeFor(category),
      durationSeconds,
      text,
      accent,
      secondaryAccent,
      animation: layers[0]?.name ?? 'Multicapa',
      curve,
      bezier,
      timelineMode,
      keyframeTracks: keyframeTracks.length > 0 ? keyframeTracks : undefined,
      timelinePhases,
      audioSfx,
      aspectRatio,
      lutName,
      lutMix,
      lutData: lutData || undefined,
      layers,
      positionX: normalizedPosX,
      positionY: normalizedPosY,
      anchorPoint,
      pivotX,
      pivotY,
      rotationDeg,
      scale: normalizedScale,
      intensity: (layers[0]?.intensity ?? 65) / 100,
      spread: Math.round(Number(layers[0]?.params.spread ?? 40) * 0.35),
      fontFamily,
      tracking: normalizedTracking,
      uppercase,
      shadow,
      backgroundBox,
      plateRadius,
      plateOpacity,
      tags: [],
      author: 'Tú',
      updatedAt: new Date().toISOString(),
      favorite: false,
      source: 'created',
      nativeFiles: [],
    }),
    [
      initialPreset?.id,
      initialPreset?.version,
      initialPreset?.teamId,
      name,
      description,
      category,
      target,
      durationSeconds,
      text,
      accent,
      secondaryAccent,
      layers,
      curve,
      bezier,
      timelineMode,
      keyframeTracks,
      timelinePhases,
      audioSfx,
      aspectRatio,
      lutName,
      lutMix,
      lutData,
      normalizedPosX,
      normalizedPosY,
      anchorPoint,
      pivotX,
      pivotY,
      rotationDeg,
      normalizedScale,
      fontFamily,
      normalizedTracking,
      uppercase,
      shadow,
      backgroundBox,
      plateRadius,
      plateOpacity,
    ]
  );

  const showTextControls =
    ['title', 'subtitle', 'graphic', 'sticker'].includes(category) ||
    layers.some((l) => l.type === 'typography');

  const enabledLayers = layers.filter((l) => l.enabled);
  const isStarter = Boolean(initialPreset && isStarterPresetId(initialPreset.id));
  const canRestoreFactory = Boolean(initialPreset && isStarter && initialPreset.source !== 'starter');
  const canDeleteCustom = Boolean(initialPreset && !isStarter);
  const anchorShortLabel =
    ANCHOR_POINTS_9.find((a) => a.id === anchorPoint)?.label ?? 'Centro exacto';

  return (
    <div className="modal-scrim" onClick={onClose}>
      <section
        className="modal-panel create-modal studio-modal"
        role="dialog"
        aria-modal="true"
        aria-label={isEditing ? 'Editar preset' : 'Crear preset'}
        onClick={(event) => event.stopPropagation()}
      >
        {/* TOP BAR COMPACTA */}
        <div className="modal-header studio-modal-header">
          <div className="studio-title-cluster">
            <span className="eyebrow">
              {isEditing
                ? `STUDIO MULTINODO · V${initialPreset?.version ?? 1} · ${teamName.toUpperCase()}`
                : `STUDIO DE PRESETS MULTINODO · ${teamName.toUpperCase()}`}
            </span>
            <h2>{isEditing ? `Personalizar “${initialPreset?.name}”` : 'Diseña tu propio recurso'}</h2>
          </div>

          <div className="studio-header-actions">
            <label className="recipe-picker-wrap">
              <Sparkles size={13} />
              <select
                aria-label="Plantillas Base / Recetas Pro"
                defaultValue=""
                onChange={(e) => {
                  if (e.target.value) applyProRecipe(e.target.value);
                  e.target.value = '';
                }}
              >
                <option value="" disabled>
                  Recetas Pro...
                </option>
                {PRO_RECIPES.map((recipe) => (
                  <option key={recipe.id} value={recipe.id}>
                    {recipe.name}
                  </option>
                ))}
              </select>
            </label>

            <select
              aria-label="Editor destino"
              className="studio-target-select"
              value={target}
              onChange={(e) => setTarget(e.target.value as EditorTarget)}
            >
              <option value="resolve">DaVinci Resolve</option>
              <option value="premiere">Adobe Premiere Pro</option>
            </select>

            <button
              type="button"
              className="icon-button modal-close"
              onClick={onClose}
              aria-label="Cerrar"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <form className="studio-ergonomic-form" onSubmit={handleFormSubmit}>
          {/* FRANJA HORIZONTAL COMPACTA DE IDENTIDAD Y ACENTO ÓPTICO */}
          <div className="studio-identity-strip" aria-label="Identidad y estética del preset">
            <div className="identity-strip-main">
              <label className="identity-field identity-field-name">
                <span>Nombre del preset</span>
                <input
                  type="text"
                  value={name}
                  placeholder="Ej: Terminal Typewriter Pro + Halation"
                  onChange={(e) => setName(e.target.value)}
                />
              </label>

              <label className="identity-field identity-field-cat">
                <span>Categoría</span>
                <select
                  aria-label="Categoría del preset"
                  value={category}
                  onChange={(e) => handleCategoryChange(e.target.value as PresetCategory)}
                >
                  {(Object.keys(categoryLabels) as PresetCategory[]).map((cat) => (
                    <option key={cat} value={cat}>
                      {categoryLabels[cat]}
                    </option>
                  ))}
                </select>
              </label>

              <label className="identity-field identity-field-tags">
                <span>Etiquetas (Ctrl+K)</span>
                <input
                  type="text"
                  value={tagsRaw}
                  placeholder="typewriter, zoom, 35mm, reels"
                  onChange={(e) => setTagsRaw(e.target.value)}
                />
              </label>

              <div className="identity-accent-cluster">
                <span className="identity-mini-label">Acento óptico</span>
                <div className="identity-accent-controls">
                  <input
                    type="color"
                    value={accent}
                    aria-label="Color personalizado"
                    onChange={(e) => setAccent(e.target.value)}
                  />
                  <div className="color-swatches">
                    {ACCENT_SWATCHES.map((swatch) => (
                      <button
                        key={swatch}
                        type="button"
                        className={`swatch-dot${accent.toLowerCase() === swatch ? ' is-active' : ''}`}
                        style={{ backgroundColor: swatch }}
                        onClick={() => setAccent(swatch)}
                        aria-label={`Color ${swatch}`}
                      />
                    ))}
                  </div>
                  <button
                    type="button"
                    className={`dual-accent-toggle${secondaryAccent ? ' is-active' : ''}`}
                    aria-label="Activar acento dual"
                    title="Habilitar segundo color de acento / gradiente"
                    onClick={() =>
                      setSecondaryAccent((prev) =>
                        prev ? undefined : accent.toLowerCase() === '#22d3ee' ? '#7c5cff' : '#22d3ee'
                      )
                    }
                  >
                    <Palette size={11} />
                    <span>{secondaryAccent ? 'Dual' : '+ Dual'}</span>
                  </button>
                  {secondaryAccent && (
                    <input
                      type="color"
                      value={secondaryAccent}
                      aria-label="Color de acento secundario"
                      title="Color de acento secundario (Gradiente)"
                      onChange={(e) => setSecondaryAccent(e.target.value)}
                    />
                  )}
                </div>
              </div>

              <button
                type="button"
                className={`identity-desc-toggle${descOpen ? ' is-open' : ''}`}
                onClick={() => setDescOpen((prev) => !prev)}
                aria-expanded={descOpen}
                title="Editar descripción técnica para el buscador"
              >
                <FileText size={13} />
                <span>Descripción</span>
                {descOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              </button>
            </div>

            {descOpen && (
              <div className="identity-desc-drawer">
                <label className="identity-field">
                  <span>Descripción técnica (indexada en Ctrl+K)</span>
                  <input
                    type="text"
                    aria-label="Descripción"
                    value={description}
                    placeholder="Resumen técnico del flujo de nodos y uso editorial..."
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </label>
              </div>
            )}
          </div>

          {/* CUADRÍCULA EQUILIBRADA DE 2 COLUMNAS SIN ESPACIO MUERTO */}
          <div className="studio-workspace-grid">
            {/* COLUMNA IZQUIERDA: STACK DE CAPAS + INSPECTOR CONTEXTUAL UNIFICADO */}
            <div className="studio-col-left">
              <EffectStackPanel
                layers={layers}
                selectedLayerId={selectedLayerId}
                onSelectLayerId={setSelectedLayerId}
                showTextControls={showTextControls}
                text={text}
                fontFamily={fontFamily}
                fontOptions={FONT_OPTIONS}
                uppercase={uppercase}
                shadow={shadow}
                backgroundBox={backgroundBox}
                plateRadius={plateRadius}
                plateOpacity={plateOpacity}
                scalePct={scalePct}
                rotationDeg={rotationDeg}
                positionX={positionX}
                positionY={positionY}
                defaultPosX={Math.round(initialPos.x * 100)}
                defaultPosY={Math.round(initialPos.y * 100)}
                trackingPct={trackingPct}
                anchorPoint={anchorPoint}
                audioSfx={audioSfx}
                customAudioBytes={audioFile?.bytes ?? null}
                lutName={lutName}
                lutMix={lutMix}
                onChangeLayers={setLayers}
                onChangeText={setText}
                onChangeFontFamily={setFontFamily}
                onChangeUppercase={setUppercase}
                onChangeShadow={setShadow}
                onChangeBackgroundBox={setBackgroundBox}
                onChangePlateRadius={setPlateRadius}
                onChangePlateOpacity={setPlateOpacity}
                onChangeScalePct={applyScaleChange}
                onChangeRotationDeg={applyRotationChange}
                onChangePositionX={(val) => applyPositionChange(val, positionY)}
                onChangePositionY={(val) => applyPositionChange(positionX, val)}
                onChangeTrackingPct={setTrackingPct}
                onChangeAnchorPoint={(anchor) => {
                  setAnchorPoint(anchor);
                  setPivotX(undefined);
                  setPivotY(undefined);
                }}
                onQuickAlign={handleQuickAlign}
                onChangeAudioSfx={(nextSfx, file) => {
                  setAudioSfx(nextSfx);
                  if (file) setAudioFile(file);
                }}
                onChangeLut={(nextName, nextData, nextMix) => {
                  setLutName(nextName);
                  if (nextData !== undefined) setLutData(nextData || undefined);
                  setLutMix(nextMix);
                }}
              />
            </div>

            {/* COLUMNA DERECHA: ESTACIÓN DE MONITOREO, TIMELINE MULTPISTA Y CURVA + GRAFO */}
            <aside className="studio-col-right">
              <div className="studio-monitor-card">
                <div className="preview-label">
                  <span>ESTACIÓN DE MONITOREO · 60 FPS</span>
                  <span>{editorLabels[target].toUpperCase()}</span>
                </div>

                <PresetPreviewPlayer
                  preset={livePreviewPreset}
                  large
                  interactive
                  forceBefore={forceBefore}
                  currentTime={playheadTime}
                  onTimeChange={setPlayheadTime}
                  selectedLayerId={selectedLayerId}
                  autoKeyframe={autoKeyframe}
                  customAudioBytes={audioFile?.bytes ?? null}
                  externalTimeCommand={timeCommand}
                  onPositionChange={(x, y) => {
                    applyPositionChange(Math.round(x * 100), Math.round(y * 100));
                  }}
                  onScaleChange={(mult) => applyScaleChange(Math.round(mult * 100))}
                  onRotationChange={(deg) => applyRotationChange(deg)}
                  onPivotChange={(px, py) => {
                    setPivotX(px);
                    setPivotY(py);
                  }}
                  onMotionPathHandleChange={handleMotionPathHandleChange}
                  onAspectRatioChange={setAspectRatio}
                />

                {/* TIMELINE CONMUTABLE: MODO RÁPIDO (3 FASES) / DOPE SHEET DE KEYFRAMES */}
                <KeyframeTrackEditor
                  mode={timelineMode}
                  onModeChange={setTimelineMode}
                  durationSeconds={durationSeconds}
                  onDurationChange={setDurationSeconds}
                  timelinePhases={timelinePhases}
                  onTimelinePhasesChange={setTimelinePhases}
                  playheadTime={playheadTime}
                  onPlayheadChange={setPlayheadTime}
                  tracks={keyframeTracks}
                  activeLayerId={activeTrackLayerId}
                  activeLayerName={activeLayer?.name}
                  autoKeyframe={autoKeyframe}
                  onToggleAutoKeyframe={() => setAutoKeyframe((prev) => !prev)}
                  selectedRow={selectedDopeRow}
                  onSelectRow={setSelectedDopeRow}
                  selectedSegment={selectedSegment}
                  onSelectSegment={setSelectedSegment}
                  onUpsertKeyframeAt={upsertRowKeyframeAt}
                  onMoveKeyframe={moveKeyframe}
                  onDeleteKeyframe={deleteKeyframe}
                  fallbackValues={{
                    positionX: normalizedPosX,
                    positionY: normalizedPosY,
                    scale: normalizedScale,
                    rotation: rotationDeg,
                    opacity: 100,
                    opticalIntensity: activeLayer?.intensity ?? 65,
                  }}
                />
              </div>

              {/* CUADRÍCULA PARALELA INFERIOR DERECHA: CURVA BÉZIER (IZQ) + ÁRBOL DE NODOS Y ATAJOS (DER) */}
              <div className="studio-right-bottom-grid">
                <BezierCurveEditor
                  curve={curve}
                  bezier={selectedSegmentKeyframe?.bezier ?? bezier}
                  segmentLabel={
                    selectedSegmentKeyframe
                      ? `Segmento ${selectedSegment?.property} @ ${selectedSegmentKeyframe.time.toFixed(2)}s`
                      : undefined
                  }
                  interpolation={selectedSegmentKeyframe?.interpolation ?? 'bezier'}
                  springParams={selectedSegmentKeyframe?.spring ?? DEFAULT_SPRING_PARAMS}
                  onCurveChange={(nextCurve, nextBezier) =>
                    updateSelectedSegmentCurve(nextCurve, nextBezier)
                  }
                  onInterpolationChange={
                    selectedSegmentKeyframe
                      ? (nextInterp, nextSpring) =>
                          updateSelectedSegmentCurve(
                            curve,
                            selectedSegmentKeyframe.bezier ?? bezier,
                            nextInterp,
                            nextSpring
                          )
                      : undefined
                  }
                />

                <div className="compiled-graph-card">
                  <div className="compiled-graph-head">
                    <span>
                      <GitCommitHorizontal size={13} />
                      Árbol compilado ({enabledLayers.length}{' '}
                      {enabledLayers.length === 1 ? 'nodo' : 'nodos'})
                    </span>
                    <small>
                      {aspectRatio} · {durationSeconds.toFixed(1)}s
                    </small>
                  </div>

                  <div className="node-chain-pills" aria-label="Cadena de nodos compilada">
                    <span className="node-pill node-pill-io">In</span>
                    {enabledLayers.map((layer) => (
                      <span key={layer.id} className={`node-pill node-pill-${layer.type}`}>
                        {layer.name}
                      </span>
                    ))}
                    {timelinePhases.autoScaleDuration && (
                      <span className="node-pill node-pill-stretcher">KeyframeStretcher</span>
                    )}
                    <span className="node-pill node-pill-io">Out</span>
                  </div>

                  <div className="compiled-specs-mini">
                    <span>Pivot: {anchorShortLabel}</span>
                    {secondaryAccent && <span>Gradiente Dual activo</span>}
                    {audioSfx.sfxId !== 'none' && <span>SFX: {audioSfx.sfxId}</span>}
                    {lutName && <span>LUT: {lutName}</span>}
                  </div>

                  <div className="studio-shortcuts-bar">
                    <span>
                      <kbd>Espacio</kbd> Play/Pausa
                    </span>
                    <span>
                      <kbd>←</kbd> <kbd>→</kbd> ±1 Frame
                    </span>
                    <span>
                      <kbd>K</kbd> Keyframe
                    </span>
                    <span>
                      <kbd>\</kbd> Antes/Después
                    </span>
                    <span>
                      <kbd>Ctrl+S</kbd> Guardar
                    </span>
                  </div>
                </div>
              </div>
            </aside>
          </div>

          {/* STICKY FOOTER UNIFICADO */}
          <footer className="studio-sticky-footer">
            <div className="studio-footer-left">
              {canRestoreFactory && onDelete && initialPreset && (
                <button
                  type="button"
                  className="button-secondary"
                  onClick={() => void onDelete(initialPreset)}
                >
                  <RotateCcw size={14} />
                  <span>Restaurar base</span>
                </button>
              )}
              {canDeleteCustom && onDelete && initialPreset && (
                <button
                  type="button"
                  className="button-danger"
                  onClick={() => void onDelete(initialPreset)}
                >
                  <Trash2 size={14} />
                  <span>Eliminar</span>
                </button>
              )}
              {isEditing && onDuplicate && (
                <button
                  type="button"
                  className="button-secondary"
                  disabled={saving}
                  onClick={() => void handleDuplicateClick()}
                >
                  <Copy size={14} />
                  <span>Duplicar</span>
                </button>
              )}

              {error ? (
                <p className="form-error-banner" role="alert">
                  {error}
                </p>
              ) : (
                <span className="studio-footer-summary">
                  {categoryLabels[category]} · {enabledLayers.length}{' '}
                  {enabledLayers.length === 1 ? 'capa activa' : 'capas activas'} · {aspectRatio} ·{' '}
                  {editorLabels[target]}
                </span>
              )}
            </div>

            <div className="form-actions-right">
              <button type="button" className="button-secondary" onClick={onClose}>
                Cancelar
              </button>
              <button type="submit" className="button-primary" disabled={saving}>
                {saving
                  ? 'Compilando...'
                  : isEditing
                    ? 'Guardar cambios'
                    : 'Guardar en la biblioteca'}
              </button>
            </div>
          </footer>
        </form>
      </section>
    </div>
  );
}
