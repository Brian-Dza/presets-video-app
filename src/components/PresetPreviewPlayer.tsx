import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  Columns2,
  Film,
  Grid3x3,
  Pause,
  Play,
  Repeat,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import {
  defaultCurveFor,
  defaultPositionFor,
  resolveNormalizedPivot,
  type AspectRatioPreset,
  type PresetLayer,
  type PresetRecord,
} from '../domain/preset';
import {
  blendModeToCss,
  computeTrimPathStroke,
  evaluateCubicBezier,
  evaluateCurve,
  evaluateKeyframeTrack,
  evaluateLfo,
  evaluateMaskReveal,
  evaluateSpatialMotionPoint,
  evaluateSpringResponse,
  evaluateTextStagger,
  evaluateWiggle,
  findTrackForProperty,
  sortKeyframes,
} from '../lib/animationEngine';
import { BUILTIN_SFX_OPTIONS, generateSfxWaveformPeaks, SfxPreviewEngine } from '../lib/audioSfx';
import { evaluateLutCssFilter, interpolateLutMatrix, parseCubeLut } from '../lib/lutParser';
import {
  normalizeScaleMultiplier,
  normalizeTrackingSpacing,
  normalizeUnitCoord,
} from '../lib/nleCompiler';

export { evaluateCubicBezier, evaluateCurve };

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function formatSeconds(seconds: number): string {
  const safe = Math.max(0, seconds);
  const whole = Math.floor(safe);
  const tenths = Math.floor((safe - whole) * 10);
  return `00:${String(whole).padStart(2, '0')}.${tenths}`;
}

function getDirectionVector(direction: string): { dx: number; dy: number } {
  switch (direction) {
    case 'left':
      return { dx: -1, dy: 0 };
    case 'up':
      return { dx: 0, dy: -1 };
    case 'down':
      return { dx: 0, dy: 1 };
    case 'right':
    default:
      return { dx: 1, dy: 0 };
  }
}

const CIPHER_GLYPHS = '01#$%&*+<>?@/';
const PUNCTUATION_PAUSE_RE = /[,.;:?!/-]/;

export interface TypewriterEvalParams {
  typewriterUnit?: string;
  cursorStyle?: string;
  showCursor?: boolean;
  cursorBlinkHz?: number;
  cursorColorMode?: string;
  hideCursorOnComplete?: boolean;
  humanJitter?: number;
  outBehavior?: string;
}

export interface TypewriterEvalResult {
  displayText: string;
  cursorChar: string;
  cursorVisible: boolean;
  cursorColorMode: 'accent' | 'white';
  stepCount: number;
  opacityMult: number;
  isTypingActive: boolean;
}

export function evaluateTypewriterState(
  text: string,
  progress: number,
  currentTime: number,
  inRatio: number,
  outRatio: number,
  easedIn: number,
  params: TypewriterEvalParams = {}
): TypewriterEvalResult {
  const unit = String(params.typewriterUnit ?? 'char');
  const rawStyle = params.showCursor === false ? 'none' : String(params.cursorStyle ?? 'bar');
  const cursorChar =
    rawStyle === 'none'
      ? ''
      : rawStyle === 'underscore'
        ? '_'
        : rawStyle === 'block'
          ? '█'
          : '|';
  const blinkHz = clamp(Number(params.cursorBlinkHz ?? 2.5), 0, 6);
  const cursorColorMode: 'accent' | 'white' =
    params.cursorColorMode === 'white' ? 'white' : 'accent';
  const hideOnComplete = Boolean(params.hideCursorOnComplete);
  const jitterNorm = clamp(Number(params.humanJitter ?? 25) / 100, 0, 1);
  const outBehavior = String(params.outBehavior ?? 'backspace');

  const safeIn = clamp(inRatio, 0.05, 0.48);
  const safeOut = clamp(outRatio, 0.05, 0.48);
  const outStart = 1 - safeOut;

  let revealRatio = 1;
  let opacityMult = 1;
  let phase: 'in' | 'sustain' | 'out' = 'sustain';

  if (progress < safeIn) {
    phase = 'in';
    revealRatio = clamp(easedIn, 0, 1);
  } else if (progress > outStart) {
    phase = 'out';
    const outLocal = clamp((progress - outStart) / Math.max(0.01, safeOut), 0, 1);
    if (outBehavior === 'backspace') {
      revealRatio = clamp(1 - outLocal, 0, 1);
    } else if (outBehavior === 'cut') {
      revealRatio = 1;
      opacityMult = outLocal >= 0.92 ? 0 : 1;
    } else if (outBehavior === 'glitch') {
      revealRatio = clamp(1 - Math.max(0, outLocal - 0.35) * 1.5, 0, 1);
      opacityMult = outLocal > 0.9 ? 0 : Math.sin(currentTime * 74) > -0.25 ? 1 : 0.22;
    } else {
      revealRatio = 1;
      opacityMult = clamp(1 - outLocal, 0, 1);
    }
  }

  if (!text) {
    return {
      displayText: '',
      cursorChar,
      cursorVisible: Boolean(cursorChar) && !hideOnComplete,
      cursorColorMode,
      stepCount: 0,
      opacityMult,
      isTypingActive: false,
    };
  }

  // Organic cadence weights per character (punctuation pauses + golden-angle micro-jitter)
  const chars = Array.from(text);
  const cumulative: number[] = [];
  let totalWeight = 0;
  for (let i = 0; i < chars.length; i += 1) {
    const ch = chars[i];
    const basePause = PUNCTUATION_PAUSE_RE.test(ch)
      ? 1 + jitterNorm * 2.2
      : ch === ' '
        ? 1 + jitterNorm * 0.45
        : 1 + jitterNorm * 0.38 * Math.sin((i + 1) * 2.39996);
    totalWeight += Math.max(0.25, basePause);
    cumulative.push(totalWeight);
  }

  let revealedChars = 0;
  if (revealRatio <= 0.001) {
    revealedChars = 0;
  } else if (revealRatio >= 0.999) {
    revealedChars = chars.length;
  } else {
    const targetWeight = revealRatio * totalWeight;
    let count = 0;
    while (count < cumulative.length && cumulative[count] <= targetWeight) {
      count += 1;
    }
    revealedChars = clamp(Math.max(phase === 'in' ? 1 : 0, count), 0, chars.length);
  }

  let displayText = '';
  let stepCount = revealedChars;

  if (unit === 'word') {
    const tokens = text.match(/\S+\s*/g) ?? [text];
    const wordCount =
      revealRatio <= 0.001
        ? 0
        : revealRatio >= 0.999
          ? tokens.length
          : clamp(Math.max(phase === 'in' ? 1 : 0, Math.ceil(tokens.length * revealRatio)), 0, tokens.length);
    displayText = tokens.slice(0, wordCount).join('').replace(/\s+$/, '');
    stepCount = wordCount;
  } else if (unit === 'cipher') {
    const locked = chars.slice(0, revealedChars).join('');
    const scrambleActive =
      (revealRatio > 0.001 && revealRatio < 0.999) ||
      (phase === 'out' && outBehavior === 'glitch' && opacityMult > 0);
    if (scrambleActive && revealedChars < chars.length) {
      const frontierCount = Math.min(3, chars.length - revealedChars);
      let scrambled = '';
      for (let k = 0; k < frontierCount; k += 1) {
        const srcChar = chars[revealedChars + k];
        if (srcChar === ' ') {
          scrambled += ' ';
        } else {
          const glyphIdx =
            Math.abs(Math.floor(currentTime * 24 + (revealedChars + k) * 7)) % CIPHER_GLYPHS.length;
          scrambled += CIPHER_GLYPHS[glyphIdx];
        }
      }
      displayText = locked + scrambled;
    } else {
      displayText = locked;
    }
  } else {
    displayText = chars.slice(0, revealedChars).join('');
  }

  const isTypingActive =
    (phase === 'in' && revealRatio < 0.999) ||
    (phase === 'out' && (outBehavior === 'backspace' || outBehavior === 'glitch') && revealRatio > 0.001);
  const isCompleteSustain = phase === 'sustain' && revealRatio >= 0.999;

  let cursorVisible = Boolean(cursorChar) && opacityMult > 0;
  if (cursorVisible && hideOnComplete && isCompleteSustain) {
    cursorVisible = false;
  } else if (cursorVisible && blinkHz > 0 && !isTypingActive) {
    cursorVisible = Math.sin(currentTime * blinkHz * Math.PI * 2) >= -0.1;
  }

  return {
    displayText,
    cursorChar,
    cursorVisible,
    cursorColorMode,
    stepCount,
    opacityMult,
    isTypingActive,
  };
}

export interface PresetPreviewPlayerProps {
  preset: PresetRecord;
  large?: boolean;
  autoPlay?: boolean;
  hoverActive?: boolean;
  interactive?: boolean;
  interactivePosition?: boolean;
  currentTime?: number;
  onTimeChange?: (seconds: number) => void;
  selectedLayerId?: string | null;
  autoKeyframe?: boolean;
  onPositionChange?: (x: number, y: number) => void;
  onScaleChange?: (scaleMultiplier: number) => void;
  onRotationChange?: (rotationDeg: number) => void;
  onPivotChange?: (pivotX: number, pivotY: number) => void;
  onMotionPathHandleChange?: (
    keyframeIndex: number,
    handleType: 'out' | 'in',
    dx: number,
    dy: number
  ) => void;
  onAspectRatioChange?: (ratio: AspectRatioPreset) => void;
  forceBefore?: boolean;
  customAudioBytes?: Uint8Array | null;
  externalTimeCommand?: { seq: number; action: 'toggle' | 'step-back' | 'step-forward' };
}

export function PresetPreviewPlayer({
  preset,
  large = false,
  autoPlay = false,
  hoverActive = false,
  interactive = false,
  interactivePosition = false,
  currentTime: controlledTime,
  onTimeChange,
  selectedLayerId = null,
  autoKeyframe = false,
  onPositionChange,
  onScaleChange,
  onRotationChange,
  onPivotChange,
  onMotionPathHandleChange,
  onAspectRatioChange,
  forceBefore = false,
  customAudioBytes = null,
  externalTimeCommand,
}: PresetPreviewPlayerProps) {
  const duration = Math.max(0.4, preset.durationSeconds || 2.5);
  const [playing, setPlaying] = useState(Boolean(large && (autoPlay || interactive || interactivePosition)));
  const [loop, setLoop] = useState(true);
  const [splitCompare, setSplitCompare] = useState(false);
  const [splitPercent, setSplitPercent] = useState(52);
  const [internalTime, setInternalTime] = useState(() =>
    large && (autoPlay || interactive || interactivePosition) ? 0 : duration * 0.48
  );
  const currentTime = controlledTime !== undefined ? clamp(controlledTime, 0, duration) : internalTime;
  const timeRef = useRef(currentTime);
  timeRef.current = currentTime;

  const setSyncedTime = (next: number | ((prev: number) => number)) => {
    const resolved =
      typeof next === 'function' ? next(timeRef.current) : next;
    const clamped = clamp(resolved, 0, duration);
    timeRef.current = clamped;
    if (controlledTime === undefined) {
      setInternalTime(clamped);
    }
    onTimeChange?.(clamped);
  };

  const [customMedia, setCustomMedia] = useState<{ url: string; kind: 'video' | 'image'; name: string } | null>(null);
  const [draggingOverlay, setDraggingOverlay] = useState(false);
  const [gizmoDrag, setGizmoDrag] = useState<
    | { kind: 'scale'; startDist: number; startScale: number; centerX: number; centerY: number }
    | { kind: 'rotate'; centerX: number; centerY: number }
    | { kind: 'pivot' }
    | { kind: 'motion-handle'; keyframeIndex: number; handleType: 'out' | 'in'; anchorX: number; anchorY: number }
    | null
  >(null);
  const [liveRotateHud, setLiveRotateHud] = useState<number | null>(null);
  const [draggingSplitWipe, setDraggingSplitWipe] = useState(false);
  const [snapGuide, setSnapGuide] = useState<{ x: boolean; y: boolean }>({ x: false, y: false });
  const [showSafeZones, setShowSafeZones] = useState(false);
  const [showRuleOfThirds, setShowRuleOfThirds] = useState(false);
  const [sfxMuted, setSfxMuted] = useState(Boolean(preset.audioSfx?.muted));

  const stageRef = useRef<HTMLDivElement>(null);
  const overlayAnchorRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const sfxEngineRef = useRef<SfxPreviewEngine | null>(null);
  const sfxTriggeredCycleRef = useRef<number>(-1);
  const lastTypedStepRef = useRef<number>(-1);
  const lastKeystrokeAtRef = useRef<number>(0);
  const lastCommandSeqRef = useRef<number>(0);
  const fileInputId = useId();
  const lutFilterId = useId().replace(/:/g, '');

  const effectivePlaying = large ? playing : hoverActive;
  const aspectRatio: AspectRatioPreset = preset.aspectRatio ?? '16:9';
  const activeLayers = useMemo(
    () => (preset.layers ?? []).filter((layer) => layer.enabled),
    [preset.layers]
  );

  const parsedLut = useMemo(
    () => (preset.lutData ? parseCubeLut(preset.lutData, preset.lutName) : null),
    [preset.lutData, preset.lutName]
  );
  const lutMatrixValues = useMemo(
    () => interpolateLutMatrix(parsedLut, preset.lutMix ?? 75),
    [parsedLut, preset.lutMix]
  );

  const sfxAnchorSec = preset.category === 'transition' ? duration * 0.5 : 0;
  const sfxTriggerSec = clamp(
    sfxAnchorSec + (preset.audioSfx?.offsetMs ?? 0) / 1000,
    0,
    Math.max(0.04, duration - 0.04)
  );
  const sfxDurationSec = useMemo(() => {
    const sfxId = preset.audioSfx?.sfxId ?? 'none';
    if (sfxId === 'none') return 0;
    if (sfxId === 'custom') return Math.min(duration * 0.6, 0.8);
    return BUILTIN_SFX_OPTIONS.find((item) => item.id === sfxId)?.durationSec ?? 0.45;
  }, [preset.audioSfx?.sfxId, duration]);

  const sfxPeaks = useMemo(
    () => generateSfxWaveformPeaks(preset.audioSfx?.sfxId ?? 'none', customAudioBytes, 28),
    [preset.audioSfx?.sfxId, customAudioBytes]
  );

  useEffect(() => {
    setSfxMuted(Boolean(preset.audioSfx?.muted));
  }, [preset.audioSfx?.muted]);

  useEffect(() => {
    if (large) {
      const startPlaying = Boolean(autoPlay || interactive || interactivePosition);
      setSyncedTime(startPlaying ? 0 : duration * 0.48);
      setPlaying(startPlaying);
      sfxTriggeredCycleRef.current = -1;
    } else if (!hoverActive) {
      setSyncedTime(duration * 0.48);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset.id, large, autoPlay, interactive, interactivePosition, duration, hoverActive]);

  useEffect(() => {
    if (!externalTimeCommand || externalTimeCommand.seq === lastCommandSeqRef.current) return;
    lastCommandSeqRef.current = externalTimeCommand.seq;
    if (externalTimeCommand.action === 'toggle') {
      setPlaying((prev) => {
        if (!prev && timeRef.current >= duration - 0.02) {
          sfxTriggeredCycleRef.current = -1;
          setSyncedTime(0);
        }
        if (prev) sfxEngineRef.current?.stop();
        return !prev;
      });
    } else if (externalTimeCommand.action === 'step-back') {
      setPlaying(false);
      sfxEngineRef.current?.stop();
      setSyncedTime((prev) => Math.max(0, Number((prev - 1 / 24).toFixed(3))));
    } else if (externalTimeCommand.action === 'step-forward') {
      setPlaying(false);
      sfxEngineRef.current?.stop();
      setSyncedTime((prev) => Math.min(duration, Number((prev + 1 / 24).toFixed(3))));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalTimeCommand, duration]);

  useEffect(() => {
    return () => {
      sfxEngineRef.current?.stop();
    };
  }, []);

  useEffect(() => {
    if (!effectivePlaying) return;
    let frameId = 0;
    let lastTimestamp = performance.now();

    const tick = (now: number) => {
      const delta = Math.min(0.08, Math.max(0, (now - lastTimestamp) / 1000));
      lastTimestamp = now;
      const next = timeRef.current + delta;
      if (next >= duration) {
        if (loop || !large) {
          sfxTriggeredCycleRef.current = -1;
          setSyncedTime(next % duration);
        } else {
          setPlaying(false);
          setSyncedTime(duration);
          return;
        }
      } else {
        setSyncedTime(next);
      }
      frameId = window.requestAnimationFrame(tick);
    };

    frameId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frameId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectivePlaying, duration, loop, large]);

  // Synchronized Web Audio SFX trigger
  useEffect(() => {
    if (!large || !playing || sfxMuted) return;
    const sfx = preset.audioSfx;
    if (!sfx || sfx.sfxId === 'none') return;
    if (currentTime >= sfxTriggerSec && sfxTriggeredCycleRef.current !== 1) {
      sfxTriggeredCycleRef.current = 1;
      if (!sfxEngineRef.current) {
        sfxEngineRef.current = new SfxPreviewEngine();
      }
      void sfxEngineRef.current.play({
        sfxId: sfx.sfxId,
        gainDb: sfx.gainDb ?? 0,
        muted: sfxMuted,
        customBytes: customAudioBytes,
      });
    }
  }, [large, playing, sfxMuted, preset.audioSfx, currentTime, sfxTriggerSec, customAudioBytes]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !customMedia || customMedia.kind !== 'video') return;
    if (effectivePlaying) {
      void video.play().catch(() => undefined);
    } else {
      video.pause();
    }
  }, [effectivePlaying, customMedia]);

  useEffect(() => {
    return () => {
      if (customMedia?.url) URL.revokeObjectURL(customMedia.url);
    };
  }, [customMedia]);

  const embeddedPreviewUrl = useMemo(() => {
    const previewFile = preset.nativeFiles?.find((item) => item.role === 'preview');
    if (!previewFile || previewFile.bytes.length === 0) return null;
    const ext = previewFile.path.split('.').pop()?.toLowerCase();
    const mime =
      ext === 'svg'
        ? 'image/svg+xml'
        : ext === 'png'
          ? 'image/png'
          : ext === 'webp'
            ? 'image/webp'
            : 'image/jpeg';
    return URL.createObjectURL(new Blob([previewFile.bytes.slice().buffer], { type: mime }));
  }, [preset.nativeFiles]);

  useEffect(() => {
    return () => {
      if (embeddedPreviewUrl) URL.revokeObjectURL(embeddedPreviewUrl);
    };
  }, [embeddedPreviewUrl]);

  const progress = clamp(currentTime / duration, 0, 1);
  const curve = preset.curve ?? defaultCurveFor(preset.category, preset.animation);
  const animLower = (preset.animation || '').toLocaleLowerCase('es');

  const inRatio = clamp(preset.timelinePhases?.inRatio ?? 0.28, 0.05, 0.48);
  const outRatio = clamp(preset.timelinePhases?.outRatio ?? 0.18, 0.05, 0.48);
  const outStart = 1 - outRatio;
  const inPhase = clamp(progress / inRatio, 0, 1);
  const outPhase = progress > outStart ? clamp(1 - (progress - outStart) / outRatio, 0, 1) : 1;

  // Evaluate keyframe tracks if present on preset
  const trackPosX = findTrackForProperty(preset.keyframeTracks, 'positionX', selectedLayerId);
  const trackPosY = findTrackForProperty(preset.keyframeTracks, 'positionY', selectedLayerId);
  const trackScale = findTrackForProperty(preset.keyframeTracks, 'scale', selectedLayerId);
  const trackRotation = findTrackForProperty(preset.keyframeTracks, 'rotation', selectedLayerId);
  const trackOpacity = findTrackForProperty(preset.keyframeTracks, 'opacity', selectedLayerId);
  const trackOptical = findTrackForProperty(preset.keyframeTracks, 'opticalIntensity', selectedLayerId);

  const keyframedOpticalMult = trackOptical
    ? clamp(evaluateKeyframeTrack(trackOptical, currentTime, 65) / 65, 0, 2)
    : 1;

  // Multi-layer stack evaluation
  const stackState = useMemo(() => {
    let scaleMult = 1;
    let anchorX = 50;
    let anchorY = 50;
    let translateX = 0;
    let translateY = 0;
    let rotateDeg = 0;
    let opacityMod = 1;
    let motionBlurPx = 0;
    let gaussianBlurPx = 0;
    let glowBoost = 0;
    let halationBoost = 0;
    let vignetteBoost = 0;
    let grainBoost = 0;
    let grainScale = 1;
    let rgbSplitPx = 0;
    let vhsScanlines = 0;
    let lensScale = 1;
    let pipFrame: { radius: number; width: number; shadow: number; scale: number } | null = null;
    let speedMultiplier = 1;
    let transitionLayer: PresetLayer | null = null;
    let typographyLayer: PresetLayer | null = null;
    let activeSpringMod: PresetLayer['modulators'] extends infer M ? M extends { spring?: infer S } ? S : undefined : undefined;
    let activeBlendMode = activeLayers.find((l) => l.id === selectedLayerId)?.blendMode ?? activeLayers.find((l) => l.blendMode && l.blendMode !== 'normal')?.blendMode;
    let activeTrimPaths = activeLayers.find((l) => l.id === selectedLayerId && l.trimPaths?.enabled)?.trimPaths ?? activeLayers.find((l) => l.trimPaths?.enabled)?.trimPaths;
    let activeMaskReveal = activeLayers.find((l) => l.id === selectedLayerId && l.maskReveal?.enabled)?.maskReveal ?? activeLayers.find((l) => l.maskReveal?.enabled)?.maskReveal;
    let activeStagger = activeLayers.find((l) => l.type === 'typography' && l.modulators?.stagger?.enabled)?.modulators?.stagger;

    for (const layer of activeLayers) {
      const lCurve = evaluateCurve(layer.curve ?? curve, progress, layer.bezier ?? preset.bezier);
      const lInCurve = layer.modulators?.spring?.enabled
        ? evaluateSpringResponse(inPhase, layer.modulators.spring)
        : evaluateCurve(layer.curve ?? curve, inPhase, layer.bezier ?? preset.bezier);
      const normInt = clamp((layer.intensity / 100) * keyframedOpticalMult, 0, 1.5);

      if (layer.modulators?.spring?.enabled && !activeSpringMod) {
        activeSpringMod = layer.modulators.spring;
      }

      // Procedural Wiggle / Perturb modulator
      if (layer.modulators?.wiggle?.enabled) {
        const w = layer.modulators.wiggle;
        const w1 = evaluateWiggle(currentTime, w.frequencyHz, w.amplitude, w.seed ?? 42);
        const w2 = evaluateWiggle(currentTime, w.frequencyHz, w.amplitude, (w.seed ?? 42) + 71);
        if (w.target === 'position') {
          translateX += w1;
          translateY += w2;
        } else if (w.target === 'rotation') {
          rotateDeg += w1 * 0.45;
        } else if (w.target === 'scale') {
          scaleMult *= clamp(1 + w1 * 0.008, 0.4, 2.2);
        } else if (w.target === 'glow') {
          glowBoost = Math.max(0, glowBoost + w1 * 0.015);
        }
      }

      // Procedural LFO Oscillator (Hz or BPM sync)
      if (layer.modulators?.lfo?.enabled) {
        const lfo = layer.modulators.lfo;
        const lfoVal = evaluateLfo(currentTime, lfo);
        if (lfo.target === 'glow') {
          glowBoost = Math.max(0, glowBoost + lfoVal * 0.012);
        } else if (lfo.target === 'scale') {
          scaleMult *= clamp(1 + lfoVal * 0.006, 0.4, 2.2);
        } else if (lfo.target === 'rotation') {
          rotateDeg += lfoVal * 0.45;
        } else if (lfo.target === 'opacity') {
          opacityMod *= clamp(1 + lfoVal * 0.01, 0.1, 1);
        }
      }

      if (layer.type === 'typography') {
        typographyLayer = layer;
        if (!activeBlendMode && layer.blendMode && layer.blendMode !== 'normal') {
          activeBlendMode = layer.blendMode;
        }
        if (layer.modulators?.stagger?.enabled) {
          activeStagger = layer.modulators.stagger;
        }
        continue;
      }
      if (layer.type === 'transition') {
        transitionLayer = layer;
        continue;
      }

      if (layer.kind === 'punch-in') {
        const s0 = Number(layer.params.startScale ?? 100) / 100;
        const s1 = Number(layer.params.endScale ?? 128) / 100;
        const factor = layer.params.impactMode === 'punch' ? lInCurve : lCurve;
        scaleMult *= 1 + (s0 + (s1 - s0) * factor - 1) * normInt;
        anchorX = Number(layer.params.anchorX ?? 50);
        anchorY = Number(layer.params.anchorY ?? 50);
      } else if (layer.kind === 'camera-shake') {
        const freq = Number(layer.params.frequencyHz ?? 8);
        const ampX = Number(layer.params.amplitudeX ?? 14) * normInt;
        const ampY = Number(layer.params.amplitudeY ?? 10) * normInt;
        const rot = Number(layer.params.rotationDeg ?? 2.2) * normInt;
        const seed = Number(layer.params.seed ?? 42);
        const decay = layer.params.decayMode === 'impact' ? Math.exp(-progress * 4.2) : 1;
        const phase = currentTime * freq * Math.PI * 2 + seed;
        translateX += Math.sin(phase) * ampX * decay;
        translateY += Math.cos(phase * 1.37) * ampY * decay;
        rotateDeg += Math.sin(phase * 0.83) * rot * decay;
      } else if (layer.kind === 'float-drift') {
        const ampX = Number(layer.params.amplitudeX ?? 8) * normInt;
        const ampY = Number(layer.params.amplitudeY ?? 10) * normInt;
        const rot = Number(layer.params.rotationDeg ?? 1.5) * normInt;
        const speed = Number(layer.params.speed ?? 1.2);
        translateX += Math.sin(progress * Math.PI * 2 * speed) * ampX;
        translateY += Math.cos(progress * Math.PI * 2 * speed * 0.85) * ampY;
        rotateDeg += Math.sin(progress * Math.PI * 2 * speed * 0.6) * rot;
      } else if (layer.kind === 'speed-ramp') {
        const minS = Number(layer.params.minSpeed ?? 40) / 100;
        const maxS = Number(layer.params.maxSpeed ?? 260) / 100;
        speedMultiplier = minS + (maxS - minS) * Math.sin(progress * Math.PI) * normInt;
      } else if (layer.kind === 'motion-blur') {
        const shutter = Number(layer.params.shutterAngle ?? 180);
        motionBlurPx += (shutter / 360) * 5.5 * normInt * (0.25 + Math.sin(progress * Math.PI) * 0.75);
      } else if (layer.kind === 'glow') {
        glowBoost = Math.max(glowBoost, normInt);
      } else if (layer.kind === 'halation') {
        halationBoost = Math.max(halationBoost, normInt);
      } else if (layer.kind === 'vignette') {
        vignetteBoost = Math.max(vignetteBoost, normInt);
      } else if (layer.kind === 'film-grain') {
        grainBoost = Math.max(grainBoost, normInt * 0.52);
        const stock = String(layer.params.stock ?? '35mm');
        grainScale = stock === '8mm' ? 1.8 : stock === '16mm' ? 1.35 : 1;
      } else if (layer.kind === 'chromatic-aberration') {
        rgbSplitPx = Math.max(rgbSplitPx, Number(layer.params.shiftPx ?? 8) * normInt);
      } else if (layer.kind === 'vhs-crt') {
        vhsScanlines = Math.max(vhsScanlines, normInt * 0.62);
        translateX += Math.sin(currentTime * 46) * normInt * 2.2;
      } else if (layer.kind === 'lens-distortion') {
        const curv = Number(layer.params.curvature ?? 32) / 100;
        lensScale = 1 + curv * 0.16 * normInt;
      } else if (layer.kind === 'blur') {
        gaussianBlurPx = Math.max(gaussianBlurPx, Number(layer.params.radiusPx ?? 12) * normInt * 0.42);
      } else if (layer.kind === 'pip-frame') {
        const lfoBorder =
          layer.modulators?.lfo?.enabled && layer.modulators.lfo.target === 'borderWidth'
            ? evaluateLfo(currentTime, layer.modulators.lfo) * 0.18
            : 0;
        pipFrame = {
          radius: Number(layer.params.borderRadius ?? 16),
          width: Math.max(0, Number(layer.params.borderWidth ?? 3) + lfoBorder),
          shadow: Number(layer.params.dropShadow ?? 48) * normInt,
          scale: Number(layer.params.pipScale ?? 88) / 100,
        };
      }
    }

    return {
      scaleMult,
      anchorX,
      anchorY,
      translateX,
      translateY,
      rotateDeg,
      opacityMod,
      motionBlurPx,
      gaussianBlurPx,
      glowBoost,
      halationBoost,
      vignetteBoost,
      grainBoost,
      grainScale,
      rgbSplitPx,
      vhsScanlines,
      lensScale,
      pipFrame,
      speedMultiplier,
      transitionLayer,
      typographyLayer,
      activeSpringMod,
      activeBlendMode,
      activeTrimPaths,
      activeMaskReveal,
      activeStagger,
    };
  }, [activeLayers, curve, progress, inPhase, preset.bezier, currentTime, keyframedOpticalMult, selectedLayerId]);

  const rawBaseScale = normalizeScaleMultiplier(preset.scale, 1);
  const baseScale = trackScale
    ? clamp(evaluateKeyframeTrack(trackScale, currentTime, rawBaseScale), 0.2, 3.0)
    : rawBaseScale;
  const typoKind = (stackState.typographyLayer?.kind ?? '') as string;
  const anchorPivot = resolveNormalizedPivot(preset);
  const rawExtraRotationDeg = Number(preset.rotationDeg ?? 0);
  const extraRotationDeg = trackRotation
    ? evaluateKeyframeTrack(trackRotation, currentTime, rawExtraRotationDeg)
    : rawExtraRotationDeg;
  const keyframedOpacity = trackOpacity
    ? clamp(evaluateKeyframeTrack(trackOpacity, currentTime, 100) / 100, 0, 1)
    : 1;

  const easedInGlobal = stackState.activeSpringMod?.enabled
    ? evaluateSpringResponse(inPhase, stackState.activeSpringMod)
    : evaluateCurve(
        stackState.typographyLayer?.curve ?? curve,
        inPhase,
        stackState.typographyLayer?.bezier ?? preset.bezier
      );

  const rawText = preset.text || (preset.category === 'sticker' ? '¡WOW!' : preset.name);
  const formattedText = preset.uppercase ? rawText.toLocaleUpperCase('es') : rawText;

  const typewriterState = useMemo(() => {
    if (typoKind !== 'typewriter') return null;
    return evaluateTypewriterState(
      formattedText,
      progress,
      currentTime,
      inRatio,
      outRatio,
      easedInGlobal,
      stackState.typographyLayer?.params ?? {}
    );
  }, [
    typoKind,
    formattedText,
    progress,
    currentTime,
    inRatio,
    outRatio,
    easedInGlobal,
    stackState.typographyLayer?.params,
  ]);

  // Synchronized Auto-SFX mechanical keystroke micro-clicks for Typewriter Pro
  useEffect(() => {
    if (!large || !playing || sfxMuted || !typewriterState) {
      lastTypedStepRef.current = typewriterState?.stepCount ?? -1;
      return;
    }
    const autoSfx = Boolean(stackState.typographyLayer?.params.autoTypingSfx);
    if (!autoSfx) return;
    if (typewriterState.stepCount !== lastTypedStepRef.current) {
      const prev = lastTypedStepRef.current;
      lastTypedStepRef.current = typewriterState.stepCount;
      if (prev >= 0 && typewriterState.stepCount > 0 && typewriterState.isTypingActive) {
        const now = performance.now();
        if (now - lastKeystrokeAtRef.current >= 42) {
          lastKeystrokeAtRef.current = now;
          if (!sfxEngineRef.current) {
            sfxEngineRef.current = new SfxPreviewEngine();
          }
          sfxEngineRef.current.playKeystrokeTick(
            typewriterState.stepCount,
            (preset.audioSfx?.gainDb ?? 0) - 4
          );
        }
      }
    }
  }, [
    large,
    playing,
    sfxMuted,
    typewriterState,
    stackState.typographyLayer?.params.autoTypingSfx,
    preset.audioSfx?.gainDb,
  ]);

  const overlayMotion = useMemo(() => {
    if (forceBefore) {
      return {
        opacity: 1,
        scale: baseScale,
        translateY: 0,
        rotate: (preset.category === 'sticker' ? -9 : 0) + extraRotationDeg,
      };
    }
    const easedIn = easedInGlobal;
    const easedOut = evaluateCurve('ease-out', outPhase);
    const hasOpacityTrack = Boolean(trackOpacity);
    const hasScaleOrSpring = Boolean(trackScale) || Boolean(stackState.activeSpringMod?.enabled);

    if (hasOpacityTrack || Boolean(trackPosX) || Boolean(trackPosY) || Boolean(trackRotation) || Boolean(trackScale)) {
      const springScaleFactor = stackState.activeSpringMod?.enabled
        ? 0.65 + 0.35 * evaluateSpringResponse(inPhase, stackState.activeSpringMod)
        : 1;
      return {
        opacity: clamp(keyframedOpacity * stackState.opacityMod * (hasOpacityTrack ? 1 : clamp(easedIn, 0, 1) * easedOut), 0, 1),
        scale: baseScale * springScaleFactor * stackState.scaleMult,
        translateY: stackState.translateY,
        rotate: extraRotationDeg + stackState.rotateDeg,
      };
    }

    if (typoKind === 'typewriter' && typewriterState) {
      return {
        opacity: clamp(typewriterState.opacityMult * stackState.opacityMod, 0, 1),
        scale: baseScale,
        translateY: 0,
        rotate: extraRotationDeg,
      };
    }

    if (typoKind === 'pop-bounce') {
      const pop = stackState.activeSpringMod?.enabled
        ? 0.25 + 0.75 * evaluateSpringResponse(inPhase, stackState.activeSpringMod)
        : inPhase < 0.65
          ? (inPhase / 0.65) * 1.12
          : 1.12 - ((inPhase - 0.65) / 0.35) * 0.12;
      return {
        opacity: clamp(inPhase * 2.8, 0, 1) * easedOut * stackState.opacityMod,
        scale: Math.max(0.08, baseScale * pop),
        translateY: (1 - clamp(inPhase * 1.5, 0, 1)) * 12,
        rotate: (preset.category === 'sticker' ? -6 : 0) + extraRotationDeg,
      };
    }

    if (typoKind === 'glitch-flicker') {
      const flicker = inPhase < 0.78 ? (Math.sin(currentTime * 68) > -0.35 ? 1 : 0.25) : 1;
      return {
        opacity: flicker * easedOut * stackState.opacityMod,
        scale: baseScale,
        translateY: 0,
        rotate: extraRotationDeg,
      };
    }

    if (animLower === 'constante' || animLower === 'none') {
      return {
        opacity: stackState.opacityMod,
        scale: hasScaleOrSpring ? baseScale * (0.6 + 0.4 * easedIn) : baseScale,
        translateY: 0,
        rotate: extraRotationDeg,
      };
    }
    if (animLower.includes('rebote') || animLower.includes('bounce')) {
      const springIn = stackState.activeSpringMod?.enabled
        ? evaluateSpringResponse(Math.min(1, progress / 0.45), stackState.activeSpringMod)
        : evaluateCurve('elastic', Math.min(1, progress / 0.42), preset.bezier);
      return {
        opacity: Math.min(1, inPhase * 2.2) * easedOut * stackState.opacityMod,
        scale: Math.max(0.08, baseScale * (0.2 + 0.8 * springIn) * (0.85 + 0.15 * easedOut)),
        translateY: (1 - springIn) * 18,
        rotate: (preset.category === 'sticker' ? -9 + (1 - springIn) * -14 : 0) + extraRotationDeg,
      };
    }
    if (animLower.includes('zoom')) {
      return {
        opacity: Math.min(1, easedIn * 1.35) * easedOut * stackState.opacityMod,
        scale: baseScale * (0.76 + 0.24 * easedIn),
        translateY: (1 - easedIn) * 8,
        rotate: extraRotationDeg,
      };
    }
    return {
      opacity: clamp(easedIn, 0, 1) * easedOut * stackState.opacityMod,
      scale: stackState.activeSpringMod?.enabled ? baseScale * (0.7 + 0.3 * easedIn) : baseScale,
      translateY: (1 - Math.min(1, easedIn)) * 12,
      rotate: (preset.category === 'sticker' ? -9 : 0) + extraRotationDeg,
    };
  }, [
    forceBefore,
    easedInGlobal,
    inPhase,
    outPhase,
    preset.bezier,
    typoKind,
    typewriterState,
    baseScale,
    preset.category,
    extraRotationDeg,
    currentTime,
    animLower,
    progress,
    trackOpacity,
    trackPosX,
    trackPosY,
    trackRotation,
    trackScale,
    keyframedOpacity,
    stackState.opacityMod,
    stackState.scaleMult,
    stackState.translateY,
    stackState.rotateDeg,
    stackState.activeSpringMod,
  ]);

  const transitionProgress = evaluateCurve(
    stackState.transitionLayer?.curve ?? curve,
    progress,
    stackState.transitionLayer?.bezier ?? preset.bezier
  );
  const transitionStyle = (stackState.transitionLayer?.kind ?? preset.transitionStyle ?? 'dissolve') as string;
  const transitionDir = String(stackState.transitionLayer?.params.direction ?? 'right');
  const transitionShutter = Number(stackState.transitionLayer?.params.shutterAngle ?? 180);
  const dirVec = getDirectionVector(transitionDir);
  const effectStyle = preset.effectStyle ?? 'glow';
  const midBell = Math.sin(progress * Math.PI);

  const defaultPos = defaultPositionFor(preset.category);
  const typoAlignment = String(stackState.typographyLayer?.params.alignment ?? '');
  const fallbackY =
    typoAlignment === 'center'
      ? 0.5
      : typoAlignment === 'reels-safe'
        ? 0.28
        : typoAlignment === 'lower-third'
          ? 0.18
          : defaultPos.y;
  const staticPosX = clamp(normalizeUnitCoord(preset.positionX, defaultPos.x), 0.08, 0.92);
  const staticPosY = clamp(normalizeUnitCoord(preset.positionY, fallbackY), 0.08, 0.92);
  const evalMotionPos =
    trackPosX || trackPosY
      ? evaluateSpatialMotionPoint(trackPosX, trackPosY, currentTime, staticPosX, staticPosY)
      : { x: staticPosX, y: staticPosY };
  const posX = clamp(evalMotionPos.x, 0.05, 0.95);
  const posY = clamp(evalMotionPos.y, 0.05, 0.95);
  const cssLeft = `${(posX * 100).toFixed(1)}%`;
  const cssTop = `${((1 - posY) * 100).toFixed(1)}%`;

  const glowIntensity =
    stackState.glowBoost > 0 || stackState.halationBoost > 0 || stackState.vignetteBoost > 0
      ? Math.max(stackState.glowBoost, stackState.halationBoost, stackState.vignetteBoost) * 1.3
      : (preset.intensity ?? 0.85) * keyframedOpticalMult;
  const glowSpread = preset.spread ?? 14;
  const pulse = 0.84 + 0.16 * Math.sin(progress * Math.PI * 2);

  const fontFamilyCss = preset.fontFamily ? `'${preset.fontFamily}', var(--display)` : undefined;
  const normalizedTracking = normalizeTrackingSpacing(preset.tracking);
  const trackingEm =
    normalizedTracking !== 1 ? `${((normalizedTracking - 1) * 0.45).toFixed(3)}em` : undefined;
  const defaultBox =
    preset.category === 'subtitle' || preset.category === 'graphic' || preset.category === 'sticker';
  const showBox = typeof preset.backgroundBox === 'boolean' ? preset.backgroundBox : defaultBox;
  const typoOutline = Boolean(stackState.typographyLayer?.params.outline);
  const plateAlphaVal = clamp((preset.plateOpacity ?? 84) / 100, 0.05, 1);
  const plateRadiusVal = preset.plateRadius;

  const shadowParts: string[] = [];
  if (preset.shadow !== false) {
    shadowParts.push('0 8px 22px rgba(0, 0, 0, 0.78), 0 2px 6px rgba(0, 0, 0, 0.65)');
  }
  if (typoOutline) {
    shadowParts.push('-1.2px -1.2px 0 #05070d, 1.2px -1.2px 0 #05070d, -1.2px 1.2px 0 #05070d, 1.2px 1.2px 0 #05070d');
  }
  const textShadowCss = shadowParts.join(', ') || undefined;

  const words = formattedText.split(/\s+/).filter(Boolean);
  const activeWordIdx =
    words.length > 0 ? Math.min(words.length - 1, Math.floor(progress * words.length)) : 0;

  const staggerTokens = useMemo(() => {
    if (!stackState.activeStagger?.enabled) return null;
    return evaluateTextStagger(
      formattedText,
      currentTime,
      duration,
      inRatio,
      stackState.activeStagger
    );
  }, [stackState.activeStagger, formattedText, currentTime, duration, inRatio]);

  function renderKineticTextContent() {
    if (typoKind === 'typewriter' && typewriterState) {
      return (
        <>
          <span>{typewriterState.displayText}</span>
          {typewriterState.cursorVisible && typewriterState.cursorChar && (
            <span
              className={`typewriter-cursor cursor-${typewriterState.cursorColorMode}`}
              aria-hidden="true"
            >
              {typewriterState.cursorChar}
            </span>
          )}
        </>
      );
    }
    if (staggerTokens) {
      return (
        <span className="stagger-text-wrap" style={{ perspective: '420px' }}>
          {staggerTokens.map((item, idx) => (
            <span
              key={idx}
              className="stagger-token"
              style={{
                display: 'inline-block',
                whiteSpace: 'pre',
                opacity: Number(item.opacity.toFixed(3)),
                transform: `translateY(${item.translateY.toFixed(1)}px) rotateX(${item.rotate3dDeg.toFixed(1)}deg)`,
                filter: item.blurPx > 0.2 ? `blur(${item.blurPx.toFixed(1)}px)` : undefined,
              }}
            >
              {item.token}
            </span>
          ))}
        </span>
      );
    }
    return formattedText;
  }

  const canDragOverlay =
    (interactive || interactivePosition) &&
    (['title', 'subtitle', 'graphic', 'sticker'].includes(preset.category) ||
      Boolean(stackState.typographyLayer));

  function snapCoord(value: number, forceThirds: boolean): { value: number; snapped: boolean } {
    const targets = forceThirds ? [0.5, 1 / 3, 2 / 3] : [0.5, 1 / 3, 2 / 3];
    const tol = forceThirds ? 0.045 : 0.025;
    for (const t of targets) {
      if (Math.abs(value - t) <= tol) {
        return { value: Number(t.toFixed(3)), snapped: true };
      }
    }
    return { value, snapped: false };
  }

  function updatePositionFromPointer(event: ReactPointerEvent<HTMLDivElement>) {
    const stage = stageRef.current;
    if (!stage || !onPositionChange) return;
    const rect = stage.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const rawX = clamp((event.clientX - rect.left) / rect.width, 0.08, 0.92);
    const rawYTop = clamp((event.clientY - rect.top) / rect.height, 0.08, 0.92);
    const sx = snapCoord(rawX, event.shiftKey);
    const sy = snapCoord(rawYTop, event.shiftKey);
    setSnapGuide({ x: sx.snapped, y: sy.snapped });
    onPositionChange(Number(sx.value.toFixed(2)), Number((1 - sy.value).toFixed(2)));
  }

  function handleStagePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!canDragOverlay || !onPositionChange) return;
    if (
      (event.target as HTMLElement).closest(
        'button, input, label, select, .preview-split-line, .gizmo-handle, .gizmo-rotate-handle, .gizmo-pivot-handle, .motion-path-handle'
      )
    ) {
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDraggingOverlay(true);
    updatePositionFromPointer(event);
  }

  function updateSplitFromPointer(event: ReactPointerEvent<HTMLDivElement>) {
    const stage = stageRef.current;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    if (rect.width <= 0) return;
    const pct = Math.round(clamp(((event.clientX - rect.left) / rect.width) * 100, 6, 94));
    setSplitPercent(pct);
  }

  function handleSplitPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    event.stopPropagation();
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDraggingSplitWipe(true);
    updateSplitFromPointer(event);
  }

  function handleSplitPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!draggingSplitWipe) return;
    event.stopPropagation();
    updateSplitFromPointer(event);
  }

  function handleSplitPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (!draggingSplitWipe) return;
    event.stopPropagation();
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDraggingSplitWipe(false);
  }

  function handleStagePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (gizmoDrag) {
      event.stopPropagation();
      const stage = stageRef.current;
      if (!stage) return;
      const stageRect = stage.getBoundingClientRect();
      if (gizmoDrag.kind === 'scale' && onScaleChange) {
        const dist = Math.hypot(event.clientX - gizmoDrag.centerX, event.clientY - gizmoDrag.centerY);
        const ratio = clamp(dist / Math.max(12, gizmoDrag.startDist), 0.35, 2.6);
        onScaleChange(Number(clamp(gizmoDrag.startScale * ratio, 0.5, 2.2).toFixed(2)));
      } else if (gizmoDrag.kind === 'rotate' && onRotationChange) {
        const angleRad = Math.atan2(event.clientY - gizmoDrag.centerY, event.clientX - gizmoDrag.centerX);
        let deg = Number(((angleRad * 180) / Math.PI + 90).toFixed(1));
        if (deg > 180) deg -= 360;
        if (event.shiftKey) deg = Math.round(deg / 15) * 15;
        deg = clamp(deg, -45, 45);
        setLiveRotateHud(deg);
        onRotationChange(deg);
      } else if (gizmoDrag.kind === 'pivot' && onPivotChange && overlayAnchorRef.current) {
        const box = overlayAnchorRef.current.getBoundingClientRect();
        if (box.width > 0 && box.height > 0) {
          let px = clamp((event.clientX - box.left) / box.width, 0, 1);
          let pyTop = clamp((event.clientY - box.top) / box.height, 0, 1);
          const sx = snapCoord(px, event.shiftKey);
          const sy = snapCoord(pyTop, event.shiftKey);
          px = sx.value;
          pyTop = sy.value;
          setSnapGuide({ x: sx.snapped, y: sy.snapped });
          onPivotChange(Number(px.toFixed(2)), Number((1 - pyTop).toFixed(2)));
        }
      } else if (gizmoDrag.kind === 'motion-handle' && onMotionPathHandleChange && stageRect.width > 0 && stageRect.height > 0) {
        const ptrX = clamp((event.clientX - stageRect.left) / stageRect.width, 0.02, 0.98);
        const ptrY = clamp(1 - (event.clientY - stageRect.top) / stageRect.height, 0.02, 0.98);
        onMotionPathHandleChange(
          gizmoDrag.keyframeIndex,
          gizmoDrag.handleType,
          Number((ptrX - gizmoDrag.anchorX).toFixed(3)),
          Number((ptrY - gizmoDrag.anchorY).toFixed(3))
        );
      }
      return;
    }

    if (!draggingOverlay || !canDragOverlay || !onPositionChange) return;
    updatePositionFromPointer(event);
  }

  function handleStagePointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (gizmoDrag) {
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      setGizmoDrag(null);
      setLiveRotateHud(null);
      setSnapGuide({ x: false, y: false });
      return;
    }
    if (!draggingOverlay) return;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDraggingOverlay(false);
    setSnapGuide({ x: false, y: false });
  }

  function handleCustomFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (customMedia?.url) URL.revokeObjectURL(customMedia.url);
    const kind = file.type.startsWith('video/') ? 'video' : 'image';
    setCustomMedia({ url: URL.createObjectURL(file), kind, name: file.name });
    setPlaying(true);
    event.target.value = '';
  }

  function togglePlay() {
    if (!playing && currentTime >= duration - 0.02) {
      sfxTriggeredCycleRef.current = -1;
      setSyncedTime(0);
    }
    if (playing) sfxEngineRef.current?.stop();
    setPlaying((prev) => !prev);
  }

  // Transition Shot A -> Shot B physics
  const transBlurPx = (transitionShutter / 360) * midBell * 7.5;
  const shotAStyle: CSSProperties =
    transitionStyle === 'whip' || transitionStyle === 'directional-swish'
      ? {
          transform: `translate(${(-dirVec.dx * transitionProgress * 100).toFixed(1)}%, ${(-dirVec.dy * transitionProgress * 100).toFixed(1)}%) scale(${(1 + midBell * 0.08).toFixed(3)})`,
          filter: transBlurPx > 0.4 ? `blur(${transBlurPx.toFixed(1)}px)` : undefined,
        }
      : transitionStyle === 'zoom'
        ? {
            opacity: Number((1 - transitionProgress).toFixed(3)),
            transform: `scale(${(transitionDir === 'out' ? 1 - transitionProgress * 0.35 : 1 + transitionProgress * 0.52).toFixed(3)})`,
          }
        : transitionStyle === 'spin'
          ? {
              opacity: Number((1 - transitionProgress).toFixed(3)),
              transform: `rotate(${(transitionProgress * Number(stackState.transitionLayer?.params.angleDeg ?? 90)).toFixed(1)}deg) scale(${(1 + midBell * 0.28).toFixed(3)})`,
              filter: transBlurPx > 0.4 ? `blur(${transBlurPx.toFixed(1)}px)` : undefined,
            }
          : transitionStyle === 'luma-fade'
            ? {
                opacity: Number(clamp(1 - transitionProgress * 1.15, 0, 1).toFixed(3)),
                filter: `contrast(${(1 + midBell * 0.45).toFixed(2)}) brightness(${(1 + midBell * 0.25).toFixed(2)})`,
              }
            : { opacity: Number((1 - transitionProgress * 0.88).toFixed(3)) };

  const shotBStyle: CSSProperties =
    transitionStyle === 'whip' || transitionStyle === 'directional-swish'
      ? {
          transform: `translate(${(dirVec.dx * (1 - transitionProgress) * 100).toFixed(1)}%, ${(dirVec.dy * (1 - transitionProgress) * 100).toFixed(1)}%) scale(${(1 + midBell * 0.08).toFixed(3)})`,
          filter: transBlurPx > 0.4 ? `blur(${transBlurPx.toFixed(1)}px)` : undefined,
        }
      : transitionStyle === 'zoom'
        ? {
            opacity: Number(transitionProgress.toFixed(3)),
            transform: `scale(${(transitionDir === 'out' ? 0.72 + 0.28 * transitionProgress : 1.42 - 0.42 * transitionProgress).toFixed(3)})`,
          }
        : transitionStyle === 'spin'
          ? {
              opacity: Number(transitionProgress.toFixed(3)),
              transform: `rotate(${(-(1 - transitionProgress) * Number(stackState.transitionLayer?.params.angleDeg ?? 90)).toFixed(1)}deg) scale(${(1.24 - 0.24 * transitionProgress).toFixed(3)})`,
              filter: transBlurPx > 0.4 ? `blur(${transBlurPx.toFixed(1)}px)` : undefined,
            }
          : {
              opacity: Number(transitionProgress.toFixed(3)),
              transform: `scale(${(1.06 - 0.06 * transitionProgress).toFixed(3)})`,
            };

  const splitActive = large && splitCompare && !forceBefore;
  const canCompare =
    large ||
    preset.category === 'effect' ||
    activeLayers.some((l) => l.type === 'vfx' || l.type === 'motion') ||
    Boolean(parsedLut);

  // Accumulated motion & optical filter for the scene rig
  const totalRigScale =
    stackState.scaleMult * stackState.lensScale * (stackState.pipFrame?.scale ?? 1);
  const rigHasTransform =
    !forceBefore &&
    (Math.abs(totalRigScale - 1) > 0.002 ||
      Math.abs(stackState.translateX) > 0.1 ||
      Math.abs(stackState.translateY) > 0.1 ||
      Math.abs(stackState.rotateDeg) > 0.05 ||
      Boolean(stackState.pipFrame));

  const totalSceneBlur = stackState.motionBlurPx + stackState.gaussianBlurPx;
  const fallbackLutCss = !lutMatrixValues ? evaluateLutCssFilter(parsedLut, preset.lutMix ?? 75) : '';
  const rigFilterParts = forceBefore
    ? []
    : [
        totalSceneBlur > 0.2 ? `blur(${totalSceneBlur.toFixed(2)}px)` : '',
        lutMatrixValues ? `url(#${lutFilterId})` : fallbackLutCss,
      ].filter(Boolean);

  const hasOverlayAnchor =
    ['title', 'subtitle', 'graphic', 'sticker'].includes(preset.category) ||
    Boolean(stackState.typographyLayer);

  const activeBlendCss = (!forceBefore ? blendModeToCss(stackState.activeBlendMode) : undefined) as
    | CSSProperties['mixBlendMode']
    | undefined;
  const maskRevealResult = !forceBefore
    ? evaluateMaskReveal(stackState.activeMaskReveal, progress, inRatio, outRatio)
    : { revealAmount: 1 };
  const trimStroke = !forceBefore
    ? computeTrimPathStroke(stackState.activeTrimPaths, progress, inRatio, 100)
    : null;

  const motionPathData = useMemo(() => {
    if (!interactive || forceBefore || !trackPosX || !trackPosY) return null;
    const xKfs = sortKeyframes(trackPosX.keyframes);
    const yKfs = sortKeyframes(trackPosY.keyframes);
    if (xKfs.length < 2 || yKfs.length < 2) return null;
    const tStart = Math.min(xKfs[0].time, yKfs[0].time);
    const tEnd = Math.max(xKfs[xKfs.length - 1].time, yKfs[yKfs.length - 1].time);
    const samples = 28;
    const points: Array<{ x: number; y: number }> = [];
    for (let i = 0; i <= samples; i += 1) {
      const t = tStart + ((tEnd - tStart) * i) / samples;
      const pt = evaluateSpatialMotionPoint(trackPosX, trackPosY, t, staticPosX, staticPosY);
      points.push({ x: clamp(pt.x, 0.02, 0.98) * 100, y: clamp(1 - pt.y, 0.02, 0.98) * 100 });
    }
    const d = points
      .map((pt, idx) => `${idx === 0 ? 'M' : 'L'} ${pt.x.toFixed(2)} ${pt.y.toFixed(2)}`)
      .join(' ');
    const count = Math.min(xKfs.length, yKfs.length);
    const waypoints = Array.from({ length: count }, (_, idx) => {
      const kx = clamp(xKfs[idx].value, 0.02, 0.98);
      const ky = clamp(yKfs[idx].value, 0.02, 0.98);
      const nextIdx = Math.min(count - 1, idx + 1);
      const defaultOutX = idx < count - 1 ? (xKfs[nextIdx].value - kx) * 0.28 : 0.06;
      const defaultOutY = idx < count - 1 ? (yKfs[nextIdx].value - ky) * 0.28 : 0.04;
      const outDx = xKfs[idx].spatialOut?.dx ?? defaultOutX;
      const outDy = yKfs[idx].spatialOut?.dy ?? defaultOutY;
      return {
        index: idx,
        kx,
        ky,
        svgX: kx * 100,
        svgY: (1 - ky) * 100,
        handleOutX: clamp(kx + outDx, 0.02, 0.98) * 100,
        handleOutY: clamp(1 - (ky + outDy), 0.02, 0.98) * 100,
      };
    });
    return { d, waypoints };
  }, [interactive, forceBefore, trackPosX, trackPosY, staticPosX, staticPosY]);

  function startGizmoDrag(
    event: ReactPointerEvent<HTMLElement>,
    kind: 'scale' | 'rotate' | 'pivot'
  ) {
    event.stopPropagation();
    event.preventDefault();
    const anchorEl = overlayAnchorRef.current;
    const stageEl = stageRef.current;
    if (!stageEl || !anchorEl) return;
    stageEl.setPointerCapture?.(event.pointerId);
    const box = anchorEl.getBoundingClientRect();
    const centerX = box.left + box.width * (anchorPivot.cssX / 100);
    const centerY = box.top + box.height * (anchorPivot.cssY / 100);
    if (kind === 'scale') {
      const startDist = Math.max(12, Math.hypot(event.clientX - centerX, event.clientY - centerY));
      setGizmoDrag({ kind: 'scale', startDist, startScale: baseScale, centerX, centerY });
    } else if (kind === 'rotate') {
      setLiveRotateHud(Number(extraRotationDeg.toFixed(1)));
      setGizmoDrag({ kind: 'rotate', centerX, centerY });
    } else {
      setGizmoDrag({ kind: 'pivot' });
    }
  }

  function renderTrimPathSvg() {
    if (!trimStroke) return null;
    return (
      <svg
        className="trim-path-overlay-svg"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <rect
          x="1.5"
          y="1.5"
          width="97"
          height="97"
          rx="4"
          pathLength={100}
          fill="none"
          stroke={preset.secondaryAccent || preset.accent || '#22d3ee'}
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeDasharray={trimStroke.dasharray}
          strokeDashoffset={trimStroke.dashoffset}
        />
      </svg>
    );
  }

  function renderViewportGizmo() {
    if (!interactive || !canDragOverlay || forceBefore) return null;
    return (
      <div className="viewport-transform-gizmo" data-testid="viewport-transform-gizmo">
        {(['nw', 'ne', 'sw', 'se'] as const).map((corner) => (
          <button
            key={corner}
            type="button"
            className={`gizmo-handle gizmo-handle-${corner}`}
            aria-label={`Escalar capa (${corner.toUpperCase()})`}
            title="Arrastra para escalar"
            onPointerDown={(event) => startGizmoDrag(event, 'scale')}
          />
        ))}
        <div className="gizmo-rotate-arm" aria-hidden={false}>
          <span className="gizmo-rotate-stem" />
          <button
            type="button"
            className="gizmo-rotate-handle"
            aria-label="Rotar capa"
            title="Arrastra para rotar (Shift: pasos de 15°)"
            onPointerDown={(event) => startGizmoDrag(event, 'rotate')}
          />
          {liveRotateHud !== null && (
            <span className="gizmo-rotate-hud">
              {liveRotateHud > 0 ? `+${liveRotateHud}` : liveRotateHud}°
            </span>
          )}
        </div>
        <button
          type="button"
          className="gizmo-pivot-handle"
          style={{ left: `${anchorPivot.cssX}%`, top: `${anchorPivot.cssY}%` }}
          aria-label="Mover punto de anclaje (Pivot)"
          title="Arrastra para mover Pivot (Shift: encajar)"
          onPointerDown={(event) => startGizmoDrag(event, 'pivot')}
        >
          <span className="pivot-cross-h" />
          <span className="pivot-cross-v" />
        </button>
      </div>
    );
  }

  const rigOriginCss =
    stackState.anchorX !== 50 || stackState.anchorY !== 50
      ? `${stackState.anchorX}% ${stackState.anchorY}%`
      : anchorPivot.cssOrigin;

  const rigStyle: CSSProperties = {
    transformOrigin: rigOriginCss,
    transform: rigHasTransform
      ? `translate3d(${stackState.translateX.toFixed(1)}px, ${stackState.translateY.toFixed(1)}px, 0) scale(${totalRigScale.toFixed(3)}) rotate(${stackState.rotateDeg.toFixed(2)}deg)`
      : undefined,
    filter: rigFilterParts.length > 0 ? rigFilterParts.join(' ') : undefined,
    mixBlendMode: !hasOverlayAnchor ? activeBlendCss : undefined,
    WebkitMaskImage: !hasOverlayAnchor ? maskRevealResult.maskImage : undefined,
    maskImage: !hasOverlayAnchor ? maskRevealResult.maskImage : undefined,
    borderRadius: !forceBefore && stackState.pipFrame ? `${stackState.pipFrame.radius}px` : undefined,
    border:
      !forceBefore && stackState.pipFrame && stackState.pipFrame.width > 0
        ? `${stackState.pipFrame.width}px solid ${preset.secondaryAccent || preset.accent || '#7c5cff'}`
        : undefined,
    boxShadow:
      !forceBefore && stackState.pipFrame
        ? `0 16px ${Math.round(stackState.pipFrame.shadow)}px rgba(0, 0, 0, 0.78)`
        : undefined,
  };

  const plateCustomStyle: CSSProperties | undefined = !showBox
    ? { background: 'transparent', border: '0', boxShadow: 'none', backdropFilter: 'none' }
    : preset.secondaryAccent || plateRadiusVal !== undefined || preset.plateOpacity !== undefined
      ? {
          borderRadius: plateRadiusVal !== undefined ? `${plateRadiusVal}px` : undefined,
          background: preset.secondaryAccent
            ? `linear-gradient(135deg, color-mix(in srgb, ${preset.accent || '#7c5cff'} 28%, rgba(9, 12, 22, ${plateAlphaVal})), color-mix(in srgb, ${preset.secondaryAccent} 30%, rgba(9, 12, 22, ${plateAlphaVal})))`
            : `rgba(9, 12, 22, ${plateAlphaVal})`,
        }
      : undefined;

  const ratioClass =
    large && aspectRatio !== '16:9' ? ` artwork-ratio-${aspectRatio.replace(':', '-')}` : '';

  const inMarkerPct = clamp(inRatio * 100, 5, 48);
  const outMarkerPct = clamp((1 - outRatio) * 100, 52, 95);
  const sfxLeftPct = clamp((sfxTriggerSec / duration) * 100, 0, 92);
  const sfxWidthPct = clamp((sfxDurationSec / duration) * 100, 8, 100 - sfxLeftPct);

  const effectiveEffectStyle =
    stackState.halationBoost > 0
      ? 'halation'
      : stackState.vignetteBoost > 0
        ? 'vignette'
        : effectStyle;

  return (
    <div className={`preview-player${large ? ' preview-player-large' : ' preview-player-card'}`}>
      {lutMatrixValues && (
        <svg width="0" height="0" style={{ position: 'absolute', pointerEvents: 'none' }} aria-hidden="true">
          <defs>
            <filter id={lutFilterId} colorInterpolationFilters="sRGB">
              <feColorMatrix type="matrix" values={lutMatrixValues} />
            </filter>
          </defs>
        </svg>
      )}

      {large && onAspectRatioChange && (
        <div className="preview-studio-toolbar">
          <div className="aspect-ratio-group" role="group" aria-label="Relación de aspecto">
            {(['16:9', '9:16', '4:5', '1:1'] as AspectRatioPreset[]).map((ratio) => (
              <button
                key={ratio}
                type="button"
                className={`aspect-chip${aspectRatio === ratio ? ' is-active' : ''}`}
                onClick={() => onAspectRatioChange(ratio)}
              >
                {ratio}
              </button>
            ))}
          </div>

          <div className="preview-guide-toggles">
            <button
              type="button"
              className={`guide-chip${showSafeZones ? ' is-active' : ''}`}
              onClick={() => setShowSafeZones((prev) => !prev)}
              title="Zonas seguras Reels / TikTok"
            >
              <ShieldCheck size={12} />
              <span>Zonas seguras</span>
            </button>
            <button
              type="button"
              className={`guide-chip${showRuleOfThirds ? ' is-active' : ''}`}
              onClick={() => setShowRuleOfThirds((prev) => !prev)}
              title="Cuadrícula de tercios"
            >
              <Grid3x3 size={12} />
              <span>Tercios</span>
            </button>
            <button
              type="button"
              className={`guide-chip${splitCompare ? ' is-active' : ''}`}
              onClick={() => setSplitCompare((prev) => !prev)}
              title="Cortinilla Divisoria Antes / Después"
              aria-label="Cortinilla Antes y Después"
            >
              <Columns2 size={12} />
              <span>Cortinilla</span>
            </button>
            {stackState.speedMultiplier !== 1 && (
              <span className="speed-ramp-pill">{stackState.speedMultiplier.toFixed(1)}× VEL</span>
            )}
          </div>
        </div>
      )}

      <div className={large && aspectRatio !== '16:9' ? 'artwork-stage-viewport' : undefined}>
        <div
          ref={stageRef}
          className={`artwork artwork-${preset.category}${large ? ' artwork-large' : ''}${canDragOverlay ? ' artwork-draggable' : ''}${preset.secondaryAccent ? ' has-dual-accent' : ''}${ratioClass}`}
          style={
            {
              '--accent': preset.accent || '#7c5cff',
              '--accent-secondary': preset.secondaryAccent || preset.accent || '#7c5cff',
            } as CSSProperties
          }
          data-testid={large ? 'interactive-preview-stage' : undefined}
          onPointerDown={canDragOverlay ? handleStagePointerDown : undefined}
          onPointerMove={canDragOverlay ? handleStagePointerMove : undefined}
          onPointerUp={canDragOverlay ? handleStagePointerUp : undefined}
          onPointerCancel={canDragOverlay ? handleStagePointerUp : undefined}
        >
          {/* Base scene when split comparator is active (unfiltered left side) */}
          {splitActive && (
            <div className="preview-scene-rig is-before-base">
              {customMedia?.kind === 'video' && (
                <video src={customMedia.url} className="preview-bg-media" muted loop playsInline />
              )}
              {customMedia?.kind === 'image' && (
                <img src={customMedia.url} alt="" className="preview-bg-media" />
              )}
              {!customMedia && embeddedPreviewUrl && (
                <img src={embeddedPreviewUrl} alt="" className="preview-bg-media" />
              )}
              {!customMedia && !embeddedPreviewUrl && ['title', 'subtitle', 'graphic'].includes(preset.category) && (
                <>
                  <div className="art-horizon" />
                  <div className="art-sun" />
                </>
              )}
            </div>
          )}

          {/* Active Motion + Optical Rig */}
          <div
            className="preview-scene-rig"
            style={{
              ...rigStyle,
              clipPath: splitActive
                ? `inset(0 0 0 ${splitPercent}%)`
                : !hasOverlayAnchor
                  ? maskRevealResult.clipPath
                  : undefined,
            }}
          >
            {customMedia?.kind === 'video' && (
              <video
                ref={videoRef}
                src={customMedia.url}
                className="preview-bg-media"
                muted
                loop
                playsInline
              />
            )}
            {customMedia?.kind === 'image' && (
              <img src={customMedia.url} alt="" className="preview-bg-media" />
            )}
            {!customMedia && embeddedPreviewUrl && (
              <img src={embeddedPreviewUrl} alt="" className="preview-bg-media" />
            )}

            {/* TRANSITION RENDERER */}
            {preset.category === 'transition' && (
              <>
                <div className="preview-shot preview-shot-a" style={forceBefore ? undefined : shotAStyle}>
                  {!customMedia && <span className="shot-badge">CLIP A</span>}
                </div>
                {!forceBefore && (
                  <div className="preview-shot preview-shot-b" style={shotBStyle}>
                    {!customMedia && <span className="shot-badge shot-badge-b">CLIP B</span>}
                  </div>
                )}
                {!forceBefore && transitionStyle === 'flash' && (
                  <div
                    className="preview-flash-burst"
                    style={{
                      opacity: Number(Math.min(1, midBell ** 1.4 * (0.65 + glowIntensity * 0.35)).toFixed(3)),
                    }}
                  />
                )}
                {!forceBefore && transitionStyle === 'glitch' && (
                  <div
                    className="preview-vfx-rgb"
                    style={{
                      opacity: midBell,
                      boxShadow: `inset ${(midBell * 20).toFixed(1)}px 0 0 rgba(255, 40, 95, 0.55), inset -${(midBell * 20).toFixed(1)}px 0 0 rgba(34, 211, 238, 0.55)`,
                    }}
                  />
                )}
                {!forceBefore && (
                  <>
                    <div
                      className="preview-transition-flare"
                      style={{
                        left: `${(-15 + transitionProgress * 130).toFixed(1)}%`,
                        opacity: Number((midBell * 0.92).toFixed(3)),
                      }}
                    />
                    <div className="art-beam" style={{ opacity: Number((0.35 + midBell * 0.65).toFixed(3)) }} />
                  </>
                )}
              </>
            )}

            {/* EFFECT RENDERER (Native Effect Category OR Stacked Glow/Halation/Vignette Layers) */}
            {!forceBefore &&
              (preset.category === 'effect' ||
                stackState.glowBoost > 0 ||
                stackState.halationBoost > 0 ||
                stackState.vignetteBoost > 0) && (
                <div
                  className={`preview-effect-layer preview-effect-${effectiveEffectStyle}`}
                  style={{
                    opacity:
                      effectiveEffectStyle === 'vignette'
                        ? 1
                        : Number(Math.min(1, 0.35 + glowIntensity * 0.55).toFixed(3)),
                  }}
                >
                  {effectiveEffectStyle === 'vignette' && stackState.glowBoost === 0 && stackState.halationBoost === 0 ? (
                    <>
                      <div
                        className="preview-vignette-mask"
                        style={{
                          background: `radial-gradient(ellipse at 50% 50%, transparent ${Math.max(20, 62 - glowSpread)}%, rgba(3, 5, 11, ${Math.min(0.95, 0.45 + glowIntensity * 0.42).toFixed(2)}) 100%)`,
                        }}
                      />
                      {preset.category === 'effect' && <div className="art-center-orb" style={{ opacity: 0.72 }} />}
                    </>
                  ) : (
                    <>
                      <div
                        className="art-light art-light-one"
                        style={{
                          background: effectiveEffectStyle === 'halation' ? '#fb7185' : undefined,
                          transform: `scale(${(pulse * (0.85 + glowSpread / 40)).toFixed(3)})`,
                          filter: `blur(${Math.round(12 + glowSpread * 0.8)}px)`,
                        }}
                      />
                      <div
                        className="art-light art-light-two"
                        style={{
                          background: effectiveEffectStyle === 'halation' ? '#f97316' : undefined,
                          transform: `scale(${((2 - pulse) * 0.95).toFixed(3)})`,
                          filter: `blur(${Math.round(14 + glowSpread * 0.9)}px)`,
                        }}
                      />
                      {preset.category === 'effect' && (
                        <div
                          className="art-center-orb"
                          style={{
                            boxShadow:
                              effectiveEffectStyle === 'halation'
                                ? '0 0 38px rgba(251, 113, 133, 0.8), 0 0 14px rgba(249, 115, 22, 0.75)'
                                : undefined,
                            transform: `scale(${(0.92 + 0.14 * Math.sin(progress * Math.PI * 2)).toFixed(3)})`,
                          }}
                        />
                      )}
                      {stackState.vignetteBoost > 0 && (
                        <div
                          className="preview-vignette-mask"
                          style={{
                            background: `radial-gradient(ellipse at 50% 50%, transparent 38%, rgba(3, 5, 11, ${(0.35 + stackState.vignetteBoost * 0.55).toFixed(2)}) 100%)`,
                          }}
                        />
                      )}
                    </>
                  )}
                </div>
              )}

            {/* HORIZON & SUN BACKDROP FOR TITLES / SUBTITLES / GRAPHICS */}
            {!customMedia && !embeddedPreviewUrl && ['title', 'subtitle', 'graphic'].includes(preset.category) && (
              <>
                <div className="art-horizon" />
                <div className="art-sun" />
              </>
            )}

            {/* EXTRA STACKED VFX OVERLAYS (RGB Split, Scanlines, Analog Grain) */}
            {!forceBefore && stackState.rgbSplitPx > 0.4 && (
              <div
                className="preview-vfx-rgb"
                style={{
                  boxShadow: `inset ${stackState.rgbSplitPx.toFixed(1)}px 0 0 rgba(255, 38, 88, 0.38), inset -${stackState.rgbSplitPx.toFixed(1)}px 0 0 rgba(34, 211, 238, 0.38)`,
                }}
              />
            )}
            {!forceBefore && stackState.vhsScanlines > 0 && (
              <div className="preview-vfx-scanlines" style={{ opacity: stackState.vhsScanlines }} />
            )}
            {!forceBefore && stackState.pipFrame && renderTrimPathSvg()}
          </div>

          <div
            className="artwork-grain"
            style={
              !forceBefore && stackState.grainBoost > 0
                ? {
                    opacity: clamp(0.12 + stackState.grainBoost, 0.12, 0.65),
                    transform: `scale(${stackState.grainScale})`,
                  }
                : undefined
            }
          />

          {/* GUIDES & SAFE ZONES */}
          {canDragOverlay && (
            <div className="preview-safe-guides" aria-hidden="true">
              <span className="safe-crosshair-h" />
              <span className="safe-crosshair-v" />
            </div>
          )}
          {large && showRuleOfThirds && (
            <div className="preview-thirds-grid" aria-hidden="true">
              <span className="thirds-v1" />
              <span className="thirds-v2" />
              <span className="thirds-h1" />
              <span className="thirds-h2" />
            </div>
          )}
          {large && showSafeZones && (
            <div className="preview-safe-zones" aria-hidden="true">
              <div className="safe-zone-box">
                <span>Zona segura Reels / TikTok</span>
              </div>
            </div>
          )}
          {draggingOverlay && (snapGuide.x || snapGuide.y) && (
            <div className="preview-snap-guides" aria-hidden="true">
              {snapGuide.x && <span className="snap-line-v" />}
              {snapGuide.y && <span className="snap-line-h" />}
            </div>
          )}

          {/* INTERACTIVE SPLIT WIPE COMPARATOR LINE */}
          {splitActive && (
            <div
              className={`preview-split-line is-draggable${draggingSplitWipe ? ' is-dragging' : ''}`}
              style={{ left: `${splitPercent}%` }}
              role="slider"
              aria-label="Cortinilla divisoria antes y después"
              aria-valuemin={6}
              aria-valuemax={94}
              aria-valuenow={splitPercent}
              onPointerDown={handleSplitPointerDown}
              onPointerMove={handleSplitPointerMove}
              onPointerUp={handleSplitPointerUp}
              onPointerCancel={handleSplitPointerUp}
            >
              <span className="split-tag split-tag-before">ORIGINAL</span>
              <span className="split-wipe-handle" aria-hidden="true">↔</span>
              <span className="split-tag split-tag-after">EFECTO</span>
            </div>
          )}

          {/* TELEMETRY / HUD MARK */}
          {preset.category === 'transition' && (
            <span className="art-mark art-mark-transition">
              {Math.round(transitionProgress * 100).toString().padStart(2, '0')}% · {transitionStyle.toUpperCase()}
            </span>
          )}
          {preset.category === 'effect' && (
            <span className="art-mark art-mark-effect">
              {(activeLayers.length > 1 ? `${activeLayers.length} CAPAS` : effectiveEffectStyle.toUpperCase())} · F
              {String(Math.max(1, Math.round(progress * duration * 24))).padStart(3, '0')}
            </span>
          )}

          {/* SPATIAL MOTION PATH OVERLAY */}
          {motionPathData && (
            <svg
              className="viewport-motion-path-svg"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              data-testid="viewport-motion-path"
            >
              <path
                d={motionPathData.d}
                className="motion-path-curve"
                vectorEffect="non-scaling-stroke"
              />
              {motionPathData.waypoints.map((wp, idx) => (
                <g key={idx}>
                  {idx < motionPathData.waypoints.length - 1 && onMotionPathHandleChange && (
                    <>
                      <line
                        x1={wp.svgX}
                        y1={wp.svgY}
                        x2={wp.handleOutX}
                        y2={wp.handleOutY}
                        className="motion-path-handle-line"
                        vectorEffect="non-scaling-stroke"
                      />
                      <circle
                        cx={wp.handleOutX}
                        cy={wp.handleOutY}
                        r="1.3"
                        className="motion-path-handle"
                        onPointerDown={(event) => {
                          event.stopPropagation();
                          event.preventDefault();
                          stageRef.current?.setPointerCapture?.(event.pointerId);
                          setGizmoDrag({
                            kind: 'motion-handle',
                            keyframeIndex: wp.index,
                            handleType: 'out',
                            anchorX: wp.kx,
                            anchorY: wp.ky,
                          });
                        }}
                      />
                    </>
                  )}
                  <circle
                    cx={wp.svgX}
                    cy={wp.svgY}
                    r="1.4"
                    className="motion-path-waypoint"
                  />
                </g>
              ))}
            </svg>
          )}

          {interactive && autoKeyframe && !forceBefore && (
            <span className="viewport-rec-pill" title="Auto-Keyframe activo">
              ● REC
            </span>
          )}

          {/* OVERLAY WIPE PLANE (Clips Titles / Subtitles / Graphics / Stickers along Split Wipe) */}
          <div
            className="preview-overlay-wipe-plane"
            style={{
              clipPath: splitActive ? `inset(0 0 0 ${splitPercent}%)` : undefined,
            }}
          >
            {(['title', 'subtitle', 'graphic'].includes(preset.category) ||
              (preset.category !== 'sticker' && Boolean(stackState.typographyLayer))) &&
              !forceBefore && (
              <div
                ref={overlayAnchorRef}
                className={`preview-overlay-anchor preview-overlay-${preset.category}`}
                style={{
                  left: cssLeft,
                  top: cssTop,
                  opacity: Number(overlayMotion.opacity.toFixed(3)),
                  transformOrigin: anchorPivot.cssOrigin,
                  transform: `translate(-${anchorPivot.cssX}%, -${anchorPivot.cssY}%) translateY(${overlayMotion.translateY.toFixed(1)}px) scale(${overlayMotion.scale.toFixed(3)}) rotate(${overlayMotion.rotate.toFixed(1)}deg)`,
                  filter: preset.shadow && showBox ? 'drop-shadow(0 10px 22px rgba(0,0,0,0.68))' : undefined,
                  mixBlendMode: activeBlendCss,
                  clipPath: maskRevealResult.clipPath,
                  WebkitMaskImage: maskRevealResult.maskImage,
                  maskImage: maskRevealResult.maskImage,
                }}
              >
                {preset.category === 'subtitle' || typoKind === 'karaoke' ? (
                  <div
                    className="preview-subtitle-pill"
                    style={plateCustomStyle}
                  >
                    {renderTrimPathSvg()}
                    {typoKind === 'karaoke' ? (
                      <span className="karaoke-words" style={{ fontFamily: fontFamilyCss, letterSpacing: trackingEm }}>
                        {words.map((word, idx) => (
                          <span
                            key={`${word}-${idx}`}
                            className={`karaoke-word${idx === activeWordIdx ? ' is-active' : ''}`}
                            style={{ textShadow: idx === activeWordIdx ? 'none' : textShadowCss }}
                          >
                            {word}
                          </span>
                        ))}
                      </span>
                    ) : (
                      <strong style={{ fontFamily: fontFamilyCss, letterSpacing: trackingEm, textShadow: textShadowCss }}>
                        {renderKineticTextContent()}
                      </strong>
                    )}
                  </div>
                ) : preset.category === 'graphic' ? (
                  <div
                    className="preview-lower-third"
                    style={plateCustomStyle}
                  >
                    {renderTrimPathSvg()}
                    <span className="lower-third-bar" />
                    <div className="lower-third-copy">
                      <span className="art-eyebrow">FRAMEBASE GRAPHICS</span>
                      <strong style={{ fontFamily: fontFamilyCss, letterSpacing: trackingEm, textShadow: textShadowCss }}>
                        {renderKineticTextContent()}
                      </strong>
                    </div>
                  </div>
                ) : (
                  <div
                    className={`preview-title-block${showBox ? ' preview-title-boxed' : ''}`}
                    style={
                      showBox
                        ? plateCustomStyle
                        : {
                            alignItems:
                              anchorPivot.fusionX === 0
                                ? 'flex-start'
                                : anchorPivot.fusionX === 1
                                  ? 'flex-end'
                                  : 'center',
                            textAlign:
                              anchorPivot.fusionX === 0
                                ? 'left'
                                : anchorPivot.fusionX === 1
                                  ? 'right'
                                  : 'center',
                          }
                    }
                  >
                    {renderTrimPathSvg()}
                    <span className="art-eyebrow">FRAMEBASE STUDIO</span>
                    <strong style={{ fontFamily: fontFamilyCss, letterSpacing: trackingEm, textShadow: textShadowCss }}>
                      {renderKineticTextContent()}
                    </strong>
                    <span className="art-underline" />
                  </div>
                )}
                {renderViewportGizmo()}
              </div>
            )}

            {/* STICKER RENDERER */}
            {preset.category === 'sticker' && !forceBefore && (
              <div
                ref={overlayAnchorRef}
                className="preview-overlay-anchor preview-overlay-sticker"
                style={{
                  left: cssLeft,
                  top: cssTop,
                  opacity: Number(overlayMotion.opacity.toFixed(3)),
                  transformOrigin: anchorPivot.cssOrigin,
                  transform: `translate(-${anchorPivot.cssX}%, -${anchorPivot.cssY}%) translateY(${overlayMotion.translateY.toFixed(1)}px) scale(${overlayMotion.scale.toFixed(3)}) rotate(${overlayMotion.rotate.toFixed(1)}deg)`,
                  filter: preset.shadow ? 'drop-shadow(0 12px 24px rgba(0,0,0,0.72))' : undefined,
                  mixBlendMode: activeBlendCss,
                  clipPath: maskRevealResult.clipPath,
                  WebkitMaskImage: maskRevealResult.maskImage,
                  maskImage: maskRevealResult.maskImage,
                }}
              >
                <div className="preview-sticker-badge">
                  {renderTrimPathSvg()}
                  {showBox && (
                    <div className="preview-sticker-icon">
                      <Sparkles size={large ? 34 : 24} fill="currentColor" />
                    </div>
                  )}
                  <strong
                    className="preview-sticker-label"
                    style={{ fontFamily: fontFamilyCss, letterSpacing: trackingEm }}
                  >
                    {formattedText}
                  </strong>
                </div>
                {renderViewportGizmo()}
              </div>
            )}
          </div>

          <span className="art-format-label">
            {forceBefore ? 'ANTES' : preset.category === 'title' ? 'T+' : preset.category.toUpperCase()}
          </span>

          {large && (
            <button
              className="art-play"
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                togglePlay();
              }}
              aria-label={playing ? 'Pausar vista previa' : 'Reproducir vista previa'}
            >
              {playing ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}
            </button>
          )}

          {!large && (
            <div className="card-progress-track" aria-hidden="true">
              <span style={{ width: `${(progress * 100).toFixed(1)}%` }} />
            </div>
          )}
        </div>
      </div>

      {large && (
        <div className="preview-transport" data-testid="preview-transport">
          <button
            type="button"
            className="transport-btn transport-btn-primary"
            onClick={togglePlay}
            aria-label={playing ? 'Pausar animación' : 'Reproducir animación'}
            title={playing ? 'Pausar (Espacio)' : 'Reproducir (Espacio)'}
          >
            {playing ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}
          </button>
          <button
            type="button"
            className="transport-btn"
            onClick={() => {
              sfxTriggeredCycleRef.current = -1;
              setSyncedTime(0);
              setPlaying(true);
            }}
            aria-label="Reiniciar vista previa"
            title="Reiniciar"
          >
            <RotateCcw size={13} />
          </button>

          <div className="transport-scrubber-wrap">
            <div className="transport-phase-markers" aria-hidden="true">
              <span className="phase-mark" style={{ left: `${inMarkerPct}%` }} title="Fin Entrada (In)" />
              <span className="phase-mark" style={{ left: `${outMarkerPct}%` }} title="Inicio Salida (Out)" />
            </div>
            <input
              type="range"
              className="transport-scrubber"
              min="0"
              max={duration}
              step="0.02"
              value={Math.min(duration, currentTime)}
              aria-label="Línea de tiempo de vista previa"
              onChange={(event) => {
                setPlaying(false);
                sfxEngineRef.current?.stop();
                setSyncedTime(Number(event.target.value));
              }}
            />
            {preset.audioSfx && preset.audioSfx.sfxId !== 'none' && (
              <div className="transport-sfx-lane" aria-hidden="true">
                <div
                  className="transport-sfx-waveform"
                  style={{ left: `${sfxLeftPct}%`, width: `${sfxWidthPct}%` }}
                >
                  {sfxPeaks.map((peak, idx) => (
                    <span key={idx} style={{ height: `${Math.round(peak * 100)}%` }} />
                  ))}
                </div>
              </div>
            )}
          </div>

          <span className="transport-timecode">
            {formatSeconds(currentTime)} / {formatSeconds(duration)}
          </span>

          {preset.audioSfx && preset.audioSfx.sfxId !== 'none' && (
            <button
              type="button"
              className={`transport-btn${!sfxMuted ? ' is-active' : ''}`}
              onClick={() => setSfxMuted((prev) => !prev)}
              aria-label={sfxMuted ? 'Activar audio SFX' : 'Silenciar audio SFX'}
              title={sfxMuted ? 'Activar SFX' : 'Silenciar SFX'}
            >
              {sfxMuted ? <VolumeX size={13} /> : <Volume2 size={13} />}
            </button>
          )}

          <button
            type="button"
            className={`transport-btn${loop ? ' is-active' : ''}`}
            onClick={() => setLoop((prev) => !prev)}
            aria-label="Repetir en bucle"
            title="Repetir en bucle"
          >
            <Repeat size={13} />
          </button>

          {canCompare && (
            <button
              type="button"
              className={`transport-btn${splitCompare ? ' is-active' : ''}`}
              onClick={() => setSplitCompare((prev) => !prev)}
              aria-label="Comparar antes y después"
              title="Comparar antes y después"
            >
              <Columns2 size={13} />
            </button>
          )}

          <label htmlFor={fileInputId} className="transport-clip-picker" title="Probar preset sobre un video o imagen de tu equipo">
            <Film size={12} />
            <span>{customMedia ? 'Cambiar clip' : 'Mi clip'}</span>
          </label>
          <input
            id={fileInputId}
            type="file"
            accept="video/*,image/*"
            className="visually-hidden"
            onChange={handleCustomFileChange}
          />
          {customMedia && (
            <button
              type="button"
              className="transport-btn"
              onClick={() => {
                URL.revokeObjectURL(customMedia.url);
                setCustomMedia(null);
              }}
              aria-label="Quitar clip de fondo"
              title="Restaurar fondo de estudio"
            >
              <X size={13} />
            </button>
          )}
        </div>
      )}

      {splitActive && (
        <div className="split-slider-bar">
          <span>División Antes / Después</span>
          <input
            type="range"
            min="10"
            max="90"
            value={splitPercent}
            aria-label="Ajustar división antes y después"
            onChange={(event) => setSplitPercent(Number(event.target.value))}
          />
          <span>{splitPercent}%</span>
        </div>
      )}
    </div>
  );
}
