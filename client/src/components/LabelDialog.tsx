import { useEffect, useMemo, useRef, useState } from 'react';
import { cellAddress } from '../layout';
import {
  canvasToBlob,
  labelOrigin,
  printSheet,
  renderLabel,
  type LabelSpec,
  type LabelStyle,
} from '../labels';
import { bluetoothAvailable, printLabels } from '../niimbot';
import type { Settings } from '../settings';
import { ROOT_ID, type Node } from '../types';

export interface LabelDialogProps {
  /** The space the labels are for, plus the option of doing its children. */
  node: Node;
  settings: Settings;
  onOpenPrinter: () => void;
  onClose: () => void;
}

type Scope = 'self' | 'children';

export function LabelDialog({ node, settings, onOpenPrinter, onClose }: LabelDialogProps) {
  const canPrintSelf = node.space.id !== ROOT_ID;
  const [scope, setScope] = useState<Scope>(canPrintSelf ? 'self' : 'children');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  const bluetooth = useMemo(() => bluetoothAvailable(), []);

  const style: LabelStyle = {
    widthMm: settings.labelWidthMm,
    heightMm: settings.labelHeightMm,
    dpi: settings.labelDpi,
    showPath: settings.labelShowPath,
    showAddress: settings.labelShowAddress,
    showQr: settings.labelShowQr,
  };

  const origin = labelOrigin(settings.labelBaseUrl);
  const targets = scope === 'self' ? [node] : node.children;
  const specs: LabelSpec[] = targets.map((t) => ({
    title: t.space.name,
    path: t.path.slice(0, -1).map((c) => c.name).join(' › ') || 'Workshop',
    address: t.parent ? cellAddress(t.parent.space, t.space) ?? undefined : undefined,
    // Scanning the label opens the app right at this space.
    qrUrl: `${origin}/?go=${t.space.id}`,
  }));

  // Re-render the previews whenever anything about them changes.
  const [canvases, setCanvases] = useState<HTMLCanvasElement[]>([]);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const rendered = await Promise.all(specs.map((s) => renderLabel(s, style)));
      if (!cancelled) setCanvases(rendered);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    scope, node.space.id, node.children.length, origin,
    style.widthMm, style.heightMm, style.dpi, style.showPath, style.showAddress, style.showQr,
  ]);

  useEffect(() => {
    const host = previewRef.current;
    if (!host) return;
    host.replaceChildren(
      ...canvases.slice(0, 24).map((c) => {
        c.className = 'label-preview';
        c.style.width = `${style.widthMm * 3}px`;
        c.style.height = `${style.heightMm * 3}px`;
        return c;
      })
    );
  }, [canvases, style.widthMm, style.heightMm]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError((err as Error).message);
      setStatus(null);
    } finally {
      setBusy(false);
    }
  };

  const download = () =>
    run(async () => {
      for (let i = 0; i < canvases.length; i++) {
        const blob = await canvasToBlob(canvases[i]);
        if (!blob) continue;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${safe(specs[i].title)}.png`;
        a.click();
        URL.revokeObjectURL(url);
      }
      setStatus(`Saved ${canvases.length} PNG${canvases.length === 1 ? '' : 's'}.`);
    });

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="dialog labels">
        <header>
          Labels
          <span className="spacer" />
          <button className="btn ghost" onClick={onClose}>✕</button>
        </header>

        <div className="body">
          <div className="segmented" style={{ marginBottom: 12 }}>
            <button
              className={scope === 'self' ? 'on' : ''}
              disabled={!canPrintSelf}
              onClick={() => setScope('self')}
            >
              Just {node.space.name}
            </button>
            <button className={scope === 'children' ? 'on' : ''} onClick={() => setScope('children')}>
              Everything inside ({node.children.length})
            </button>
          </div>

          {!targets.length && <p className="hint">Nothing to label here.</p>}

          <div className="label-sheet" ref={previewRef} />
          {canvases.length > 24 && (
            <p className="hint">Showing the first 24 of {canvases.length}.</p>
          )}

          <p className="hint" style={{ marginTop: 10 }}>
            {style.widthMm} × {style.heightMm} mm at {style.dpi} dpi
            {settings.printQuantity > 1 && ` · ${settings.printQuantity} copies of each`}.
            {' '}
            <button className="link" onClick={onOpenPrinter}>Printer and defaults…</button>
          </p>
          {!bluetooth.ok && (
            <p className="hint" style={{ color: 'var(--danger)' }}>{bluetooth.reason}</p>
          )}

          {status && <p className="hint" style={{ color: 'var(--ok)' }}>{status}</p>}
          {error && <p className="hint" style={{ color: 'var(--danger)' }}>{error}</p>}
        </div>

        <footer>
          <button className="btn" disabled={busy || !canvases.length} onClick={download}>
            Save PNGs
          </button>
          <button
            className="btn"
            disabled={busy || !canvases.length}
            onClick={() => printSheet(canvases, style)}
          >
            Print sheet
          </button>
          <button
            className="btn primary"
            disabled={busy || !canvases.length || !bluetooth.ok}
            onClick={() =>
              run(() =>
                printLabels(
                  canvases,
                  {
                    printTask: settings.printTask,
                    density: settings.printDensity,
                    quantity: settings.printQuantity,
                  },
                  setStatus
                )
              )
            }
          >
            {busy ? 'Printing…' : `Print ${canvases.length} to NIIMBOT`}
          </button>
        </footer>
      </div>
    </div>
  );
}

const safe = (name: string): string => name.replace(/[^\w\-. ]+/g, '_').slice(0, 60) || 'label';
