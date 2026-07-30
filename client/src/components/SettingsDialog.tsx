import { DEFAULT_SETTINGS, UI_SCALE_MAX, UI_SCALE_MIN, type Settings } from '../settings';

export interface SettingsDialogProps {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  onReplayWalkthrough: () => void;
  onClose: () => void;
}

interface Toggle {
  key: keyof Settings;
  label: string;
  hint: string;
}

const NAVIGATION: Toggle[] = [
  {
    key: 'singleClickEnters',
    label: 'A single click goes inside',
    hint: 'Off: one click inspects, two go in. On: one click goes straight in, and the details panel follows wherever you are.',
  },
  {
    key: 'clickOutsideToGoBack',
    label: 'Clicking the space around a level goes back',
    hint: 'The margin outside the orange outline acts as a way out.',
  },
  {
    key: 'rightClickToGoBack',
    label: 'Right-click goes back',
    hint: 'Off: right-click gives you the browser menu instead.',
  },
  {
    key: 'backspaceToGoBack',
    label: 'Backspace goes back',
    hint: 'Never applies while you are typing in a field.',
  },
];

const VIEW: Toggle[] = [
  { key: 'showGrid', label: 'Draw the unit grid', hint: 'The faint squares things line up against.' },
  { key: 'confirmDelete', label: 'Ask before deleting', hint: 'Deleting a space always takes its contents with it.' },
];

export function SettingsDialog({ settings, onChange, onReplayWalkthrough, onClose }: SettingsDialogProps) {
  const check = (t: Toggle) => (
    <label className="setting" key={t.key}>
      <input
        type="checkbox"
        checked={settings[t.key] as boolean}
        onChange={(e) => onChange({ [t.key]: e.target.checked } as Partial<Settings>)}
      />
      <span>
        <span className="s-label">{t.label}</span>
        <span className="s-hint">{t.hint}</span>
      </span>
    </label>
  );

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog">
        <header>
          Settings
          <span className="spacer" />
          <button className="btn ghost" onClick={onClose}>✕</button>
        </header>

        <div className="body">
          <div className="panel-title">Interface size</div>
          <div className="field">
            <label>
              Everything except the map — {Math.round(settings.uiScale * 100)}%
            </label>
            <div className="inline-form" style={{ marginBottom: 6, alignItems: 'center' }}>
              <span className="hint" style={{ flex: 'none' }}>A</span>
              <input
                className="grow"
                type="range"
                min={UI_SCALE_MIN}
                max={UI_SCALE_MAX}
                step={0.05}
                value={settings.uiScale}
                aria-label="Interface size"
                onChange={(e) => onChange({ uiScale: Number(e.target.value) })}
              />
              <span className="hint" style={{ flex: 'none', fontSize: '1.5em' }}>A</span>
              <button
                className="btn"
                disabled={settings.uiScale === 1}
                onClick={() => onChange({ uiScale: 1 })}
              >
                Reset
              </button>
            </div>
            <p className="hint">
              Scales the toolbar, both panels, the tree, menus and dialogs together — text and
              the controls around it, so nothing outgrows the box it sits in. Takes effect as you
              drag. The map is deliberately left out: blocks are sized by the layout and by the
              map's own zoom, which is a different question.
            </p>
          </div>

          <div className="panel-title" style={{ marginTop: 16 }}>Navigation</div>
          {NAVIGATION.map(check)}

          <div className="panel-title" style={{ marginTop: 16 }}>The map</div>
          {VIEW.map(check)}

          <div className="field" style={{ marginTop: 10 }}>
            <label>Levels drawn at once — {settings.drawDepth}</label>
            <input
              type="range"
              min={1}
              max={4}
              step={1}
              value={settings.drawDepth}
              onChange={(e) => onChange({ drawDepth: Number(e.target.value) })}
            />
            <p className="hint">
              At 1 you see only what is directly inside the level you are in; at 4 you see drawers
              within units within a closet.
            </p>
          </div>

          <div className="panel-title" style={{ marginTop: 16 }}>Labels</div>
          <div className="grid-2">
            <div className="field">
              <label>Printer dpi</label>
              <input
                type="number" min={100}
                value={settings.labelDpi}
                onChange={(e) => onChange({ labelDpi: Math.max(100, Number(e.target.value) || 203) })}
              />
            </div>
            <div className="field">
              <label>Currently loaded</label>
              <input readOnly value={`${settings.labelWidthMm} × ${settings.labelHeightMm} mm`} />
            </div>
          </div>
          <p className="hint">
            203 dpi suits every current NIIMBOT — exactly 8 dots per millimetre. Pick the label
            size itself in the Labels dialog, next to the preview.
          </p>

          <div className="row-actions" style={{ marginTop: 16 }}>
            <button className="btn" onClick={onReplayWalkthrough}>Show the walkthrough again</button>
            <button
              className="btn danger"
              onClick={() => {
                if (confirm('Put every setting back to its default?')) onChange(DEFAULT_SETTINGS);
              }}
            >
              Reset settings
            </button>
          </div>
          <p className="hint" style={{ marginTop: 8 }}>
            Settings are kept in this browser, so your phone and your PC can behave differently.
            They are not part of a backup.
          </p>
        </div>

        <footer>
          <button className="btn primary" onClick={onClose}>Done</button>
        </footer>
      </div>
    </div>
  );
}
