import type { Container, Item, Node, Rect, SizeMode, UnitRect } from './types';

/* ------------------------------------------------------------- unit space */

/** Interior extent of a container, in units. Units are square. */
export function interiorUnits(c: Container): { w: number; h: number } {
  return { w: Math.max(c.cols, 1), h: Math.max(c.rows, 1) };
}

/**
 * Snap step for placements inside this container. The unit grid is drawn either
 * way as a visual reference; a free container just snaps at a finer step so
 * things can sit between the lines.
 */
export const snapStep = (c: Container): number => (c.layout === 'grid' ? 1 : 0.5);

/** Smallest rectangle you can draw inside this container. */
export const minSpan = (c: Container): number => snapStep(c);

export const snapTo = (value: number, step: number): number =>
  step > 0 ? Math.round(value / step) * step : value;

/**
 * Largest rect with the given aspect that fits inside `avail`, centred. Only the
 * level you are standing in uses this — a nested preview fills its block — so
 * the thing you are working on sits in the middle of the stage.
 */
export function fitAspect(aspect: number, avail: Rect): Rect {
  const availAspect = avail.w / Math.max(avail.h, 1e-6);
  let w = avail.w;
  let h = avail.h;
  if (aspect > availAspect) h = w / aspect;
  else w = h * aspect;
  return { x: avail.x + (avail.w - w) / 2, y: avail.y + (avail.h - h) / 2, w, h };
}

export function inset(r: Rect, by: number): Rect {
  const dx = Math.min(by, r.w / 2 - 0.5);
  const dy = Math.min(by, r.h / 2 - 0.5);
  return { x: r.x + dx, y: r.y + dy, w: Math.max(r.w - dx * 2, 1), h: Math.max(r.h - dy * 2, 1) };
}

/** Map a rectangle of parent units onto the screen frame drawn for that parent. */
export function unitsToScreen(rect: UnitRect, frame: Rect, parent: Container): Rect {
  const { w: cols, h: rows } = interiorUnits(parent);
  return {
    x: frame.x + (rect.x / cols) * frame.w,
    y: frame.y + (rect.y / rows) * frame.h,
    w: (Math.max(rect.w, 0.05) / cols) * frame.w,
    h: (Math.max(rect.h, 0.05) / rows) * frame.h,
  };
}

/** Inverse of `unitsToScreen` for a single point. */
export function screenToUnits(
  px: number,
  py: number,
  frame: Rect,
  parent: Container
): { x: number; y: number } {
  const { w: cols, h: rows } = interiorUnits(parent);
  return {
    x: ((px - frame.x) / Math.max(frame.w, 1)) * cols,
    y: ((py - frame.y) / Math.max(frame.h, 1)) * rows,
  };
}

export const rectsOverlap = (a: UnitRect, b: UnitRect): boolean =>
  a.x < b.x + b.w - 1e-6 &&
  b.x < a.x + a.w - 1e-6 &&
  a.y < b.y + b.h - 1e-6 &&
  b.y < a.y + a.h - 1e-6;

/**
 * Shrink a rectangle being resized until it stops overlapping its neighbours,
 * keeping its origin fixed. Refusing the drop instead would make resizing
 * impossible as soon as furniture is packed edge to edge — this way the drag
 * simply meets resistance at whatever is in the way.
 */
export function clampResize(rect: UnitRect, siblings: UnitRect[]): UnitRect {
  let { w, h } = rect;
  const { x, y } = rect;

  for (let pass = 0; pass <= siblings.length; pass++) {
    const hit = siblings.find((s) => rectsOverlap({ x, y, w, h }, s));
    if (!hit) break;

    // Only an edge that starts after our origin can be backed away from.
    const byWidth = hit.x > x;
    const byHeight = hit.y > y;
    if (byWidth && (!byHeight || w - (hit.x - x) <= h - (hit.y - y))) w = hit.x - x;
    else if (byHeight) h = hit.y - y;
    else break; // overlapping something that starts at or before us: unfixable here
  }

  return { x, y, w, h };
}

/** Clamp a rectangle so it stays inside the container's unit extent. */
export function clampToInterior(rect: UnitRect, c: Container): UnitRect {
  const { w: cols, h: rows } = interiorUnits(c);
  const w = Math.min(rect.w, cols);
  const h = Math.min(rect.h, rows);
  return {
    x: Math.min(Math.max(rect.x, 0), cols - w),
    y: Math.min(Math.max(rect.y, 0), rows - h),
    w,
    h,
  };
}

/* ------------------------------------------------------------- treemapping */

function worst(sum: number, min: number, max: number, side: number): number {
  const s2 = sum * sum;
  const w2 = side * side;
  return Math.max((w2 * max) / s2, s2 / (w2 * min));
}

/**
 * Squarified treemap (Bruls, Huizing & van Wijk). Returns one rect per input
 * value, in input order. Values are clamped so zero-weight entries still get a
 * visible sliver rather than collapsing.
 */
export function squarify(values: number[], rect: Rect): Rect[] {
  const n = values.length;
  const out: Rect[] = new Array(n);
  if (n === 0) return out;

  const area = Math.max(rect.w, 0) * Math.max(rect.h, 0);
  if (area <= 0) {
    for (let i = 0; i < n; i++) out[i] = { x: rect.x, y: rect.y, w: 0, h: 0 };
    return out;
  }

  const floor = 1e-4;
  const clamped = values.map((v) => Math.max(v, floor));
  const order = clamped.map((_, i) => i).sort((a, b) => clamped[b] - clamped[a]);
  const total = clamped.reduce((s, v) => s + v, 0);
  const scale = area / total;
  const scaled = order.map((i) => clamped[i] * scale);

  const free: Rect = { ...rect };
  let i = 0;
  while (i < n) {
    const side = Math.min(free.w, free.h);
    if (side <= 0) {
      for (let k = i; k < n; k++) out[order[k]] = { x: free.x, y: free.y, w: 0, h: 0 };
      break;
    }

    // Grow the row while it keeps getting squarer.
    let sum = 0;
    let min = Infinity;
    let max = 0;
    let best = Infinity;
    let count = 0;
    for (let j = i; j < n; j++) {
      const v = scaled[j];
      const nextSum = sum + v;
      const ratio = worst(nextSum, Math.min(min, v), Math.max(max, v), side);
      if (count > 0 && ratio > best) break;
      sum = nextSum;
      min = Math.min(min, v);
      max = Math.max(max, v);
      best = ratio;
      count++;
    }

    const thickness = sum / side;
    const horizontal = free.w < free.h; // lay the row along the shorter side
    let offset = 0;
    for (let k = i; k < i + count; k++) {
      const len = (scaled[k] / sum) * side;
      out[order[k]] = horizontal
        ? { x: free.x + offset, y: free.y, w: len, h: thickness }
        : { x: free.x, y: free.y + offset, w: thickness, h: len };
      offset += len;
    }

    if (horizontal) {
      free.y += thickness;
      free.h -= thickness;
    } else {
      free.x += thickness;
      free.w -= thickness;
    }
    i += count;
  }

  return out;
}

/* ------------------------------------------------------------- placements */

export interface Placed {
  key: string;
  kind: 'container' | 'item' | 'empty' | 'summary';
  rect: Rect;
  node?: Node;
  item?: Item;
  /** Unit coordinates of an empty slot. */
  cell?: { x: number; y: number };
  /** How many parts a summary tile stands for. */
  count?: number;
  /** Draw as a single-line list row rather than a tile. */
  dense?: boolean;
}

export interface Interior {
  /** The drawn surface of the container's inside, in screen pixels. */
  frame: Rect;
  placed: Placed[];
  /** True when `frame` is a faithful scale drawing rather than a treemap. */
  physical: boolean;
  /** Pixels per unit, physical mode only. */
  scale: number;
}

const weightOf = (node: Node, mode: SizeMode): number =>
  mode === 'qty' ? Math.max(node.totalQty, 1) : Math.max(node.totalItems, 1);

// Quantities span several orders of magnitude (1 dev board vs 2000 resistors).
// Compress them so a bulk bag does not swallow the drawer.
const itemWeight = (item: Item, mode: SizeMode): number =>
  mode === 'qty' ? 1 + Math.log2(1 + Math.max(item.stock.qty, 0)) : 1;

/** A part pinned to a slot on its container's grid. */
export const slotOf = (item: Item): UnitRect | null =>
  item.stock.x == null || item.stock.y == null
    ? null
    : { x: item.stock.x, y: item.stock.y, w: item.stock.w || 1, h: item.stock.h || 1 };

/** Everything that already claims space inside `node`, in its units. */
export function claims(node: Node, except?: Node | Item): UnitRect[] {
  const out: UnitRect[] = [];
  for (const child of node.children) if (child !== except) out.push(child.c);
  for (const item of node.items) {
    if (item === except) continue;
    const slot = slotOf(item);
    if (slot) out.push(slot);
  }
  return out;
}

/** Grid occupancy of everything placed inside a container, one byte per cell. */
function occupancy(node: Node, cols: number, rows: number): Uint8Array {
  const taken = new Uint8Array(cols * rows);
  for (const box of claims(node)) {
    const x0 = Math.max(0, Math.floor(box.x + 1e-6));
    const y0 = Math.max(0, Math.floor(box.y + 1e-6));
    const x1 = Math.min(cols, Math.ceil(box.x + box.w - 1e-6));
    const y1 = Math.min(rows, Math.ceil(box.y + box.h - 1e-6));
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) taken[y * cols + x] = 1;
  }
  return taken;
}

/**
 * Whole cells of a container not covered by any child. Meaningful as a grid
 * container's unfilled slots; for a free container it is only used internally
 * as a way to find empty space for loose parts, and is never drawn.
 */
export function emptyCells(node: Node): { x: number; y: number }[] {
  const { w: cols, h: rows } = interiorUnits(node.c);
  const taken = occupancy(node, cols, rows);
  const free: { x: number; y: number }[] = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) if (!taken[y * cols + x]) free.push({ x, y });
  }
  return free;
}

/**
 * The biggest solid rectangle of cells no child sits on — where loose parts can
 * go without being scattered around the children. Classic largest-rectangle-in-
 * a-histogram, run once per row.
 */
export function largestFreeRect(node: Node): UnitRect | null {
  const { w: cols, h: rows } = interiorUnits(node.c);
  const taken = occupancy(node, cols, rows);
  const heights = new Array<number>(cols).fill(0);
  let best: UnitRect | null = null;
  let bestArea = 0;

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) heights[x] = taken[y * cols + x] ? 0 : heights[x] + 1;

    const stack: number[] = [];
    for (let x = 0; x <= cols; x++) {
      const h = x === cols ? 0 : heights[x];
      while (stack.length && heights[stack[stack.length - 1]] >= h) {
        const top = stack.pop() as number;
        const height = heights[top];
        const left = stack.length ? stack[stack.length - 1] + 1 : 0;
        const area = (x - left) * height;
        if (area > bestArea) {
          bestArea = area;
          best = { x: left, y: y - height + 1, w: x - left, h: height };
        }
      }
      stack.push(x);
    }
  }
  return bestArea > 0 ? best : null;
}

/* ------------------------------------------------------------- item tiles */

/** A tile carries a name and a quantity on separate lines. */
const TILE_MIN_W = 52;
const TILE_MIN_H = 17;
const TILE_ASPECT = 3.2;

/** Below this, one grid cell is too small to be worth drawing a slot in. */
const SLOT_MIN_PX = 11;

/** A list row carries one line of text, so it needs far less height. */
const ROW_MIN_W = 46;
const ROW_MIN_H = 11;
const ROW_ASPECT = 9;

/** Best column count for `n` cells of at least this size, or null if none fits. */
function bestColumns(
  n: number,
  region: Rect,
  minW: number,
  minH: number,
  target: number
): number | null {
  let best: number | null = null;
  let bestScore = Infinity;
  for (let c = 1; c <= n; c++) {
    const rows = Math.ceil(n / c);
    const w = region.w / c;
    const h = region.h / rows;
    if (w < minW || h < minH) continue;
    const score = Math.abs(w / h - target);
    if (score < bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

/** Nothing stretches past this, so one part never becomes a slab. */
const TILE_MAX_W = 240;
const TILE_MAX_H = 44;
const ROW_MAX_H = 22;

function cells(items: Item[], region: Rect, cols: number, dense: boolean, hidden: number): Placed[] {
  const count = items.length;
  const rows = Math.ceil(count / cols);
  // Cap the cell size and anchor top-left. A single part in a wide drawer should
  // read as one labelled chip with room to spare, not as a full-width bar.
  const w = Math.min(region.w / cols, TILE_MAX_W);
  const h = Math.min(region.h / rows, dense ? ROW_MAX_H : TILE_MAX_H);
  const placed: Placed[] = [];
  for (let i = 0; i < count; i++) {
    const rect = {
      x: region.x + (i % cols) * w,
      y: region.y + Math.floor(i / cols) * h,
      w,
      h,
    };
    // The final cell stands in for everything that did not fit, itself included.
    if (hidden > 0 && i === count - 1) {
      placed.push({ key: 'more', kind: 'summary', rect, count: hidden + 1, dense });
    } else {
      placed.push({ key: `i${items[i].stock.id}`, kind: 'item', item: items[i], rect, dense });
    }
  }
  return placed;
}

/**
 * Lay loose parts into whatever space is available, degrading in steps.
 *
 * A container is drawn twice over, in two different projections: as a slice of
 * its parent's *front* elevation, and — once you open it — as its own top-down
 * plan. A drawer that is one slice tall from the front can hold a 12 × 12 grid
 * of compartments from above, and there is no honest way to draw the second
 * inside the first. So rather than shrink the contents into slivers, the
 * presentation changes:
 *
 *   tiles    name and quantity, two lines, when every part gets a legible tile
 *   rows     one line each, so several times as many parts still fit and read
 *   +N more  when even rows run out, the last one stands in for the rest
 *   count    when nothing legible fits at all
 *
 * Completeness beats prettiness: tiles are only used when *all* the parts fit
 * as tiles, otherwise the denser form that shows more of them wins.
 */
export function packItems(items: Item[], region: Rect, cell?: { w: number; h: number }): Placed[] {
  const n = items.length;
  if (!n || region.w < 6 || region.h < 6) return [];

  // Preferred: one part per grid cell, snapped up to however many cells it takes
  // to be readable. A drawer with one thing in it shows one small tile and a lot
  // of free space, which is the truth — it does not stretch to fill the drawer.
  if (cell && cell.w > 0 && cell.h > 0) {
    const spanX = Math.max(1, Math.ceil(TILE_MIN_W / cell.w));
    const spanY = Math.max(1, Math.ceil(TILE_MIN_H / cell.h));
    const tileW = spanX * cell.w;
    const tileH = spanY * cell.h;
    const perRow = Math.floor(region.w / tileW);
    const perCol = Math.floor(region.h / tileH);
    if (perRow >= 1 && perCol >= 1 && n <= perRow * perCol) {
      return items.map((item, i) => ({
        key: `i${item.stock.id}`,
        kind: 'item' as const,
        item,
        rect: {
          x: region.x + (i % perRow) * tileW,
          y: region.y + Math.floor(i / perRow) * tileH,
          w: tileW,
          h: tileH,
        },
      }));
    }
  }

  // Too many for that: fall back to filling the space, tiles first then rows.
  const tileCols = bestColumns(n, region, TILE_MIN_W, TILE_MIN_H, TILE_ASPECT);
  if (tileCols) return cells(items, region, tileCols, false, 0);

  const rowCols = bestColumns(n, region, ROW_MIN_W, ROW_MIN_H, ROW_ASPECT);
  if (rowCols) return cells(items, region, rowCols, true, 0);

  const cols = Math.max(1, Math.floor(region.w / ROW_MIN_W));
  const capacity = cols * Math.floor(region.h / ROW_MIN_H);
  if (capacity >= 2) {
    const shown = Math.min(n, capacity);
    return cells(items.slice(0, shown), region, cols, true, n - shown);
  }

  return [{ key: 'summary', kind: 'summary', rect: region, count: n }];
}

/**
 * Lay out everything directly inside `node` within `viewport`.
 *
 * physical mode  - children keep their drawn positions and proportions; loose
 *                  parts fill whatever space the children left over.
 * items / qty    - the whole interior becomes a squarified treemap, so the
 *                  biggest holdings read as the biggest blocks.
 */
export function layoutInterior(
  node: Node,
  viewport: Rect,
  mode: SizeMode,
  opts: { showEmpty?: boolean; letterbox?: boolean } = {}
): Interior {
  // The top level is just another gridded container, so it needs no special
  // case here: closets sit at their own coordinates like everything else.
  const placed: Placed[] = [];

  if (mode !== 'physical') {
    const entries: Placed[] = [
      ...node.children.map((child) => ({
        key: `c${child.c.id}`,
        kind: 'container' as const,
        node: child,
        rect: { x: 0, y: 0, w: 0, h: 0 },
      })),
      ...node.items.map((item) => ({
        key: `i${item.stock.id}`,
        kind: 'item' as const,
        item,
        rect: { x: 0, y: 0, w: 0, h: 0 },
      })),
    ];
    const weights = entries.map((e) =>
      e.kind === 'container' ? weightOf(e.node!, mode) : itemWeight(e.item!, mode)
    );
    const rects = squarify(weights, viewport);
    entries.forEach((e, i) => placed.push({ ...e, rect: rects[i] }));
    return { frame: viewport, placed, physical: false, scale: 0 };
  }

  /* ---- physical ---- */

  const units = interiorUnits(node.c);
  // Drawing parts at their real slots only helps while a slot is big enough to
  // see. Squeezed into a nested strip, a 1 × 1 slot becomes a 4px sliver — so
  // below that the whole tray gives up on geometry and becomes a list instead.
  const slotsLegible =
    viewport.w / units.w >= SLOT_MIN_PX && viewport.h / units.h >= SLOT_MIN_PX;
  const pinned = slotsLegible ? node.items.filter((item) => slotOf(item)) : [];
  const loose = slotsLegible ? node.items.filter((item) => !slotOf(item)) : node.items;
  // Anything with a real position needs the grid's proportions kept. Only a
  // container holding nothing but loose parts can safely fill its whole block —
  // letterboxing a 12 × 12 plan inside a 12 × 1 slice is mostly empty margin.
  const anchored = node.children.length > 0 || pinned.length > 0;
  // True proportions at the level you are working in; a nested preview fills its
  // block instead, so a full shelf looks full from outside.
  const letterbox = opts.letterbox ?? true;
  const frame = letterbox ? fitAspect(units.w / units.h, viewport) : viewport;
  const scale = frame.w / units.w;

  for (const child of node.children) {
    placed.push({
      key: `c${child.c.id}`,
      kind: 'container',
      node: child,
      rect: unitsToScreen(child.c, frame, node.c),
    });
  }

  for (const item of pinned) {
    placed.push({
      key: `i${item.stock.id}`,
      kind: 'item',
      item,
      rect: unitsToScreen(slotOf(item) as UnitRect, frame, node.c),
    });
  }

  if (loose.length) {
    // Parts with nowhere of their own go in the largest rectangle nothing else
    // claimed, so they stay one readable block rather than scattering.
    const hole = anchored ? largestFreeRect(node) : null;
    const region = anchored
      ? hole
        ? unitsToScreen(hole, frame, node.c)
        : bottomBand(frame)
      : frame;
    placed.push(
      ...packItems(
        loose,
        inset(region, 1),
        slotsLegible ? { w: frame.w / units.w, h: frame.h / units.h } : undefined
      )
    );
  } else if (!pinned.length && opts.showEmpty !== false && node.c.layout === 'grid') {
    for (const cell of emptyCells(node)) {
      placed.push({
        key: `e${cell.x}-${cell.y}`,
        kind: 'empty',
        cell,
        rect: unitsToScreen({ ...cell, w: 1, h: 1 }, frame, node.c),
      });
    }
  }

  return { frame, placed, physical: true, scale };
}

/** Last resort when the children leave no whole cell free. */
function bottomBand(frame: Rect): Rect {
  const h = Math.max(frame.h * 0.2, Math.min(40, frame.h));
  return { x: frame.x, y: frame.y + frame.h - h, w: frame.w, h };
}

/* ------------------------------------------------------------------ labels */

/**
 * Where a child sits inside its parent, said out loud. A grid parent gets a
 * row/column address — counted from the bottom when it is labelled that way —
 * while a free parent gets plain coordinates, because rows and columns do not
 * mean anything when things are just placed where they fit.
 */
export function cellAddress(parent: Container, child: Container): string | null {
  if (parent.layout === 'free') return `@ ${round(child.x)},${round(child.y)}`;
  const col = Math.floor(child.x) + 1;
  const row =
    parent.row_origin === 'bottom'
      ? Math.max(parent.rows, 1) - Math.ceil(child.y + child.h) + 1
      : Math.floor(child.y) + 1;
  return `R${row}·C${col}`;
}

/** `2×3` in units. */
export const size = (r: UnitRect): string => `${round(r.w)}×${round(r.h)}`;

export const round = (n: number): string =>
  Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);

export const formatUnits = (r: { cols: number; rows: number }): string =>
  `${r.cols} × ${r.rows} U`;
