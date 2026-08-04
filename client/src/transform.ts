/**
 * Zoom and pan for the map, and only the map.
 *
 * The obvious implementation is a CSS transform on the block layer, and that is
 * what this was at first. It magnifies: a 2× zoom is the same drawing, twice
 * the size, text and all. Which is the wrong thing for this app. Blocks here
 * step down through tiles → list rows → "+8 more" as they run out of room, so
 * the interesting question when you zoom in on a crowded drawer is not "can I
 * see the same picture bigger" but "can I now see what is actually in it".
 *
 * So zoom instead enlarges the *stage the level is laid out into*, and the
 * layout runs again. Blocks get bigger, text stays at its own native size and
 * stays crisp, and the presentation tiers re-evaluate — zoom in far enough and
 * the "+8 more" becomes eight real tiles. Panning slides that stage around.
 *
 * The happy side effect is that everything is laid out in real screen pixels at
 * every zoom level, so hit-testing, handles and overlays need no conversion at
 * all. There is no transformed coordinate space to get wrong.
 */
import type { Rect } from './types';

export interface View {
  /** How much bigger than "fits the window" the level is drawn. */
  k: number;
  /** Where that enlarged stage sits, relative to its resting position. */
  x: number;
  y: number;
}

export const IDENTITY: View = { k: 1, x: 0, y: 0 };

/** 1 is "the whole level fits". Below that there is nothing more to see. */
export const MIN_K = 1;
export const MAX_K = 8;
/** One press of + or −, and one wheel notch. */
export const ZOOM_STEP = 1.25;

export const clampK = (k: number): number => Math.min(MAX_K, Math.max(MIN_K, k));

/** The rectangle the level should be laid out into at this zoom and pan. */
export const stageFor = (base: Rect, v: View): Rect => ({
  x: base.x + v.x,
  y: base.y + v.y,
  w: base.w * v.k,
  h: base.h * v.k,
});

/**
 * Change the zoom while keeping whatever is under (px, py) where it is. Any
 * other anchor makes the map slide out from under the pointer.
 */
export function zoomAt(base: Rect, v: View, k: number, px: number, py: number): View {
  const next = clampK(k);
  const stage = stageFor(base, v);
  const fx = stage.w > 0 ? (px - stage.x) / stage.w : 0.5;
  const fy = stage.h > 0 ? (py - stage.y) / stage.h : 0.5;
  return {
    k: next,
    x: px - base.x - fx * base.w * next,
    y: py - base.y - fy * base.h * next,
  };
}

export const panBy = (v: View, dx: number, dy: number): View => ({
  k: v.k,
  x: v.x + dx,
  y: v.y + dy,
});

/**
 * How much of the stage the drawing actually covers, as fractions of it. The
 * level is letterboxed inside the stage, so this is usually a little less than
 * all of it — and occasionally *more*, when something is drawn outside the
 * level's own bounds. Panning is clamped against this rather than against the
 * stage, because the stage is a construct and this is what you can see.
 */
export interface Extent {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export const FULL_EXTENT: Extent = { x0: 0, x1: 1, y0: 0, y1: 1 };

/**
 * Stop the map being flung somewhere you cannot get it back from. It may leave
 * the window, but never entirely: a strip stays put so there is always
 * something to drag back.
 */
const KEEP_VISIBLE = 72;

export function clampView(
  base: Rect,
  v: View,
  host: { w: number; h: number },
  extent: Extent = FULL_EXTENT
): View {
  return {
    k: v.k,
    x: clampAxis(v.x, base.x + extent.x0 * base.w * v.k, (extent.x1 - extent.x0) * base.w * v.k, host.w),
    y: clampAxis(v.y, base.y + extent.y0 * base.h * v.k, (extent.y1 - extent.y0) * base.h * v.k, host.h),
  };
}

/**
 * One axis of the above. A stage that already fits is centred — there is
 * nothing along that axis to go and look at, so letting it drift would only
 * lose you the view you had.
 */
function clampAxis(offset: number, start: number, length: number, host: number): number {
  const centred = (host - length) / 2 - start;
  if (length <= host) return centred;

  const min = KEEP_VISIBLE - start - length;
  const max = host - KEEP_VISIBLE - start;
  if (min > max) return centred;
  return Math.min(Math.max(offset, min), max);
}

/**
 * Sit the drawing in the visible area as well as it can: centred when it fits,
 * and hard against the top-left when it does not, so the part you lose is the
 * far edge rather than a strip off every side. Used when something covers part
 * of the map, which changes where "the middle" is.
 */
export function fitInto(base: Rect, host: { w: number; h: number }, extent: Extent): View {
  const align = (start: number, length: number, avail: number) =>
    Math.max((avail - length) / 2 - start, -start);
  return {
    k: 1,
    x: align(base.x + extent.x0 * base.w, (extent.x1 - extent.x0) * base.w, host.w),
    y: align(base.y + extent.y0 * base.h, (extent.y1 - extent.y0) * base.h, host.h),
  };
}

/** Distance and midpoint between two pointers, for a pinch. */
export function span(a: { x: number; y: number }, b: { x: number; y: number }) {
  return {
    dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
    cx: (a.x + b.x) / 2,
    cy: (a.y + b.y) / 2,
  };
}
