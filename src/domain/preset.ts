export const categories = [
  'transition',
  'effect',
  'title',
  'subtitle',
  'graphic',
  'sticker',
] as const;

export type PresetCategory = (typeof categories)[number];
export type EditorTarget = 'resolve' | 'premiere';
export type MemberRole = 'owner' | 'editor' | 'viewer';
export type ApplyMode = 'transition' | 'clip-effect' | 'overlay';
export type AnimationCurve = 'ease-out' | 'ease-in-out' | 'elastic' | 'expo' | 'linear';
export type FontChoice = 'Segoe UI' | 'Georgia' | 'Impact' | 'Consolas' | 'Trebuchet MS';
export type TransitionStyle =
  | 'dissolve'
  | 'flash'
  | 'zoom'
  | 'whip'
  | 'spin'
  | 'glitch'
  | 'luma-fade'
  | 'directional-swish';
export type EffectStyle = 'glow' | 'halation' | 'vignette';

export type PresetLayerType = 'motion' | 'transition' | 'vfx' | 'typography';

export type MotionEffectKind =
  | 'punch-in'
  | 'camera-shake'
  | 'float-drift'
  | 'speed-ramp'
  | 'motion-blur';

export type TransitionEffectKind = TransitionStyle;

export type TransitionDirection = 'up' | 'down' | 'left' | 'right' | 'in' | 'out';

export type VfxEffectKind =
  | 'glow'
  | 'halation'
  | 'vignette'
  | 'film-grain'
  | 'chromatic-aberration'
  | 'vhs-crt'
  | 'lens-distortion'
  | 'blur'
  | 'pip-frame'
  | 'lut';

export type TypographyAnimationKind =
  | 'fade-slide'
  | 'pop-bounce'
  | 'karaoke'
  | 'typewriter'
  | 'glitch-flicker';

export type TypographyAlignment = 'lower-third' | 'center' | 'reels-safe';

export type AnchorPoint9 =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'middle-left'
  | 'center'
  | 'middle-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right';

export type TypewriterUnit = 'char' | 'word' | 'cipher';
export type TypewriterCursorStyle = 'bar' | 'underscore' | 'block' | 'none';
export type TypewriterCursorColorMode = 'accent' | 'white';
export type TypewriterOutBehavior = 'fade' | 'backspace' | 'cut' | 'glitch';

export type AspectRatioPreset = '16:9' | '9:16' | '4:5' | '1:1';

export type BezierHandles = [number, number, number, number];

export type TimelineMode = 'phases' | 'keyframes';
export type KeyframeInterpolation = 'bezier' | 'linear' | 'hold' | 'spring';
export type KeyframeTrackId =
  | 'positionX'
  | 'positionY'
  | 'scale'
  | 'rotation'
  | 'opacity'
  | 'opticalIntensity';

export interface SpringParams {
  stiffness: number;
  damping: number;
  mass: number;
}

export interface SpatialTangent {
  dx: number;
  dy: number;
}

export interface KeyframePoint {
  id: string;
  time: number;
  value: number;
  interpolation: KeyframeInterpolation;
  bezier?: BezierHandles;
  spring?: SpringParams;
  spatialIn?: SpatialTangent;
  spatialOut?: SpatialTangent;
}

export interface KeyframeTrack {
  id: string;
  layerId?: string;
  property: KeyframeTrackId;
  keyframes: KeyframePoint[];
}

export type LayerBlendMode = 'normal' | 'screen' | 'add' | 'overlay' | 'multiply';

export type MaskRevealDirection = 'bottom' | 'left' | 'right' | 'top' | 'center' | 'diagonal';

export interface TrimPathsConfig {
  enabled: boolean;
  startPct: number;
  endPct: number;
  offsetDeg: number;
}

export interface MaskRevealConfig {
  enabled: boolean;
  direction: MaskRevealDirection;
  featherPx: number;
}

export interface SpringModulatorConfig extends SpringParams {
  enabled: boolean;
}

export interface WiggleModulatorConfig {
  enabled: boolean;
  target: 'position' | 'rotation' | 'scale' | 'glow';
  frequencyHz: number;
  amplitude: number;
  seed: number;
}

export type LfoWaveform = 'sine' | 'pulse' | 'sawtooth';
export type LfoBeatDivision = '1/1' | '1/2' | '1/4' | '1/8';

export interface LfoModulatorConfig {
  enabled: boolean;
  waveform: LfoWaveform;
  target: 'glow' | 'scale' | 'rotation' | 'opacity' | 'borderWidth';
  syncMode: 'hz' | 'bpm';
  frequencyHz: number;
  bpm: number;
  beatDivision: LfoBeatDivision;
  amplitude: number;
}

export interface TextStaggerConfig {
  enabled: boolean;
  unit: 'char' | 'word' | 'line';
  delayMs: number;
  offsetY: number;
  rotate3dDeg: number;
  blurInPx: number;
}

export interface LayerModulators {
  spring?: SpringModulatorConfig;
  wiggle?: WiggleModulatorConfig;
  lfo?: LfoModulatorConfig;
  stagger?: TextStaggerConfig;
}

export interface TimelinePhases {
  inRatio: number;
  outRatio: number;
  autoScaleDuration: boolean;
}

export type AudioSfxId =
  | 'none'
  | 'whoosh'
  | 'impact'
  | 'pop'
  | 'riser'
  | 'tape-stop'
  | 'shutter'
  | 'custom';

export interface AudioSfxConfig {
  sfxId: AudioSfxId;
  customName?: string;
  offsetMs: number;
  gainDb: number;
  muted?: boolean;
}

export type PresetLayerKind =
  | MotionEffectKind
  | TransitionEffectKind
  | VfxEffectKind
  | TypographyAnimationKind;

export interface PresetLayer {
  id: string;
  name: string;
  type: PresetLayerType;
  kind: PresetLayerKind;
  enabled: boolean;
  intensity: number;
  curve: AnimationCurve;
  bezier?: BezierHandles;
  blendMode?: LayerBlendMode;
  trimPaths?: TrimPathsConfig;
  maskReveal?: MaskRevealConfig;
  modulators?: LayerModulators;
  params: Record<string, number | string | boolean>;
}

export interface ProRecipePreset {
  id: string;
  name: string;
  description: string;
  category: PresetCategory;
  durationSeconds: number;
  aspectRatio: AspectRatioPreset;
  bezier: BezierHandles;
  timelinePhases: TimelinePhases;
  audioSfx: AudioSfxConfig;
  text?: string;
  accent: string;
  secondaryAccent?: string;
  anchorPoint?: AnchorPoint9;
  tags: string[];
  layers: PresetLayer[];
}

export interface PresetManifest {
  formatVersion: 1;
  id: string;
  version: number;
  name: string;
  description: string;
  category: PresetCategory;
  target: EditorTarget;
  templateName: string;
  applyMode: ApplyMode;
  durationSeconds: number;
  text?: string;
  accent: string;
  secondaryAccent?: string;
  animation: string;
  curve?: AnimationCurve;
  positionX?: number;
  positionY?: number;
  anchorPoint?: AnchorPoint9;
  pivotX?: number;
  pivotY?: number;
  rotationDeg?: number;
  scale?: number;
  intensity?: number;
  spread?: number;
  fontFamily?: FontChoice;
  tracking?: number;
  uppercase?: boolean;
  shadow?: boolean;
  backgroundBox?: boolean;
  plateRadius?: number;
  plateOpacity?: number;
  transitionStyle?: TransitionStyle;
  effectStyle?: EffectStyle;
  layers?: PresetLayer[];
  bezier?: BezierHandles;
  timelinePhases?: TimelinePhases;
  timelineMode?: TimelineMode;
  keyframeTracks?: KeyframeTrack[];
  audioSfx?: AudioSfxConfig;
  aspectRatio?: AspectRatioPreset;
  lutName?: string;
  lutMix?: number;
  lutData?: string;
  tags: string[];
  files: Array<{ path: string; role: 'template' | 'asset' | 'preview' }>;
}

export interface PresetRecord extends Omit<PresetManifest, 'formatVersion' | 'files'> {
  teamId: string;
  author: string;
  updatedAt: string;
  favorite: boolean;
  source: 'starter' | 'created' | 'imported';
  nativeFiles: NativeFile[];
  assetPath?: string;
}

export interface PresetVersionRecord {
  presetId: string;
  version: number;
  createdAt: string;
  manifest: PresetManifest;
  assetPath?: string;
}

export interface NativeFile {
  path: string;
  bytes: Uint8Array;
  role: 'template' | 'asset' | 'preview';
}

export interface TeamSummary {
  id: string;
  name: string;
  role: MemberRole;
}

export interface TeamMemberSummary {
  userId: string;
  displayName: string;
  role: MemberRole;
  joinedAt: string;
  isSelf?: boolean;
}

export interface CreatePresetInput {
  id?: string;
  name: string;
  description: string;
  category: PresetCategory;
  target?: EditorTarget;
  text: string;
  accent: string;
  secondaryAccent?: string;
  animation: string;
  curve?: AnimationCurve;
  positionX?: number;
  positionY?: number;
  anchorPoint?: AnchorPoint9;
  pivotX?: number;
  pivotY?: number;
  rotationDeg?: number;
  scale?: number;
  intensity?: number;
  spread?: number;
  fontFamily?: FontChoice;
  tracking?: number;
  uppercase?: boolean;
  shadow?: boolean;
  backgroundBox?: boolean;
  plateRadius?: number;
  plateOpacity?: number;
  transitionStyle?: TransitionStyle;
  effectStyle?: EffectStyle;
  layers?: PresetLayer[];
  bezier?: BezierHandles;
  timelinePhases?: TimelinePhases;
  timelineMode?: TimelineMode;
  keyframeTracks?: KeyframeTrack[];
  audioSfx?: AudioSfxConfig;
  audioFile?: NativeFile;
  aspectRatio?: AspectRatioPreset;
  lutName?: string;
  lutMix?: number;
  lutData?: string;
  durationSeconds: number;
  tags: string[];
}

export const categoryLabels: Record<PresetCategory, string> = {
  transition: 'Transiciones',
  effect: 'Efectos',
  title: 'Títulos',
  subtitle: 'Subtítulos',
  graphic: 'Gráficos',
  sticker: 'Stickers',
};

export const editorLabels: Record<EditorTarget, string> = {
  resolve: 'DaVinci Resolve',
  premiere: 'Adobe Premiere Pro',
};

export const curveLabels: Record<AnimationCurve, string> = {
  'ease-out': 'Suave al frenar (Ease Out)',
  'ease-in-out': 'Cinemática (S-Curve)',
  elastic: 'Elástica (Spring)',
  expo: 'Rápida (Exponencial)',
  linear: 'Lineal uniforme',
};

export const fontLabels: Record<FontChoice, string> = {
  'Segoe UI': 'Sans Moderna (Segoe UI)',
  Georgia: 'Serif Editorial (Georgia)',
  Impact: 'Display Titular (Impact)',
  Consolas: 'Mono Técnica (Consolas)',
  'Trebuchet MS': 'Humanista Dinámica (Trebuchet)',
};

export const transitionStyleLabels: Record<TransitionStyle, string> = {
  dissolve: 'Fundido prismático',
  flash: 'Flash de exposición',
  zoom: 'Zoom óptico',
  whip: 'Barrido rápido (Whip Pan)',
  spin: 'Spin / Roll (90°/180°)',
  glitch: 'Glitch / RGB Split',
  'luma-fade': 'Luma Fade',
  'directional-swish': 'Directional Blur Swish',
};

export const effectStyleLabels: Record<EffectStyle, string> = {
  glow: 'Resplandor atmosférico (Glow)',
  halation: 'Halation analógico 35mm',
  vignette: 'Viñeta anamórfica de cine',
};

export const categoryPaths: Record<PresetCategory, string> = {
  transition: 'Edit/Transitions',
  effect: 'Edit/Effects',
  title: 'Edit/Titles',
  subtitle: 'Edit/Titles',
  graphic: 'Edit/Generators',
  sticker: 'Edit/Generators',
};

export function applyModeFor(category: PresetCategory): ApplyMode {
  if (category === 'transition') return 'transition';
  if (category === 'effect') return 'clip-effect';
  return 'overlay';
}

export function defaultPositionFor(category: PresetCategory): { x: number; y: number } {
  if (category === 'subtitle') return { x: 0.5, y: 0.12 };
  if (category === 'graphic') return { x: 0.24, y: 0.18 };
  return { x: 0.5, y: 0.5 };
}

export function defaultCurveFor(category: PresetCategory, animation = ''): AnimationCurve {
  const lower = animation.toLocaleLowerCase('es');
  if (lower.includes('rebote') || lower.includes('bounce')) return 'elastic';
  if (category === 'transition') return 'ease-in-out';
  if (lower === 'constante' || lower === 'none') return 'linear';
  return 'ease-out';
}

export function isPresetCategory(value: string): value is PresetCategory {
  return categories.some((category) => category === value);
}

export const ANCHOR_POINTS_9: Array<{ id: AnchorPoint9; label: string }> = [
  { id: 'top-left', label: 'Superior izquierda' },
  { id: 'top-center', label: 'Superior centro' },
  { id: 'top-right', label: 'Superior derecha' },
  { id: 'middle-left', label: 'Centro izquierda' },
  { id: 'center', label: 'Centro exacto' },
  { id: 'middle-right', label: 'Centro derecha' },
  { id: 'bottom-left', label: 'Inferior izquierda' },
  { id: 'bottom-center', label: 'Inferior centro' },
  { id: 'bottom-right', label: 'Inferior derecha' },
];

export function anchorPointToPivot(anchor: AnchorPoint9 = 'center'): {
  fusionX: number;
  fusionY: number;
  cssX: number;
  cssY: number;
  cssOrigin: string;
} {
  const col = anchor.endsWith('left') ? 0 : anchor.endsWith('right') ? 1 : 0.5;
  const rowTopDown = anchor.startsWith('top') ? 0 : anchor.startsWith('bottom') ? 1 : 0.5;
  const fusionY = 1 - rowTopDown;
  return {
    fusionX: col,
    fusionY,
    cssX: col * 100,
    cssY: rowTopDown * 100,
    cssOrigin: `${col * 100}% ${rowTopDown * 100}%`,
  };
}

/** Resolves free pivotX/pivotY (Fusion bottom-up 0..1) with 9-point anchor fallback. */
export function resolveNormalizedPivot(
  preset: Pick<PresetManifest, 'anchorPoint' | 'pivotX' | 'pivotY'>
): {
  fusionX: number;
  fusionY: number;
  cssX: number;
  cssY: number;
  cssOrigin: string;
} {
  const base = anchorPointToPivot(preset.anchorPoint ?? 'center');
  const fx = typeof preset.pivotX === 'number' && Number.isFinite(preset.pivotX)
    ? Math.min(1, Math.max(0, preset.pivotX))
    : base.fusionX;
  const fy = typeof preset.pivotY === 'number' && Number.isFinite(preset.pivotY)
    ? Math.min(1, Math.max(0, preset.pivotY))
    : base.fusionY;
  const cssX = Number((fx * 100).toFixed(1));
  const cssY = Number(((1 - fy) * 100).toFixed(1));
  return {
    fusionX: fx,
    fusionY: fy,
    cssX,
    cssY,
    cssOrigin: `${cssX}% ${cssY}%`,
  };
}

export const DEFAULT_SPRING_PARAMS: SpringParams = {
  stiffness: 180,
  damping: 16,
  mass: 1.0,
};

export const BLEND_MODE_LABELS: Record<LayerBlendMode, string> = {
  normal: 'Normal',
  screen: 'Screen / Pantalla',
  add: 'Add / Añadir',
  overlay: 'Overlay / Superponer',
  multiply: 'Multiply / Multiplicar',
};

export const DEFAULT_TIMELINE_PHASES: TimelinePhases = {
  inRatio: 0.25,
  outRatio: 0.25,
  autoScaleDuration: true,
};

export const BEZIER_PRESETS: Record<AnimationCurve, BezierHandles> = {
  'ease-out': [0.16, 1, 0.3, 1],
  'ease-in-out': [0.42, 0, 0.58, 1],
  elastic: [0.34, 1.56, 0.64, 1],
  expo: [0.85, 0, 0.15, 1],
  linear: [0, 0, 1, 1],
};

export function createLayerId(prefix = 'layer'): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createPresetLayer(
  type: PresetLayerType,
  kind: PresetLayerKind,
  overrides: Partial<PresetLayer> = {}
): PresetLayer {
  const defaults: Record<string, { name: string; params: Record<string, number | string | boolean> }> = {
    'punch-in': {
      name: 'Punch-In / Crash Zoom',
      params: { startScale: 100, endScale: 128, anchorX: 50, anchorY: 50, impactMode: 'punch' },
    },
    'camera-shake': {
      name: 'Camera Shake',
      params: { frequencyHz: 8, amplitudeX: 14, amplitudeY: 10, rotationDeg: 2.2, seed: 42, decayMode: 'impact' },
    },
    'float-drift': {
      name: 'Float / Drift',
      params: { amplitudeX: 8, amplitudeY: 10, rotationDeg: 1.5, speed: 1.2 },
    },
    'speed-ramp': {
      name: 'Velocity / Speed Ramp',
      params: { minSpeed: 40, maxSpeed: 260, peakPosition: 50 },
    },
    'motion-blur': {
      name: 'Motion Blur Óptico',
      params: { shutterAngle: 180 },
    },
    dissolve: {
      name: 'Fundido prismático',
      params: { direction: 'in', shutterAngle: 180 },
    },
    flash: {
      name: 'Flash de exposición',
      params: { direction: 'in', shutterAngle: 180 },
    },
    zoom: {
      name: 'Zoom óptico',
      params: { direction: 'in', shutterAngle: 220 },
    },
    whip: {
      name: 'Whip Pan',
      params: { direction: 'right', shutterAngle: 270 },
    },
    spin: {
      name: 'Spin / Roll',
      params: { direction: 'right', angleDeg: 90, shutterAngle: 240 },
    },
    glitch: {
      name: 'Glitch / RGB Split',
      params: { direction: 'left', shutterAngle: 180, sliceAmount: 55 },
    },
    'luma-fade': {
      name: 'Luma Fade',
      params: { direction: 'in', shutterAngle: 150, threshold: 50 },
    },
    'directional-swish': {
      name: 'Directional Blur Swish',
      params: { direction: 'right', shutterAngle: 300 },
    },
    glow: {
      name: 'Glow suave',
      params: { spread: 40 },
    },
    halation: {
      name: 'Halation 35mm',
      params: { spread: 50 },
    },
    vignette: {
      name: 'Viñeta anamórfica',
      params: { spread: 55 },
    },
    'film-grain': {
      name: 'Film Grain',
      params: { stock: '35mm', grainSize: 38 },
    },
    'chromatic-aberration': {
      name: 'Chromatic Aberration',
      params: { mode: 'radial', shiftPx: 8 },
    },
    'vhs-crt': {
      name: 'VHS / CRT Scanlines',
      params: { scanlineDensity: 45, jitter: 25 },
    },
    'lens-distortion': {
      name: 'Lens Distortion',
      params: { curvature: 32 },
    },
    blur: {
      name: 'Gaussian / Directional Blur',
      params: { mode: 'gaussian', angleDeg: 0, radiusPx: 12 },
    },
    'pip-frame': {
      name: 'Marco PiP / Collage',
      params: { borderRadius: 18, borderWidth: 4, dropShadow: 48, pipScale: 84 },
    },
    lut: {
      name: 'LUT (.cube)',
      params: { mix: 75 },
    },
    'fade-slide': {
      name: 'Entrada limpia',
      params: { alignment: 'lower-third', outline: false },
    },
    'pop-bounce': {
      name: 'Pop-In / Bounce',
      params: { alignment: 'center', outline: true },
    },
    karaoke: {
      name: 'Karaoke Word Highlight',
      params: { alignment: 'reels-safe', outline: true, activeWordPill: true },
    },
    typewriter: {
      name: 'Typewriter Pro',
      params: {
        alignment: 'lower-third',
        showCursor: true,
        outline: false,
        typewriterUnit: 'char',
        cursorStyle: 'bar',
        cursorBlinkHz: 2.5,
        cursorColorMode: 'accent',
        hideCursorOnComplete: false,
        humanJitter: 25,
        outBehavior: 'backspace',
        autoTypingSfx: false,
      },
    },
    'glitch-flicker': {
      name: 'Glitch Flicker',
      params: { alignment: 'center', outline: true },
    },
  };

  const preset = defaults[kind] ?? { name: kind, params: {} };
  return {
    id: overrides.id ?? createLayerId(type),
    name: overrides.name ?? preset.name,
    type,
    kind,
    enabled: overrides.enabled ?? true,
    intensity: overrides.intensity ?? 65,
    curve: overrides.curve ?? 'ease-out',
    bezier: overrides.bezier,
    blendMode: overrides.blendMode,
    trimPaths: overrides.trimPaths,
    maskReveal: overrides.maskReveal,
    modulators: overrides.modulators,
    params: { ...preset.params, ...(overrides.params ?? {}) },
  };
}

export function createDefaultLayersForCategory(
  category: PresetCategory,
  presetLike?: Partial<Pick<PresetManifest, 'transitionStyle' | 'effectStyle' | 'intensity' | 'spread' | 'curve'>>
): PresetLayer[] {
  const curve = presetLike?.curve ?? defaultCurveFor(category);
  const intensity = presetLike?.intensity ?? 65;

  if (category === 'transition') {
    const style = presetLike?.transitionStyle ?? 'whip';
    return [
      createPresetLayer('transition', style, { intensity, curve }),
      createPresetLayer('motion', 'motion-blur', { intensity: 70, curve, params: { shutterAngle: 220 } }),
    ];
  }

  if (category === 'title') {
    return [
      createPresetLayer('typography', 'fade-slide', {
        intensity,
        curve,
        params: { alignment: 'lower-third', outline: false },
      }),
    ];
  }

  if (category === 'subtitle') {
    return [
      createPresetLayer('typography', 'karaoke', {
        intensity: 80,
        curve: 'elastic',
        params: { alignment: 'reels-safe', outline: true, activeWordPill: true },
      }),
    ];
  }

  if (category === 'graphic' || category === 'sticker') {
    return [
      createPresetLayer('motion', 'float-drift', {
        intensity: 55,
        curve: 'elastic',
        params: { amplitudeX: 6, amplitudeY: 8, rotationDeg: 2, speed: 1.4 },
      }),
      createPresetLayer('vfx', 'pip-frame', {
        intensity: 60,
        curve,
        params: { borderRadius: 16, borderWidth: 3, dropShadow: 42, pipScale: 92 },
      }),
    ];
  }

  const effectStyle = presetLike?.effectStyle ?? 'halation';
  return [
    createPresetLayer('vfx', effectStyle, {
      intensity,
      curve,
      params: { spread: presetLike?.spread ?? 48 },
    }),
  ];
}

export const PRO_RECIPES: ProRecipePreset[] = [
  {
    id: 'recipe-punch-shake-doc',
    name: 'Punch-In + Shake Documental',
    description: 'Golpe seco de cámara con vibración orgánica, aberración cromática y motion blur.',
    category: 'effect',
    durationSeconds: 1.4,
    aspectRatio: '16:9',
    bezier: [0.16, 1, 0.3, 1],
    timelinePhases: { inRatio: 0.22, outRatio: 0.25, autoScaleDuration: true },
    audioSfx: { sfxId: 'impact', offsetMs: 0, gainDb: -3 },
    accent: '#7c5cff',
    tags: ['punch-in', 'shake', 'documental', 'impacto'],
    layers: [
      createPresetLayer('motion', 'punch-in', {
        id: 'rec-punch',
        intensity: 80,
        curve: 'expo',
        params: { startScale: 100, endScale: 132, anchorX: 50, anchorY: 50, impactMode: 'punch' },
      }),
      createPresetLayer('motion', 'camera-shake', {
        id: 'rec-shake',
        intensity: 72,
        curve: 'ease-out',
        params: { frequencyHz: 11, amplitudeX: 16, amplitudeY: 12, rotationDeg: 2.8, seed: 17, decayMode: 'impact' },
      }),
      createPresetLayer('vfx', 'chromatic-aberration', {
        id: 'rec-rgb',
        intensity: 52,
        curve: 'ease-out',
        params: { mode: 'radial', shiftPx: 9 },
      }),
      createPresetLayer('motion', 'motion-blur', {
        id: 'rec-mblur',
        intensity: 75,
        curve: 'ease-in-out',
        params: { shutterAngle: 210 },
      }),
    ],
  },
  {
    id: 'recipe-35mm-halation-grain',
    name: '35mm Halation + Grain',
    description: 'Look fílmico orgánico con halation cálida de 35mm, grano analógico y viñeta suave.',
    category: 'effect',
    durationSeconds: 3.0,
    aspectRatio: '16:9',
    bezier: [0.42, 0, 0.58, 1],
    timelinePhases: { inRatio: 0.2, outRatio: 0.2, autoScaleDuration: true },
    audioSfx: { sfxId: 'none', offsetMs: 0, gainDb: 0 },
    accent: '#f97316',
    tags: ['35mm', 'halation', 'film-grain', 'cine'],
    layers: [
      createPresetLayer('vfx', 'halation', {
        id: 'rec-hal',
        intensity: 74,
        curve: 'ease-in-out',
        params: { spread: 58 },
      }),
      createPresetLayer('vfx', 'film-grain', {
        id: 'rec-grain',
        intensity: 58,
        curve: 'linear',
        params: { stock: '35mm', grainSize: 42 },
      }),
      createPresetLayer('vfx', 'vignette', {
        id: 'rec-vig',
        intensity: 44,
        curve: 'ease-in-out',
        params: { spread: 64 },
      }),
    ],
  },
  {
    id: 'recipe-karaoke-viral-916',
    name: 'Subtítulos Karaoke Virales 9:16',
    description: 'Subtítulos dinámicos palabra por palabra optimizados para zona segura de Reels y TikTok.',
    category: 'subtitle',
    durationSeconds: 2.4,
    aspectRatio: '9:16',
    bezier: [0.34, 1.56, 0.64, 1],
    timelinePhases: { inRatio: 0.18, outRatio: 0.18, autoScaleDuration: true },
    audioSfx: { sfxId: 'pop', offsetMs: 40, gainDb: -4 },
    text: 'EDICIÓN PRO EN SEGUNDOS',
    accent: '#22d3ee',
    tags: ['karaoke', 'reels', 'tiktok', '9:16', 'subtitulos'],
    layers: [
      createPresetLayer('typography', 'karaoke', {
        id: 'rec-karaoke',
        intensity: 88,
        curve: 'elastic',
        params: { alignment: 'reels-safe', outline: true, activeWordPill: true },
      }),
      createPresetLayer('motion', 'float-drift', {
        id: 'rec-drift',
        intensity: 28,
        curve: 'ease-in-out',
        params: { amplitudeX: 2, amplitudeY: 4, rotationDeg: 0.6, speed: 1.5 },
      }),
    ],
  },
  {
    id: 'recipe-whip-rgb-whoosh',
    name: 'Whip Pan + RGB Split + Whoosh',
    description: 'Transición rápida de barrido direccional con desfase RGB, obturación 270° y whoosh sincronizado.',
    category: 'transition',
    durationSeconds: 0.8,
    aspectRatio: '16:9',
    bezier: [0.85, 0, 0.15, 1],
    timelinePhases: { inRatio: 0.35, outRatio: 0.35, autoScaleDuration: true },
    audioSfx: { sfxId: 'whoosh', offsetMs: -80, gainDb: -2 },
    accent: '#38bdf8',
    tags: ['whip-pan', 'rgb-split', 'whoosh', 'transicion'],
    layers: [
      createPresetLayer('transition', 'whip', {
        id: 'rec-whip',
        intensity: 85,
        curve: 'expo',
        params: { direction: 'right', shutterAngle: 270 },
      }),
      createPresetLayer('vfx', 'chromatic-aberration', {
        id: 'rec-whip-rgb',
        intensity: 64,
        curve: 'expo',
        params: { mode: 'directional', shiftPx: 14 },
      }),
      createPresetLayer('motion', 'motion-blur', {
        id: 'rec-whip-mb',
        intensity: 82,
        curve: 'expo',
        params: { shutterAngle: 270 },
      }),
    ],
  },
  {
    id: 'recipe-typewriter-terminal',
    name: 'Terminal Typewriter Pro + Cipher',
    description: 'Escritura mecánica con decodificación estilo Matrix, cursor de bloque y borrado inverso en salida.',
    category: 'title',
    durationSeconds: 3.2,
    aspectRatio: '16:9',
    bezier: [0.16, 1, 0.3, 1],
    timelinePhases: { inRatio: 0.34, outRatio: 0.24, autoScaleDuration: true },
    audioSfx: { sfxId: 'none', offsetMs: 0, gainDb: -4 },
    text: 'ACCESO AUTORIZADO // NODO 09',
    accent: '#22d3ee',
    secondaryAccent: '#7c5cff',
    anchorPoint: 'middle-left',
    tags: ['typewriter', 'terminal', 'cipher', 'codigo', 'documental'],
    layers: [
      createPresetLayer('typography', 'typewriter', {
        id: 'rec-typewriter',
        intensity: 95,
        curve: 'ease-out',
        params: {
          alignment: 'center',
          showCursor: true,
          outline: false,
          typewriterUnit: 'cipher',
          cursorStyle: 'block',
          cursorBlinkHz: 3,
          cursorColorMode: 'accent',
          hideCursorOnComplete: false,
          humanJitter: 35,
          outBehavior: 'backspace',
          autoTypingSfx: true,
        },
      }),
      createPresetLayer('vfx', 'glow', {
        id: 'rec-term-glow',
        intensity: 42,
        curve: 'ease-out',
        params: { spread: 34 },
      }),
    ],
  },
];
