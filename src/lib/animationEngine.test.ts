import { describe, expect, it } from 'vitest';
import type { KeyframeTrack } from '../domain/preset';
import {
  bakeSpringKeyframes,
  blendModeToCss,
  computeTrimPathStroke,
  evaluateKeyframeTrack,
  evaluateLfo,
  evaluateMaskReveal,
  evaluateSpatialMotionPoint,
  evaluateSpringResponse,
  evaluateTextStagger,
  evaluateWiggle,
  resolveLfoFrequencyHz,
} from './animationEngine';

describe('Real-time physics, procedural modulators & multi-track animation engine', () => {
  it('computes damped Hooke spring overshoot and bakes discrete spline frames', () => {
    const atZero = evaluateSpringResponse(0, { stiffness: 320, damping: 14, mass: 1 });
    const atEnd = evaluateSpringResponse(1, { stiffness: 320, damping: 14, mass: 1 });
    expect(atZero).toBe(0);
    expect(atEnd).toBe(1);

    // Underdamped spring must overshoot past 1.0 before settling
    const samples = Array.from({ length: 20 }, (_, idx) =>
      evaluateSpringResponse((idx + 1) / 20, { stiffness: 340, damping: 12, mass: 1 })
    );
    expect(Math.max(...samples)).toBeGreaterThan(1.05);

    const baked = bakeSpringKeyframes(0, 24, 100, 200, { stiffness: 300, damping: 16, mass: 1 }, 2);
    expect(baked.length).toBeGreaterThan(6);
    expect(baked[0]).toMatchObject({ frame: 0, value: 100 });
    expect(baked[baked.length - 1]).toMatchObject({ frame: 24, value: 200 });
  });

  it('evaluates deterministic Wiggle noise and BPM/Hz LFO waveforms', () => {
    const wA = evaluateWiggle(1.25, 3.5, 24, 7);
    const wB = evaluateWiggle(1.25, 3.5, 24, 7);
    const wOtherSeed = evaluateWiggle(1.25, 3.5, 24, 19);
    expect(wA).toBe(wB);
    expect(Math.abs(wA)).toBeLessThanOrEqual(24);
    expect(wA).not.toBe(wOtherSeed);

    const hz120Quarter = resolveLfoFrequencyHz({
      syncMode: 'bpm',
      bpm: 120,
      beatDivision: '1/4',
    });
    expect(hz120Quarter).toBe(8);

    const pulseHigh = evaluateLfo(0.1, {
      enabled: true,
      waveform: 'pulse',
      target: 'glow',
      syncMode: 'hz',
      frequencyHz: 1,
      bpm: 120,
      beatDivision: '1/4',
      amplitude: 40,
    });
    const pulseLow = evaluateLfo(0.75, {
      enabled: true,
      waveform: 'pulse',
      target: 'glow',
      syncMode: 'hz',
      frequencyHz: 1,
      bpm: 120,
      beatDivision: '1/4',
      amplitude: 40,
    });
    expect(pulseHigh).toBe(40);
    expect(pulseLow).toBe(0);
  });

  it('interpolates Linear, Hold/Step, Bezier, Spring and 2D spatial motion path tracks', () => {
    const holdLinearTrack: KeyframeTrack = {
      id: 'trk-scale',
      property: 'scale',
      keyframes: [
        { id: 'k1', time: 0, value: 1, interpolation: 'hold' },
        { id: 'k2', time: 1, value: 1.5, interpolation: 'linear' },
        { id: 'k3', time: 2, value: 2, interpolation: 'linear' },
      ],
    };

    expect(evaluateKeyframeTrack(holdLinearTrack, 0.6, 1)).toBe(1);
    expect(evaluateKeyframeTrack(holdLinearTrack, 1.5, 1)).toBeCloseTo(1.75, 4);

    const tx: KeyframeTrack = {
      id: 'trk-x',
      property: 'positionX',
      keyframes: [
        {
          id: 'px1',
          time: 0,
          value: 0.2,
          interpolation: 'linear',
          spatialOut: { dx: 0.3, dy: 0.25 },
        },
        { id: 'px2', time: 1, value: 0.8, interpolation: 'linear' },
      ],
    };
    const ty: KeyframeTrack = {
      id: 'trk-y',
      property: 'positionY',
      keyframes: [
        {
          id: 'py1',
          time: 0,
          value: 0.2,
          interpolation: 'linear',
          spatialOut: { dx: 0.3, dy: 0.25 },
        },
        { id: 'py2', time: 1, value: 0.2, interpolation: 'linear' },
      ],
    };

    const curvedMid = evaluateSpatialMotionPoint(tx, ty, 0.5, 0.5, 0.5);
    expect(curvedMid.x).toBeGreaterThan(0.45);
    expect(curvedMid.x).toBeLessThan(0.65);
    // Curve bends upward in normalized coordinates because spatialOut.dy > 0
    expect(curvedMid.y).toBeGreaterThan(0.24);
  });

  it('evaluates Text Stagger cascades, Trim Paths dash strokes, Mask Reveal & Blend CSS', () => {
    const tokens = evaluateTextStagger('HOLA MUNDO', 0.04, 2.0, 0.3, {
      enabled: true,
      unit: 'word',
      delayMs: 80,
      offsetY: 20,
      rotate3dDeg: -30,
      blurInPx: 8,
    });
    expect(tokens).toHaveLength(2);
    expect(tokens[0].opacity).toBeGreaterThan(tokens[1].opacity);
    expect(tokens[1].translateY).toBe(20);

    const trim = computeTrimPathStroke(
      { enabled: true, startPct: 0, endPct: 100, offsetDeg: 90 },
      0.2,
      0.4,
      100
    );
    expect(trim).not.toBeNull();
    expect(trim!.activeLength).toBeGreaterThan(0);
    expect(trim!.dashoffset).toBe(-25);

    const mask = evaluateMaskReveal({ enabled: true, direction: 'bottom', featherPx: 16 }, 0.1, 0.4, 0.2);
    expect(mask.clipPath).toContain('inset(');
    expect(mask.maskImage).toContain('linear-gradient');

    expect(blendModeToCss('add')).toBe('plus-lighter');
    expect(blendModeToCss('screen')).toBe('screen');
    expect(blendModeToCss('normal')).toBeUndefined();
  });
});
