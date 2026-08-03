import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { cellAddress, size, slotOf } from '../layout';
import { colorOf } from '../palette';
import type { SearchResult } from '../search';
import type { Tree } from '../tree';
import { ROOT_ID, type Holding, type Node, type Item } from '../types';
import { fmtQty } from './SpaceView';
import { ContextMenu, type MenuItem } from './ContextMenu';

export interface TreePanelProps {
  tree: Tree;
  /** The level currently on screen, so it can be marked and revealed. */
  root: Node;
  /**
   * The location the tree is showing. Each location is a tree in its own right,
   * so only one is ever listed — switching between them is the toolbar's job,
   * and stacking them all here would bury the one you are actually working in.
   */
  location: Node;
  selectedId: number | null;
  selectedHoldingId: number | null;
  /** Items in the catalogue that are not stored anywhere at all. */
  displaced: Item[];
  selectedItemId: number | null;
  search: SearchResult;
  searching: boolean;
  onOpen: (node: Node) => void;
  onReveal: (node: Node, holding: Holding | null) => void;
  onSelectDisplaced: (item: Item) => void;
  onClose: () => void;

  /* right-click actions */
  onRenameSpace: (node: Node, name: string) => void;
  /** Ask for a name in-app; the browser prompt is a different application. */
  onAskName: (title: string, value: string, apply: (name: string) => void) => void;
  onDeleteSpace: (node: Node) => void;
  onAddInside: (node: Node) => void;
  onMakeLabels: (node: Node) => void;
  onRenameItem: (itemId: number, name: string) => void;
  onRemoveHolding: (holdingId: number) => void;
  onDeleteItem: (itemId: number) => void;
}

/** Guides drawn to the left of a row: one per ancestor level. */
interface Guides {
  /** For each ancestor, whether its branch continues below this row. */
  through: boolean[];
  /** This row is the last among its siblings, so its elbow closes off. */
  last: boolean;
}

/**
 * The whole inventory as an outline — every place, and every item in it. The map
 * answers "what is in this drawer"; this answers "where is everything", and is
 * the quicker way to walk somewhere several levels down.
 */
export function TreePanel(props: TreePanelProps) {
  const { tree, root, searching, search, displaced } = props;
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set([ROOT_ID]));
  const [showDisplaced, setShowDisplaced] = useState(true);
  const [menu, setMenu] = useState<{ x: number; y: number; title: string; items: MenuItem[] } | null>(
    null
  );

  const rename = (current: string, apply: (next: string) => void) =>
    props.onAskName('Rename', current, apply);

  const placeMenu = (node: Node, e: { clientX: number; clientY: number }) =>
    setMenu({
      x: e.clientX,
      y: e.clientY,
      title: node.space.name,
      items: [
        { label: 'Open', onPick: () => props.onOpen(node) },
        { label: 'Rename…', onPick: () => rename(node.space.name, (n) => props.onRenameSpace(node, n)) },
        { label: 'Add inside…', onPick: () => props.onAddInside(node) },
        { label: 'Labels…', onPick: () => props.onMakeLabels(node) },
        ...(node.space.id === ROOT_ID
          ? []
          : [{ label: 'Delete', danger: true, onPick: () => props.onDeleteSpace(node) }]),
      ],
    });

  const holdingMenu = (holding: Holding, holder: Node, e: { clientX: number; clientY: number }) =>
    setMenu({
      x: e.clientX,
      y: e.clientY,
      title: holding.item.name,
      items: [
        { label: 'Show where it is', onPick: () => props.onReveal(holder, holding) },
        {
          label: 'Rename…',
          onPick: () => rename(holding.item.name, (n) => props.onRenameItem(holding.item.id, n)),
        },
        {
          label: 'Remove from here',
          danger: true,
          onPick: () => props.onRemoveHolding(holding.row.id),
        },
        {
          label: 'Delete item everywhere',
          danger: true,
          onPick: () => {
            if (confirm(`Delete "${holding.item.name}" entirely?`)) props.onDeleteItem(holding.item.id);
          },
        },
      ],
    });

  // Keep open the branch you are standing in, and the one holding the selection.
  useEffect(() => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.add(ROOT_ID);
      for (const c of root.path) next.add(c.id);
      next.add(root.space.id);
      const picked = props.selectedId != null ? tree.byId.get(props.selectedId) : undefined;
      if (picked) {
        for (const c of picked.path) next.add(c.id);
        next.add(picked.space.id);
      }
      return next;
    });
  }, [root, props.selectedId, tree]);

  /**
   * Everything the selection sits inside, so the whole chain lights up rather
   * than one lonely row — the same read as Fusion's browser, where selecting a
   * body tells you which component it belongs to without hunting.
   */
  const ancestors = useMemo(() => {
    const picked = props.selectedId != null ? tree.byId.get(props.selectedId) : undefined;
    const chain = new Set<number>();
    if (!picked) return chain; // nothing selected: nothing to trace
    chain.add(ROOT_ID);
    for (const c of picked.path) chain.add(c.id);
    chain.delete(picked.space.id); // the selection itself is marked differently
    return chain;
  }, [props.selectedId, tree]);

  // While searching, open every branch that leads to a hit and hide the rest.
  const visible = useMemo(() => {
    if (!searching) return null;
    const keep = new Set<number>([ROOT_ID]);
    for (const id of search.matched) keep.add(id);
    for (const id of search.onPath) keep.add(id);
    return keep;
  }, [searching, search]);

  const toggle = (id: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const matchedDisplaced = searching
    ? displaced.filter((p) => search.hits.some((h) => h.holding?.item.id === p.id))
    : displaced;

  const rows: ReactNode[] = [];
  walk(props.location, { through: [], last: true });

  function walk(node: Node, guides: Guides) {
    if (visible && !visible.has(node.space.id)) return;

    const isRoot = node.space.id === ROOT_ID;
    const holdings = searching
      ? node.holdings.filter((it) => search.matchedHoldings.has(it.row.id))
      : node.holdings;
    // The synthetic Displaced branch hangs off the top level like a child would.
    const displacedBranch = isRoot && matchedDisplaced.length > 0;
    const kids = node.children.length + holdings.length + (displacedBranch ? 1 : 0);
    const open = expanded.has(node.space.id) || (!!visible && kids > 0);

    rows.push(
      <Row
        key={`c${node.space.id}`}
        guides={guides}
        depth={guides.through.length}
        kind="space"
        state={
          node.space.id === props.selectedId
            ? 'on'
            : node.space.id === root.space.id
              ? 'here'
              : ancestors.has(node.space.id)
                ? 'ancestor'
                : undefined
        }
        hit={searching && search.matched.has(node.space.id)}
        open={kids > 0 ? open : undefined}
        onToggle={() => toggle(node.space.id)}
        onClick={() => props.onOpen(node)}
        onContextMenu={(e) => placeMenu(node, e)}
        title={node.path.map((c) => c.name).join(' › ') || node.space.name}
        colour={colorOf(node) ?? '#8a6a45'}
        name={node.space.name}
        trailing={node.totalHoldings > 0 ? String(node.totalHoldings) : undefined}
      />
    );

    if (!open) return;

    // Work out which of these children is the last drawn thing, so its elbow
    // closes the branch rather than continuing it.
    const childCount = node.children.length + holdings.length + (displacedBranch ? 1 : 0);
    let drawn = 0;
    const nextGuides = (): Guides => {
      drawn += 1;
      return { through: [...guides.through, !guides.last], last: drawn === childCount };
    };

    for (const child of node.children) walk(child, nextGuides());

    for (const holding of holdings) {
      const slot = slotOf(holding);
      const g = nextGuides();
      rows.push(
        <Row
          key={`i${holding.row.id}`}
          guides={g}
          depth={g.through.length}
          kind="holding"
          state={holding.row.id === props.selectedHoldingId ? 'on' : undefined}
          hit={searching && search.matchedHoldings.has(holding.row.id)}
          onClick={() => props.onReveal(node, holding)}
          onContextMenu={(e) => holdingMenu(holding, node, e)}
          title={`${holding.item.name}\n${node.path.map((c) => c.name).join(' › ')}${
            slot ? `\nslot ${cellAddress(node.space, { ...node.space, ...slot }) ?? ''} · ${size(slot)}` : ''
          }`}
          slotted={!!slot}
          name={holding.item.name}
          trailing={fmtQty(holding.row.qty)}
        />
      );
    }

    if (displacedBranch) {
      const g = nextGuides();
      rows.push(
        <Row
          key="displaced"
          guides={g}
          depth={g.through.length}
          kind="displaced"
          open={showDisplaced}
          onToggle={() => setShowDisplaced((v) => !v)}
          onClick={() => setShowDisplaced((v) => !v)}
          title="Items you still have a record of, but which are not stored anywhere"
          colour="#8a5060"
          name="Displaced"
          trailing={String(matchedDisplaced.length)}
        />
      );
      if (showDisplaced) {
        matchedDisplaced.forEach((item, i) => {
          const inner: Guides = {
            through: [...g.through, !g.last],
            last: i === matchedDisplaced.length - 1,
          };
          rows.push(
            <Row
              key={`p${item.id}`}
              guides={inner}
              depth={inner.through.length}
              kind="holding"
              state={item.id === props.selectedItemId ? 'on' : undefined}
              onClick={() => props.onSelectDisplaced(item)}
              title={`${item.name}\nNot stored anywhere — click to put it back or forget it`}
              slotted={false}
              name={item.name}
            />
          );
        });
      }
    }
  }

  const total = tree.flat.reduce((n, node) => n + node.holdings.length, 0);

  return (
    <aside className="tree-sidebar">
      <div className="side-head">
        <span className="title">{searching ? 'Matching branches' : 'Everything'}</span>
        <span className="badge">{searching ? search.hits.length : total}</span>
        <button className="btn ghost" onClick={props.onClose} title="Collapse this panel">
          ◂
        </button>
      </div>

      <div className="tree-scroll">
        {rows.length <= 1 && (
          <p className="hint">{searching ? 'Nothing matches.' : 'Nothing stored yet.'}</p>
        )}
        <div className="tree-rows">{rows}</div>
      </div>

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          title={menu.title}
          items={menu.items}
          onClose={() => setMenu(null)}
        />
      )}
    </aside>
  );
}

/* --------------------------------------------------------------------- row */

interface RowProps {
  guides: Guides;
  depth: number;
  kind: 'space' | 'holding' | 'displaced';
  state?: 'here' | 'on' | 'ancestor';
  hit?: boolean;
  /** Undefined when there is nothing to expand. */
  open?: boolean;
  onToggle?: () => void;
  onClick: () => void;
  onContextMenu?: (e: { clientX: number; clientY: number }) => void;
  title: string;
  colour?: string;
  slotted?: boolean;
  name: string;
  trailing?: string;
}

function Row({
  guides,
  kind,
  state,
  hit,
  open,
  onToggle,
  onClick,
  onContextMenu,
  title,
  colour,
  slotted,
  name,
  trailing,
}: RowProps) {
  return (
    <div
      className={cx('tree-row', kind, state, hit && 'hit')}
      onContextMenu={(e) => {
        if (!onContextMenu) return;
        e.preventDefault();
        e.stopPropagation();
        onContextMenu(e);
      }}
    >
      <span className="t-guides">
        {guides.through.map((through, i) => (
          <i key={i} className={through ? 'g through' : 'g'} />
        ))}
        {guides.through.length > 0 && <i className={guides.last ? 'g elbow' : 'g elbow mid'} />}
      </span>

      <button className="t-box" onClick={onClick} title={title}>
        {open !== undefined ? (
          <span
            className="twisty"
            role="presentation"
            onClick={(e) => {
              e.stopPropagation();
              onToggle?.();
            }}
          >
            {open ? '▾' : '▸'}
          </span>
        ) : (
          <span className="twisty leaf" />
        )}

        {kind === 'holding' ? (
          /* Hollow only in the overflow case, where the grid had no room left. */
          <span className={cx('dot', 'square', slotted === false && 'hollow')} />
        ) : (
          <span className="dot" style={{ background: colour }} />
        )}

        <span className="t-name">{name}</span>
        {trailing && <span className="t-count">{trailing}</span>}
      </button>
    </div>
  );
}

const cx = (...classes: (string | false | null | undefined)[]) => classes.filter(Boolean).join(' ');
