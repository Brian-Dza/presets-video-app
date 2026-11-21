import { useState } from 'react';

interface PrecisionSliderProps {
  label: string;
  value: number;
  defaultValue: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (value: number) => void;
}

export function PrecisionSlider({
  label,
  value,
  defaultValue,
  min,
  max,
  step = 1,
  unit = '',
  onChange,
}: PrecisionSliderProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));

  function commitDraft() {
    const parsed = Number(draft);
    if (Number.isFinite(parsed)) {
      onChange(Math.min(max, Math.max(min, parsed)));
    }
    setEditing(false);
  }

  return (
    <div className="precision-slider">
      <div className="precision-slider-head">
        <span>{label}</span>
        {editing ? (
          <input
            type="number"
            className="precision-num-input"
            min={min}
            max={max}
            step={step}
            value={draft}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitDraft}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commitDraft();
              } else if (e.key === 'Escape') {
                setEditing(false);
              }
            }}
          />
        ) : (
          <button
            type="button"
            className="precision-num-btn"
            title="Haz clic para escribir un valor exacto"
            onClick={() => {
              setDraft(String(value));
              setEditing(true);
            }}
          >
            {Number.isInteger(step) ? Math.round(value) : value.toFixed(1)}
            {unit}
          </button>
        )}
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        title="Doble clic para restablecer valor por defecto"
        onDoubleClick={() => onChange(defaultValue)}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}
