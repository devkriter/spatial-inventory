import { ROOT_ID, type Node, type Space, type State } from './types';

export interface Tree {
  /** The synthetic node above the locations. */
  rootSpace: Node;
  /** The locations: every space with nothing above it. */
  roots: Node[];
  byId: Map<number, Node>;
  /** Every real node, parents before children. */
  flat: Node[];
}

/** Present the root row as a space so every level is handled alike. */
const rootAsSpace = (state: State): Space => ({
  id: ROOT_ID,
  parent_id: null,
  type_id: null,
  name: state.rootSpace?.name ?? 'Workshop',
  x: 0,
  y: 0,
  w: 1,
  h: 1,
  layout: state.rootSpace?.layout ?? 'grid',
  cols: state.rootSpace?.cols ?? 24,
  rows: state.rootSpace?.rows ?? 16,
  row_origin: state.rootSpace?.row_origin ?? 'top',
  color: null,
  notes: null,
  sort: 0,
  created_at: '',
  updated_at: '',
});

/**
 * Turn the flat tables into a tree with the aggregates the views need.
 * Cheap enough (a few thousand rows) to redo on every state change.
 */
export function buildTree(state: State): Tree {
  const byId = new Map<number, Node>();
  const itemsById = new Map(state.items.map((i) => [i.id, i]));
  const typesById = new Map(state.types.map((t) => [t.id, t]));

  for (const space of state.spaces) {
    byId.set(space.id, {
      space,
      type: space.type_id != null ? typesById.get(space.type_id) ?? null : null,
      children: [],
      parent: null,
      depth: 0,
      holdings: [],
      totalHoldings: 0,
      totalQty: 0,
      totalSpaces: 0,
      path: [],
    });
  }

  for (const row of state.holdings) {
    const node = byId.get(row.space_id);
    const item = itemsById.get(row.item_id);
    if (node && item) node.holdings.push({ row, item });
  }

  const roots: Node[] = [];
  for (const node of byId.values()) {
    const parent = node.space.parent_id != null ? byId.get(node.space.parent_id) : undefined;
    if (parent) {
      node.parent = parent;
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const bySort = (a: Node, b: Node) =>
    a.space.sort - b.space.sort ||
    a.space.y - b.space.y ||
    a.space.x - b.space.x ||
    a.space.id - b.space.id;
  roots.sort(bySort);
  for (const node of byId.values()) {
    node.children.sort(bySort);
    node.holdings.sort((a, b) =>
      a.item.name.localeCompare(b.item.name, undefined, { numeric: true })
    );
  }

  // Depth, path and rolled-up totals in one post-order walk.
  const flat: Node[] = [];
  const visit = (node: Node, depth: number, path: Space[]) => {
    node.depth = depth;
    node.path = [...path, node.space];
    flat.push(node);
    let holdings = node.holdings.length;
    let qty = node.holdings.reduce((sum, held) => sum + held.row.qty, 0);
    let spaces = node.children.length;
    for (const child of node.children) {
      visit(child, depth + 1, node.path);
      holdings += child.totalHoldings;
      qty += child.totalQty;
      spaces += child.totalSpaces;
    }
    node.totalHoldings = holdings;
    node.totalQty = qty;
    node.totalSpaces = spaces;
  };
  for (const root of roots) visit(root, 0, []);

  // A synthetic node owning the locations, so the top view is uniform.
  const rootSpace: Node = {
    space: rootAsSpace(state),
    type: null,
    children: roots,
    parent: null,
    depth: -1,
    holdings: [],
    totalHoldings: roots.reduce((s, r) => s + r.totalHoldings, 0),
    totalQty: roots.reduce((s, r) => s + r.totalQty, 0),
    totalSpaces: roots.reduce((s, r) => s + r.totalSpaces + 1, 0),
    path: [],
  };

  byId.set(ROOT_ID, rootSpace);
  return { rootSpace, roots, byId, flat };
}
