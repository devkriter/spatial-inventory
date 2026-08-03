export type Layout = 'grid' | 'free';
export type RowOrigin = 'top' | 'bottom';

/** The synthetic top-level node that holds every location. */
export const ROOT_ID = 0;

/**
 * The level above the locations. Not a `spaces` row — there is exactly one and
 * it has no parent — but it has the same grid, so the client has one uniform
 * thing to lay out however high up you are.
 */
export interface RootSpace {
  id: number;
  name: string;
  layout: Layout;
  cols: number;
  rows: number;
  row_origin: RowOrigin;
  updated_at: string;
}

/** A user-defined kind of space. Doubles as the template for new ones. */
export interface SpaceType {
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

/** Anywhere a thing can be. One with no parent is a location. */
export interface Space {
  id: number;
  parent_id: number | null;
  type_id: number | null;
  name: string;
  /** The rectangle claimed inside the parent, in the parent's units. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** This space's own interior, in units. */
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

/**
 * A distinct thing you own, independent of where it is. `part_number` is the
 * manufacturer's, off the datasheet — it is not this app's word for an item.
 */
export interface Item {
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

/** The stored side of a holding: which item, in which space, how many. */
export interface HoldingRow {
  id: number;
  item_id: number;
  space_id: number;
  qty: number;
  note: string | null;
  /** Slot on the space's plan-view grid. Null means "loose in here". */
  x: number | null;
  y: number | null;
  w: number | null;
  h: number | null;
}

export interface State {
  rootSpace: RootSpace;
  types: SpaceType[];
  spaces: Space[];
  items: Item[];
  holdings: HoldingRow[];
}

/** A space plus everything derived from the tree, built once per state load. */
export interface Node {
  space: Space;
  type: SpaceType | null;
  children: Node[];
  parent: Node | null;
  depth: number;
  /** Held directly by this space, each joined to its catalogue item. */
  holdings: Holding[];
  /** Holdings here and anywhere below. */
  totalHoldings: number;
  /** Summed quantity here and anywhere below. */
  totalQty: number;
  /** Spaces below, excluding self. */
  totalSpaces: number;
  path: Space[];
}

/**
 * An item in a space: the stored row joined to the catalogue entry it points
 * at. The same resistor in two drawers is two holdings of one item.
 */
export interface Holding {
  row: HoldingRow;
  item: Item;
}

/** Rectangle in screen pixels, relative to the viewport element. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Rectangle in a space's unit space. */
export interface UnitRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type SizeMode = 'physical' | 'items' | 'qty';
