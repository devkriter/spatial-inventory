import { useEffect, useRef, useState } from 'react';
import type { Node } from '../types';

export interface LocationMenuProps {
  locations: Node[];
  /** The one the current level belongs to. */
  current: Node;
  onPick: (location: Node) => void;
  onCreate: () => void;
  onRename: (location: Node) => void;
}

/**
 * The location you are in, and the way to any other. It stands where the first
 * breadcrumb used to, because that is the slot people already read as "the top"
 * — but locations are not a level you navigate through. Each is its own tree,
 * so this switches between trees rather than walking up out of one.
 */
export function LocationMenu({
  locations,
  current,
  onPick,
  onCreate,
  onRename,
}: LocationMenuProps) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  // Anywhere else, and the menu is done with. Pointerdown rather than click, so
  // it closes on the way down and never eats the click that dismissed it.
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => {
      if (!box.current?.contains(e.target as globalThis.Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  return (
    <div className="loc" ref={box}>
      <button
        className={open ? 'loc-button on' : 'loc-button'}
        onClick={() => setOpen((v) => !v)}
        title="Switch location"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="loc-name">{current.c.name}</span>
        <span className="loc-caret">▾</span>
      </button>

      {open && (
        <div className="loc-menu" role="menu">
          {locations.map((node) => (
            <div className="loc-row" key={node.c.id}>
              <button
                className={node === current ? 'loc-item on' : 'loc-item'}
                role="menuitemradio"
                aria-checked={node === current}
                onClick={() => {
                  setOpen(false);
                  if (node !== current) onPick(node);
                }}
              >
                <span
                  className="dot"
                  style={{ background: node.c.color || 'var(--muted)' }}
                  aria-hidden
                />
                <span className="grow">{node.c.name}</span>
                <span className="loc-count">{node.totalContainers}</span>
              </button>
              {/* Always drawn, not revealed on hover — there is no hover on a
                  phone, and renaming a location is not a rare enough thing to
                  hide behind a right-click that touch cannot reach. */}
              <button
                className="loc-rename"
                title={`Rename ${node.c.name}`}
                aria-label={`Rename ${node.c.name}`}
                onClick={() => {
                  setOpen(false);
                  onRename(node);
                }}
              >
                ✎
              </button>
            </div>
          ))}

          {!locations.length && <p className="hint loc-empty">No locations yet.</p>}

          <button
            className="loc-item new"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onCreate();
            }}
          >
            ＋ New location…
          </button>
        </div>
      )}
    </div>
  );
}
