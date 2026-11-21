import type {
  AnimationCurve,
  BezierHandles,
  KeyframePoint,
  KeyframeTrack,
  KeyframeTrackId,
  LayerBlendMode,
  LfoBeatDivision,
  LfoModulatorConfig,
  MaskRevealConfig,
  SpringParams,
  TextStaggerConfig,
  TrimPathsConfig,
} from '../domain/preset';
import { DEFAULT_SPRING_PARAMS } from '../domain/preset';

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function evaluateCubicBezier(rawT: number, handles: BezierHandles): number {
  const x = clamp(rawT, 0, 1);
  if (x === 0 || x === 1) return x;
  const [x1, y1, x2, y2] = handles;
  let u = x;
  for (let i = 0; i < 6; i += 1) {
    const inv = 1 - u;
    const bx = 3 * inv * inv * u * x1 + 3 * inv * u * u * x2 + u * u * u;
    const dx = 3 * inv * inv * x1 + 6 * inv * u * (x2 - x1) + 3 * u * u * (1 - x2);
    if (Math.abs(dx) < 1e-4) break;
    u = clamp(u - (bx - x) / dx, 0, 1);
  }
  const inv = 1 - u;
  return 3 * inv * inv * u * y1 + 3 * inv * u * u * y2 + u * u * u;
}

export function evaluateCurve(
  curve: AnimationCurve,
  rawT: number,
  bezier?: BezierHandles
): number {
  const t = clamp(rawT, 0, 1);
  if (bezier && bezier.length === 4) {
    return evaluateCubicBezier(t, bezier);
  }
  switch (curve) {
    case 'linear':
      return t;
    case 'ease-in-out':
      return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    case 'expo':
      if (t === 0 || t === 1) return t;
      return 1 - Math.pow(2, -10 * t);
    case 'elastic':
      if (t === 0 || t === 1) return t;
      return Math.pow(2, -8.5 * t) * Math.sin((t * 8 - 0.75) * ((2 * Math.PI) / 3)) + 1;
    case 'ease-out':
    default:
      return 1 - Math.pow(1 - t, 3);
  }
}

/**
 * Integrates Hooke's Law damped spring ODE: m * x'' = -k * (x - 1) - c * x'
 * from x(0) = 0, v(0) = 0 across an effective physical duration scaled by damping/stiffness.
 */
export function evaluateSpringResponse(
  rawT: number,
  params: Partial<SpringParams> = {}
): number {
  const tNorm = clamp(rawT, 0, 1);
  if (tNorm <= 0) return 0;
  if (tNorm >= 1) return 1;

  const k = clamp(Number(params.stiffness ?? DEFAULT_SPRING_PARAMS.stiffness), 50, 500);
  const c = clamp(Number(params.damping ?? DEFAULT_SPRING_PARAMS.damping), 5, 50);
  const m = clamp(Number(params.mass ?? DEFAULT_SPRING_PARAMS.mass), 0.5, 5.0);

  // Estimate physical settling horizon (~4.5 time constants + minimum window)
  const zeta = c / (2 * Math.sqrt(k * m));
  const omega0 = Math.sqrt(k / m);
  const settleSec = clamp(4.6 / Math.max(0.4, zeta * omega0), 0.45, 2.8);
  const targetTime = tNorm * settleSec;

  const dt = 1 / 240;
  const steps = Math.max(1, Math.ceil(targetTime / dt));
  const stepDt = targetTime / steps;

  let x = 0;
  let v = 0;
  for (let i = 0; i < steps; i += 1) {
    // RK4 integration for accurate overshoot & phase
    const acc = (pos: number, vel: number) => (-k * (pos - 1) - c * vel) / m;

    const k1x = v;
    const k1v = acc(x, v);

    const k2x = v + 0.5 * stepDt * k1v;
    const k2v = acc(x + 0.5 * stepDt * k1x, k2x);

    const k3x = v + 0.5 * stepDt * k2v;
    const k3v = acc(x + 0.5 * stepDt * k2x, k3x);

    const k4x = v + stepDt * k3v;
    const k4v = acc(x + stepDt * k3x, k4x);

    x += (stepDt / 6) * (k1x + 2 * k2x + 2 * k3x + k4x);
    v += (stepDt / 6) * (k1v + 2 * k2v + 2 * k3v + k4v);
  }

  // Smoothly blend last 4% to exact equilibrium 1.0
  if (tNorm > 0.96) {
    const tail = (tNorm - 0.96) / 0.04;
    return x * (1 - tail) + 1 * tail;
  }
  return x;
}

export interface BakedSplinePoint {
  frame: number;
  value: number;
  lhX?: number;
  lhY?: number;
  rhX?: number;
  rhY?: number;
}

/**
 * Bakes a physical Hooke's Law spring segment into discrete BezierSpline keyframes
 * with Catmull-Rom / finite-difference tangents for Resolve & Premiere export.
 */
export function bakeSpringKeyframes(
  startFrame: number,
  endFrame: number,
  startVal: number,
  endVal: number,
  params: Partial<SpringParams> = {},
  sampleStep = 2
): BakedSplinePoint[] {
  const span = Math.max(1, endFrame - startFrame);
  const step = Math.max(1, Math.min(sampleStep, Math.ceil(span / 4)));
  const frames: number[] = [];
  for (let f = startFrame; f < endFrame; f += step) {
    frames.push(f);
  }
  if (frames[frames.length - 1] !== endFrame) {
    frames.push(endFrame);
  }

  const raw = frames.map((frame) => {
    const t = (frame - startFrame) / span;
    const resp = evaluateSpringResponse(t, params);
    return {
      frame,
      value: startVal + (endVal - startVal) * resp,
    };
  });

  return raw.map((pt, idx) => {
    const prev = raw[idx - 1];
    const next = raw[idx + 1];
    const out: BakedSplinePoint = { frame: pt.frame, value: pt.value };
    if (prev && next) {
      const slope = (next.value - prev.value) / Math.max(1, next.frame - prev.frame);
      const dxLeft = (pt.frame - prev.frame) * 0.33;
      const dxRight = (next.frame - pt.frame) * 0.33;
      out.lhX = Number((-dxLeft).toFixed(2));
      out.lhY = Number((-slope * dxLeft).toFixed(4));
      out.rhX = Number(dxRight.toFixed(2));
      out.rhY = Number((slope * dxRight).toFixed(4));
    } else if (next) {
      const dx = (next.frame - pt.frame) * 0.33;
      out.rhX = Number(dx.toFixed(2));
      out.rhY = Number(((next.value - pt.value) * 0.33).toFixed(4));
    } else if (prev) {
      const dx = (pt.frame - prev.frame) * 0.33;
      out.lhX = Number((-dx).toFixed(2));
      out.lhY = Number(((prev.value - pt.value) * 0.33).toFixed(4));
    }
    return out;
  });
}

function hash1D(n: number, seed: number): number {
  const x = Math.sin(n * 127.1 + seed * 311.7) * 43758.5453123;
  return (x - Math.floor(x)) * 2 - 1;
}

function smoothNoise1D(x: number, seed: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  const a = hash1D(i, seed);
  const b = hash1D(i + 1, seed);
  return a * (1 - u) + b * u;
}

/**
 * Deterministic multi-octave organic noise equivalent to AE wiggle(freq, amp) / Fusion Perturb.
 */
export function evaluateWiggle(
  timeSec: number,
  frequencyHz: number,
  amplitude: number,
  seed = 42,
  octaves = 2
): number {
  if (amplitude === 0 || frequencyHz <= 0) return 0;
  let sum = 0;
  let norm = 0;
  let freq = frequencyHz;
  let weight = 1;
  for (let o = 0; o < octaves; o += 1) {
    sum += smoothNoise1D(timeSec * freq, seed + o * 19.3) * weight;
    norm += weight;
    freq *= 2.03;
    weight *= 0.45;
  }
  return (sum / Math.max(1e-4, norm)) * amplitude;
}

const BEAT_MULTIPLIERS: Record<LfoBeatDivision, number> = {
  '1/1': 1,
  '1/2': 2,
  '1/4': 4,
  '1/8': 8,
};

export function resolveLfoFrequencyHz(lfo: Partial<LfoModulatorConfig>): number {
  if (lfo.syncMode === 'bpm') {
    const bpm = clamp(Number(lfo.bpm ?? 120), 60, 180);
    const mult = BEAT_MULTIPLIERS[lfo.beatDivision ?? '1/2'] ?? 2;
    return (bpm / 60) * mult;
  }
  return clamp(Number(lfo.frequencyHz ?? 1.5), 0.1, 20);
}

/**
 * Evaluates an LFO waveform in [-amplitude, +amplitude] (or [0, amplitude] for pulse).
 */
export function evaluateLfo(timeSec: number, lfo: LfoModulatorConfig): number {
  if (!lfo.enabled || lfo.amplitude === 0) return 0;
  const freq = resolveLfoFrequencyHz(lfo);
  const phase = (timeSec * freq) % 1;
  const normPhase = phase < 0 ? phase + 1 : phase;
  if (lfo.waveform === 'pulse') {
    return normPhase < 0.5 ? lfo.amplitude : 0;
  }
  if (lfo.waveform === 'sawtooth') {
    return (normPhase * 2 - 1) * lfo.amplitude;
  }
  return Math.sin(timeSec * freq * Math.PI * 2) * lfo.amplitude;
}

export function sortKeyframes(keyframes: KeyframePoint[]): KeyframePoint[] {
  return [...keyframes].sort((a, b) => a.time - b.time);
}

export function interpolateKeyframePair(
  k0: KeyframePoint,
  k1: KeyframePoint,
  timeSec: number
): number {
  if (timeSec <= k0.time) return k0.value;
  if (timeSec >= k1.time) return k1.value;
  if (k0.interpolation === 'hold') return k0.value;

  const span = Math.max(1e-4, k1.time - k0.time);
  const localT = clamp((timeSec - k0.time) / span, 0, 1);

  let eased = localT;
  if (k0.interpolation === 'bezier') {
    eased = evaluateCubicBezier(localT, k0.bezier ?? [0.42, 0, 0.58, 1]);
  } else if (k0.interpolation === 'spring') {
    eased = evaluateSpringResponse(localT, k0.spring ?? DEFAULT_SPRING_PARAMS);
  }
  return k0.value + (k1.value - k0.value) * eased;
}

export function evaluateKeyframeTrack(
  track: KeyframeTrack | undefined,
  timeSec: number,
  fallbackValue: number
): number {
  if (!track || track.keyframes.length === 0) return fallbackValue;
  const sorted = sortKeyframes(track.keyframes);
  if (timeSec <= sorted[0].time) return sorted[0].value;
  const last = sorted[sorted.length - 1];
  if (timeSec >= last.time) return last.value;

  for (let i = 0; i < sorted.length - 1; i += 1) {
    const k0 = sorted[i];
    const k1 = sorted[i + 1];
    if (timeSec >= k0.time && timeSec <= k1.time) {
      return interpolateKeyframePair(k0, k1, timeSec);
    }
  }
  return last.value;
}

export function findTrackForProperty(
  tracks: KeyframeTrack[] | undefined,
  property: KeyframeTrackId,
  layerId?: string | null
): KeyframeTrack | undefined {
  if (!tracks || tracks.length === 0) return undefined;
  if (layerId) {
    const specific = tracks.find(
      (t) => t.property === property && t.layerId === layerId && t.keyframes.length > 0
    );
    if (specific) return specific;
  }
  return tracks.find(
    (t) => t.property === property && (!t.layerId || t.layerId === '__global__') && t.keyframes.length > 0
  ) ?? tracks.find((t) => t.property === property && t.keyframes.length > 0);
}

/**
 * Evaluates 2D position along a spatial cubic Bezier motion path when spatial handles exist.
 */
export function evaluateSpatialMotionPoint(
  trackX: KeyframeTrack | undefined,
  trackY: KeyframeTrack | undefined,
  timeSec: number,
  fallbackX: number,
  fallbackY: number
): { x: number; y: number } {
  if (!trackX || !trackY || trackX.keyframes.length === 0 || trackY.keyframes.length === 0) {
    return {
      x: evaluateKeyframeTrack(trackX, timeSec, fallbackX),
      y: evaluateKeyframeTrack(trackY, timeSec, fallbackY),
    };
  }

  const sx = sortKeyframes(trackX.keyframes);
  const sy = sortKeyframes(trackY.keyframes);
  if (sx.length !== sy.length || sx.length < 2) {
    return {
      x: evaluateKeyframeTrack(trackX, timeSec, fallbackX),
      y: evaluateKeyframeTrack(trackY, timeSec, fallbackY),
    };
  }

  if (timeSec <= sx[0].time) return { x: sx[0].value, y: sy[0].value };
  const lastIdx = sx.length - 1;
  if (timeSec >= sx[lastIdx].time) return { x: sx[lastIdx].value, y: sy[lastIdx].value };

  for (let i = 0; i < lastIdx; i += 1) {
    const kx0 = sx[i];
    const kx1 = sx[i + 1];
    const ky0 = sy[i];
    const ky1 = sy[i + 1];
    if (timeSec >= kx0.time && timeSec <= kx1.time) {
      if (kx0.interpolation === 'hold') return { x: kx0.value, y: ky0.value };
      const span = Math.max(1e-4, kx1.time - kx0.time);
      const localT = clamp((timeSec - kx0.time) / span, 0, 1);
      const u =
        kx0.interpolation === 'bezier'
          ? evaluateCubicBezier(localT, kx0.bezier ?? [0.42, 0, 0.58, 1])
          : kx0.interpolation === 'spring'
            ? evaluateSpringResponse(localT, kx0.spring ?? DEFAULT_SPRING_PARAMS)
            : localT;

      const hasSpatial =
        Boolean(kx0.spatialOut) || Boolean(kx1.spatialIn);
      if (!hasSpatial) {
        return {
          x: kx0.value + (kx1.value - kx0.value) * u,
          y: ky0.value + (ky1.value - ky0.value) * u,
        };
      }

      const p0x = kx0.value;
      const p0y = ky0.value;
      const p3x = kx1.value;
      const p3y = ky1.value;
      const p1x = p0x + (kx0.spatialOut?.dx ?? (p3x - p0x) * 0.33);
      const p1y = p0y + (kx0.spatialOut?.dy ?? (p3y - p0y) * 0.33);
      const p2x = p3x + (kx1.spatialIn?.dx ?? (p0x - p3x) * 0.33);
      const p2y = p3y + (kx1.spatialIn?.dy ?? (p0y - p3y) * 0.33);

      const inv = 1 - u;
      const bx =
        inv * inv * inv * p0x +
        3 * inv * inv * u * p1x +
        3 * inv * u * u * p2x +
        u * u * u * p3x;
      const by =
        inv * inv * inv * p0y +
        3 * inv * inv * u * p1y +
        3 * inv * u * u * p2y +
        u * u * u * p3y;
      return { x: bx, y: by };
    }
  }
  return { x: sx[lastIdx].value, y: sy[lastIdx].value };
}

export interface MaskRevealEvaluation {
  clipPath?: string;
  maskImage?: string;
  revealAmount: number;
}

export function evaluateMaskReveal(
  config: MaskRevealConfig | undefined,
  progress: number,
  inRatio: number,
  outRatio: number
): MaskRevealEvaluation {
  if (!config?.enabled) return { revealAmount: 1 };
  const safeIn = clamp(inRatio, 0.05, 0.48);
  const safeOut = clamp(outRatio, 0.05, 0.48);
  const outStart = 1 - safeOut;

  let reveal = 1;
  if (progress < safeIn) {
    reveal = evaluateCurve('ease-out', clamp(progress / safeIn, 0, 1));
  } else if (progress > outStart) {
    reveal = 1 - evaluateCurve('ease-in-out', clamp((progress - outStart) / safeOut, 0, 1));
  }
  reveal = clamp(reveal, 0.001, 1);
  const hiddenPct = Number(((1 - reveal) * 100).toFixed(1));
  const feather = clamp(config.featherPx ?? 0, 0, 60);

  let clipPath: string | undefined;
  let maskImage: string | undefined;

  switch (config.direction) {
    case 'left':
      clipPath = `inset(0 ${hiddenPct}% 0 0)`;
      if (feather > 0 && reveal < 0.995) {
        const stop = (reveal * 100).toFixed(1);
        const start = Math.max(0, reveal * 100 - feather * 0.45).toFixed(1);
        maskImage = `linear-gradient(to right, #000 ${start}%, transparent ${stop}%)`;
      }
      break;
    case 'right':
      clipPath = `inset(0 0 0 ${hiddenPct}%)`;
      if (feather > 0 && reveal < 0.995) {
        const edge = ((1 - reveal) * 100).toFixed(1);
        const solid = Math.min(100, (1 - reveal) * 100 + feather * 0.45).toFixed(1);
        maskImage = `linear-gradient(to right, transparent ${edge}%, #000 ${solid}%)`;
      }
      break;
    case 'top':
      clipPath = `inset(0 0 ${hiddenPct}% 0)`;
      if (feather > 0 && reveal < 0.995) {
        const stop = (reveal * 100).toFixed(1);
        const start = Math.max(0, reveal * 100 - feather * 0.45).toFixed(1);
        maskImage = `linear-gradient(to bottom, #000 ${start}%, transparent ${stop}%)`;
      }
      break;
    case 'center': {
      const halfHidden = Number((((1 - reveal) * 50)).toFixed(1));
      clipPath = `inset(${halfHidden}% ${halfHidden}% ${halfHidden}% ${halfHidden}%)`;
      break;
    }
    case 'diagonal': {
      const d = Number((reveal * 200).toFixed(1));
      clipPath = `polygon(0% 0%, ${Math.min(100, d)}% 0%, ${Math.max(0, d - 100)}% 100%, 0% ${Math.min(100, d)}%)`;
      break;
    }
    case 'bottom':
    default:
      clipPath = `inset(${hiddenPct}% 0 0 0)`;
      if (feather > 0 && reveal < 0.995) {
        const edge = ((1 - reveal) * 100).toFixed(1);
        const solid = Math.min(100, (1 - reveal) * 100 + feather * 0.45).toFixed(1);
        maskImage = `linear-gradient(to bottom, transparent ${edge}%, #000 ${solid}%)`;
      }
      break;
  }

  return { clipPath, maskImage, revealAmount: reveal };
}

export interface StaggerTokenState {
  token: string;
  opacity: number;
  translateY: number;
  rotate3dDeg: number;
  blurPx: number;
}

export function evaluateTextStagger(
  text: string,
  timeSec: number,
  durationSec: number,
  inRatio: number,
  stagger: TextStaggerConfig
): StaggerTokenState[] {
  const tokens =
    stagger.unit === 'line'
      ? text.split(/\r?\n/)
      : stagger.unit === 'word'
        ? text.match(/\S+\s*/g) ?? [text]
        : Array.from(text);

  if (!stagger.enabled || tokens.length === 0) {
    return tokens.map((token) => ({
      token,
      opacity: 1,
      translateY: 0,
      rotate3dDeg: 0,
      blurPx: 0,
    }));
  }

  const inSec = Math.max(0.18, durationSec * clamp(inRatio, 0.08, 0.48));
  const delaySec = clamp(stagger.delayMs ?? 45, 0, 250) / 1000;
  const elemWindow = Math.max(0.14, inSec * 0.55);

  return tokens.map((token, idx) => {
    const start = idx * delaySec;
    const localT = clamp((timeSec - start) / elemWindow, 0, 1);
    const eased = evaluateCurve('ease-out', localT);
    const inv = 1 - eased;
    return {
      token,
      opacity: clamp(eased * 1.15, 0, 1),
      translateY: inv * (stagger.offsetY ?? 18),
      rotate3dDeg: inv * (stagger.rotate3dDeg ?? 28),
      blurPx: inv * (stagger.blurInPx ?? 6),
    };
  });
}

export function computeTrimPathStroke(
  trim: TrimPathsConfig | undefined,
  progress: number,
  inRatio: number,
  perimeter = 100
): { dasharray: string; dashoffset: number; activeLength: number } | null {
  if (!trim?.enabled) return null;
  const reveal = evaluateCurve('ease-out', clamp(progress / Math.max(0.08, inRatio), 0, 1));
  const start = clamp(trim.startPct ?? 0, 0, 100);
  const end = clamp(trim.endPct ?? 100, 0, 100) * reveal;
  const len = Math.max(0, end - start);
  const activeLength = (len / 100) * perimeter;
  const offsetNorm = ((start / 100) + ((trim.offsetDeg ?? 0) / 360)) * perimeter;
  return {
    dasharray: `${activeLength.toFixed(2)} ${(perimeter + 4).toFixed(2)}`,
    dashoffset: -offsetNorm,
    activeLength,
  };
}

export function blendModeToCss(mode: LayerBlendMode | undefined): string | undefined {
  if (!mode || mode === 'normal') return undefined;
  if (mode === 'add') return 'plus-lighter';
  return mode;
}
