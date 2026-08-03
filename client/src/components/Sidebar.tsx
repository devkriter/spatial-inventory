import { useEffect, useRef, useState } from 'react';
import { cellAddress, formatUnits, size, slotOf } from '../layout';
import { typeName } from '../palette';
import type { SearchResult } from '../search';
import {
  ROOT_ID,
  type Space,
  type Holding,
  type Layout,
  type Node,
  type Item,
  type RootSpace,
} from '../types';
import type { Tree } from '../tree';
import { fmtQty } from './SpaceView';
import { DisplacedPanel } from './DisplacedPanel';
import { ITEM_NAME_LIST } from './ItemNames';

export interface SidebarProps {
  tree: Tree;
  onClose: () => void;
  /** What the panel is describing — the selection, or the current level. */
  node: Node;
  /** The level currently being drawn, so the panel can say where you are. */
  root: Node;
  selected: Holding | null;
  search: SearchResult;
  searching: boolean;
  /** Jump to a search hit and highlight it where it lives. */
  onReveal: (node: Node, holding: Holding | null) => void;
  onOpen: (node: Node) => void;
  onSelectHolding: (holding: Holding | null, holder: Node) => void;
  onAddChild: (parent: Node) => void;
  onEditSpace: (node: Node) => void;
  onMakeLabels: (node: Node) => void;
  onDeleteSpace: (node: Node) => void;
  onAddHolding: (spaceId: number, name: string, qty: number) => void;
  onSetQty: (holdingId: number, qty: number) => void;
  onRemoveHolding: (holdingId: number) => void;
  rootSpace: RootSpace;
  onSaveRootSpace: (patch: Partial<RootSpace>) => void;
  /** Save a location's own name and grid — it has no parent to be edited from. */
  onSaveLocation: (node: Node, patch: Partial<Space>) => void;
  onSaveItem: (itemId: number, patch: Partial<Item>) => void;
  onMoveHolding: (holdingId: number, spaceId: number) => void;
  /** A displaced item chosen in the tree, if any — it has no location to show. */
  displacedItem: Item | null;
  onPlaceDisplaced: (itemId: number, spaceId: number, qty: number) => void;
  onDismissDisplaced: () => void;
  onDeleteItem: (itemId: number) => void;
  /** Rendered as a bottom sheet rather than a side panel — the phone form. */
  sheet?: boolean;
  /** Sheet only: whether it is at full height, and how to change that. */
  expanded?: boolean;
  onToggleHeight?: () => void;
  /** Sheet only: how tall it ended up, so the map can stay clear of it. */
  onHeight?: (px: number) => void;
}

export function Sidebar(props: SidebarProps) {
  const { searching, selected, sheet, onHeight } = props;

  // Report how much of the screen this covers, measured rather than derived
  // from the CSS so the two can never drift apart. Observed rather than read
  // once, because the sheet animates between its peek and full heights.
  const asideRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = asideRef.current;
    if (!el || !onHeight) return;
    if (!sheet) {
      onHeight(0);
      return;
    }
    const report = () => onHeight(el.getBoundingClientRect().height);
    report();
    const observer = new ResizeObserver(report);
    observer.observe(el);
    return () => {
      observer.disconnect();
      onHeight(0);
    };
  }, [sheet, onHeight]);
  // Collapsed on a phone this is a band, not a panel: one row naming whatever
  // is selected, with room for shortcuts alongside it later. The old collapsed
  // state was 42% of the screen, which is a great deal of map to spend on a
  // preview of something you can already see.
  if (sheet && !props.expanded) {
    const subject = props.displacedItem?.name ?? selected?.item.name ?? props.node.space.name;
    return (
      <aside ref={asideRef} className="sidebar sheet band">
        <button className="band-open" onClick={props.onToggleHeight}>
          <span className="band-label">Details</span>
          <span className="band-subject">{subject}</span>
          <span className="band-caret">▲</span>
        </button>
      </aside>
    );
  }

  return (
    <aside
      ref={asideRef}
      className={sheet ? `sidebar sheet${props.expanded ? ' full' : ''}` : 'sidebar'}
    >
      {sheet && (
        // The whole strip is the target, not just the little bar drawn on it —
        // a 4px handle is not something you can reliably hit with a thumb.
        <button
          className="sheet-grab"
          onClick={props.onToggleHeight}
          aria-label="Collapse to the band"
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
        {props.displacedItem ? (
          <DisplacedPanel
            item={props.displacedItem}
            tree={props.tree}
            onSaveItem={props.onSaveItem}
            onPlace={props.onPlaceDisplaced}
            onForget={props.onDeleteItem}
            onDismiss={props.onDismissDisplaced}
          />
        ) : (
          <>
            {searching && <Results {...props} />}
            {selected ? <ItemPanel {...props} holding={selected} /> : <NodePanel {...props} />}
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
          key={hit.holding ? `i${hit.holding.row.id}` : `c${hit.node.space.id}`}
          className="result"
          onClick={() => onReveal(hit.node, hit.holding ?? null)}
        >
          <div className="r-name">
            <span className="grow">{hit.holding ? hit.holding.item.name : hit.node.space.name}</span>
            {hit.holding ? (
              <span className="badge">{fmtQty(hit.holding.row.qty)}</span>
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

/* -------------------------------------------------------------- space */

function NodePanel(props: SidebarProps) {
  const { node, root, onOpen, onSelectHolding, onAddChild, onEditSpace, onDeleteSpace } = props;
  const isRoot = node.space.id === ROOT_ID;
  // A location has nothing above it, so its own grid is set from here rather
  // than from a parent that does not exist.
  const isLocation = !isRoot && node.space.parent_id == null;
  const address = node.parent ? cellAddress(node.parent.space, node.space) : null;
  // Selected something without walking into it: say so, and offer the way in.
  const justSelected = node.space.id !== root.space.id;
  const loose = node.holdings.filter((holding) => !slotOf(holding));

  return (
    <>
      <div className="panel-section">
        {/* Say plainly whether this is the level you are standing in or just
            something you clicked, otherwise the two are indistinguishable. */}
        <div className="panel-title" style={{ marginBottom: 6 }}>
          {justSelected
            ? `Selected — inside ${root.space.name}`
            : isRoot
              ? 'You are at the top'
              : 'You are inside'}
        </div>
        <div className="node-title">
          <h2>{node.space.name}</h2>
        </div>
        <div className="node-sub">
          {isRoot
            ? `${formatUnits(node.space)} ${node.space.layout} · everything you have`
            : `${typeName(node)} · ${formatUnits(node.space)} ${node.space.layout} inside` +
              (node.parent
                ? ` · ${size(node.space)} U on the front of ${node.parent.space.name}${address ? ` at ${address}` : ''}`
                : '')}
        </div>

        <div className="stat-row">
          <div className="stat">
            <div className="v">{node.totalSpaces}</div>
            <div className="k">spaces</div>
          </div>
          <div className="stat">
            <div className="v">{node.totalHoldings}</div>
            <div className="k">items</div>
          </div>
          <div className="stat">
            <div className="v">{fmtQty(node.totalQty)}</div>
            <div className="k">units</div>
          </div>
        </div>

        {node.space.notes && <p className="hint" style={{ marginTop: 0 }}>{node.space.notes}</p>}

        <div className="row-actions">
          {justSelected && (
            <button className="btn primary" onClick={() => onOpen(node)}>Open ↵</button>
          )}
          <button className={justSelected ? 'btn' : 'btn primary'} onClick={() => onAddChild(node)}>
            + Add
          </button>
          {!isRoot && <button className="btn" onClick={() => onEditSpace(node)}>Edit</button>}
          <button
            className="btn"
            onClick={() => props.onMakeLabels(node)}
            title={`Labels for ${node.space.name}, or for everything inside it`}
          >
            🏷 Labels
          </button>
          {!isRoot && (
            <button className="btn danger" onClick={() => onDeleteSpace(node)}>Delete</button>
          )}
        </div>
      </div>

      {!isRoot && <AddHolding node={node} onAddHolding={props.onAddHolding} />}

      {node.children.length > 0 && (
        <div className="panel-section">
          <div className="panel-title">
            <span>Inside</span>
            <span className="spacer" />
            <span className="badge">{node.children.length}</span>
          </div>
          <div className="item-list">
            {node.children.map((child) => (
              <div key={child.space.id} className="item" onClick={() => onOpen(child)}>
                <span className="name">{child.space.name}</span>
                <span className="where">
                  {cellAddress(node.space, child.space) ?? ''} {size(child.space)}
                </span>
                <span className="qty">{child.totalHoldings || ''}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {isLocation && <RoomEditor {...props} />}

      {node.holdings.length > 0 && (
        <div className="panel-section">
          <div className="panel-title">
            <span>Items here</span>
            <span className="spacer" />
            <span className="badge">{node.holdings.length}</span>
          </div>
          {loose.length > 0 && (
            <p className="hint" style={{ marginTop: 0, marginBottom: 8, color: 'var(--danger)' }}>
              {loose.length} {loose.length === 1 ? 'item has' : 'items have'} no room on the{' '}
              {node.space.cols} × {node.space.rows} grid, so {loose.length === 1 ? 'it is' : 'they are'} only
              listed. Make the grid bigger with <b>Edit</b>.
            </p>
          )}
          <div className="item-list">
            {node.holdings.map((holding) => (
              <HoldingLine
                key={holding.row.id}
                holding={holding}
                holder={node}
                onClick={() => onSelectHolding(holding, node)}
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
 * A location has no parent to be edited from, so its own name and grid are set
 * here. Making it bigger never moves anything; making it smaller can leave
 * furniture hanging past the edge, so that is called out rather than silently
 * clamped.
 */
function RoomEditor({ onSaveLocation, node }: SidebarProps) {
  const [draft, setDraft] = useState<Partial<Space>>({});
  // A fresh location resets the form — otherwise a half-typed name would follow
  // you from one room to the next.
  useEffect(() => setDraft({}), [node.space.id]);
  const value = <K extends keyof Space>(key: K): Space[K] =>
    (draft[key] as Space[K]) ?? node.space[key];
  const dirty = Object.keys(draft).length > 0;

  const overflowing = node.children.filter(
    (c) => c.space.x + c.space.w > Number(value('cols')) || c.space.y + c.space.h > Number(value('rows'))
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
          {overflowing.map((c) => c.space.name).join(', ')} would fall outside a grid that size.
        </p>
      )}

      <div className="row-actions">
        <button
          className="btn primary"
          disabled={!dirty}
          onClick={() => {
            onSaveLocation(node, draft);
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

function HoldingLine({
  holding,
  holder,
  onClick,
  onSetQty,
}: {
  holding: Holding;
  holder: Node;
  onClick: () => void;
  onSetQty: (holdingId: number, qty: number) => void;
}) {
  const low = holding.item.min_qty != null && holding.row.qty < holding.item.min_qty;
  const slot = slotOf(holding);
  return (
    <div className="item" onClick={onClick}>
      <span className="name">{holding.item.name}</span>
      <span
        className="where"
        title={
          slot
            ? `Slot ${cellAddress(holder.space, { ...holder.space, ...slot }) ?? ''} · ${size(slot)} U`
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
          onSetQty(holding.row.id, Math.max(0, holding.row.qty - 1));
        }}
      >
        −
      </button>
      <span className={low ? 'qty low' : 'qty'}>{fmtQty(holding.row.qty)}</span>
      <button
        className="btn ghost"
        title="One more"
        onClick={(e) => {
          e.stopPropagation();
          onSetQty(holding.row.id, holding.row.qty + 1);
        }}
      >
        +
      </button>
    </div>
  );
}

function AddHolding({
  node,
  onAddHolding,
}: {
  node: Node;
  onAddHolding: SidebarProps['onAddHolding'];
}) {
  const [name, setName] = useState('');
  const [qty, setQty] = useState('1');

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onAddHolding(node.space.id, trimmed, Number(qty) || 0);
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
          list={ITEM_NAME_LIST}
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
        An existing item of the same name is reused, so the same resistor can live in two drawers.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------- item */

const ITEM_FIELDS: { key: keyof Item; label: string }[] = [
  { key: 'description', label: 'Description' },
  { key: 'part_number', label: 'Part number' },
  { key: 'manufacturer', label: 'Manufacturer' },
  { key: 'category', label: 'Category' },
  { key: 'package', label: 'Package' },
  { key: 'value', label: 'Value' },
  { key: 'tags', label: 'Tags' },
  { key: 'datasheet_url', label: 'Datasheet URL' },
];

function ItemPanel(props: SidebarProps & { holding: Holding }) {
  const { holding, tree, onSelectHolding, onSaveItem, onRemoveHolding, onSetQty, onOpen, node } = props;
  const [draft, setDraft] = useState<Partial<Item>>({});
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setDraft({});
    setOpen(false);
  }, [holding.item.id]);

  const value = (key: keyof Item) => (draft[key] as string | undefined) ?? (holding.item[key] as string | null) ?? '';
  const set = (key: keyof Item, v: string) => setDraft((d) => ({ ...d, [key]: v }));
  const dirty = Object.keys(draft).length > 0;

  // Everywhere else this same item is held.
  const elsewhere = tree.flat
    .flatMap((n) => n.holdings.map((it) => ({ n, it })))
    .filter(({ it }) => it.item.id === holding.item.id && it.row.id !== holding.row.id);

  return (
    <>
      <div className="panel-section">
        <div className="panel-title">
          <span>Item</span>
          <span className="spacer" />
          <button className="btn ghost" onClick={() => onSelectHolding(null, node)}>← Back</button>
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
              value={holding.row.qty}
              onChange={(e) => onSetQty(holding.row.id, Number(e.target.value) || 0)}
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
              value={(draft.min_qty as number | undefined) ?? holding.item.min_qty ?? ''}
              onChange={(e) =>
                setDraft((d) => ({ ...d, min_qty: e.target.value === '' ? null : Number(e.target.value) }))
              }
            />
          </div>
        </div>

        {open &&
          ITEM_FIELDS.map((f) => (
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
              onSaveItem(holding.item.id, draft);
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
            onClick={() => onRemoveHolding(holding.row.id)}
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
                  ? `Delete "${holding.item.name}" from all ${where} spaces, and forget it entirely?`
                  : `Delete "${holding.item.name}" entirely?`;
              if (confirm(message)) props.onDeleteItem(holding.item.id);
            }}
          >
            Delete item
          </button>
        </div>
      </div>

      <div className="panel-section">
        <div className="panel-title">Location</div>
        <div className="item-list">
          <div className="item on">
            <span className="name">{pathLabel(node)}</span>
            <span className="qty">{fmtQty(holding.row.qty)}</span>
          </div>
          {elsewhere.map(({ n, it }) => (
            <div key={it.row.id} className="item" onClick={() => { onOpen(n); onSelectHolding(it, n); }}>
              <span className="name">{pathLabel(n)}</span>
              <span className="qty">{fmtQty(it.row.qty)}</span>
            </div>
          ))}
        </div>
        <p className="hint" style={{ marginTop: 8 }}>
          Total across all locations:{' '}
          {fmtQty(holding.row.qty + elsewhere.reduce((s, e) => s + e.it.row.qty, 0))} {holding.item.unit}
        </p>
      </div>

      <MoveHolding {...props} />
    </>
  );
}

function MoveHolding({ tree, holding, onMoveHolding }: SidebarProps & { holding: Holding }) {
  const [target, setTarget] = useState('');
  const options = tree.flat.filter((n) => n.space.id !== holding.row.space_id);

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
            <option key={n.space.id} value={n.space.id}>
              {pathLabel(n)}
            </option>
          ))}
        </select>
        <button
          className="btn"
          disabled={!target}
          onClick={() => {
            onMoveHolding(holding.row.id, Number(target));
            setTarget('');
          }}
        >
          Move
        </button>
      </div>
    </div>
  );
}
