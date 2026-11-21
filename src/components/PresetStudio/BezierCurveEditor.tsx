import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  BEZIER_PRESETS,
  DEFAULT_SPRING_PARAMS,
  type AnimationCurve,
  type BezierHandles,
  type KeyframeInterpolation,
  type SpringParams,
} from '../../domain/preset';
import { evaluateCubicBezier, evaluateSpringResponse } from '../../lib/animationEngine';

interface BezierCurveEditorProps {
  curve: AnimationCurve;
  bezier: BezierHandles;
  onCurveChange: (curve: AnimationCurve, bezier: BezierHandles) => void;
  segmentLabel?: string;
  interpolation?: KeyframeInterpolation;
  springParams?: SpringParams;
  onInterpolationChange?: (mode: KeyframeInterpolation, spring?: SpringParams) => void;
}

const CURVE_OPTIONS: Array<{ value: AnimationCurve; label: string }> = [
  { value: 'ease-out', label: 'Ease Out (Desaceleración)' },
  { value: 'ease-in-out', label: 'S-Curve (Suave)' },
  { value: 'elastic', label: 'Spring / Bounce' },
  { value: 'expo', label: 'Whip / Exponencial' },
  { value: 'linear', label: 'Lineal' },
];

const INTERPOLATION_OPTIONS: Array<{ value: KeyframeInterpolation; label: string }> = [
  { value: 'bezier', label: 'Bézier' },
  { value: 'linear', label: 'Linear' },
  { value: 'hold', label: 'Hold / Step' },
  { value: 'spring', label: 'Spring (Física)' },
];

const QUICK_BEZIER_PILLS: Array<{
  id: string;
  label: string;
  curve: AnimationCurve;
  handles: BezierHandles;
}> = [
  { id: 'ease-out', label: 'Ease Out', curve: 'ease-out', handles: [0.16, 1, 0.3, 1] },
  { id: 's-curve', label: 'S-Curve', curve: 'ease-in-out', handles: [0.65, 0, 0.35, 1] },
  { id: 'spring', label: 'Spring / Bounce', curve: 'elastic', handles: [0.34, 1.42, 0.64, 1] },
  { id: 'whip', label: 'Whip / Snap', curve: 'expo', handles: [0.87, 0, 0.13, 1] },
  { id: 'exponential', label: 'Exponencial', curve: 'expo', handles: [0.19, 1, 0.22, 1] },
  { id: 'linear', label: 'Lineal', curve: 'linear', handles: [0, 0, 1, 1] },
];

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function sameHandles(a: BezierHandles, b: BezierHandles): boolean {
  return (
    Math.abs(a[0] - b[0]) < 0.015 &&
    Math.abs(a[1] - b[1]) < 0.015 &&
    Math.abs(a[2] - b[2]) < 0.015 &&
    Math.abs(a[3] - b[3]) < 0.015
  );
}

export function BezierCurveEditor({
  curve,
  bezier,
  onCurveChange,
  segmentLabel,
  interpolation = 'bezier',
  springParams,
  onInterpolationChange,
}: BezierCurveEditorProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [draggingHandle, setDraggingHandle] = useState<'p1' | 'p2' | null>(null);

  const activeSpring: SpringParams = springParams ?? DEFAULT_SPRING_PARAMS;
  const effectiveBezier: BezierHandles = interpolation === 'linear' ? [0, 0, 1, 1] : bezier;
  const [x1, y1, x2, y2] = effectiveBezier;
  const pad = 18;
  const size = 148;
  const inner = size - pad * 2;

  const toSvgX = (x: number) => pad + clamp(x, 0, 1) * inner;
  const toSvgY = (y: number) => pad + (1 - clamp(y, -0.35, 1.45)) * inner;

  const p0 = { x: toSvgX(0), y: toSvgY(0) };
  const p3 = { x: toSvgX(1), y: toSvgY(1) };
  const p1 = { x: toSvgX(x1), y: toSvgY(y1) };
  const p2 = { x: toSvgX(x2), y: toSvgY(y2) };

  const evalAt = (t: number) => {
    if (interpolation === 'hold') return t >= 0.999 ? 1 : 0;
    if (interpolation === 'linear') return t;
    if (interpolation === 'spring') return evaluateSpringResponse(t, activeSpring);
    return evaluateCubicBezier(t, effectiveBezier);
  };

  // Compute normalized velocity derivative curve dy/dt across [0..1]
  const { velocityLinePath, velocityAreaPath, peakVelocity, sampledCurvePath } = useMemo(() => {
    const steps = 32;
    const dt = 1 / steps;
    const rawSpeeds: number[] = [];
    const curvePts: Array<{ x: number; y: number }> = [];

    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      const val = evalAt(t);
      curvePts.push({ x: toSvgX(t), y: toSvgY(val) });
      const t0 = Math.max(0, t - dt * 0.5);
      const t1 = Math.min(1, t + dt * 0.5);
      const dy = evalAt(t1) - evalAt(t0);
      const speed = Math.abs(dy / Math.max(1e-4, t1 - t0));
      rawSpeeds.push(speed);
    }

    const maxSpeed = Math.max(1, ...rawSpeeds);
    const pts = rawSpeeds.map((s, idx) => {
      const normT = idx / steps;
      const normV = clamp(s / maxSpeed, 0, 1) * 0.86;
      return { x: pad + normT * inner, y: pad + (1 - normV) * inner };
    });
    const lineD = pts
      .map((pt, idx) => `${idx === 0 ? 'M' : 'L'} ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`)
      .join(' ');
    const baseBottom = pad + inner;
    const areaD = `${lineD} L ${(pad + inner).toFixed(1)} ${baseBottom.toFixed(1)} L ${pad.toFixed(1)} ${baseBottom.toFixed(1)} Z`;

    const sampledD =
      interpolation === 'hold'
        ? `M ${p0.x} ${p0.y} L ${p3.x} ${p0.y} L ${p3.x} ${p3.y}`
        : curvePts
            .map((pt, idx) => `${idx === 0 ? 'M' : 'L'} ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`)
            .join(' ');

    return {
      velocityLinePath: lineD,
      velocityAreaPath: areaD,
      peakVelocity: maxSpeed,
      sampledCurvePath: sampledD,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveBezier, inner, interpolation, activeSpring.stiffness, activeSpring.damping, activeSpring.mass]);

  function updateFromPointer(event: ReactPointerEvent<SVGSVGElement>, handle: 'p1' | 'p2') {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const normX = clamp((((event.clientX - rect.left) / rect.width) * size - pad) / inner, 0.02, 0.98);
    const normY = clamp(1 - (((event.clientY - rect.top) / rect.height) * size - pad) / inner, -0.35, 1.45);
    const rx = Number(normX.toFixed(2));
    const ry = Number(normY.toFixed(2));
    const next: BezierHandles = handle === 'p1' ? [rx, ry, x2, y2] : [x1, y1, rx, ry];
    if (onInterpolationChange && interpolation !== 'bezier') {
      onInterpolationChange('bezier');
    }
    onCurveChange(curve, next);
  }

  function startDrag(event: ReactPointerEvent<SVGCircleElement>, handle: 'p1' | 'p2') {
    event.stopPropagation();
    event.preventDefault();
    svgRef.current?.setPointerCapture?.(event.pointerId);
    setDraggingHandle(handle);
  }

  function finishDrag(event: ReactPointerEvent<SVGSVGElement>) {
    if (!draggingHandle) return;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDraggingHandle(null);
  }

  const showBezierHandles = interpolation === 'bezier';

  return (
    <div className="bezier-editor-card">
      <div className="bezier-editor-top">
        <label className="bezier-select-label">
          <span>{segmentLabel ?? 'Curva de animación'}</span>
          {onInterpolationChange ? (
            <select
              aria-label="Interpolación del segmento"
              value={interpolation}
              onChange={(e) => {
                const nextMode = e.target.value as KeyframeInterpolation;
                onInterpolationChange(nextMode, nextMode === 'spring' ? activeSpring : undefined);
                if (nextMode === 'linear') {
                  onCurveChange('linear', BEZIER_PRESETS.linear);
                }
              }}
            >
              {INTERPOLATION_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          ) : (
            <select
              aria-label="Curva de animación"
              value={curve}
              onChange={(e) => {
                const nextCurve = e.target.value as AnimationCurve;
                onCurveChange(nextCurve, BEZIER_PRESETS[nextCurve]);
              }}
            >
              {CURVE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          )}
        </label>
        <div className="bezier-telemetry">
          <span className="bezier-vel-tag" title="Pico de aceleración / velocidad">
            vMax {peakVelocity.toFixed(1)}×
          </span>
          <span className="bezier-coords" title="Coordenadas Cubic Bézier (P1x, P1y, P2x, P2y)">
            {interpolation === 'spring'
              ? `k=${activeSpring.stiffness} c=${activeSpring.damping}`
              : interpolation === 'hold'
                ? 'STEP / HOLD'
                : `(${x1.toFixed(2)}, ${y1.toFixed(2)}, ${x2.toFixed(2)}, ${y2.toFixed(2)})`}
          </span>
        </div>
      </div>

      <div className="bezier-editor-body">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${size} ${size}`}
          className="bezier-svg"
          role="img"
          aria-label="Editor interactivo de curva Bézier y velocidad"
          onPointerMove={(e) => {
            if (draggingHandle) updateFromPointer(e, draggingHandle);
          }}
          onPointerUp={finishDrag}
          onPointerCancel={finishDrag}
        >
          {/* Grid */}
          <rect x={pad} y={pad} width={inner} height={inner} className="bezier-grid-bg" rx="7" />
          <line x1={pad} y1={pad + inner * 0.25} x2={pad + inner} y2={pad + inner * 0.25} className="bezier-grid-line" />
          <line x1={pad} y1={pad + inner * 0.5} x2={pad + inner} y2={pad + inner * 0.5} className="bezier-grid-line" />
          <line x1={pad} y1={pad + inner * 0.75} x2={pad + inner} y2={pad + inner * 0.75} className="bezier-grid-line" />
          <line x1={pad + inner * 0.25} y1={pad} x2={pad + inner * 0.25} y2={pad + inner} className="bezier-grid-line" />
          <line x1={pad + inner * 0.5} y1={pad} x2={pad + inner * 0.5} y2={pad + inner} className="bezier-grid-line" />
          <line x1={pad + inner * 0.75} y1={pad} x2={pad + inner * 0.75} y2={pad + inner} className="bezier-grid-line" />
          <line x1={p0.x} y1={p0.y} x2={p3.x} y2={p3.y} className="bezier-linear-ref" />

          {/* Velocity derivative curve */}
          <path d={velocityAreaPath} className="bezier-velocity-area" />
          <path d={velocityLinePath} className="bezier-velocity-path" />

          {/* Handle stems */}
          {showBezierHandles && (
            <>
              <line x1={p0.x} y1={p0.y} x2={p1.x} y2={p1.y} className="bezier-stem" />
              <line x1={p3.x} y1={p3.y} x2={p2.x} y2={p2.y} className="bezier-stem" />
            </>
          )}

          {/* Curve path */}
          <path
            d={
              showBezierHandles
                ? `M ${p0.x} ${p0.y} C ${p1.x} ${p1.y}, ${p2.x} ${p2.y}, ${p3.x} ${p3.y}`
                : sampledCurvePath
            }
            className="bezier-curve-path"
          />

          {/* Endpoints */}
          <circle cx={p0.x} cy={p0.y} r="3.5" className="bezier-anchor" />
          <circle cx={p3.x} cy={p3.y} r="3.5" className="bezier-anchor" />

          {/* Draggable P1 & P2 handles */}
          {showBezierHandles && (
            <>
              <circle
                cx={p1.x}
                cy={p1.y}
                r="6"
                className={`bezier-handle bezier-handle-p1${draggingHandle === 'p1' ? ' is-dragging' : ''}`}
                onPointerDown={(e) => startDrag(e, 'p1')}
              />
              <circle
                cx={p2.x}
                cy={p2.y}
                r="6"
                className={`bezier-handle bezier-handle-p2${draggingHandle === 'p2' ? ' is-dragging' : ''}`}
                onPointerDown={(e) => startDrag(e, 'p2')}
              />
            </>
          )}
        </svg>

        <div className="bezier-right-col">
          {interpolation === 'spring' && onInterpolationChange ? (
            <div className="bezier-spring-controls">
              <label className="bezier-spring-row">
                <span>Rigidez ({activeSpring.stiffness})</span>
                <input
                  type="range"
                  min={50}
                  max={500}
                  step={5}
                  value={activeSpring.stiffness}
                  onChange={(e) =>
                    onInterpolationChange('spring', { ...activeSpring, stiffness: Number(e.target.value) })
                  }
                />
              </label>
              <label className="bezier-spring-row">
                <span>Amortiguación ({activeSpring.damping})</span>
                <input
                  type="range"
                  min={5}
                  max={50}
                  step={1}
                  value={activeSpring.damping}
                  onChange={(e) =>
                    onInterpolationChange('spring', { ...activeSpring, damping: Number(e.target.value) })
                  }
                />
              </label>
              <label className="bezier-spring-row">
                <span>Masa ({activeSpring.mass.toFixed(1)})</span>
                <input
                  type="range"
                  min={0.5}
                  max={5}
                  step={0.1}
                  value={activeSpring.mass}
                  onChange={(e) =>
                    onInterpolationChange('spring', { ...activeSpring, mass: Number(e.target.value) })
                  }
                />
              </label>
            </div>
          ) : (
            <div className="bezier-preset-pills">
              {QUICK_BEZIER_PILLS.map((pill) => {
                const active = interpolation === 'bezier' && sameHandles(bezier, pill.handles);
                return (
                  <button
                    key={pill.id}
                    type="button"
                    className={`bezier-pill${active ? ' is-active' : ''}`}
                    onClick={() => {
                      if (onInterpolationChange && interpolation !== 'bezier') {
                        onInterpolationChange('bezier');
                      }
                      onCurveChange(pill.curve, pill.handles);
                    }}
                  >
                    {pill.label}
                  </button>
                );
              })}
            </div>
          )}
          <div className="bezier-legend">
            <span>
              <i className="legend-dot legend-dot-curve" /> Valor ({interpolation === 'spring' ? 'Hooke' : interpolation === 'hold' ? 'Step' : 'Bézier'})
            </span>
            <span>
              <i className="legend-dot legend-dot-vel" /> Velocidad (dy/dt)
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
