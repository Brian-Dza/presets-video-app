import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Music, Play, Upload } from 'lucide-react';
import type { AudioSfxConfig, AudioSfxId, NativeFile } from '../../domain/preset';
import {
  BUILTIN_SFX_OPTIONS,
  generateSfxWaveformPeaks,
  SfxPreviewEngine,
} from '../../lib/audioSfx';
import { PrecisionSlider } from './PrecisionSlider';

interface AudioSfxPanelProps {
  audioSfx: AudioSfxConfig;
  customAudioBytes?: Uint8Array | null;
  embedded?: boolean;
  onChange: (next: AudioSfxConfig, file?: NativeFile) => void;
}

export function AudioSfxPanel({
  audioSfx,
  customAudioBytes = null,
  embedded = false,
  onChange,
}: AudioSfxPanelProps) {
  const [open, setOpen] = useState(embedded || audioSfx.sfxId !== 'none');
  const engineRef = useRef<SfxPreviewEngine | null>(null);

  useEffect(() => {
    return () => {
      engineRef.current?.stop();
    };
  }, []);

  const peaks = useMemo(
    () => generateSfxWaveformPeaks(audioSfx.sfxId, customAudioBytes, 32),
    [audioSfx.sfxId, customAudioBytes]
  );

  async function handleFileUpload(file: File | undefined) {
    if (!file) return;
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    onChange(
      {
        ...audioSfx,
        sfxId: 'custom',
        customName: file.name,
      },
      {
        path: `Audio/${file.name}`,
        bytes,
        role: 'asset',
      }
    );
  }

  function handleTestSound() {
    if (!engineRef.current) {
      engineRef.current = new SfxPreviewEngine();
    }
    void engineRef.current.play({
      sfxId: audioSfx.sfxId,
      gainDb: audioSfx.gainDb,
      muted: false,
      customBytes: customAudioBytes,
    });
  }

  const isOpen = embedded ? true : open;

  return (
    <section className={`editor-section-box sfx-panel-section${embedded ? ' is-embedded' : ''}`}>
      {embedded ? (
        <div className="sfx-embedded-head">
          <div className="studio-section-title">
            <Music size={13} />
            <strong>DISEÑO SONORO / SFX VINCULADO</strong>
          </div>
          <span className={`sfx-badge${audioSfx.sfxId !== 'none' ? ' is-linked' : ''}`}>
            {audioSfx.sfxId === 'none'
              ? 'Sin audio'
              : audioSfx.sfxId === 'custom'
                ? audioSfx.customName || 'Archivo local'
                : BUILTIN_SFX_OPTIONS.find((s) => s.id === audioSfx.sfxId)?.label}
          </span>
        </div>
      ) : (
        <button
          type="button"
          className="sfx-collapse-trigger"
          onClick={() => setOpen((prev) => !prev)}
          aria-expanded={open}
        >
          <div className="studio-section-title">
            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <Music size={14} />
            <strong>SFX / DISEÑO SONORO VINCULADO</strong>
          </div>
          <span className={`sfx-badge${audioSfx.sfxId !== 'none' ? ' is-linked' : ''}`}>
            {audioSfx.sfxId === 'none'
              ? 'Sin audio'
              : audioSfx.sfxId === 'custom'
                ? audioSfx.customName || 'Archivo local'
                : BUILTIN_SFX_OPTIONS.find((s) => s.id === audioSfx.sfxId)?.label}
          </span>
        </button>
      )}

      {isOpen && (
        <div className="sfx-panel-body">
          <div className="sfx-controls-row">
            <label className="layer-select-field sfx-select-grow">
              <span>Efecto sonoro</span>
              <select
                aria-label="Efecto sonoro vinculado"
                value={audioSfx.sfxId}
                onChange={(e) =>
                  onChange({
                    ...audioSfx,
                    sfxId: e.target.value as AudioSfxId,
                  })
                }
              >
                {BUILTIN_SFX_OPTIONS.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label}
                  </option>
                ))}
                <option value="custom">Archivo local (.wav / .mp3)</option>
              </select>
            </label>

            <label className="sfx-upload-btn" title="Adjuntar archivo .wav o .mp3">
              <Upload size={12} />
              <span>Cargar audio</span>
              <input
                type="file"
                accept=".wav,.mp3,audio/wav,audio/mpeg"
                className="visually-hidden"
                onChange={(e) => void handleFileUpload(e.target.files?.[0])}
              />
            </label>

            {audioSfx.sfxId !== 'none' && (
              <button
                type="button"
                className="btn-studio-add"
                onClick={handleTestSound}
                title="Escuchar SFX"
              >
                <Play size={12} />
                <span>Probar</span>
              </button>
            )}
          </div>

          {audioSfx.sfxId !== 'none' && (
            <>
              <div className="sfx-preview-wave" aria-hidden="true">
                {peaks.map((peak, idx) => (
                  <span key={idx} style={{ height: `${Math.round(peak * 100)}%` }} />
                ))}
              </div>
              <div className="layer-params-grid">
                <PrecisionSlider
                  label="Offset temporal"
                  value={audioSfx.offsetMs}
                  defaultValue={0}
                  min={-500}
                  max={1500}
                  step={10}
                  unit=" ms"
                  onChange={(v) => onChange({ ...audioSfx, offsetMs: v })}
                />
                <PrecisionSlider
                  label="Ganancia"
                  value={audioSfx.gainDb}
                  defaultValue={0}
                  min={-24}
                  max={6}
                  step={0.5}
                  unit=" dB"
                  onChange={(v) => onChange({ ...audioSfx, gainDb: v })}
                />
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
