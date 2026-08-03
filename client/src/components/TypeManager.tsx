import { useState } from 'react';
import { SWATCHES } from '../palette';
import type { Layout, SpaceType } from '../types';

export interface TypeManagerProps {
  types: SpaceType[];
  /** How many spaces currently use each type, for the delete warning. */
  usage: Map<number, number>;
  onCreate: (data: Partial<SpaceType>) => void;
  onUpdate: (id: number, data: Partial<SpaceType>) => void;
  onDelete: (id: number) => void;
  onClose: () => void;
}

const BLANK: Partial<SpaceType> = { name: '', layout: 'grid', cols: 4, rows: 4, color: SWATCHES[0] };

/**
 * Space types are the vocabulary for your own shelves — "Gridfinity tray",
 * "Bosch L-BOXX", "that blue tub". Each one carries a default size and layout
 * so creating the next one of the same thing is a single click.
 */
export function TypeManager({ types, usage, onCreate, onUpdate, onDelete, onClose }: TypeManagerProps) {
  const [editing, setEditing] = useState<number | 'new' | null>(null);
  const [draft, setDraft] = useState<Partial<SpaceType>>(BLANK);

  const startNew = () => {
    setEditing('new');
    setDraft({ ...BLANK, sort: types.length });
  };

  const startEdit = (type: SpaceType) => {
    setEditing(type.id);
    setDraft({ ...type });
  };

  const save = () => {
    const name = (draft.name ?? '').trim();
    if (!name) return;
    if (editing === 'new') onCreate({ ...draft, name });
    else if (typeof editing === 'number') onUpdate(editing, { ...draft, name });
    setEditing(null);
    setDraft(BLANK);
  };

  const set = <K extends keyof SpaceType>(key: K, value: SpaceType[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog">
        <header>
          Space types
          <span className="spacer" />
          <button className="btn ghost" onClick={onClose}>✕</button>
        </header>

        <div className="body">
          <div className="item-list" style={{ marginBottom: 12 }}>
            {types.map((type) => (
              <div key={type.id} className={editing === type.id ? 'item on' : 'item'}>
                <span className="swatch" style={{ background: type.color ?? '#8a6a45' }} />
                <span className="name">{type.name}</span>
                <span className="where">
                  {type.layout === 'grid' ? 'grid' : 'free'} · {type.cols}×{type.rows}
                </span>
                <span className="badge">{usage.get(type.id) ?? 0}</span>
                <button className="btn ghost" onClick={() => startEdit(type)}>Edit</button>
                <button
                  className="btn ghost danger"
                  title="Delete this type"
                  onClick={() => {
                    const used = usage.get(type.id) ?? 0;
                    const message = used
                      ? `${used} space${used === 1 ? '' : 's'} use "${type.name}". They keep their size and layout but lose the label. Delete it?`
                      : `Delete the "${type.name}" type?`;
                    if (confirm(message)) onDelete(type.id);
                  }}
                >
                  ✕
                </button>
              </div>
            ))}
            {!types.length && <p className="hint">No types yet. Add the first one below.</p>}
          </div>

          {editing === null ? (
            <button className="btn primary" onClick={startNew}>+ New type</button>
          ) : (
            <div className="type-editor">
              <div className="panel-title">{editing === 'new' ? 'New type' : 'Edit type'}</div>

              <div className="field">
                <label>Name</label>
                <input
                  autoFocus
                  value={draft.name ?? ''}
                  onChange={(e) => set('name', e.target.value)}
                  placeholder="e.g. Gridfinity tray"
                  onKeyDown={(e) => e.key === 'Enter' && save()}
                />
              </div>

              <div className="grid-3">
                <div className="field">
                  <label>Default width (U)</label>
                  <input
                    type="number" min={1}
                    value={draft.cols ?? 1}
                    onChange={(e) => set('cols', Math.max(1, Number(e.target.value) || 1))}
                  />
                </div>
                <div className="field">
                  <label>Default height (U)</label>
                  <input
                    type="number" min={1}
                    value={draft.rows ?? 1}
                    onChange={(e) => set('rows', Math.max(1, Number(e.target.value) || 1))}
                  />
                </div>
                <div className="field">
                  <label>Inside</label>
                  <select
                    value={draft.layout ?? 'grid'}
                    onChange={(e) => set('layout', e.target.value as Layout)}
                  >
                    <option value="grid">Grid</option>
                    <option value="free">Free</option>
                  </select>
                </div>
              </div>

              <div className="field">
                <label>Colour</label>
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
                  {!!draft.color && !SWATCHES.includes(draft.color) && (
                    <button
                      className="swatch pick on"
                      style={{ background: draft.color }}
                      title={`${draft.color} — kept from before`}
                    />
                  )}
                </div>
              </div>

              <div className="row-actions">
                <button className="btn primary" disabled={!(draft.name ?? '').trim()} onClick={save}>
                  Save
                </button>
                <button className="btn" onClick={() => { setEditing(null); setDraft(BLANK); }}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          <p className="hint" style={{ marginTop: 12 }}>
            A type only supplies defaults. Once a space exists, its size and layout are its own —
            changing the type later never moves anything you have already drawn.
          </p>
        </div>

        <footer>
          <button className="btn" onClick={onClose}>Done</button>
        </footer>
      </div>
    </div>
  );
}
