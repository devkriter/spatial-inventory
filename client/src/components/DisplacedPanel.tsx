import { useEffect, useState } from 'react';
import type { Tree } from '../tree';
import { WORLD_ID, type Part } from '../types';

export interface DisplacedPanelProps {
  part: Part;
  tree: Tree;
  onSavePart: (partId: number, patch: Partial<Part>) => void;
  onPlace: (partId: number, containerId: number, qty: number) => void;
  onForget: (partId: number) => void;
  onDismiss: () => void;
}

/**
 * A part the catalogue still knows about but which is not stored anywhere. It
 * keeps its description and datasheet on purpose — you have not stopped owning
 * the *knowledge* of a 470 Ω resistor just because the drawer is empty — so this
 * offers the two things worth doing: put it back, or forget it entirely.
 */
export function DisplacedPanel({
  part,
  tree,
  onSavePart,
  onPlace,
  onForget,
  onDismiss,
}: DisplacedPanelProps) {
  const [name, setName] = useState(part.name);
  const [target, setTarget] = useState('');
  const [qty, setQty] = useState('1');

  useEffect(() => {
    setName(part.name);
    setTarget('');
    setQty('1');
  }, [part.id, part.name]);

  const places = tree.flat.filter((n) => n.c.id !== WORLD_ID);

  return (
    <>
      <div className="panel-section">
        <div className="panel-title">
          <span>Displaced item</span>
          <span className="spacer" />
          <button className="btn ghost" onClick={onDismiss}>← Back</button>
        </div>

        <div className="field">
          <label>Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </div>

        <div className="row-actions">
          <button
            className="btn"
            disabled={!name.trim() || name === part.name}
            onClick={() => onSavePart(part.id, { name: name.trim() })}
          >
            Rename
          </button>
          <button
            className="btn danger"
            onClick={() => {
              if (confirm(`Forget "${part.name}" completely? Its description and links go too.`)) {
                onForget(part.id);
              }
            }}
          >
            Forget it
          </button>
        </div>

        <p className="hint" style={{ marginTop: 8 }}>
          Nowhere in the workshop holds this at the moment. Its details are kept so putting it
          back does not mean typing them all again.
        </p>
      </div>

      <div className="panel-section">
        <div className="panel-title">Put it back</div>
        <div className="inline-form">
          <select
            className="grow"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            style={{
              background: '#12151a',
              border: '1px solid var(--line)',
              borderRadius: 4,
              padding: '6px 8px',
              minWidth: 0,
            }}
          >
            <option value="">Choose a place…</option>
            {places.map((n) => (
              <option key={n.c.id} value={n.c.id}>
                {n.path.map((c) => c.name).join(' › ')}
              </option>
            ))}
          </select>
          <input
            className="qty"
            type="number"
            min={0}
            value={qty}
            onChange={(e) => setQty(e.target.value)}
          />
          <button
            className="btn primary"
            disabled={!target}
            onClick={() => onPlace(part.id, Number(target), Number(qty) || 0)}
          >
            Place
          </button>
        </div>
        <p className="hint">
          It lands loose in there. Give it a slot afterwards by dragging it, or with
          <b> Give each item a slot</b>.
        </p>
      </div>
    </>
  );
}
