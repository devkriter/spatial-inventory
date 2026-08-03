import { useState, type CSSProperties } from 'react';
import { emptyCells } from '../layout';
import { SWATCHES } from '../palette';
import { ROOT_ID, type Space, type Layout, type Node, type RowOrigin, type SpaceType } from '../types';

export interface SpaceDialogProps {
  /** Parent for a new space; the root node means a new top-level place. */
  parent: Node;
  /** Present when editing rather than creating. */
  existing?: Node;
  types: SpaceType[];
  onSave: (data: Partial<Space>) => void;
  onManageTypes: () => void;
  onClose: () => void;
}

type Draft = Partial<Space> & { name: string };

/**
 * The full form. Everyday creation happens by drawing on the grid instead —
 * this is for top-level places, and for adjusting anything numerically.
 */
export function SpaceDialog({
  parent,
  existing,
  types,
  onSave,
  onManageTypes,
  onClose,
}: SpaceDialogProps) {
  const editing = !!existing;

  const [draft, setDraft] = useState<Draft>(() =>
    existing
      ? { ...existing.space }
      : {
          ...initialPlacement(parent),
          name: '',
          type_id: types[0]?.id ?? null,
          layout: types[0]?.layout ?? 'free',
          cols: types[0]?.cols ?? 4,
          rows: types[0]?.rows ?? 4,
          row_origin: 'top',
        }
  );

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const num = (key: keyof Draft, min = 0) => (e: { target: { value: string } }) =>
    set(key, Math.max(min, Number(e.target.value) || 0) as never);

  /** Choosing a type refills the interior defaults, but never on an edit. */
  const chooseType = (value: string) => {
    const id = value ? Number(value) : null;
    const type = types.find((t) => t.id === id);
    setDraft((d) => ({
      ...d,
      type_id: id,
      ...(editing || !type ? {} : { layout: type.layout, cols: type.cols, rows: type.rows }),
      name: d.name || (editing ? d.name : type?.name ?? ''),
    }));
  };

  const rows = Math.max(parent.space.rows, 1);
  const bottomUp = parent.space.row_origin === 'bottom';
  const displayRow = bottomUp ? rows - (draft.y ?? 0) - (draft.h ?? 1) + 1 : (draft.y ?? 0) + 1;
  const setDisplayRow = (r: number) => set('y', bottomUp ? rows - r - (draft.h ?? 1) + 1 : r - 1);

  const canSave = draft.name.trim().length > 0;

  // The title bar wears the colour this space will actually be drawn in:
  // its own override if set, otherwise whatever the chosen type supplies.
  const tint = draft.color || types.find((t) => t.id === draft.type_id)?.color || null;

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog">
        <header style={tintStyle(tint)}>
          {tint && <span className="swatch" style={{ background: tint, marginRight: 8 }} />}
          {editing ? `Edit ${existing!.space.name}` : `Add inside ${parent.space.name}`}
          <span className="spacer" />
          <button className="btn ghost" onClick={onClose}>✕</button>
        </header>

        <div className="body">
          <div className="grid-2">
            <div className="field">
              <label>Name</label>
              <input
                autoFocus
                value={draft.name}
                onChange={(e) => set('name', e.target.value)}
                placeholder="e.g. Left drawer unit"
              />
            </div>
            <div className="field">
              <label>
                Type
                <button className="link" onClick={onManageTypes}>manage…</button>
              </label>
              <select value={draft.type_id ?? ''} onChange={(e) => chooseType(e.target.value)}>
                <option value="">No type</option>
                {types.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} · {t.cols}×{t.rows} {t.layout}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="panel-title" style={{ marginTop: 6 }}>
            Seen from the front, in {parent.space.name} — {parent.space.cols} × {parent.space.rows} U
          </div>
          <div className="grid-2">
            <div className="field">
              <label>Column (1–{parent.space.cols})</label>
              <input
                type="number" min={1} max={parent.space.cols}
                value={(draft.x ?? 0) + 1}
                onChange={(e) => set('x', Math.max(0, Number(e.target.value) - 1))}
              />
            </div>
            <div className="field">
              <label>Row (1–{rows}, from the {bottomUp ? 'bottom' : 'top'})</label>
              <input
                type="number" min={1} max={rows}
                value={displayRow}
                onChange={(e) => setDisplayRow(Math.max(1, Number(e.target.value)))}
              />
            </div>
            <div className="field">
              <label>Width it takes up (U)</label>
              <input type="number" min={0.5} step={0.5} value={draft.w ?? 1} onChange={num('w', 0.5)} />
            </div>
            <div className="field">
              <label>Height it takes up (U)</label>
              <input type="number" min={0.5} step={0.5} value={draft.h ?? 1} onChange={num('h', 0.5)} />
            </div>
          </div>
          <p className="hint">
            The slice it takes up on the face of {parent.space.name} — a drawer in a cabinet is one
            slice tall. Easier to drag out on the grid than to type: close this and draw it.
          </p>

          <div className="panel-title" style={{ marginTop: 6 }}>Opened up, seen from above</div>
          <div className="grid-3">
            <div className="field">
              <label>Width (U)</label>
              <input type="number" min={1} value={draft.cols ?? 1} onChange={num('cols', 1)} />
            </div>
            <div className="field">
              <label>Height (U)</label>
              <input type="number" min={1} value={draft.rows ?? 1} onChange={num('rows', 1)} />
            </div>
            <div className="field">
              <label>Placement</label>
              <select value={draft.layout} onChange={(e) => set('layout', e.target.value as Layout)}>
                <option value="grid">Grid — snap to whole units</option>
                <option value="free">Free — half-unit steps</option>
              </select>
            </div>
          </div>

          <p className="hint">
            Its own floor plan, which is a different shape from the slice above — a drawer one
            slice tall on the front of a cabinet is a full 12 × 12 grid once you pull it out.
          </p>

          <div className="grid-2">
            <div className="field">
              <label>Row 1 is at the</label>
              <select
                value={draft.row_origin ?? 'top'}
                onChange={(e) => set('row_origin', e.target.value as RowOrigin)}
              >
                <option value="top">Top</option>
                <option value="bottom">Bottom</option>
              </select>
            </div>
            <div className="field">
              <label>Sort order</label>
              <input type="number" value={draft.sort ?? 0} onChange={num('sort')} />
            </div>
          </div>

          <div className="field">
            <label>Colour — blank follows the type</label>
            <button
              className={!draft.color ? 'swatch pick none on' : 'swatch pick none'}
              title="Follow the type"
              onClick={() => set('color', null)}
            />
            <div className="swatches">
              {SWATCHES.map((hex) => (
                <button
                  key={hex}
                  className={draft.color === hex ? 'swatch pick on' : 'swatch pick'}
                  style={{ background: hex }}
                  title={hex}
                  onClick={() => set('color', hex)}
                />
              ))}
              {/* Whatever was already chosen, even if the palette no longer
                  offers it — otherwise editing a space would look uncoloured. */}
              {!!draft.color && !SWATCHES.includes(draft.color) && (
                <button
                  className="swatch pick on"
                  style={{ background: draft.color }}
                  title={`${draft.color} — kept from before`}
                />
              )}
            </div>
          </div>

          <div className="field">
            <label>Notes</label>
            <textarea value={draft.notes ?? ''} onChange={(e) => set('notes', e.target.value || null)} />
          </div>
        </div>

        <footer>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button
            className="btn primary"
            disabled={!canSave}
            onClick={() => onSave({ ...draft, name: draft.name.trim() })}
          >
            {editing ? 'Save' : 'Create'}
          </button>
        </footer>
      </div>
    </div>
  );
}

/** Wash the header in the space's colour, keeping the text readable. */
function tintStyle(tint: string | null): CSSProperties | undefined {
  if (!tint) return undefined;
  return {
    background: `linear-gradient(to bottom,
      color-mix(in srgb, ${tint}, var(--panel) 45%),
      color-mix(in srgb, ${tint}, var(--panel) 78%))`,
    borderBottom: `2px solid ${tint}`,
  };
}

/** First free cell, so a new child never lands on top of a sibling. */
function initialPlacement(parent: Node): Partial<Space> {
  const spot = emptyCells(parent)[0] ?? { x: 0, y: 0 };
  // A top-level thing is a piece of furniture, not a drawer — 1×1 would be a
  // speck on a room-sized grid.
  const span = parent.space.id === ROOT_ID ? { w: 6, h: 8 } : { w: 1, h: 1 };
  return { x: spot.x, y: spot.y, ...span };
}
