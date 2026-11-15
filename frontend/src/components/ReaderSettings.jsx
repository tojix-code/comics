// Reader settings — the panel from the Mini App (Telegram) reader and the
// website reader share this. Settings persist in localStorage on the device
// (in Telegram that is the WebView's storage), so they survive reopening.
import { useEffect } from 'react';

export const SETTINGS_KEY = 'comicverse-reader-settings';

export const DEFAULT_SETTINGS = {
  direction: 'top-bottom', // 'ltr' | 'rtl' | 'top-bottom'
  stripMargin: 0, // px gap between pages in strip mode, 0–40
  keyboardScroll: 'fast', // 'fast' | 'smooth'
  keyboardStep: 100, // % of viewport height per Arrow / Space / W / S press
  autoScrollMode: 'continuous', // 'continuous' | 'step'
  autoScrollSpeed: 150, // px per second for the play / pause auto-scroll
  progressBar: 'top', // 'left' | 'top' | 'bottom' | 'right' | 'hidden'
  preload: 'some', // 'some' | 'all'
  greyscale: false,
  dim: 0, // % brightness reduction, 0–80
};

export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* private mode */ }
}

// CSS filter applied to every page image from greyscale + dim.
export function pageFilter(s) {
  const parts = [];
  if (s.greyscale) parts.push('grayscale(1)');
  if (s.dim > 0) parts.push(`brightness(${(1 - s.dim / 100).toFixed(2)})`);
  return parts.length ? parts.join(' ') : 'none';
}

function Section({ title, children }) {
  return (
    <div className="rs-section">
      <h3>{title}</h3>
      {children}
    </div>
  );
}

function Seg({ options, value, onChange, ariaLabel }) {
  return (
    <div className="rs-seg" role="group" aria-label={ariaLabel}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={value === o.value ? 'rs-seg-active' : ''}
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Stepper({ value, min, max, step, unit, onChange, onReset, label }) {
  return (
    <div className="rs-stepper">
      <button type="button" aria-label={`Decrease ${label}`} onClick={() => onChange(Math.max(min, value - step))}>−</button>
      <span>{value}{unit}</span>
      <button type="button" aria-label={`Increase ${label}`} onClick={() => onChange(Math.min(max, value + step))}>+</button>
      <button type="button" className="rs-reset" onClick={onReset}>Reset</button>
    </div>
  );
}

export default function ReaderSettingsPanel({ settings, onChange, onClose }) {
  const set = (patch) => onChange({ ...settings, ...patch });
  // Close on Escape.
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="rs-overlay" onClick={onClose}>
      <div className="rs-panel" role="dialog" aria-label="Reader settings" onClick={(e) => e.stopPropagation()}>
        <div className="rs-head">
          <h2>Settings</h2>
          <button type="button" className="rs-close" aria-label="Close settings" onClick={onClose}>✕</button>
        </div>

        <Section title="Reading direction">
          <Seg
            ariaLabel="Reading direction"
            value={settings.direction}
            onChange={(direction) => set({ direction })}
            options={[
              { value: 'ltr', label: '→ Left to right' },
              { value: 'rtl', label: '← Right to left' },
              { value: 'top-bottom', label: '↓ Top to bottom' },
            ]}
          />
        </Section>

        <Section title="Strip margin">
          <Stepper
            label="strip margin" value={settings.stripMargin} min={0} max={40} step={4} unit=""
            onChange={(stripMargin) => set({ stripMargin })}
            onReset={() => set({ stripMargin: DEFAULT_SETTINGS.stripMargin })}
          />
        </Section>

        <Section title="Keyboard scrolling">
          <Seg
            ariaLabel="Keyboard scrolling"
            value={settings.keyboardScroll}
            onChange={(keyboardScroll) => set({ keyboardScroll })}
            options={[
              { value: 'fast', label: '● Scroll fast' },
              { value: 'smooth', label: '○ Scroll smooth' },
            ]}
          />
          <Stepper
            label="keyboard step" value={settings.keyboardStep} min={10} max={200} step={10} unit="%"
            onChange={(keyboardStep) => set({ keyboardStep })}
            onReset={() => set({ keyboardStep: DEFAULT_SETTINGS.keyboardStep })}
          />
          <p className="rs-hint">Step size for Arrow / Space / W / S keys, as percent of the viewport height.</p>
        </Section>

        <Section title="Auto-scroll mode">
          <Seg
            ariaLabel="Auto-scroll mode"
            value={settings.autoScrollMode}
            onChange={(autoScrollMode) => set({ autoScrollMode })}
            options={[
              { value: 'continuous', label: '● Continuous' },
              { value: 'step', label: '○ Step' },
            ]}
          />
          <label className="rs-slider">
            <input
              type="range" min={20} max={400} step={10} value={settings.autoScrollSpeed}
              aria-label="Auto-scroll speed"
              onChange={(e) => set({ autoScrollSpeed: Number(e.target.value) })}
            />
            <span>{settings.autoScrollSpeed} px/s</span>
          </label>
          <p className="rs-hint">Speed of the play / pause auto-scroll button in the reader controls.</p>
        </Section>

        <Section title="Progress bar">
          <Seg
            ariaLabel="Progress bar position"
            value={settings.progressBar}
            onChange={(progressBar) => set({ progressBar })}
            options={[
              { value: 'left', label: '◀' },
              { value: 'top', label: '▲' },
              { value: 'bottom', label: '▼' },
              { value: 'right', label: '▶' },
              { value: 'hidden', label: '🚫' },
            ]}
          />
        </Section>

        <Section title="Preload images">
          <Seg
            ariaLabel="Preload images"
            value={settings.preload}
            onChange={(preload) => set({ preload })}
            options={[
              { value: 'some', label: '● Preload some' },
              { value: 'all', label: '○ Preload all' },
            ]}
          />
          <label className="rs-check">
            <input type="checkbox" checked={settings.greyscale} onChange={(e) => set({ greyscale: e.target.checked })} />
            Greyscale pages
          </label>
        </Section>

        <Section title="Dim pages">
          <label className="rs-slider">
            <input
              type="range" min={0} max={80} step={5} value={settings.dim}
              aria-label="Dim pages"
              onChange={(e) => set({ dim: Number(e.target.value) })}
            />
            <span>{settings.dim}%</span>
          </label>
        </Section>

        <button type="button" className="rs-reset-all" onClick={() => onChange({ ...DEFAULT_SETTINGS })}>
          Reset to defaults
        </button>
      </div>
    </div>
  );
}
