import { useEffect, useState } from 'react';
import { cellAddress, formatUnits, size, slotOf } from '../layout';
import { typeName } from '../palette';
import type { SearchResult } from '../search';
import { WORLD_ID, type Item, type Layout, type Node, type Part, type Workspace } from '../types';
import type { Tree } from '../tree';
import { fmtQty } from './SpaceView';
import { DisplacedPanel } from './DisplacedPanel';
import { PART_NAME_LIST } from './PartNames';

export interface SidebarProps {
  tree: Tree;
  onClose: () => void;
  /** What the panel is describing — the selection, or the current level. */
  node: Node;
  /** The level currently being drawn, so the panel can say where you are. */
  root: Node;
  selected: Item | null;
  search: SearchResult;
  searching: boolean;
  /** Jump to a search hit and highlight it where it lives. */
  onReveal: (node: Node, item: Item | null) => void;
  onOpen: (node: Node) => void;
  onSelectItem: (item: Item | null, holder: Node) => void;
  onAddChild: (parent: Node) => void;
  onEditContainer: (node: Node) => void;
  onMakeLabels: (node: Node) => void;
  onDeleteContainer: (node: Node) => void;
  onAddStock: (containerId: number, name: string, qty: number) => void;
  onSetQty: (stockId: number, qty: number) => void;
  onRemoveStock: (stockId: number) => void;
  workspace: Workspace;
  onSaveWorkspace: (patch: Partial<Workspace>) => void;
  onSavePart: (partId: number, patch: Partial<Part>) => void;
  onMoveStock: (stockId: number, containerId: number) => void;
  /** A displaced part chosen in the tree, if any — it has no location to show. */
  displacedPart: Part | null;
  onPlaceDisplaced: (partId: number, containerId: number, qty: number) => void;
  onDismissDisplaced: () => void;
  onDeletePart: (partId: number) => void;
  /** Rendered as a bottom sheet rather than a side panel — the phone form. */
  sheet?: boolean;
  /** Sheet only: whether it is at full height, and how to change that. */
  expanded?: boolean;
  onToggleHeight?: () => void;
}

export function Sidebar(props: SidebarProps) {
  const { searching, selected, sheet } = props;
  return (
    <aside className={sheet ? `sidebar sheet${props.expanded ? ' full' : ''}` : 'sidebar'}>
      {sheet && (
        // The whole strip is the target, not just the little bar drawn on it —
        // a 4px handle is not something you can reliably hit with a thumb.
        <button
          className="sheet-grab"
          onClick={props.onToggleHeight}
          aria-label={props.expanded ? 'Shrink this panel' : 'Expand this panel'}
        />
      )}
      <div className="side-head">
        <span className="title">Details</span>
        <button
          className="btn ghost"
          onClick={props.onClose}
          title={sheet ? 'Close' : 'Collapse this panel'}
        >
          {sheet ? '✕' : '▸'}
        </button>
      </div>
      <div className="side-scroll">
        {props.displacedPart ? (
          <DisplacedPanel
            part={props.displacedPart}
            tree={props.tree}
            onSavePart={props.onSavePart}
            onPlace={props.onPlaceDisplaced}
            onForget={props.onDeletePart}
            onDismiss={props.onDismissDisplaced}
          />
        ) : (
          <>
            {searching && <Results {...props} />}
            {selected ? <PartPanel {...props} item={selected} /> : <NodePanel {...props} />}
          </>
        )}
      </div>

      {/* Always true, never about the selection — so it lives at the bottom
          rather than shifting around with the content above it. */}
      <p className="side-foot">
        {sheet
          ? 'Tap a block to inspect it, double-tap to go inside. Tap the margin around a level to step back out.'
          : `Click a block to inspect it, double-click to go inside. Drag on empty grid to draw
             something new; drag a block by its title bar to move it, or its bottom-right corner to
             resize. Drag an item onto another space to move it there.`}
      </p>
    </aside>
  );
}

/* ---------------------------------------------------------------- results */

function Results({ search, onReveal }: SidebarProps) {
  const shown = search.hits.slice(0, 200);
  return (
    <div className="panel-section">
      <div className="panel-title">
        <span>Results</span>
        <span className="spacer" />
        <span className="badge">{search.hits.length}</span>
      </div>
      {!shown.length && <p className="hint">Nothing matches. Try fewer words.</p>}
      {shown.map((hit) => (
        <button
          key={hit.item ? `i${hit.item.stock.id}` : `c${hit.node.c.id}`}
          className="result"
          onClick={() => onReveal(hit.node, hit.item ?? null)}
        >
          <div className="r-name">
            <span className="grow">{hit.item ? hit.item.part.name : hit.node.c.name}</span>
            {hit.item ? (
              <span className="badge">{fmtQty(hit.item.stock.qty)}</span>
            ) : (
              <span className="badge">{typeName(hit.node)}</span>
            )}
          </div>
          <div className="r-path">{pathLabel(hit.node)}</div>
        </button>
      ))}
      {search.hits.length > shown.length && (
        <p className="hint">+ {search.hits.length - shown.length} more — narrow the search.</p>
      )}
    </div>
  );
}

const pathLabel = (node: Node): string => node.path.map((c) => c.name).join('  ›  ') || 'Workshop';

/* -------------------------------------------------------------- container */

function NodePanel(props: SidebarProps) {
  const { node, root, onOpen, onSelectItem, onAddChild, onEditContainer, onDeleteContainer } = props;
  const isWorld = node.c.id === WORLD_ID;
  const address = node.parent ? cellAddress(node.parent.c, node.c) : null;
  // Selected something without walking into it: say so, and offer the way in.
  const justSelected = node.c.id !== root.c.id;
  const loose = node.items.filter((item) => !slotOf(item));

  return (
    <>
      <div className="panel-section">
        {/* Say plainly whether this is the level you are standing in or just
            something you clicked, otherwise the two are indistinguishable. */}
        <div className="panel-title" style={{ marginBottom: 6 }}>
          {justSelected
            ? `Selected — inside ${root.c.name}`
            : isWorld
              ? 'You are at the top'
              : 'You are inside'}
        </div>
        <div className="node-title">
          <h2>{node.c.name}</h2>
        </div>
        <div className="node-sub">
          {isWorld
            ? `${formatUnits(node.c)} ${node.c.layout} · everything you have`
            : `${typeName(node)} · ${formatUnits(node.c)} ${node.c.layout} inside` +
              (node.parent
                ? ` · ${size(node.c)} U on the front of ${node.parent.c.name}${address ? ` at ${address}` : ''}`
                : '')}
        </div>

        <div className="stat-row">
          <div className="stat">
            <div className="v">{node.totalContainers}</div>
            <div className="k">spaces</div>
          </div>
          <div className="stat">
            <div className="v">{node.totalItems}</div>
            <div className="k">items</div>
          </div>
          <div className="stat">
            <div className="v">{fmtQty(node.totalQty)}</div>
            <div className="k">units</div>
          </div>
        </div>

        {node.c.notes && <p className="hint" style={{ marginTop: 0 }}>{node.c.notes}</p>}

        <div className="row-actions">
          {justSelected && (
            <button className="btn primary" onClick={() => onOpen(node)}>Open ↵</button>
          )}
          <button className={justSelected ? 'btn' : 'btn primary'} onClick={() => onAddChild(node)}>
            + Add
          </button>
          {!isWorld && <button className="btn" onClick={() => onEditContainer(node)}>Edit</button>}
          <button
            className="btn"
            onClick={() => props.onMakeLabels(node)}
            title={`Labels for ${node.c.name}, or for everything inside it`}
          >
            🏷 Labels
          </button>
          {!isWorld && (
            <button className="btn danger" onClick={() => onDeleteContainer(node)}>Delete</button>
          )}
        </div>
      </div>

      {!isWorld && <AddStock node={node} onAddStock={props.onAddStock} />}

      {node.children.length > 0 && (
        <div className="panel-section">
          <div className="panel-title">
            <span>Inside</span>
            <span className="spacer" />
            <span className="badge">{node.children.length}</span>
          </div>
          <div className="item-list">
            {node.children.map((child) => (
              <div key={child.c.id} className="item" onClick={() => onOpen(child)}>
                <span className="name">{child.c.name}</span>
                <span className="where">
                  {cellAddress(node.c, child.c) ?? ''} {size(child.c)}
                </span>
                <span className="qty">{child.totalItems || ''}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {isWorld && <WorkspaceEditor {...props} />}

      {node.items.length > 0 && (
        <div className="panel-section">
          <div className="panel-title">
            <span>Items here</span>
            <span className="spacer" />
            <span className="badge">{node.items.length}</span>
          </div>
          {loose.length > 0 && (
            <p className="hint" style={{ marginTop: 0, marginBottom: 8, color: 'var(--danger)' }}>
              {loose.length} {loose.length === 1 ? 'item has' : 'items have'} no room on the{' '}
              {node.c.cols} × {node.c.rows} grid, so {loose.length === 1 ? 'it is' : 'they are'} only
              listed. Make the grid bigger with <b>Edit</b>.
            </p>
          )}
          <div className="item-list">
            {node.items.map((item) => (
              <ItemRow
                key={item.stock.id}
                item={item}
                holder={node}
                onClick={() => onSelectItem(item, node)}
                onSetQty={props.onSetQty}
              />
            ))}
          </div>
        </div>
      )}
    </>
  );
}

/**
 * The workshop has no parent to be edited from, so its own grid is set here.
 * Making it bigger never moves anything; making it smaller can leave furniture
 * hanging past the edge, so that is called out rather than silently clamped.
 */
function WorkspaceEditor({ workspace, onSaveWorkspace, node }: SidebarProps) {
  const [draft, setDraft] = useState<Partial<Workspace>>({});
  const value = <K extends keyof Workspace>(key: K): Workspace[K] =>
    (draft[key] as Workspace[K]) ?? workspace[key];
  const dirty = Object.keys(draft).length > 0;

  const overflowing = node.children.filter(
    (c) => c.c.x + c.c.w > Number(value('cols')) || c.c.y + c.c.h > Number(value('rows'))
  );

  return (
    <div className="panel-section">
      <div className="panel-title">The room itself</div>

      <div className="field">
        <label>Name</label>
        <input
          value={value('name')}
          onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
        />
      </div>

      <div className="grid-3">
        <div className="field">
          <label>Width (U)</label>
          <input
            type="number" min={1}
            value={value('cols')}
            onChange={(e) => setDraft((d) => ({ ...d, cols: Math.max(1, Number(e.target.value) || 1) }))}
          />
        </div>
        <div className="field">
          <label>Height (U)</label>
          <input
            type="number" min={1}
            value={value('rows')}
            onChange={(e) => setDraft((d) => ({ ...d, rows: Math.max(1, Number(e.target.value) || 1) }))}
          />
        </div>
        <div className="field">
          <label>Placement</label>
          <select
            value={value('layout')}
            onChange={(e) => setDraft((d) => ({ ...d, layout: e.target.value as Layout }))}
          >
            <option value="grid">Grid</option>
            <option value="free">Free</option>
          </select>
        </div>
      </div>

      {overflowing.length > 0 && (
        <p className="hint" style={{ color: 'var(--danger)' }}>
          {overflowing.map((c) => c.c.name).join(', ')} would fall outside a grid that size.
        </p>
      )}

      <div className="row-actions">
        <button
          className="btn primary"
          disabled={!dirty}
          onClick={() => {
            onSaveWorkspace(draft);
            setDraft({});
          }}
        >
          Save
        </button>
        {dirty && <button className="btn" onClick={() => setDraft({})}>Cancel</button>}
      </div>
    </div>
  );
}

function ItemRow({
  item,
  holder,
  onClick,
  onSetQty,
}: {
  item: Item;
  holder: Node;
  onClick: () => void;
  onSetQty: (stockId: number, qty: number) => void;
}) {
  const low = item.part.min_qty != null && item.stock.qty < item.part.min_qty;
  const slot = slotOf(item);
  return (
    <div className="item" onClick={onClick}>
      <span className="name">{item.part.name}</span>
      <span
        className="where"
        title={
          slot
            ? `Slot ${cellAddress(holder.c, { ...holder.c, ...slot }) ?? ''} · ${size(slot)} U`
            : 'No room on the grid — only listed'
        }
      >
        {slot ? size(slot) : '—'}
      </span>
      <button
        className="btn ghost"
        title="One fewer"
        onClick={(e) => {
          e.stopPropagation();
          onSetQty(item.stock.id, Math.max(0, item.stock.qty - 1));
        }}
      >
        −
      </button>
      <span className={low ? 'qty low' : 'qty'}>{fmtQty(item.stock.qty)}</span>
      <button
        className="btn ghost"
        title="One more"
        onClick={(e) => {
          e.stopPropagation();
          onSetQty(item.stock.id, item.stock.qty + 1);
        }}
      >
        +
      </button>
    </div>
  );
}

function AddStock({
  node,
  onAddStock,
}: {
  node: Node;
  onAddStock: SidebarProps['onAddStock'];
}) {
  const [name, setName] = useState('');
  const [qty, setQty] = useState('1');

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onAddStock(node.c.id, trimmed, Number(qty) || 0);
    setName('');
    setQty('1');
  };

  return (
    <div className="panel-section">
      <div className="panel-title">Put an item in here</div>
      <div className="inline-form">
        <input
          className="grow"
          placeholder="Item name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          list={PART_NAME_LIST}
          autoComplete="off"
        />
        <input
          className="qty"
          type="number"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
        <button className="btn primary" onClick={submit}>Add</button>
      </div>
      <p className="hint">
        An existing part of the same name is reused, so the same resistor can live in two drawers.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------- part */

const PART_FIELDS: { key: keyof Part; label: string }[] = [
  { key: 'description', label: 'Description' },
  { key: 'part_number', label: 'Part number' },
  { key: 'manufacturer', label: 'Manufacturer' },
  { key: 'category', label: 'Category' },
  { key: 'package', label: 'Package' },
  { key: 'value', label: 'Value' },
  { key: 'tags', label: 'Tags' },
  { key: 'datasheet_url', label: 'Datasheet URL' },
];

function PartPanel(props: SidebarProps & { item: Item }) {
  const { item, tree, onSelectItem, onSavePart, onRemoveStock, onSetQty, onOpen, node } = props;
  const [draft, setDraft] = useState<Partial<Part>>({});
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setDraft({});
    setOpen(false);
  }, [item.part.id]);

  const value = (key: keyof Part) => (draft[key] as string | undefined) ?? (item.part[key] as string | null) ?? '';
  const set = (key: keyof Part, v: string) => setDraft((d) => ({ ...d, [key]: v }));
  const dirty = Object.keys(draft).length > 0;

  // Everywhere else this same part is stocked.
  const elsewhere = tree.flat
    .flatMap((n) => n.items.map((it) => ({ n, it })))
    .filter(({ it }) => it.part.id === item.part.id && it.stock.id !== item.stock.id);

  return (
    <>
      <div className="panel-section">
        <div className="panel-title">
          <span>Item</span>
          <span className="spacer" />
          <button className="btn ghost" onClick={() => onSelectItem(null, node)}>← Back</button>
        </div>

        <div className="field">
          <label>Name</label>
          <input value={value('name')} onChange={(e) => set('name', e.target.value)} />
        </div>

        <div className="grid-3">
          <div className="field">
            <label>Quantity</label>
            <input
              type="number"
              value={item.stock.qty}
              onChange={(e) => onSetQty(item.stock.id, Number(e.target.value) || 0)}
            />
          </div>
          <div className="field">
            <label>Unit</label>
            <input value={value('unit')} onChange={(e) => set('unit', e.target.value)} />
          </div>
          <div className="field">
            <label>Min</label>
            <input
              type="number"
              value={(draft.min_qty as number | undefined) ?? item.part.min_qty ?? ''}
              onChange={(e) =>
                setDraft((d) => ({ ...d, min_qty: e.target.value === '' ? null : Number(e.target.value) }))
              }
            />
          </div>
        </div>

        {open &&
          PART_FIELDS.map((f) => (
            <div className="field" key={f.key}>
              <label>{f.label}</label>
              <input value={value(f.key)} onChange={(e) => set(f.key, e.target.value)} />
            </div>
          ))}

        <div className="row-actions">
          <button
            className="btn primary"
            disabled={!dirty}
            onClick={() => {
              onSavePart(item.part.id, draft);
              setDraft({});
            }}
          >
            Save
          </button>
          <button className="btn" onClick={() => setOpen((v) => !v)}>
            {open ? 'Fewer fields' : 'More fields'}
          </button>
          <button
            className="btn danger"
            title="Take it out of this space. The item stays in the catalogue."
            onClick={() => onRemoveStock(item.stock.id)}
          >
            Remove from here
          </button>
          <button
            className="btn danger"
            title="Delete the item itself, everywhere it is stored"
            onClick={() => {
              const where = elsewhere.length + 1;
              const message =
                where > 1
                  ? `Delete "${item.part.name}" from all ${where} spaces, and forget it entirely?`
                  : `Delete "${item.part.name}" entirely?`;
              if (confirm(message)) props.onDeletePart(item.part.id);
            }}
          >
            Delete part
          </button>
        </div>
      </div>

      <div className="panel-section">
        <div className="panel-title">Location</div>
        <div className="item-list">
          <div className="item on">
            <span className="name">{pathLabel(node)}</span>
            <span className="qty">{fmtQty(item.stock.qty)}</span>
          </div>
          {elsewhere.map(({ n, it }) => (
            <div key={it.stock.id} className="item" onClick={() => { onOpen(n); onSelectItem(it, n); }}>
              <span className="name">{pathLabel(n)}</span>
              <span className="qty">{fmtQty(it.stock.qty)}</span>
            </div>
          ))}
        </div>
        <p className="hint" style={{ marginTop: 8 }}>
          Total across all locations:{' '}
          {fmtQty(item.stock.qty + elsewhere.reduce((s, e) => s + e.it.stock.qty, 0))} {item.part.unit}
        </p>
      </div>

      <MoveStock {...props} />
    </>
  );
}

function MoveStock({ tree, item, onMoveStock }: SidebarProps & { item: Item }) {
  const [target, setTarget] = useState('');
  const options = tree.flat.filter((n) => n.c.id !== item.stock.container_id);

  return (
    <div className="panel-section">
      <div className="panel-title">Move it somewhere else</div>
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
            // Without this the long paths in the options push the button off-panel.
            minWidth: 0,
          }}
        >
          <option value="">Choose a space…</option>
          {options.map((n) => (
            <option key={n.c.id} value={n.c.id}>
              {pathLabel(n)}
            </option>
          ))}
        </select>
        <button
          className="btn"
          disabled={!target}
          onClick={() => {
            onMoveStock(item.stock.id, Number(target));
            setTarget('');
          }}
        >
          Move
        </button>
      </div>
    </div>
  );
}
