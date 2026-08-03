import type { Space, Holding, Node, Rect, SizeMode, UnitRect } from './types';

/* ------------------------------------------------------------- unit space */

/** Interior extent of a space, in units. Units are square. */
export function interiorUnits(c: Space): { w: number; h: number } {
  return { w: Math.max(c.cols, 1), h: Math.max(c.rows, 1) };
}

/**
 * Snap step for placements inside this space. The unit grid is drawn either
 * way as a visual reference; a free space just snaps at a finer step so
 * things can sit between the lines.
 */
export const snapStep = (c: Space): number => (c.layout === 'grid' ? 1 : 0.5);

/** Smallest rectangle you can draw inside this space. */
export const minSpan = (c: Space): number => snapStep(c);

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
export function unitsToScreen(rect: UnitRect, frame: Rect, parent: Space): Rect {
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
  parent: Space
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

/** Clamp a rectangle so it stays inside the space's unit extent. */
export function clampToInterior(rect: UnitRect, c: Space): UnitRect {
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
  kind: 'space' | 'holding' | 'empty' | 'summary';
  rect: Rect;
  node?: Node;
  holding?: Holding;
  /** Unit coordinates of an empty slot. */
  cell?: { x: number; y: number };
  /** How many items a summary tile stands for. */
  count?: number;
  /** Draw as a single-line list row rather than a tile. */
  dense?: boolean;
}

export interface Interior {
  /** The drawn surface of the space's inside, in screen pixels. */
  frame: Rect;
  placed: Placed[];
  /** True when `frame` is a faithful scale drawing rather than a treemap. */
  physical: boolean;
  /** Pixels per unit, physical mode only. */
  scale: number;
}

const weightOf = (node: Node, mode: SizeMode): number =>
  mode === 'qty' ? Math.max(node.totalQty, 1) : Math.max(node.totalHoldings, 1);

// Quantities span several orders of magnitude (1 dev board vs 2000 resistors).
// Compress them so a bulk bag does not swallow the drawer.
const holdingWeight = (holding: Holding, mode: SizeMode): number =>
  mode === 'qty' ? 1 + Math.log2(1 + Math.max(holding.row.qty, 0)) : 1;

/** An item pinned to a slot on its space's grid. */
export const slotOf = (holding: Holding): UnitRect | null =>
  holding.row.x == null || holding.row.y == null
    ? null
    : { x: holding.row.x, y: holding.row.y, w: holding.row.w || 1, h: holding.row.h || 1 };

/** Everything that already claims space inside `node`, in its units. */
export function claims(node: Node, except?: Node | Holding): UnitRect[] {
  const out: UnitRect[] = [];
  for (const child of node.children) if (child !== except) out.push(child.space);
  for (const holding of node.holdings) {
    if (holding === except) continue;
    const slot = slotOf(holding);
    if (slot) out.push(slot);
  }
  return out;
}

/** Grid occupancy of everything placed inside a space, one byte per cell. */
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
 * Whole cells of a space not covered by any child. Meaningful as a grid
 * space's unfilled slots; for a free space it is only used internally
 * as a way to find empty space for loose items, and is never drawn.
 */
export function emptyCells(node: Node): { x: number; y: number }[] {
  const { w: cols, h: rows } = interiorUnits(node.space);
  const taken = occupancy(node, cols, rows);
  const free: { x: number; y: number }[] = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) if (!taken[y * cols + x]) free.push({ x, y });
  }
  return free;
}

/**
 * The biggest solid rectangle of cells no child sits on — where loose items can
 * go without being scattered around the children. Classic largest-rectangle-in-
 * a-histogram, run once per row.
 */
export function largestFreeRect(node: Node): UnitRect | null {
  const { w: cols, h: rows } = interiorUnits(node.space);
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

/** …unless there are only this many items, where position still beats size. */
const SLOT_FEW = 4;

/**
 * The most of a region one slot-shaped tile may claim while being snapped up to
 * a legible size. Legibility is measured in pixels and the grid is not, so
 * without a ceiling the snapping runs away on small drawings.
 */
const MAX_TILE_SHARE = 0.34;

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

/** Nothing stretches past this, so one item never becomes a slab. */
const TILE_MAX_W = 240;
const TILE_MAX_H = 44;
const ROW_MAX_H = 22;

function cells(holdings: Holding[], region: Rect, cols: number, dense: boolean, hidden: number): Placed[] {
  const count = holdings.length;
  const rows = Math.ceil(count / cols);
  // Cap the cell size and anchor top-left. A single item in a wide drawer should
  // read as one labelled chip with room to spare, not as a full-width bar.
  //
  // The caps above are absolute pixels, which is no help on a small drawing:
  // 240px is wider than a whole closet in a preview on a phone, so it never
  // binds and one item ends up filling the region. Hence the share cap as well
  // — a tile may not take more than a third of what it sits in, whatever the
  // scale. List rows are exempt: spanning the width is what makes a list read
  // as a list.
  const w = dense
    ? Math.min(region.w / cols, TILE_MAX_W)
    : Math.min(region.w / cols, TILE_MAX_W, region.w * MAX_TILE_SHARE);
  const h = Math.min(
    region.h / rows,
    dense ? ROW_MAX_H : Math.min(TILE_MAX_H, region.h * MAX_TILE_SHARE)
  );
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
      placed.push({ key: `i${holdings[i].row.id}`, kind: 'holding', holding: holdings[i], rect, dense });
    }
  }
  return placed;
}

/**
 * Lay loose items into whatever space is available, degrading in steps.
 *
 * A space is drawn twice over, in two different projections: as a slice of
 * its parent's *front* elevation, and — once you open it — as its own top-down
 * plan. A drawer that is one slice tall from the front can hold a 12 × 12 grid
 * of compartments from above, and there is no honest way to draw the second
 * inside the first. So rather than shrink the contents into slivers, the
 * presentation changes:
 *
 *   tiles    name and quantity, two lines, when every item gets a legible tile
 *   rows     one line each, so several times as many items still fit and read
 *   +N more  when even rows run out, the last one stands in for the rest
 *   count    when nothing legible fits at all
 *
 * Completeness beats prettiness: tiles are only used when *all* the items fit
 * as tiles, otherwise the denser form that shows more of them wins.
 */
export function packHoldings(holdings: Holding[], region: Rect, cell?: { w: number; h: number }): Placed[] {
  const n = holdings.length;
  if (!n || region.w < 6 || region.h < 6) return [];

  // Preferred: one item per grid cell, snapped up to however many cells it takes
  // to be readable. A drawer with one thing in it shows one small tile and a lot
  // of free space, which is the truth — it does not stretch to fill the drawer.
  //
  // The snapping is capped, because the minimum is in *pixels* and the cell is
  // not. Left uncapped, the same holding drawn in a small preview claims a far
  // larger share of it than the same holding on a big screen — one item in a
  // closet preview on a phone ends up a slab across the whole closet. Past the
  // cap it simply renders small and wordless, which is what the desktop already
  // does and is honest about how much room the thing actually takes.
  if (cell && cell.w > 0 && cell.h > 0) {
    const capX = Math.max(1, Math.floor((region.w * MAX_TILE_SHARE) / cell.w));
    const capY = Math.max(1, Math.floor((region.h * MAX_TILE_SHARE) / cell.h));
    const spanX = Math.min(Math.max(1, Math.ceil(TILE_MIN_W / cell.w)), capX);
    const spanY = Math.min(Math.max(1, Math.ceil(TILE_MIN_H / cell.h)), capY);
    const tileW = spanX * cell.w;
    const tileH = spanY * cell.h;
    const perRow = Math.floor(region.w / tileW);
    const perCol = Math.floor(region.h / tileH);
    if (perRow >= 1 && perCol >= 1 && n <= perRow * perCol) {
      return holdings.map((holding, i) => ({
        key: `i${holding.row.id}`,
        kind: 'holding' as const,
        holding,
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
  if (tileCols) return cells(holdings, region, tileCols, false, 0);

  const rowCols = bestColumns(n, region, ROW_MIN_W, ROW_MIN_H, ROW_ASPECT);
  if (rowCols) return cells(holdings, region, rowCols, true, 0);

  const cols = Math.max(1, Math.floor(region.w / ROW_MIN_W));
  const capacity = cols * Math.floor(region.h / ROW_MIN_H);
  if (capacity >= 2) {
    const shown = Math.min(n, capacity);
    return cells(holdings.slice(0, shown), region, cols, true, n - shown);
  }

  return [{ key: 'summary', kind: 'summary', rect: region, count: n }];
}

/**
 * Lay out everything directly inside `node` within `viewport`.
 *
 * physical mode  - children keep their drawn positions and proportions; loose
 *                  items fill whatever space the children left over.
 * items / qty    - the whole interior becomes a squarified treemap, so the
 *                  biggest holdings read as the biggest blocks.
 */
export function layoutInterior(
  node: Node,
  viewport: Rect,
  mode: SizeMode,
  opts: { showEmpty?: boolean; letterbox?: boolean } = {}
): Interior {
  // The top level is just another gridded space, so it needs no special
  // case here: closets sit at their own coordinates like everything else.
  const placed: Placed[] = [];

  if (mode !== 'physical') {
    const entries: Placed[] = [
      ...node.children.map((child) => ({
        key: `c${child.space.id}`,
        kind: 'space' as const,
        node: child,
        rect: { x: 0, y: 0, w: 0, h: 0 },
      })),
      ...node.holdings.map((holding) => ({
        key: `i${holding.row.id}`,
        kind: 'holding' as const,
        holding,
        rect: { x: 0, y: 0, w: 0, h: 0 },
      })),
    ];
    const weights = entries.map((e) =>
      e.kind === 'space' ? weightOf(e.node!, mode) : holdingWeight(e.holding!, mode)
    );
    const rects = squarify(weights, viewport);
    entries.forEach((e, i) => placed.push({ ...e, rect: rects[i] }));
    return { frame: viewport, placed, physical: false, scale: 0 };
  }

  /* ---- physical ---- */

  const units = interiorUnits(node.space);
  // Drawing items at their real slots only helps while a slot is big enough to
  // see. Squeezed into a nested strip, a 1 × 1 slot becomes a 4px sliver — so
  // below that the whole tray gives up on geometry and becomes a list instead.
  //
  // Except when there are only a few. That trade — geometry for legibility —
  // is worth making for thirty items, where thirty specks are noise and a list
  // is information. For one or two it is a bad bargain: the item loses its real
  // position *and*, having become "loose", gets promoted to a chip sized for
  // reading rather than for how much room it takes. A speck in the right place
  // is more honest than a slab in the wrong one.
  const slotsLegible =
    (viewport.w / units.w >= SLOT_MIN_PX && viewport.h / units.h >= SLOT_MIN_PX) ||
    node.holdings.length <= SLOT_FEW;
  const pinned = slotsLegible ? node.holdings.filter((holding) => slotOf(holding)) : [];
  const loose = slotsLegible ? node.holdings.filter((holding) => !slotOf(holding)) : node.holdings;
  // Anything with a real position needs the grid's proportions kept. Only a
  // space holding nothing but loose items can safely fill its whole block —
  // letterboxing a 12 × 12 plan inside a 12 × 1 slice is mostly empty margin.
  const anchored = node.children.length > 0 || pinned.length > 0;
  // True proportions at the level you are working in; a nested preview fills its
  // block instead, so a full shelf looks full from outside.
  const letterbox = opts.letterbox ?? true;
  const frame = letterbox ? fitAspect(units.w / units.h, viewport) : viewport;
  const scale = frame.w / units.w;

  for (const child of node.children) {
    placed.push({
      key: `c${child.space.id}`,
      kind: 'space',
      node: child,
      rect: unitsToScreen(child.space, frame, node.space),
    });
  }

  for (const holding of pinned) {
    placed.push({
      key: `i${holding.row.id}`,
      kind: 'holding',
      holding,
      rect: unitsToScreen(slotOf(holding) as UnitRect, frame, node.space),
    });
  }

  if (loose.length) {
    // Items with nowhere of their own go in the largest rectangle nothing else
    // claimed, so they stay one readable block rather than scattering.
    const hole = anchored ? largestFreeRect(node) : null;
    const region = anchored
      ? hole
        ? unitsToScreen(hole, frame, node.space)
        : bottomBand(frame)
      : frame;
    placed.push(
      ...packHoldings(
        loose,
        inset(region, 1),
        slotsLegible ? { w: frame.w / units.w, h: frame.h / units.h } : undefined
      )
    );
  } else if (!pinned.length && opts.showEmpty !== false && node.space.layout === 'grid') {
    for (const cell of emptyCells(node)) {
      placed.push({
        key: `e${cell.x}-${cell.y}`,
        kind: 'empty',
        cell,
        rect: unitsToScreen({ ...cell, w: 1, h: 1 }, frame, node.space),
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
export function cellAddress(parent: Space, child: Space): string | null {
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
