import { WORLD_ID, type Container, type Node, type State } from './types';

export interface Tree {
  world: Node;
  roots: Node[];
  byId: Map<number, Node>;
  /** Every real node, parents before children. */
  flat: Node[];
}

/** Present the workspace row as a container so every level is handled alike. */
const worldContainer = (state: State): Container => ({
  id: WORLD_ID,
  parent_id: null,
  type_id: null,
  name: state.workspace?.name ?? 'Workshop',
  x: 0,
  y: 0,
  w: 1,
  h: 1,
  layout: state.workspace?.layout ?? 'grid',
  cols: state.workspace?.cols ?? 24,
  rows: state.workspace?.rows ?? 16,
  row_origin: state.workspace?.row_origin ?? 'top',
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
  const partsById = new Map(state.parts.map((p) => [p.id, p]));
  const typesById = new Map(state.types.map((t) => [t.id, t]));

  for (const c of state.containers) {
    byId.set(c.id, {
      c,
      type: c.type_id != null ? typesById.get(c.type_id) ?? null : null,
      children: [],
      parent: null,
      depth: 0,
      items: [],
      totalItems: 0,
      totalQty: 0,
      totalContainers: 0,
      path: [],
    });
  }

  for (const s of state.stock) {
    const node = byId.get(s.container_id);
    const part = partsById.get(s.part_id);
    if (node && part) node.items.push({ stock: s, part });
  }

  const roots: Node[] = [];
  for (const node of byId.values()) {
    const parent = node.c.parent_id != null ? byId.get(node.c.parent_id) : undefined;
    if (parent) {
      node.parent = parent;
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const bySort = (a: Node, b: Node) =>
    a.c.sort - b.c.sort || a.c.y - b.c.y || a.c.x - b.c.x || a.c.id - b.c.id;
  roots.sort(bySort);
  for (const node of byId.values()) {
    node.children.sort(bySort);
    node.items.sort((a, b) => a.part.name.localeCompare(b.part.name, undefined, { numeric: true }));
  }

  // Depth, path and rolled-up totals in one post-order walk.
  const flat: Node[] = [];
  const visit = (node: Node, depth: number, path: Container[]) => {
    node.depth = depth;
    node.path = [...path, node.c];
    flat.push(node);
    let items = node.items.length;
    let qty = node.items.reduce((sum, it) => sum + it.stock.qty, 0);
    let containers = node.children.length;
    for (const child of node.children) {
      visit(child, depth + 1, node.path);
      items += child.totalItems;
      qty += child.totalQty;
      containers += child.totalContainers;
    }
    node.totalItems = items;
    node.totalQty = qty;
    node.totalContainers = containers;
  };
  for (const root of roots) visit(root, 0, []);

  // A synthetic node owning the real roots, so the top view is uniform.
  const world: Node = {
    c: worldContainer(state),
    type: null,
    children: roots,
    parent: null,
    depth: -1,
    items: [],
    totalItems: roots.reduce((s, r) => s + r.totalItems, 0),
    totalQty: roots.reduce((s, r) => s + r.totalQty, 0),
    totalContainers: roots.reduce((s, r) => s + r.totalContainers + 1, 0),
    path: [],
  };

  byId.set(WORLD_ID, world);
  return { world, roots, byId, flat };
}
