export type Layout = 'grid' | 'free';
export type RowOrigin = 'top' | 'bottom';

/** The synthetic top-level node that holds everything else. */
export const WORLD_ID = 0;

/**
 * The top level. Not a container row — there is exactly one and it has no
 * parent — but it has the same grid, so closets and benches can be placed
 * against each other just like drawers inside a cabinet.
 */
export interface Workspace {
  id: number;
  name: string;
  layout: Layout;
  cols: number;
  rows: number;
  row_origin: RowOrigin;
  updated_at: string;
}

/** A user-defined kind of storage. Doubles as the template for new containers. */
export interface StorageType {
  id: number;
  name: string;
  layout: Layout;
  cols: number;
  rows: number;
  color: string | null;
  notes: string | null;
  sort: number;
  created_at: string;
  updated_at: string;
}

export interface Container {
  id: number;
  parent_id: number | null;
  type_id: number | null;
  name: string;
  /** The rectangle claimed inside the parent, in the parent's units. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** This container's own interior, in units. */
  layout: Layout;
  cols: number;
  rows: number;
  row_origin: RowOrigin;
  color: string | null;
  notes: string | null;
  sort: number;
  created_at: string;
  updated_at: string;
}

export interface Part {
  id: number;
  name: string;
  description: string | null;
  part_number: string | null;
  manufacturer: string | null;
  category: string | null;
  tags: string | null;
  package: string | null;
  value: string | null;
  datasheet_url: string | null;
  image_url: string | null;
  unit: string;
  min_qty: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Stock {
  id: number;
  part_id: number;
  container_id: number;
  qty: number;
  note: string | null;
  /** Slot on the container's plan-view grid. Null means "loose in here". */
  x: number | null;
  y: number | null;
  w: number | null;
  h: number | null;
}

export interface State {
  workspace: Workspace;
  types: StorageType[];
  containers: Container[];
  parts: Part[];
  stock: Stock[];
}

/** A container plus everything derived from the tree, built once per state load. */
export interface Node {
  c: Container;
  type: StorageType | null;
  children: Node[];
  parent: Node | null;
  depth: number;
  /** Stock rows held directly by this container, joined to their part. */
  items: Item[];
  /** Stock rows here and anywhere below. */
  totalItems: number;
  /** Summed quantity here and anywhere below. */
  totalQty: number;
  /** Containers below, excluding self. */
  totalContainers: number;
  path: Container[];
}

export interface Item {
  stock: Stock;
  part: Part;
}

/** Rectangle in screen pixels, relative to the viewport element. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Rectangle in a container's unit space. */
export interface UnitRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type SizeMode = 'physical' | 'items' | 'qty';
