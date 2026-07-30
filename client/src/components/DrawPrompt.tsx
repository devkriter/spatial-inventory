import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { size } from '../layout';
import { PART_NAME_LIST } from './PartNames';
import type { Rect, StorageType, UnitRect } from '../types';

export interface DrawPromptProps {
  /** The rectangle just drawn, in the parent's units. */
  rect: UnitRect;
  /** Where that rectangle landed on screen, so the prompt can sit beside it. */
  anchor: Rect;
  types: StorageType[];
  onCreate: (what: 'container' | 'part', name: string, typeId: number | null, qty: number) => void;
  onCancel: () => void;
}

/**
 * The small form that appears the moment you finish dragging out a rectangle.
 * Name it, pick a type, Enter. Fast enough to fill a 12×12 cabinet in one go.
 */
export function DrawPrompt({ rect, anchor, types, onCreate, onCancel }: DrawPromptProps) {
  const [what, setWhat] = useState<'container' | 'part'>('container');
  const [name, setName] = useState('');
  const [typeId, setTypeId] = useState<string>('');
  const [qty, setQty] = useState('1');
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
  }, []);

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onCreate(what, trimmed, typeId ? Number(typeId) : null, Number(qty) || 0);
  };

  const keys = (e: { key: string }) => {
    if (e.key === 'Enter') submit();
    if (e.key === 'Escape') onCancel();
  };

  const tint = types.find((t) => String(t.id) === typeId)?.color || null;

  // Keep the popover on screen: drawn near the right or bottom edge it would
  // otherwise hang off the viewport and be unreachable.
  const [place, setPlace] = useState<{ left: number; top: number }>({
    left: anchor.x,
    top: anchor.y + anchor.h + 6,
  });
  const box = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = box.current;
    const host = el?.offsetParent as HTMLElement | null;
    if (!el || !host) return;
    const margin = 8;
    const left = Math.max(
      margin,
      Math.min(anchor.x, host.clientWidth - el.offsetWidth - margin)
    );
    const below = anchor.y + anchor.h + 6;
    const top =
      below + el.offsetHeight + margin > host.clientHeight
        ? Math.max(margin, anchor.y - el.offsetHeight - 6)
        : below;
    setPlace({ left, top });
  }, [anchor.x, anchor.y, anchor.h, what]);

  return (
    <div
      ref={box}
      className="draw-prompt"
      style={{
        left: place.left,
        top: place.top,
        ...(tint ? { borderColor: tint } : null),
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="dp-head">
        {tint && <span className="swatch" style={{ background: tint, marginRight: 6 }} />}
        New <strong>{size(rect)}</strong> here
      </div>
      <div className="segmented dp-what">
        <button className={what === 'container' ? 'on' : ''} onClick={() => setWhat('container')}>
          Space
        </button>
        <button className={what === 'part' ? 'on' : ''} onClick={() => setWhat('part')}>
          Item
        </button>
      </div>

      <input
        ref={input}
        placeholder={what === 'part' ? 'Item name' : 'Name it'}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={keys}
        // Offers parts you already have, so the same resistor is never entered
        // twice under two spellings.
        list={what === 'part' ? PART_NAME_LIST : undefined}
        autoComplete="off"
      />

      {what === 'part' ? (
        <input
          type="number"
          placeholder="Quantity"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          onKeyDown={keys}
        />
      ) : (
        <select value={typeId} onChange={(e) => setTypeId(e.target.value)} onKeyDown={keys}>
          <option value="">No type</option>
          {types.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} · {t.cols}×{t.rows}
            </option>
          ))}
        </select>
      )}
      <div className="dp-actions">
        <button className="btn" onClick={onCancel}>Cancel</button>
        <button className="btn primary" disabled={!name.trim()} onClick={submit}>Create</button>
      </div>
    </div>
  );
}
