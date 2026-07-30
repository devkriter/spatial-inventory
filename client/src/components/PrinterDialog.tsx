import { useEffect, useMemo, useRef, useState } from 'react';
import { LABEL_PRESETS, labelOrigin, renderLabel } from '../labels';
import { bluetoothAvailable, printLabels, printTaskNames } from '../niimbot';
import type { Settings } from '../settings';

/** An address only this machine can resolve, so a QR pointing at it is useless. */
const local = (host: string): boolean =>
  host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.local');

export interface PrinterDialogProps {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  onClose: () => void;
}

/**
 * Everything about the printer and the stock in it — set once, then forgotten.
 * Making individual labels happens from the details panel, per container.
 */
export function PrinterDialog({ settings, onChange, onClose }: PrinterDialogProps) {
  const [tasks, setTasks] = useState<string[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const preview = useRef<HTMLDivElement>(null);

  const bluetooth = useMemo(() => bluetoothAvailable(), []);

  const presetKey =
    LABEL_PRESETS.find((p) => p.w === settings.labelWidthMm && p.h === settings.labelHeightMm)
      ?.name ?? '';

  useEffect(() => {
    if (bluetooth.ok) void printTaskNames().then(setTasks).catch(() => setTasks([]));
  }, [bluetooth.ok]);

  // A sample at the current settings, so the stock size can be sanity-checked.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const canvas = await renderLabel(
        {
          title: 'Sample label',
          path: 'Workshop › Cabinet',
          address: 'R3·C2',
          qrUrl: `${labelOrigin(settings.labelBaseUrl)}/?go=1`,
        },
        {
          widthMm: settings.labelWidthMm,
          heightMm: settings.labelHeightMm,
          dpi: settings.labelDpi,
          showPath: settings.labelShowPath,
          showAddress: settings.labelShowAddress,
          showQr: settings.labelShowQr,
        }
      );
      if (cancelled || !preview.current) return;
      canvas.className = 'label-preview';
      canvas.style.width = `${settings.labelWidthMm * 3}px`;
      canvas.style.height = `${settings.labelHeightMm * 3}px`;
      preview.current.replaceChildren(canvas);
    })();
    return () => {
      cancelled = true;
    };
  }, [
    settings.labelWidthMm, settings.labelHeightMm, settings.labelDpi,
    settings.labelShowPath, settings.labelShowAddress, settings.labelShowQr,
    settings.labelBaseUrl,
  ]);

  const testPrint = async () => {
    setBusy(true);
    setError(null);
    try {
      const canvas = preview.current?.querySelector('canvas');
      if (!canvas) throw new Error('nothing to print');
      await printLabels(
        [canvas as HTMLCanvasElement],
        { printTask: settings.printTask, density: settings.printDensity, quantity: 1 },
        setStatus
      );
    } catch (err) {
      setError((err as Error).message);
      setStatus(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="dialog labels">
        <header>
          Label printer and defaults
          <span className="spacer" />
          <button className="btn ghost" onClick={onClose}>✕</button>
        </header>

        <div className="body">
          <div className="panel-title">The stock in the printer</div>
          <div className="grid-2">
            <div className="field">
              <label>Size</label>
              <select
                value={presetKey}
                onChange={(e) => {
                  const p = LABEL_PRESETS.find((x) => x.name === e.target.value);
                  if (p) onChange({ labelWidthMm: p.w, labelHeightMm: p.h });
                }}
              >
                {!presetKey && (
                  <option value="">
                    Custom — {settings.labelWidthMm} × {settings.labelHeightMm} mm
                  </option>
                )}
                {LABEL_PRESETS.map((p) => (
                  <option key={p.name} value={p.name}>{p.name}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Or set it yourself (mm)</label>
              <div className="inline-form" style={{ marginBottom: 0 }}>
                <input
                  className="qty" type="number" min={5}
                  value={settings.labelWidthMm}
                  onChange={(e) => onChange({ labelWidthMm: Math.max(5, Number(e.target.value) || 5) })}
                />
                <input
                  className="qty" type="number" min={5}
                  value={settings.labelHeightMm}
                  onChange={(e) => onChange({ labelHeightMm: Math.max(5, Number(e.target.value) || 5) })}
                />
                <button
                  className="btn"
                  title="Swap width and height"
                  onClick={() =>
                    onChange({
                      labelWidthMm: settings.labelHeightMm,
                      labelHeightMm: settings.labelWidthMm,
                    })
                  }
                >
                  ⇄
                </button>
              </div>
            </div>
          </div>
          <p className="hint">
            Named the way the packet is — tape width first — and drawn with the long side across.
            Use ⇄ if your roll feeds the other way.
            {settings.labelHeightMm < 16 && ' At this height the path is left off so the name stays readable.'}
          </p>

          <div className="panel-title" style={{ marginTop: 14 }}>What goes on every label</div>
          <div className="row-actions">
            {(
              [
                ['labelShowAddress', 'Address'],
                ['labelShowPath', 'Where it lives'],
                ['labelShowQr', 'QR code'],
              ] as const
            ).map(([key, label]) => (
              <label className="chip" key={key}>
                <input
                  type="checkbox"
                  checked={settings[key]}
                  onChange={(e) => onChange({ [key]: e.target.checked })}
                />
                {label}
              </label>
            ))}
          </div>

          <div className="field" style={{ marginTop: 10 }}>
            <label>Where the QR codes point</label>
            <input
              value={settings.labelBaseUrl}
              placeholder={window.location.origin}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              onChange={(e) => onChange({ labelBaseUrl: e.target.value })}
            />
          </div>
          <p className="hint">
            Scanning a label opens the app at that space. Left blank it uses whatever address this
            page is on, so labels printed at{' '}
            <b>{window.location.origin}</b>{' '}
            {local(window.location.hostname)
              ? 'will not open on your phone — put this machine’s address on the network here instead, e.g. http://192.168.1.20:5178.'
              : 'will work from any device that can reach it.'}
          </p>

          <div className="label-sheet" style={{ marginTop: 10 }} ref={preview} />

          <div className="panel-title" style={{ marginTop: 14 }}>The printer</div>
          {bluetooth.ok ? (
            <>
              <div className="grid-3">
                <div className="field">
                  <label>Model</label>
                  <select
                    value={settings.printTask}
                    onChange={(e) => onChange({ printTask: e.target.value })}
                  >
                    <option value="">Detect automatically</option>
                    {tasks.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>Density — {settings.printDensity}</label>
                  <input
                    type="range" min={1} max={5} step={1}
                    value={settings.printDensity}
                    onChange={(e) => onChange({ printDensity: Number(e.target.value) })}
                  />
                </div>
                <div className="field">
                  <label>Printer dpi</label>
                  <input
                    type="number" min={100}
                    value={settings.labelDpi}
                    onChange={(e) => onChange({ labelDpi: Math.max(100, Number(e.target.value) || 203) })}
                  />
                </div>
              </div>
              <div className="field">
                <label>Copies of each label</label>
                <input
                  type="number" min={1}
                  value={settings.printQuantity}
                  onChange={(e) =>
                    onChange({ printQuantity: Math.max(1, Number(e.target.value) || 1) })
                  }
                />
              </div>
              <p className="hint">
                203 dpi suits every current NIIMBOT — exactly 8 dots per millimetre. Pairing
                happens in the browser's own Bluetooth prompt each time you print, so turn the
                printer on first.
              </p>
            </>
          ) : (
            <p className="hint" style={{ color: 'var(--danger)' }}>{bluetooth.reason}</p>
          )}

          {status && <p className="hint" style={{ color: 'var(--ok)' }}>{status}</p>}
          {error && <p className="hint" style={{ color: 'var(--danger)' }}>{error}</p>}

          <p className="hint" style={{ marginTop: 12 }}>
            To make real labels, select a space and use <b>Labels</b> in the details panel.
          </p>
        </div>

        <footer>
          <button className="btn" disabled={busy || !bluetooth.ok} onClick={testPrint}>
            {busy ? 'Printing…' : 'Print a test label'}
          </button>
          <button className="btn primary" onClick={onClose}>Done</button>
        </footer>
      </div>
    </div>
  );
}
