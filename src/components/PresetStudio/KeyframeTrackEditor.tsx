import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Clock, Diamond, Film, Plus, Radio, Trash2 } from 'lucide-react';
import type {
  KeyframePoint,
  KeyframeTrack,
  KeyframeTrackId,
  TimelineMode,
  TimelinePhases,
} from '../../domain/preset';
import { clamp, evaluateKeyframeTrack, sortKeyframes } from '../../lib/animationEngine';
import { PrecisionSlider } from './PrecisionSlider';

export type DopeTrackRowId = 'position' | 'scale' | 'rotation' | 'opacity' | 'opticalIntensity';

export interface SelectedSegmentRef {
  property: KeyframeTrackId;
  keyframeId: string;
  layerId?: string;
}

interface KeyframeTrackEditorProps {
  mode: TimelineMode;
  onModeChange: (mode: TimelineMode) => void;
  durationSeconds: number;
  onDurationChange: (seconds: number) => void;
  timelinePhases: TimelinePhases;
  onTimelinePhasesChange: (next: TimelinePhases) => void;
  playheadTime: number;
  onPlayheadChange: (seconds: number) => void;
  tracks: KeyframeTrack[];
  activeLayerId?: string | null;
  activeLayerName?: string;
  autoKeyframe: boolean;
  onToggleAutoKeyframe: () => void;
  selectedRow: DopeTrackRowId;
  onSelectRow: (row: DopeTrackRowId) => void;
  selectedSegment: SelectedSegmentRef | null;
  onSelectSegment: (seg: SelectedSegmentRef | null) => void;
  onUpsertKeyframeAt: (row: DopeTrackRowId, timeSec?: number) => void;
  onMoveKeyframe: (property: KeyframeTrackId, keyframeId: string, newTime: number, layerId?: string) => void;
  onDeleteKeyframe: (property: KeyframeTrackId, keyframeId: string, layerId?: string) => void;
  fallbackValues: {
    positionX: number;
    positionY: number;
    scale: number;
    rotation: number;
    opacity: number;
    opticalIntensity: number;
  };
}

const TRACK_ROWS: Array<{ id: DopeTrackRowId; label: string; primaryProp: KeyframeTrackId; unit: string }> = [
  { id: 'position', label: 'Posición (X, Y)', primaryProp: 'positionX', unit: '%' },
  { id: 'scale', label: 'Escala', primaryProp: 'scale', unit: '%' },
  { id: 'rotation', label: 'Rotación', primaryProp: 'rotation', unit: '°' },
  { id: 'opacity', label: 'Opacidad', primaryProp: 'opacity', unit: '%' },
  { id: 'opticalIntensity', label: 'Intensidad Óptica', primaryProp: 'opticalIntensity', unit: '%' },
];

export function KeyframeTrackEditor({
  mode,
  onModeChange,
  durationSeconds,
  onDurationChange,
  timelinePhases,
  onTimelinePhasesChange,
  playheadTime,
  onPlayheadChange,
  tracks,
  activeLayerId,
  activeLayerName,
  autoKeyframe,
  onToggleAutoKeyframe,
  selectedRow,
  onSelectRow,
  selectedSegment,
  onSelectSegment,
  onUpsertKeyframeAt,
  onMoveKeyframe,
  onDeleteKeyframe,
  fallbackValues,
}: KeyframeTrackEditorProps) {
  const [draggingKf, setDraggingKf] = useState<{
    property: KeyframeTrackId;
    keyframeId: string;
    layerId?: string;
    isPosition: boolean;
    pairedId?: string;
  } | null>(null);
  const [scrubbingRuler, setScrubbingRuler] = useState(false);
  const rulerRef = useRef<HTMLDivElement>(null);

  const safeDur = Math.max(0.4, durationSeconds);
  const inPct = Math.round(timelinePhases.inRatio * 100);
  const outPct = Math.round(timelinePhases.outRatio * 100);
  const midPct = Math.max(10, 100 - inPct - outPct);
  const inSec = (safeDur * (inPct / 100)).toFixed(1);
  const midSec = Math.max(0.1, safeDur * (midPct / 100)).toFixed(1);
  const outSec = (safeDur * (outPct / 100)).toFixed(1);

  const getTrack = (prop: KeyframeTrackId) =>
    tracks.find(
      (t) =>
        t.property === prop &&
        (activeLayerId ? t.layerId === activeLayerId : !t.layerId || t.layerId === '__global__')
    ) ?? tracks.find((t) => t.property === prop && (!t.layerId || t.layerId === '__global__'));

  const timeFromLaneEvent = (el: HTMLElement, clientX: number): number => {
    const rect = el.getBoundingClientRect();
    if (!rect.width) return playheadTime;
    const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
    return Number((ratio * safeDur).toFixed(2));
  };

  function handleRulerPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setScrubbingRuler(true);
    onPlayheadChange(timeFromLaneEvent(event.currentTarget, event.clientX));
  }

  function handleRulerPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!scrubbingRuler) return;
    onPlayheadChange(timeFromLaneEvent(event.currentTarget, event.clientX));
  }

  function handleRulerPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (!scrubbingRuler) return;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setScrubbingRuler(false);
  }

  function formatReadout(rowId: DopeTrackRowId): string {
    if (rowId === 'position') {
      const tx = getTrack('positionX');
      const ty = getTrack('positionY');
      const vx = evaluateKeyframeTrack(tx, playheadTime, fallbackValues.positionX);
      const vy = evaluateKeyframeTrack(ty, playheadTime, fallbackValues.positionY);
      return `${Math.round(vx * 100)}%, ${Math.round(vy * 100)}%`;
    }
    if (rowId === 'scale') {
      const v = evaluateKeyframeTrack(getTrack('scale'), playheadTime, fallbackValues.scale);
      return `${Math.round(v * 100)}%`;
    }
    if (rowId === 'rotation') {
      const v = evaluateKeyframeTrack(getTrack('rotation'), playheadTime, fallbackValues.rotation);
      return `${v.toFixed(1)}°`;
    }
    if (rowId === 'opacity') {
      const v = evaluateKeyframeTrack(getTrack('opacity'), playheadTime, fallbackValues.opacity);
      return `${Math.round(v)}%`;
    }
    const v = evaluateKeyframeTrack(
      getTrack('opticalIntensity'),
      playheadTime,
      fallbackValues.opticalIntensity
    );
    return `${Math.round(v)}%`;
  }

  const playheadPct = clamp((playheadTime / safeDur) * 100, 0, 100);
  const rulerTicks = [0, 0.25, 0.5, 0.75, 1];

  return (
    <div className="unified-timeline-box">
      <div className="unified-timeline-head">
        <div className="timeline-mode-switch" role="tablist" aria-label="Modo de línea de tiempo">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'phases'}
            className={`timeline-mode-btn${mode === 'phases' ? ' is-active' : ''}`}
            onClick={() => onModeChange('phases')}
          >
            <Clock size={12} />
            <span>Modo Rápido (3 Fases)</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'keyframes'}
            className={`timeline-mode-btn${mode === 'keyframes' ? ' is-active' : ''}`}
            onClick={() => onModeChange('keyframes')}
          >
            <Film size={12} />
            <span>Editor de Keyframes (Dope Sheet)</span>
          </button>
        </div>

        {mode === 'phases' ? (
          <label className="layer-check-field stretcher-toggle">
            <input
              type="checkbox"
              checked={timelinePhases.autoScaleDuration}
              onChange={(e) =>
                onTimelinePhasesChange({
                  ...timelinePhases,
                  autoScaleDuration: e.target.checked,
                })
              }
            />
            <span>Auto-escalar duración (KeyframeStretcher)</span>
          </label>
        ) : (
          <div className="dope-head-actions">
            <button
              type="button"
              className={`rec-auto-kf-btn${autoKeyframe ? ' is-armed' : ''}`}
              aria-pressed={autoKeyframe}
              aria-label="Auto-Keyframe (REC)"
              title="Grabar automáticamente keyframes al mover objetos en el visor"
              onClick={onToggleAutoKeyframe}
            >
              <Radio size={12} />
              <span>REC</span>
            </button>
            <button
              type="button"
              className="dope-add-kf-btn"
              aria-label="Añadir keyframe en playhead"
              title="Añadir o actualizar keyframe en el cabezal (Tecla K)"
              onClick={() => onUpsertKeyframeAt(selectedRow, playheadTime)}
            >
              <Plus size={12} />
              <span>Keyframe (K)</span>
            </button>
            {selectedSegment && (
              <button
                type="button"
                className="icon-mini-btn danger"
                aria-label="Eliminar keyframe seleccionado"
                title="Eliminar keyframe seleccionado"
                onClick={() => {
                  onDeleteKeyframe(
                    selectedSegment.property,
                    selectedSegment.keyframeId,
                    selectedSegment.layerId
                  );
                  onSelectSegment(null);
                }}
              >
                <Trash2 size={12} />
              </button>
            )}
          </div>
        )}
      </div>

      {mode === 'phases' ? (
        <>
          <div className="phase-visual-bar" aria-label="Fases de duración del preset">
            <div className="phase-seg phase-seg-in" style={{ width: `${inPct}%` }}>
              <span>IN</span>
              <strong>{inSec}s</strong>
            </div>
            <div className="phase-seg phase-seg-mid" style={{ width: `${midPct}%` }}>
              <span>{timelinePhases.autoScaleDuration ? 'SOSTENIDO · AUTO' : 'SOSTENIDO'}</span>
              <strong>{midSec}s</strong>
            </div>
            <div className="phase-seg phase-seg-out" style={{ width: `${outPct}%` }}>
              <span>OUT</span>
              <strong>{outSec}s</strong>
            </div>
          </div>

          <div className="field-row-3 timeline-sliders-compact">
            <PrecisionSlider
              label="Duración total"
              value={durationSeconds}
              defaultValue={2.4}
              min={0.5}
              max={8}
              step={0.1}
              unit="s"
              onChange={onDurationChange}
            />
            <PrecisionSlider
              label="Entrada (In)"
              value={inPct}
              defaultValue={25}
              min={10}
              max={45}
              unit="%"
              onChange={(v) => onTimelinePhasesChange({ ...timelinePhases, inRatio: v / 100 })}
            />
            <PrecisionSlider
              label="Salida (Out)"
              value={outPct}
              defaultValue={25}
              min={10}
              max={45}
              unit="%"
              onChange={(v) => onTimelinePhasesChange({ ...timelinePhases, outRatio: v / 100 })}
            />
          </div>
        </>
      ) : (
        <div className="dope-sheet-editor" data-testid="dope-sheet-editor">
          <div className="dope-sheet-meta-bar">
            <span className="dope-layer-pill">
              Capa activa: <strong>{activeLayerName || 'Escena Global'}</strong>
            </span>
            <span className="dope-time-readout">
              {playheadTime.toFixed(2)}s / {safeDur.toFixed(2)}s
            </span>
            <label className="dope-dur-inline">
              <span>Duración</span>
              <input
                type="number"
                min={0.5}
                max={8}
                step={0.1}
                value={durationSeconds}
                aria-label="Duración total en Dope Sheet"
                onChange={(e) => {
                  const val = Number(e.target.value);
                  if (Number.isFinite(val)) onDurationChange(clamp(val, 0.5, 8));
                }}
              />
              <span>s</span>
            </label>
          </div>

          {/* Time ruler */}
          <div className="dope-track-row dope-ruler-row">
            <div className="dope-track-label">TIEMPO</div>
            <div
              ref={rulerRef}
              className="dope-ruler-lane"
              role="slider"
              aria-label="Cabezal de tiempo Dope Sheet"
              aria-valuemin={0}
              aria-valuemax={safeDur}
              aria-valuenow={Number(playheadTime.toFixed(2))}
              onPointerDown={handleRulerPointerDown}
              onPointerMove={handleRulerPointerMove}
              onPointerUp={handleRulerPointerUp}
              onPointerCancel={handleRulerPointerUp}
            >
              {rulerTicks.map((ratio) => (
                <span
                  key={ratio}
                  className="dope-ruler-tick"
                  style={{ left: `${ratio * 100}%` }}
                >
                  {(ratio * safeDur).toFixed(2)}s
                </span>
              ))}
              <div className="dope-playhead-head" style={{ left: `${playheadPct}%` }} />
            </div>
          </div>

          {/* Keyframe Lanes */}
          <div className="dope-tracks-list">
            {TRACK_ROWS.map((row) => {
              const track = getTrack(row.primaryProp);
              const trackY = row.id === 'position' ? getTrack('positionY') : undefined;
              const keyframes: KeyframePoint[] = track ? sortKeyframes(track.keyframes) : [];
              const keyframesY: KeyframePoint[] = trackY ? sortKeyframes(trackY.keyframes) : [];
              const isRowSelected = selectedRow === row.id;

              return (
                <div
                  key={row.id}
                  className={`dope-track-row${isRowSelected ? ' is-selected' : ''}`}
                  onClick={() => onSelectRow(row.id)}
                >
                  <div className="dope-track-label">
                    <span className="dope-prop-name">{row.label}</span>
                    <span className="dope-prop-val">{formatReadout(row.id)}</span>
                    <button
                      type="button"
                      className="dope-row-add-btn"
                      aria-label={`Añadir keyframe en ${row.label}`}
                      title={`Añadir keyframe en ${row.label}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectRow(row.id);
                        onUpsertKeyframeAt(row.id, playheadTime);
                      }}
                    >
                      <Plus size={11} />
                    </button>
                  </div>

                  <div
                    className="dope-lane"
                    onPointerMove={(e) => {
                      if (!draggingKf || draggingKf.property !== row.primaryProp) return;
                      const nextTime = timeFromLaneEvent(e.currentTarget, e.clientX);
                      onMoveKeyframe(
                        draggingKf.property,
                        draggingKf.keyframeId,
                        nextTime,
                        draggingKf.layerId
                      );
                      if (draggingKf.isPosition && draggingKf.pairedId) {
                        onMoveKeyframe('positionY', draggingKf.pairedId, nextTime, draggingKf.layerId);
                      }
                    }}
                    onPointerUp={(e) => {
                      if (!draggingKf) return;
                      if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
                        e.currentTarget.releasePointerCapture(e.pointerId);
                      }
                      setDraggingKf(null);
                    }}
                    onDoubleClick={(e) => {
                      const t = timeFromLaneEvent(e.currentTarget, e.clientX);
                      onSelectRow(row.id);
                      onUpsertKeyframeAt(row.id, t);
                    }}
                  >
                    {/* Playhead guide line */}
                    <div className="dope-playhead-line" style={{ left: `${playheadPct}%` }} />

                    {/* Interpolation segments */}
                    {keyframes.slice(0, -1).map((kf, idx) => {
                      const nextKf = keyframes[idx + 1];
                      const leftPct = (clamp(kf.time / safeDur, 0, 1)) * 100;
                      const rightPct = (clamp(nextKf.time / safeDur, 0, 1)) * 100;
                      const widthPct = Math.max(0.5, rightPct - leftPct);
                      const isSegSelected =
                        selectedSegment?.property === row.primaryProp &&
                        selectedSegment?.keyframeId === kf.id;

                      return (
                        <button
                          key={`seg-${kf.id}`}
                          type="button"
                          className={`dope-segment-bar mode-${kf.interpolation}${isSegSelected ? ' is-selected' : ''}`}
                          style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                          title={`Segmento (${kf.interpolation.toUpperCase()}) · clic para editar curva`}
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectRow(row.id);
                            onSelectSegment({
                              property: row.primaryProp,
                              keyframeId: kf.id,
                              layerId: track?.layerId,
                            });
                          }}
                        />
                      );
                    })}

                    {/* Keyframe diamonds */}
                    {keyframes.map((kf, idx) => {
                      const leftPct = clamp(kf.time / safeDur, 0, 1) * 100;
                      const isSelected =
                        selectedSegment?.property === row.primaryProp &&
                        selectedSegment?.keyframeId === kf.id;
                      const pairedY = row.id === 'position' ? keyframesY[idx] : undefined;

                      return (
                        <button
                          key={kf.id}
                          type="button"
                          className={`dope-keyframe-diamond mode-${kf.interpolation}${isSelected ? ' is-selected' : ''}`}
                          style={{ left: `${leftPct}%` }}
                          aria-label={`Keyframe ${row.label} ${kf.time.toFixed(2)}s`}
                          title={`${kf.time.toFixed(2)}s · ${kf.interpolation.toUpperCase()} (Arrastra para mover)`}
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            (e.currentTarget.parentElement as HTMLElement)?.setPointerCapture?.(e.pointerId);
                            onSelectRow(row.id);
                            onSelectSegment({
                              property: row.primaryProp,
                              keyframeId: kf.id,
                              layerId: track?.layerId,
                            });
                            onPlayheadChange(kf.time);
                            setDraggingKf({
                              property: row.primaryProp,
                              keyframeId: kf.id,
                              layerId: track?.layerId,
                              isPosition: row.id === 'position',
                              pairedId: pairedY?.id,
                            });
                          }}
                        >
                          <Diamond size={10} fill="currentColor" />
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
