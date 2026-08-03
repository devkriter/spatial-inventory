import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { cellAddress, size, slotOf } from '../layout';
import { colorOf } from '../palette';
import type { SearchResult } from '../search';
import type { Tree } from '../tree';
import { WORLD_ID, type Item, type Node, type Part } from '../types';
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
  selectedStockId: number | null;
  /** Parts in the catalogue that are not stored anywhere at all. */
  displaced: Part[];
  selectedPartId: number | null;
  search: SearchResult;
  searching: boolean;
  onOpen: (node: Node) => void;
  onReveal: (node: Node, item: Item | null) => void;
  onSelectDisplaced: (part: Part) => void;
  onClose: () => void;

  /* right-click actions */
  onRenameContainer: (node: Node, name: string) => void;
  /** Ask for a name in-app; the browser prompt is a different application. */
  onAskName: (title: string, value: string, apply: (name: string) => void) => void;
  onDeleteContainer: (node: Node) => void;
  onAddInside: (node: Node) => void;
  onMakeLabels: (node: Node) => void;
  onRenamePart: (partId: number, name: string) => void;
  onRemoveStock: (stockId: number) => void;
  onDeletePart: (partId: number) => void;
}

/** Guides drawn to the left of a row: one per ancestor level. */
interface Guides {
  /** For each ancestor, whether its branch continues below this row. */
  through: boolean[];
  /** This row is the last among its siblings, so its elbow closes off. */
  last: boolean;
}

/**
 * The whole inventory as an outline — every place, and every part in it. The map
 * answers "what is in this drawer"; this answers "where is everything", and is
 * the quicker way to walk somewhere several levels down.
 */
export function TreePanel(props: TreePanelProps) {
  const { tree, root, searching, search, displaced } = props;
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set([WORLD_ID]));
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
      title: node.c.name,
      items: [
        { label: 'Open', onPick: () => props.onOpen(node) },
        { label: 'Rename…', onPick: () => rename(node.c.name, (n) => props.onRenameContainer(node, n)) },
        { label: 'Add inside…', onPick: () => props.onAddInside(node) },
        { label: 'Labels…', onPick: () => props.onMakeLabels(node) },
        ...(node.c.id === WORLD_ID
          ? []
          : [{ label: 'Delete', danger: true, onPick: () => props.onDeleteContainer(node) }]),
      ],
    });

  const partMenu = (item: Item, holder: Node, e: { clientX: number; clientY: number }) =>
    setMenu({
      x: e.clientX,
      y: e.clientY,
      title: item.part.name,
      items: [
        { label: 'Show where it is', onPick: () => props.onReveal(holder, item) },
        {
          label: 'Rename…',
          onPick: () => rename(item.part.name, (n) => props.onRenamePart(item.part.id, n)),
        },
        {
          label: 'Remove from here',
          danger: true,
          onPick: () => props.onRemoveStock(item.stock.id),
        },
        {
          label: 'Delete item everywhere',
          danger: true,
          onPick: () => {
            if (confirm(`Delete "${item.part.name}" entirely?`)) props.onDeletePart(item.part.id);
          },
        },
      ],
    });

  // Keep open the branch you are standing in, and the one holding the selection.
  useEffect(() => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.add(WORLD_ID);
      for (const c of root.path) next.add(c.id);
      next.add(root.c.id);
      const picked = props.selectedId != null ? tree.byId.get(props.selectedId) : undefined;
      if (picked) {
        for (const c of picked.path) next.add(c.id);
        next.add(picked.c.id);
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
    chain.add(WORLD_ID);
    for (const c of picked.path) chain.add(c.id);
    chain.delete(picked.c.id); // the selection itself is marked differently
    return chain;
  }, [props.selectedId, tree]);

  // While searching, open every branch that leads to a hit and hide the rest.
  const visible = useMemo(() => {
    if (!searching) return null;
    const keep = new Set<number>([WORLD_ID]);
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
    ? displaced.filter((p) => search.hits.some((h) => h.item?.part.id === p.id))
    : displaced;

  const rows: ReactNode[] = [];
  walk(props.location, { through: [], last: true });

  function walk(node: Node, guides: Guides) {
    if (visible && !visible.has(node.c.id)) return;

    const isWorld = node.c.id === WORLD_ID;
    const items = searching
      ? node.items.filter((it) => search.matchedStock.has(it.stock.id))
      : node.items;
    // The synthetic Displaced branch hangs off the top level like a child would.
    const displacedBranch = isWorld && matchedDisplaced.length > 0;
    const kids = node.children.length + items.length + (displacedBranch ? 1 : 0);
    const open = expanded.has(node.c.id) || (!!visible && kids > 0);

    rows.push(
      <Row
        key={`c${node.c.id}`}
        guides={guides}
        depth={guides.through.length}
        kind="space"
        state={
          node.c.id === props.selectedId
            ? 'on'
            : node.c.id === root.c.id
              ? 'here'
              : ancestors.has(node.c.id)
                ? 'ancestor'
                : undefined
        }
        hit={searching && search.matched.has(node.c.id)}
        open={kids > 0 ? open : undefined}
        onToggle={() => toggle(node.c.id)}
        onClick={() => props.onOpen(node)}
        onContextMenu={(e) => placeMenu(node, e)}
        title={node.path.map((c) => c.name).join(' › ') || node.c.name}
        colour={colorOf(node) ?? '#8a6a45'}
        name={node.c.name}
        trailing={node.totalItems > 0 ? String(node.totalItems) : undefined}
      />
    );

    if (!open) return;

    // Work out which of these children is the last drawn thing, so its elbow
    // closes the branch rather than continuing it.
    const childCount = node.children.length + items.length + (displacedBranch ? 1 : 0);
    let drawn = 0;
    const nextGuides = (): Guides => {
      drawn += 1;
      return { through: [...guides.through, !guides.last], last: drawn === childCount };
    };

    for (const child of node.children) walk(child, nextGuides());

    for (const item of items) {
      const slot = slotOf(item);
      const g = nextGuides();
      rows.push(
        <Row
          key={`i${item.stock.id}`}
          guides={g}
          depth={g.through.length}
          kind="part"
          state={item.stock.id === props.selectedStockId ? 'on' : undefined}
          hit={searching && search.matchedStock.has(item.stock.id)}
          onClick={() => props.onReveal(node, item)}
          onContextMenu={(e) => partMenu(item, node, e)}
          title={`${item.part.name}\n${node.path.map((c) => c.name).join(' › ')}${
            slot ? `\nslot ${cellAddress(node.c, { ...node.c, ...slot }) ?? ''} · ${size(slot)}` : ''
          }`}
          slotted={!!slot}
          name={item.part.name}
          trailing={fmtQty(item.stock.qty)}
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
        matchedDisplaced.forEach((part, i) => {
          const inner: Guides = {
            through: [...g.through, !g.last],
            last: i === matchedDisplaced.length - 1,
          };
          rows.push(
            <Row
              key={`p${part.id}`}
              guides={inner}
              depth={inner.through.length}
              kind="part"
              state={part.id === props.selectedPartId ? 'on' : undefined}
              onClick={() => props.onSelectDisplaced(part)}
              title={`${part.name}\nNot stored anywhere — click to put it back or forget it`}
              slotted={false}
              name={part.name}
            />
          );
        });
      }
    }
  }

  const total = tree.flat.reduce((n, node) => n + node.items.length, 0);

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
  kind: 'space' | 'part' | 'displaced';
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

        {kind === 'part' ? (
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

const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ');
