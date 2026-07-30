import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import {
  cellAddress,
  claims,
  clampResize,
  clampToInterior,
  inset,
  interiorUnits,
  largestFreeRect,
  layoutInterior,
  minSpan,
  rectsOverlap,
  screenToUnits,
  size,
  slotOf,
  snapStep,
  snapTo,
  unitsToScreen,
  type Placed,
} from '../layout';
import {
  IDENTITY,
  ZOOM_STEP,
  atRest,
  clampView,
  panBy,
  span,
  stageFor,
  zoomAt,
  type View,
} from '../transform';
import { colorOf, typeName } from '../palette';
import type { SearchResult } from '../search';
import {
  WORLD_ID,
  type Container,
  type Item,
  type Node,
  type Rect,
  type SizeMode,
  type StorageType,
  type UnitRect,
} from '../types';
import { DrawPrompt } from './DrawPrompt';

/** Below this many pixels a block stops drawing its contents. */
const CONTENT_MIN = 34;
const LABEL_MIN_W = 30;
const LABEL_MIN_H = 18;
/** A block taller than this gets a title strip instead of a centred label. */
const HEAD_MIN_H = 52;
const HEAD_H = 21;
const PAD = 3;
const STAGE_PAD = 12;
/**
 * Pointer travel before a press counts as a drag rather than a click. A finger
 * wobbles several pixels just resting on the glass, so a mouse threshold would
 * turn most taps into tiny drags and nothing would ever navigate.
 */
const DRAG_SLOP = 4;
const DRAG_SLOP_TOUCH = 11;
/**
 * Size of the corner that starts a resize. Generous, because a 10px invisible
 * target is genuinely hard to hit — and it is drawn, so you can see where it is.
 * A fingertip covers about 7 mm, hence the larger touch figure.
 */
const RESIZE_GRIP = 18;
const RESIZE_GRIP_TOUCH = 28;
const RESIZE_GRIP_MIN = 9;
const RESIZE_GRIP_MIN_TOUCH = 14;

/** The grip shrinks on small blocks so it never swallows the whole face. */
const gripSize = (rect: Rect, touch = false): number =>
  Math.max(
    touch ? RESIZE_GRIP_MIN_TOUCH : RESIZE_GRIP_MIN,
    Math.min(touch ? RESIZE_GRIP_TOUCH : RESIZE_GRIP, rect.w * 0.3, rect.h * 0.45)
  );

export interface SpaceViewProps {
  root: Node;
  types: StorageType[];
  mode: SizeMode;
  search: SearchResult;
  searching: boolean;
  selectedStockId: number | null;
  selectedContainerId: number | null;
  maxDepth: number;
  showGrid: boolean;
  /**
   * Whether dragging edits the layout at all. On a phone this is off unless you
   * ask for it: every tap would otherwise risk shoving a drawer sideways, and
   * you are almost always there to find something rather than to rearrange.
   */
  editing?: boolean;
  /** Fingers, not a mouse — fatter grips, more slop, no hover affordances. */
  touch?: boolean;
  /**
   * A touchscreen exists, whatever is driving the cursor. Enough to claim the
   * gesture from the browser, so a finger pans rather than scrolling the page.
   */
  anyTouch?: boolean;
  /** When on, one click goes inside instead of merely inspecting. */
  singleClickEnters: boolean;
  clickOutsideToGoBack: boolean;
  rightClickToGoBack: boolean;
  /** Single click — inspect without moving. */
  onSelect: (node: Node) => void;
  /** Double click — actually go inside. */
  onOpen: (node: Node) => void;
  onSelectItem: (item: Item, holder: Node) => void;
  onDrawChild: (parent: Node, rect: UnitRect, name: string, typeId: number | null) => void;
  onDrawPart: (parent: Node, rect: UnitRect, name: string, qty: number) => void;
  onPlaceChild: (node: Node, rect: UnitRect) => void;
  onPlaceItem: (item: Item, rect: UnitRect) => void;
  /** Dropped onto a neighbouring container: move it in there. */
  onMoveItemInto: (item: Item, target: Node) => void;
  /** Same, for a whole container — re-parenting it. */
  onMoveContainerInto: (node: Node, target: Node) => void;
  onUp: () => void;
  /** Clicked bare space: nothing is selected any more. */
  onDeselect: () => void;
}

interface Ctx {
  props: SpaceViewProps;
  out: ReactNode[];
  hits: Hit[];
  /** Suppressed while a drag is in progress so a drag never navigates. */
  clickBlocked: () => boolean;
  touch: boolean;
}

/**
 * Containers and parts are dragged around the same grid. A part with no slot
 * carries the rectangle it happened to be drawn in, so dragging it turns that
 * into a real slot instead of refusing.
 */
type Target =
  | { kind: 'container'; node: Node }
  | { kind: 'item'; item: Item; drawn: UnitRect };

const targetRect = (t: Target): UnitRect =>
  t.kind === 'container' ? t.node.c : slotOf(t.item) ?? t.drawn;

/** Screen rect back into the container's units, snapped to its grid. */
function toUnits(rect: Rect, frame: Rect, parent: Container): UnitRect {
  const a = screenToUnits(rect.x, rect.y, frame, parent);
  const b = screenToUnits(rect.x + rect.w, rect.y + rect.h, frame, parent);
  return {
    x: Math.max(0, Math.round(a.x)),
    y: Math.max(0, Math.round(a.y)),
    w: Math.max(1, Math.round(b.x - a.x)),
    h: Math.max(1, Math.round(b.y - a.y)),
  };
}

const targetExcept = (t: Target): Node | Item =>
  t.kind === 'container' ? t.node : t.item;

type Gesture =
  | { kind: 'draw'; from: { x: number; y: number } }
  | { kind: 'move'; target: Target; grab: { x: number; y: number } }
  | { kind: 'resize'; target: Target }
  /** Carrying something drawn below this level somewhere else entirely. */
  | { kind: 'carry'; payload: Carried }
  /**
   * One finger on the map with nothing else claiming it. This is the default on
   * touch: the map moves under your finger, the way every map does. Editing is
   * reached deliberately — through a handle, or through a long press.
   */
  | { kind: 'pan'; from: { x: number; y: number }; view: View }
  | { kind: 'pinch'; dist: number; cx: number; cy: number; view: View };

/** How long a finger must rest before a press stops being a pan. */
const LONG_PRESS_MS = 420;
/** …and how far it may wander in that time. */
const LONG_PRESS_SLOP = 12;

type Carried =
  | { kind: 'item'; item: Item; holder: Node }
  | { kind: 'container'; node: Node };

const carriedName = (c: Carried): string =>
  c.kind === 'item' ? c.item.part.name : c.node.c.name;

/** Where it is now, so dropping it back there is a no-op. */
const carriedHome = (c: Carried): Node | null =>
  c.kind === 'item' ? c.holder : c.node.parent;

/** You cannot put a container inside itself, or inside its own contents. */
const wouldNest = (c: Carried, target: Node): boolean => {
  if (c.kind !== 'container') return false;
  for (let n: Node | null = target; n; n = n.parent) if (n === c.node) return true;
  return false;
};

/** Everything drawn this frame, so a drag can find what is under the pointer. */
interface Hit {
  rect: Rect;
  depth: number;
  node?: Node;
  item?: Item;
  holder?: Node;
}

export function SpaceView(props: SpaceViewProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [size_, setSize] = useState({ w: 0, h: 0 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    // Measure straight away rather than waiting for the first observer
    // callback — those are tied to the rendering lifecycle and never arrive in
    // a background or non-compositing tab, which would leave the view blank.
    const measure = () => {
      const rect = el.getBoundingClientRect();
      setSize((prev) =>
        Math.abs(prev.w - rect.width) < 0.5 && Math.abs(prev.h - rect.height) < 0.5
          ? prev
          : { w: rect.width, h: rect.height }
      );
    };
    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  const { root, mode, onUp } = props;
  const touch = !!props.touch;
  const anyTouch = !!props.anyTouch || touch;
  // The workshop is a grid like any other level, so it is drawable too. It just
  // has nowhere above it, which is what `insideSomething` gates.
  const editable = mode === 'physical' && props.editing !== false;
  // Only promise a way out if clicking the margin actually takes one.
  const insideSomething = root.c.id !== WORLD_ID && props.clickOutsideToGoBack;

  /** Where the level sits at rest — the whole window, less a margin. */
  const base: Rect = {
    x: STAGE_PAD,
    y: STAGE_PAD,
    w: Math.max(size_.w - STAGE_PAD * 2, 0),
    h: Math.max(size_.h - STAGE_PAD * 2, 0),
  };

  /* ------------------------------------------------------- zoom and pan */

  /**
   * Zoom enlarges the stage the level is laid out into, rather than magnifying
   * the result — so blocks get bigger, text stays crisp at its own size, and a
   * crowded drawer showing "+8 more" turns into eight real tiles as you go in.
   */
  const [view, setViewRaw] = useState<View>(IDENTITY);
  const viewRef = useRef(view);
  viewRef.current = view;

  const baseRef = useRef(base);
  baseRef.current = base;

  const setView = useCallback((next: View) => {
    const host = ref.current?.getBoundingClientRect();
    setViewRaw(
      host ? clampView(baseRef.current, next, { w: host.width, h: host.height }) : next
    );
  }, []);

  // A new level is a new drawing; it opens at rest, filling the window. Keeping
  // the old pan would drop you into the corner of somewhere you have not seen.
  useEffect(() => {
    setViewRaw(IDENTITY);
  }, [root.c.id, mode]);

  const stage = stageFor(base, view);
  const interior = useMemo(
    () => (stage.w > 0 && stage.h > 0 ? layoutInterior(root, stage, mode) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [root, mode, stage.w, stage.h, stage.x, stage.y]
  );

  /* ------------------------------------------------------------- gestures */

  const [gesture, setGesture] = useState<Gesture | null>(null);
  const [draft, setDraft] = useState<UnitRect | null>(null);
  const [pending, setPending] = useState<UnitRect | null>(null);
  const dragged = useRef(false);
  const pressAt = useRef({ x: 0, y: 0 });
  const captured = useRef(false);
  const frameRef = useRef<Rect | null>(null);
  frameRef.current = interior?.frame ?? null;
  /** What is on screen at this level, for hit-testing parts by their drawn box. */
  const placedRef = useRef<Placed[]>([]);
  placedRef.current = interior?.placed ?? [];
  /** Every block drawn, at every depth, for carrying a part across containers. */
  const hitsRef = useRef<Hit[]>([]);
  /** Where a carried part currently is, and what it would drop into. */
  const [carry, setCarry] = useState<{ x: number; y: number; onto: Node | null } | null>(null);
  /** Live fingers, so a second one can turn a pan into a pinch. */
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const longPress = useRef<number | null>(null);
  /** Set while a long press is deciding, so its release is not read as a tap. */
  const heldRef = useRef(false);

  const cancelLongPress = useCallback(() => {
    if (longPress.current !== null) {
      window.clearTimeout(longPress.current);
      longPress.current = null;
    }
  }, []);

  /**
   * Pointer position in the viewport's own pixels. Because zoom re-lays-out
   * rather than transforming, this is also the coordinate space every block was
   * laid out in — there is no second space to convert to.
   */
  const screenPoint = useCallback((e: { clientX: number; clientY: number }) => {
    const box = ref.current?.getBoundingClientRect();
    return box ? { x: e.clientX - box.left, y: e.clientY - box.top } : { x: 0, y: 0 };
  }, []);

  const pointerUnits = useCallback(
    (e: { clientX: number; clientY: number }) => {
      const frame = frameRef.current;
      if (!ref.current || !frame) return null;
      const p = screenPoint(e);
      return screenToUnits(p.x, p.y, frame, root.c);
    },
    [root.c, screenPoint]
  );

  /** Everything the dragged rectangle must not land on. */
  const obstacles = useCallback(
    (except?: Node | Item) => claims(root, except),
    [root]
  );

  /**
   * A part dropped on top of a container goes *into* it, rather than being
   * refused for overlapping — dragging something from one drawer to the next is
   * the obvious way to move it.
   */
  const dropInto = useMemo(() => {
    if (!draft || gesture?.kind !== 'move' || gesture.target.kind !== 'item') return null;
    const cx = draft.x + draft.w / 2;
    const cy = draft.y + draft.h / 2;
    return (
      root.children.find(
        (c) => cx >= c.c.x && cx < c.c.x + c.c.w && cy >= c.c.y && cy < c.c.y + c.c.h
      ) ?? null
    );
  }, [draft, gesture, root.children]);

  const valid = useMemo(() => {
    if (!draft || !gesture) return true;
    // Panning and pinching never place anything, and a carried thing is judged
    // by what it lands in rather than by what it overlaps.
    if (gesture.kind === 'carry' || gesture.kind === 'pan' || gesture.kind === 'pinch') return true;
    if (dropInto) return true;
    const except = gesture.kind === 'draw' ? undefined : targetExcept(gesture.target);
    return !obstacles(except).some((o) => rectsOverlap(draft, o));
  }, [draft, gesture, obstacles, dropInto]);

  /**
   * What the selection's drag handles act on. Only ever something in *this*
   * level's own grid — those are the only rectangles this grid can position.
   * Anything deeper is arranged by going inside it, or carried with a long press.
   */
  const handleTarget = useMemo<Target | null>(() => {
    if (!touch || !editable || !interior) return null;
    if (props.selectedStockId != null) {
      const p = interior.placed.find(
        (entry) => entry.kind === 'item' && !entry.dense && entry.item?.stock.id === props.selectedStockId
      );
      if (p?.item) {
        return { kind: 'item', item: p.item, drawn: toUnits(p.rect, interior.frame, root.c) };
      }
    }
    if (props.selectedContainerId != null) {
      const child = root.children.find((c) => c.c.id === props.selectedContainerId);
      if (child) return { kind: 'container', node: child };
    }
    return null;
  }, [touch, editable, interior, props.selectedStockId, props.selectedContainerId, root]);

  const handleRef = useRef(handleTarget);
  handleRef.current = handleTarget;

  /** The deepest thing drawn under a stage point, whatever level it belongs to. */
  const deepestAt = useCallback((sx: number, sy: number): Hit | undefined => {
    const over = (r: Rect) => sx >= r.x && sx < r.x + r.w && sy >= r.y && sy < r.y + r.h;
    return hitsRef.current.filter((entry) => over(entry.rect)).sort((a, b) => b.depth - a.depth)[0];
  }, []);

  /**
   * A press that has been held still long enough to mean something other than
   * "move the map". Over a block it picks the block up; over bare grid it starts
   * drawing. Both are deliberate, so neither can happen while you are panning.
   */
  const beginHold = useCallback(
    (clientX: number, clientY: number) => {
      const frame = frameRef.current;
      if (!frame) return;
      const p = screenPoint({ clientX, clientY });
      const screen = screenPoint({ clientX, clientY });
      const at = screenToUnits(p.x, p.y, frame, root.c);

      const under = deepestAt(p.x, p.y);
      const payload: Carried | null = under?.item
        ? under.holder
          ? { kind: 'item', item: under.item, holder: under.holder }
          : null
        : under?.node
          ? { kind: 'container', node: under.node }
          : null;

      heldRef.current = true;
      // The release must not also count as a tap: you meant to pick this up.
      dragged.current = true;

      if (payload) {
        setGesture({ kind: 'carry', payload });
        setCarry({ x: screen.x, y: screen.y, onto: null });
        setDraft(null);
        return;
      }

      const units = interiorUnits(root.c);
      if (at.x < 0 || at.y < 0 || at.x >= units.w || at.y >= units.h) return;

      const step = snapStep(root.c);
      const min = minSpan(root.c);
      const from = { x: snapTo(at.x, step), y: snapTo(at.y, step) };
      setGesture({ kind: 'draw', from });
      // Show the rectangle straight away — otherwise the long press appears to
      // have done nothing until you move, and you let go and try again.
      setDraft({
        x: Math.max(0, Math.min(from.x, units.w - min)),
        y: Math.max(0, Math.min(from.y, units.h - min)),
        w: min,
        h: min,
      });
    },
    [deepestAt, root, screenPoint]
  );

  /**
   * The wheel is the zoom, anchored on the cursor. There is nothing to scroll
   * here — the map is not a document — so claiming it costs nothing and it is
   * what every map does. A trackpad's two-finger scroll lands here too, which
   * is the gesture people already reach for.
   */
  const onWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (e.deltaY === 0) return;
    const p = screenPoint(e);
    // Trackpads send many small deltas and a mouse wheel a few large ones;
    // scaling by the magnitude keeps both feeling like the same speed.
    const steps = Math.sign(e.deltaY) * Math.min(1, Math.abs(e.deltaY) / 100);
    setView(zoomAt(baseRef.current, viewRef.current, viewRef.current.k * ZOOM_STEP ** -steps, p.x, p.y));
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    // Middle button drags the map, the way it does in every drawing tool. The
    // left button is spoken for by drawing, so once zoomed in this is how a
    // mouse gets around.
    if (e.pointerType === 'mouse' && e.button === 1) {
      e.preventDefault();
      pressAt.current = { x: e.clientX, y: e.clientY };
      dragged.current = false;
      setGesture({ kind: 'pan', from: screenPoint(e), view: viewRef.current });
      return;
    }
    if (e.pointerType === 'mouse' && e.button !== 0) return;

    const screen = screenPoint(e);
    pointers.current.set(e.pointerId, screen);

    // A second finger always means pinch, whatever the first one was doing.
    if (pointers.current.size === 2) {
      cancelLongPress();
      const [a, b] = [...pointers.current.values()];
      const s = span(a, b);
      setDraft(null);
      setCarry(null);
      dragged.current = true;
      setGesture({ kind: 'pinch', dist: s.dist, cx: s.cx, cy: s.cy, view: viewRef.current });
      return;
    }
    if (pointers.current.size > 2) return;

    dragged.current = false;
    heldRef.current = false;
    pressAt.current = { x: e.clientX, y: e.clientY };
    if (pending) return;

    // A handle is the one thing that always edits — that is the whole point of
    // drawing one. It wins over pan, over long press, over everything.
    const grabbed = (e.target as Element | null)?.closest?.('[data-handle]');
    const hit = handleRef.current;
    if (grabbed && hit) {
      const at = pointerUnits(e);
      const current = targetRect(hit);
      if (at) {
        setGesture(
          grabbed.getAttribute('data-handle') === 'resize'
            ? { kind: 'resize', target: hit }
            : { kind: 'move', target: hit, grab: { x: at.x - current.x, y: at.y - current.y } }
        );
        setDraft({ ...current });
      }
      return;
    }

    // Decided from *this* event, not from what the device claims to be. On an
    // iPad with a trackpad attached both arrive at the same window: the finger
    // should pan and long-press, the trackpad should draw and drag directly,
    // and asking the device which one it "is" cannot answer that.
    if (e.pointerType === 'touch') {
      // The default, and the reason this reads as a map: one finger moves it.
      setGesture({ kind: 'pan', from: screen, view: viewRef.current });
      setDraft(null);
      if (!editable) return;
      const { clientX, clientY } = e;
      cancelLongPress();
      longPress.current = window.setTimeout(() => {
        longPress.current = null;
        beginHold(clientX, clientY);
      }, LONG_PRESS_MS);
      return;
    }

    if (!editable) return;
    const at = pointerUnits(e);
    const frame = frameRef.current;
    if (!at || !frame) return;

    const units = interiorUnits(root.c);
    // The letterboxed margin is outside the container altogether. Drawing there
    // used to get clamped into the grid, quietly creating things off-canvas.
    const outsideInterior = at.x < 0 || at.y < 0 || at.x >= units.w || at.y >= units.h;

    const { x: px, y: py } = screenPoint(e);
    const over = (r: Rect) => px >= r.x && px < r.x + r.w && py >= r.y && py < r.y + r.h;

    // Anything drawn deeper than this level has no place in this grid, but it
    // can be picked up and carried somewhere else — including back out here.
    const deep = hitsRef.current
      .filter((entry) => entry.depth > 0 && over(entry.rect))
      .sort((a, b) => b.depth - a.depth)[0];
    if (deep) {
      const payload: Carried | null = deep.item
        ? deep.holder
          ? { kind: 'item', item: deep.item, holder: deep.holder }
          : null
        : deep.node
          ? { kind: 'container', node: deep.node }
          : null;
      if (payload) {
        setGesture({ kind: 'carry', payload });
        setCarry({ x: px, y: py, onto: null });
        setDraft(null);
        return;
      }
    }

    // Hit-test against what was actually drawn, so a loose part — which has no
    // slot yet — can still be grabbed and thereby given one.
    let target: Target | undefined;
    for (const p of placedRef.current) {
      if (p.kind === 'item' && p.item && over(p.rect)) {
        target = { kind: 'item', item: p.item, drawn: toUnits(p.rect, frame, root.c) };
        break;
      }
    }
    if (!target) {
      const child = root.children.find(
        (c) => at.x >= c.c.x && at.x < c.c.x + c.c.w && at.y >= c.c.y && at.y < c.c.y + c.c.h
      );
      if (child) target = { kind: 'container', node: child };
    }

    if (!target && outsideInterior) {
      setGesture(null);
      setDraft(null);
      return;
    }

    // Note: the pointer is deliberately *not* captured here. Capturing on press
    // retargets the following click event to the viewport, which would stop
    // clicks ever reaching a block — capture is deferred until a real drag.
    if (!target) {
      const step = snapStep(root.c);
      setGesture({ kind: 'draw', from: { x: snapTo(at.x, step), y: snapTo(at.y, step) } });
      setDraft(null);
      return;
    }

    const current = targetRect(target);
    const box = unitsToScreen(current, frame, root.c);

    // The drawn corner resizes.
    const grip = gripSize(box, touch);
    if (px > box.x + box.w - grip && py > box.y + box.h - grip) {
      setGesture({ kind: 'resize', target });
      setDraft({ ...current });
      return;
    }

    // Moving is grabbed by the title bar only, so pressing the body of a block
    // is always just a click — you can never nudge a drawer out of place while
    // trying to look inside it. Anything with no title bar (a part, or a block
    // too small for one) uses its whole face as the handle.
    const byHead =
      target.kind === 'container' && hasHeadStrip(target.node, box, props.maxDepth)
        ? py <= box.y + HEAD_H
        : true;
    if (!byHead) {
      setGesture(null);
      setDraft(null);
      return;
    }

    setGesture({
      kind: 'move',
      target,
      grab: { x: at.x - current.x, y: at.y - current.y },
    });
    setDraft({ ...current });
  };

  /**
   * What a carried thing would land in if released at this point. The deepest
   * container under the pointer wins; failing that, the level itself, which is
   * how you pull something back out of whatever it is buried in.
   */
  const dropTargetAt = useCallback(
    (px: number, py: number, carried: Carried): Node | null => {
      const home = carriedHome(carried);
      // Find what is under the pointer *first*, then judge it. Filtering the
      // home out up front would make releasing it back where it came from look
      // like a drop onto bare stage, and quietly move it out.
      const under =
        hitsRef.current
          .filter(
            (entry) =>
              entry.node &&
              px >= entry.rect.x && px < entry.rect.x + entry.rect.w &&
              py >= entry.rect.y && py < entry.rect.y + entry.rect.h
          )
          .sort((a, b) => b.depth - a.depth)[0]?.node ?? null;

      if (under) return under === home || wouldNest(carried, under) ? null : under;

      const f = frameRef.current;
      const overStage = !!f && px >= f.x && px < f.x + f.w && py >= f.y && py < f.y + f.h;
      return overStage && home !== root && !wouldNest(carried, root) ? root : null;
    },
    [root]
  );

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, screenPoint(e));
    if (!gesture) return;
    // Belt and braces: if the button came up somewhere we never heard about,
    // treat the next move as the end of the gesture rather than continuing it.
    if (e.pointerType === 'mouse' && e.buttons === 0) {
      onPointerUp(e);
      return;
    }

    // Ignore the jitter of an ordinary click, so a click still navigates.
    const travel = Math.hypot(e.clientX - pressAt.current.x, e.clientY - pressAt.current.y);
    const isDrag = travel > (e.pointerType === 'touch' ? DRAG_SLOP_TOUCH : DRAG_SLOP);

    // Wandering means you are dragging the map, not holding still to pick
    // something up — so the long press stops waiting.
    if (travel > LONG_PRESS_SLOP) cancelLongPress();

    if (gesture.kind === 'pinch') {
      const [a, b] = [...pointers.current.values()];
      if (!a || !b) return;
      const s = span(a, b);
      // Anchor on the midpoint: zoom about the fingers, and let the midpoint
      // moving carry the map with it, so pinch and two-finger pan are one thing.
      const pinched = zoomAt(
        baseRef.current,
        gesture.view,
        gesture.view.k * (s.dist / gesture.dist),
        gesture.cx,
        gesture.cy
      );
      setView(panBy(pinched, s.cx - gesture.cx, s.cy - gesture.cy));
      return;
    }

    if (gesture.kind === 'pan') {
      if (!isDrag) return;
      dragged.current = true;
      const p = screenPoint(e);
      setView(panBy(gesture.view, p.x - gesture.from.x, p.y - gesture.from.y));
      return;
    }

    const at = pointerUnits(e);
    if (!at) return;
    const step = snapStep(root.c);
    const min = minSpan(root.c);
    const units = interiorUnits(root.c);

    // Now that it is definitely a drag, take the pointer so it keeps tracking
    // even if it leaves the viewport. Retargeting the click no longer matters.
    if ((isDrag || heldRef.current) && !captured.current && ref.current) {
      try {
        ref.current.setPointerCapture(e.pointerId);
        captured.current = true;
      } catch {
        /* the pointer went away between the move and here; carry on without it */
      }
    }

    if (gesture.kind === 'carry') {
      if (!isDrag && !heldRef.current) return;
      dragged.current = true;
      const { x: px, y: py } = screenPoint(e);
      const screen = screenPoint(e);
      setCarry({ x: screen.x, y: screen.y, onto: dropTargetAt(px, py, gesture.payload) });
      return;
    }

    if (gesture.kind === 'draw') {
      const x0 = Math.min(gesture.from.x, snapTo(at.x, step));
      const y0 = Math.min(gesture.from.y, snapTo(at.y, step));
      const x1 = Math.max(gesture.from.x, snapTo(at.x, step));
      const y1 = Math.max(gesture.from.y, snapTo(at.y, step));
      const next = {
        x: Math.max(0, x0),
        y: Math.max(0, y0),
        w: Math.max(Math.min(x1, units.w) - Math.max(0, x0), min),
        h: Math.max(Math.min(y1, units.h) - Math.max(0, y0), min),
      };
      if (isDrag) dragged.current = true;
      setDraft(next);
      return;
    }

    if (!isDrag) return;
    dragged.current = true;
    const current = targetRect(gesture.target);

    if (gesture.kind === 'move') {
      setDraft(
        clampToInterior(
          {
            x: snapTo(at.x - gesture.grab.x, step),
            y: snapTo(at.y - gesture.grab.y, step),
            w: current.w,
            h: current.h,
          },
          root.c
        )
      );
    } else {
      const wanted = {
        x: current.x,
        y: current.y,
        w: Math.max(min, Math.min(snapTo(at.x, step) - current.x, units.w - current.x)),
        h: Math.max(min, Math.min(snapTo(at.y, step) - current.y, units.h - current.y)),
      };
      const stopped = clampResize(wanted, obstacles(targetExcept(gesture.target)));
      setDraft({ ...stopped, w: Math.max(stopped.w, min), h: Math.max(stopped.h, min) });
    }
  };

  const onPointerUp = (e: { pointerId: number; clientX?: number; clientY?: number }) => {
    cancelLongPress();
    pointers.current.delete(e.pointerId);
    if (captured.current) {
      try {
        ref.current?.releasePointerCapture(e.pointerId);
      } catch {
        /* the pointer is already gone */
      }
      captured.current = false;
    }
    const g = gesture;
    const d = draft;
    const carried = carry;
    heldRef.current = false;

    // Lifting one finger out of a pinch leaves the other one still down and
    // still meaning "move the map" — hand the gesture over rather than dropping
    // it, or the map freezes until you tap again.
    if (g?.kind === 'pinch') {
      const [rest] = [...pointers.current.values()];
      setGesture(rest ? { kind: 'pan', from: rest, view: viewRef.current } : null);
      setTimeout(() => (dragged.current = false), 0);
      return;
    }

    setGesture(null);
    setCarry(null);

    if (g?.kind === 'pan') {
      if (dragged.current) setTimeout(() => (dragged.current = false), 0);
      return;
    }

    if (g?.kind === 'carry') {
      const wasDrag = dragged.current;
      if (wasDrag) setTimeout(() => (dragged.current = false), 0);
      // Resolve the target from where the pointer actually came up. Trusting the
      // last hover would drop it wherever it passed over on the way.
      const at =
        e.clientX !== undefined && e.clientY !== undefined
          ? screenPoint({ clientX: e.clientX, clientY: e.clientY })
          : null;
      const onto = at ? dropTargetAt(at.x, at.y, g.payload) : carried?.onto ?? null;
      // A long press that was picked up and put straight back down is a
      // cancelled pick-up, not a move — `onto` is null there, so nothing runs.
      if (wasDrag && onto) {
        if (g.payload.kind === 'item') props.onMoveItemInto(g.payload.item, onto);
        else props.onMoveContainerInto(g.payload.node, onto);
      }
      return;
    }
    // The click event fires immediately after pointerup, so the suppression
    // flag has to survive exactly that long and no longer — leaving it set
    // would swallow the next click that arrives without a pointerdown.
    if (dragged.current) setTimeout(() => (dragged.current = false), 0);
    if (!g || !d) {
      setDraft(null);
      return;
    }

    if (!dragged.current || !valid) {
      // A tap on empty space, or a drop that would overlap: forget it.
      setDraft(null);
      return;
    }

    if (g.kind === 'draw') {
      setPending(d); // keep it on screen while the name is typed
    } else {
      setDraft(null);
      if (g.target.kind === 'container') props.onPlaceChild(g.target.node, d);
      else if (dropInto) props.onMoveItemInto(g.target.item, dropInto);
      else props.onPlaceItem(g.target.item, d);
    }
  };

  // A pointer released outside the window never reaches the viewport's own
  // handler, which used to leave the gesture live — the view then kept
  // "dragging" with no button held until you clicked somewhere to break it out.
  // Registered unconditionally, because the list of live fingers has to be
  // trimmed on every release, gesture or no gesture: one stale entry and the
  // next single touch would be mistaken for the second half of a pinch.
  const finish = useRef(onPointerUp);
  finish.current = onPointerUp;
  useEffect(() => {
    const end = (ev: PointerEvent) => finish.current(ev);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    return () => {
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
  }, []);

  /* --------------------------------------------------------------- render */

  const out: ReactNode[] = [];
  const hits: Hit[] = [];
  if (interior) {
    const ctx: Ctx = { props, out, hits, clickBlocked: () => dragged.current, touch };

    // The orange outline marks the level you are actually standing in.
    out.push(
      <div
        key="stage-frame"
        className="stage-frame"
        style={{
          left: interior.frame.x - 2,
          top: interior.frame.y - 2,
          width: interior.frame.w + 4,
          height: interior.frame.h + 4,
        }}
      />
    );

    // A hit-testable surface over the level itself, purely so the cursor can
    // say "draw here" inside and "step back out" in the margin around it.
    out.push(
      <div
        key="stage-surface"
        className="stage-surface"
        style={{
          left: interior.frame.x,
          top: interior.frame.y,
          width: interior.frame.w,
          height: interior.frame.h,
        }}
      />
    );

    // The grid is drawn for both layouts as a placement reference — a free
    // container just gets a fainter one, since nothing has to line up with it.
    if (editable && props.showGrid) {
      const units = interiorUnits(root.c);
      const cell = interior.frame.w / units.w;
      if (cell >= 5) {
        out.push(
          <div
            key="stage-grid"
            className={root.c.layout === 'grid' ? 'stage-grid' : 'stage-grid faint'}
            style={{
              left: interior.frame.x,
              top: interior.frame.y,
              width: interior.frame.w,
              height: interior.frame.h,
              backgroundSize: `${cell}px ${interior.frame.h / units.h}px`,
            }}
          />
        );
      }
    }

    for (const placed of interior.placed) emitBlock(placed, root, 0, ctx);
    hitsRef.current = hits;

    if (carry) {
      if (carry.onto) {
        // Dropping onto the level itself has no block to outline, so the stage
        // frame stands in for it.
        const target =
          carry.onto === root
            ? { rect: interior.frame }
            : hits.find((entry) => entry.node === carry.onto);
        if (target) {
          out.push(
            <div
              key="carry-target"
              className="carry-target"
              style={{
                left: target.rect.x,
                top: target.rect.y,
                width: target.rect.w,
                height: target.rect.h,
              }}
            />
          );
        }
      }
    }

    const ghost = pending ?? draft;
    if (ghost && interior.frame) {
      const box = unitsToScreen(ghost, interior.frame, root.c);
      out.push(
        <div
          key="draft"
          className={cx('draft', dropInto && 'into', !valid && 'invalid')}
          style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
        >
          <span>
            {dropInto
              ? `into ${dropInto.c.name}`
              : valid
                ? size(ghost)
                : `${size(ghost)} — blocked`}
          </span>
        </div>
      );
    }
  }

  // Shown whether or not you can draw: an empty level that says nothing at all
  // looks broken, and with editing off you still need to be told why.
  const hint = !root.children.length && !root.items.length;

  /**
   * Drop a new rectangle into the biggest clear patch and go straight to naming
   * it. Drawing one by hand is fine with a mouse; with a fingertip, on a grid
   * whose cells may be four pixels across, being handed a correctly sized
   * rectangle to nudge is far better than being asked to draw one.
   */
  const addHere = () => {
    const free = largestFreeRect(root);
    const units = interiorUnits(root.c);
    const step = snapStep(root.c);
    const box = free ?? { x: 0, y: 0, w: units.w, h: units.h };
    setPending({
      x: box.x,
      y: box.y,
      // A quarter of the free patch, but never smaller than one cell and never
      // the whole thing — you want something to grab, not a full-bleed slab.
      w: Math.max(step, Math.min(box.w, Math.max(1, Math.round(box.w / 2)))),
      h: Math.max(step, Math.min(box.h, Math.max(1, Math.round(box.h / 2)))),
    });
    setDraft(null);
  };

  const zoomed = !atRest(view);
  const handleBox =
    handleTarget && interior
      ? unitsToScreen(draft ?? targetRect(handleTarget), interior.frame, root.c)
      : null;

  /**
   * Handles are no use where you cannot reach them. A block against the top of
   * the screen, or panned half out of it, would otherwise hang its move pad off
   * the edge — so they are pulled back inside the viewport. Once the block is
   * gone from the screen entirely there is nothing to point at, and they go too.
   */
  const HANDLE_EDGE = 22;
  const onScreen =
    !!handleBox &&
    handleBox.x + handleBox.w > 0 && handleBox.x < size_.w &&
    handleBox.y + handleBox.h > 0 && handleBox.y < size_.h;
  const pin = (x: number, y: number) => ({
    left: Math.min(Math.max(x, HANDLE_EDGE), Math.max(HANDLE_EDGE, size_.w - HANDLE_EDGE)),
    top: Math.min(Math.max(y, HANDLE_EDGE), Math.max(HANDLE_EDGE, size_.h - HANDLE_EDGE)),
  });

  return (
    <div
      ref={ref}
      className={cx('viewport', editable && 'editable', insideSomething && 'nested', touch && 'touch')}
      title={insideSomething ? 'Click the surrounding space to step back out' : undefined}
      // The map handles its own panning and zooming, so the browser must not
      // also try: a one-finger drag is a pan, two fingers are a zoom, and
      // neither may turn into a page scroll or scale the toolbar along with it.
      // Keyed to *any* touchscreen, not just a touch-first one — an iPad driven
      // by a trackpad can still be prodded, and that prod must reach us.
      style={{ touchAction: anyTouch || editable ? 'none' : undefined }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onWheel={onWheel}
      onClick={(e) => {
        // Blocks stop propagation, so anything arriving here landed on bare
        // space — either the level's own floor or the margin around it.
        if (dragged.current || pending) return;
        const frame = frameRef.current;
        if (!frame || !ref.current) return;
        const { x: px, y: py } = screenPoint(e);
        const outside =
          px < frame.x || px > frame.x + frame.w || py < frame.y || py > frame.y + frame.h;

        // The margin is "outside" this level, so clicking it steps back out —
        // the discoverable version of right-click / Backspace.
        if (outside && props.clickOutsideToGoBack && root.c.id !== WORLD_ID) {
          onUp();
          return;
        }
        // Otherwise clicking nothing means exactly that: nothing is selected.
        props.onDeselect();
      }}
      onContextMenu={(e) => {
        if (pending) {
          e.preventDefault();
          setPending(null);
          return;
        }
        if (!props.rightClickToGoBack) return; // leave the browser menu alone
        e.preventDefault();
        onUp();
      }}
    >
      {out}

      {handleBox && onScreen && (
        <>
          {/* Clear of the top edge rather than straddling it, so on a one-unit
              slot the two handles do not sit on top of each other. */}
          <div
            className="grab-move"
            data-handle="move"
            style={pin(handleBox.x + handleBox.w / 2, handleBox.y - 18)}
            aria-label="Drag to move"
          >
            ⠿
          </div>
          <div
            className="grab-size"
            data-handle="resize"
            style={pin(handleBox.x + handleBox.w, handleBox.y + handleBox.h)}
            aria-label="Drag to resize"
          />
        </>
      )}

      {carry && (
        <div className="carry-ghost" style={{ left: carry.x + 14, top: carry.y + 14 }}>
          {gesture?.kind === 'carry' ? carriedName(gesture.payload) : ''}
          {carry.onto && <b> → {carry.onto.c.name}</b>}
        </div>
      )}

      {!pending && (editable && touch || zoomed) && (
        <div className="map-tools">
          {editable && touch && (
            <button
              className="map-tool add"
              onClick={addHere}
              title={`Add something inside ${root.c.name}`}
              aria-label={`Add something inside ${root.c.name}`}
            >
              ＋
            </button>
          )}

          {/* Not a zoom control — the wheel and the pinch are that. This is
              only the way back, and it appears solely when there is somewhere
              to come back from. How big the *interface* is drawn is a settings
              question, and lives under the cog. */}
          {zoomed && (
            <button
              className="map-tool readout"
              onClick={() => setViewRaw(IDENTITY)}
              title="Back to fitting the window"
              aria-label="Fit the level to the window"
            >
              <span className="mt-zoom">{Math.round(view.k * 100)}%</span>
              <span>⤢</span>
            </button>
          )}
        </div>
      )}

      {pending && interior && (
        <DrawPrompt
          rect={pending}
          // The prompt is outside the transformed layer, so it needs where the
          // rectangle actually appears, not where it was laid out.
          anchor={unitsToScreen(pending, interior.frame, root.c)}
          types={props.types}
          onCancel={() => {
            setPending(null);
            setDraft(null);
          }}
          onCreate={(what, name, typeId, qty) => {
            if (what === 'part') props.onDrawPart(root, pending, name, qty);
            else props.onDrawChild(root, pending, name, typeId);
            setPending(null);
            setDraft(null);
          }}
        />
      )}

      {hint && (
        <DrawHint
          name={root.c.name}
          atTop={root.c.id === WORLD_ID}
          editable={editable}
          touch={touch}
        />
      )}
    </div>
  );
}

function DrawHint({
  name,
  atTop,
  editable,
  touch,
}: {
  name: string;
  atTop: boolean;
  editable: boolean;
  touch: boolean;
}) {
  const how = touch ? 'Drag a finger' : 'Drag';
  return (
    <div className="empty-state">
      <div>
        <h2>{atTop ? 'Nothing here yet' : `${name} is empty`}</h2>
        <p>
          {!editable
            ? `Turn on "Edit the layout" to draw what is inside ${atTop ? 'the workshop' : name}.`
            : atTop
              ? `${how} across the grid to lay out the room — a closet here, a bench there. Then go inside each one and draw what it holds.`
              : `${how} across the grid to carve out the first thing inside it.`}
        </p>
      </div>
    </div>
  );
}

/* ----------------------------------------------------- rendering decisions */

// Shared by the renderer and by hit-testing, so the strip you can grab is
// always exactly the strip you can see.

const showsContents = (node: Node, rect: Rect, maxDepth: number, depth: number): boolean =>
  (node.children.length > 0 || node.items.length > 0) &&
  depth < maxDepth &&
  rect.w > CONTENT_MIN &&
  rect.h > CONTENT_MIN;

/**
 * A title bar depends only on there being room for one. An empty drawer still
 * wants its name and its size on show — that is exactly when you need to know
 * how much room is going spare.
 */
const hasHeadStrip = (_node: Node, rect: Rect, _maxDepth: number, _depth = 0): boolean =>
  rect.h > HEAD_MIN_H && rect.w > 60;

/* ---------------------------------------------------------------- emitters */

function emitBlock(placed: Placed, parent: Node, depth: number, ctx: Ctx) {
  const { rect } = placed;
  if (rect.w < 2 || rect.h < 2) return;

  if (placed.kind === 'empty') return; // the grid overlay already shows these

  if (placed.kind === 'item') {
    emitItem(placed, parent, depth, ctx);
    return;
  }

  if (placed.kind === 'summary') {
    const count = placed.count ?? 0;
    ctx.out.push(
      <div
        key={`s${parent.c.id}-${placed.key}`}
        className={cx('block', 'part', 'more', placed.dense && 'row', ctx.props.searching && 'dimmed')}
        style={{ ...boxStyle(rect, depth + 1), ...fillStyle('#8a7a63', depth + 1) }}
        title={`${count} more item${count === 1 ? '' : 's'} in ${parent.c.name} — open it to see them`}
        onClick={(e) => {
          e.stopPropagation();
          if (ctx.clickBlocked()) return;
          ctx.props.onOpen(parent);
        }}
      >
        {placed.dense ? (
          <Row rect={rect} name={`+${count} more`} qty="" />
        ) : (
          <Label rect={rect} name={`+${count} more`} centered />
        )}
      </div>
    );
    return;
  }

  const { props } = ctx;
  const node = placed.node!;
  const matched = props.search.matched.has(node.c.id);
  const onPath = props.search.onPath.has(node.c.id);
  const dimmed = props.searching && !matched && !onPath;

  const showContents = showsContents(node, rect, props.maxDepth, depth);
  const showHead = hasHeadStrip(node, rect, props.maxDepth, depth);

  const address = cellAddress(parent.c, node.c);
  const summary = describe(node);
  const movable = depth === 0 && props.mode === 'physical';
  ctx.hits.push({ rect, depth, node });

  ctx.out.push(
    <div
      key={`c${node.c.id}`}
      className={cx(
        'block',
        movable && 'movable',
        dimmed && 'dimmed',
        matched && 'match',
        !matched && onPath && 'onpath',
        props.selectedContainerId === node.c.id && 'selected'
      )}
      style={{ ...boxStyle(rect, depth), ...fillStyle(colorOf(node), depth) }}
      title={`${node.c.name}\n${typeName(node)} · ${node.c.cols}×${node.c.rows} U inside · takes ${size(node.c)} U${address ? ` at ${address}` : ''}\n${summary}\n\nClick to inspect · double-click to go inside`}
      onClick={(e) => {
        e.stopPropagation();
        if (ctx.clickBlocked()) return;
        if (props.singleClickEnters) props.onOpen(node);
        else props.onSelect(node);
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        props.onOpen(node);
      }}
    >
      {showHead ? (
        <>
          <div className="block-head" style={{ height: HEAD_H }} title={`Drag to move ${node.c.name}`}>
            {movable && rect.w > 90 && <span className="grip">⠿</span>}
            <span className="grow">{node.c.name}</span>
            {/* Its own capacity, which is what you want to know at a glance —
                where it sits is already obvious from looking at it. */}
            {rect.w > 130 && <span className="addr">{node.c.cols}×{node.c.rows} U</span>}
          </div>
          {!showContents && (
            <div className="block-empty" style={{ top: HEAD_H }}>
              {summary}
            </div>
          )}
        </>
      ) : (
        <Label rect={rect} name={node.c.name} meta={summary} centered={!showContents} />
      )}
      {movable && <Grip rect={rect} touch={ctx.touch} />}
    </div>
  );

  if (!showContents) return;

  const body = inset(
    { x: rect.x, y: rect.y + (showHead ? HEAD_H : 0), w: rect.w, h: rect.h - (showHead ? HEAD_H : 0) },
    PAD
  );
  if (body.w < 6 || body.h < 6) return;

  const interior = layoutInterior(node, body, props.mode, {
    showEmpty: false,
    // A preview drawn inside its parent fills the block rather than keeping true
    // proportions. Aspect only matters where you are working; from outside, what
    // matters is whether the thing looks full — and a letterboxed grid reads as
    // empty space that is not really there.
    letterbox: false,
  });
  for (const child of interior.placed) emitBlock(child, node, depth + 1, ctx);
}

function emitItem(placed: Placed, holder: Node, depth: number, ctx: Ctx) {
  const { props } = ctx;
  const { rect } = placed;
  const item = placed.item!;
  // Every part at this level can be dragged; doing so is what gives a loose one
  // a slot in the first place.
  const grabbable = depth === 0 && props.mode === 'physical' && !placed.dense;
  ctx.hits.push({ rect, depth, item, holder });
  const matched = props.search.matchedStock.has(item.stock.id);
  const dimmed = props.searching && !matched;
  const selected = props.selectedStockId === item.stock.id;
  const low = item.part.min_qty != null && item.stock.qty < item.part.min_qty;

  ctx.out.push(
    <div
      key={`i${item.stock.id}`}
      className={cx(
        'block', 'part', placed.dense && 'row', grabbable && 'movable',
        dimmed && 'dimmed', matched && 'match', selected && 'selected'
      )}
      style={{ ...boxStyle(rect, depth + 1), ...fillStyle(low ? '#c2604f' : '#c39a5e', depth + 1) }}
      title={`${item.part.name}\n${item.stock.qty} ${item.part.unit}${low ? '  ⚠ below minimum' : ''}`}
      onClick={(e) => {
        e.stopPropagation();
        if (ctx.clickBlocked()) return;
        props.onSelectItem(item, holder);
      }}
    >
      {placed.dense ? (
        <Row rect={rect} name={item.part.name} qty={fmtQty(item.stock.qty)} />
      ) : (
        <Label
          rect={rect}
          name={item.part.name}
          meta={`${fmtQty(item.stock.qty)} ${item.part.unit}`}
          centered={rect.h < 34}
        />
      )}
      {grabbable && <Grip rect={rect} touch={ctx.touch} />}
    </div>
  );
}

/**
 * The resize corner, drawn rather than invisible. Its size matches the hit area
 * exactly, so what you aim at is what responds.
 */
function Grip({ rect, touch }: { rect: Rect; touch?: boolean }) {
  const size = gripSize(rect, touch);
  if (rect.w < 26 || rect.h < 20) return null;
  return <div className="grip-corner" style={{ width: size, height: size }} />;
}

/** One line: name on the left, quantity on the right if there is room. */
function Row({ rect, name, qty }: { rect: Rect; name: string; qty: string }) {
  if (rect.h < 8 || rect.w < 24) return null;
  const size = Math.max(9, Math.min(12, Math.round(rect.h * 0.62)));
  return (
    <div className="block-row" style={{ fontSize: size }}>
      <span className="rname">{name}</span>
      {rect.w > 90 && <span className="rqty">{qty}</span>}
    </div>
  );
}

/* ------------------------------------------------------------------ pieces */

function Label({
  rect,
  name,
  meta,
  centered,
}: {
  rect: Rect;
  name: string;
  meta?: string;
  centered?: boolean;
}) {
  if (rect.w < LABEL_MIN_W || rect.h < LABEL_MIN_H) return null;
  const tiny = rect.h < 38 || rect.w < 78;
  const showMeta = !!meta && rect.h > 38 && rect.w > 62;
  return (
    <div className={cx('block-label', tiny && 'tiny', centered && 'center')}>
      <span className="name">{name}</span>
      {showMeta && <span className="meta">{meta}</span>}
    </div>
  );
}

/* ------------------------------------------------------------------- style */

/**
 * Everything is a flat list of absolutely positioned siblings, so depth alone
 * decides what covers what — a child must always paint over its parent.
 */
const boxStyle = (r: Rect, depth: number): CSSProperties => ({
  left: Math.round(r.x),
  top: Math.round(r.y),
  width: Math.max(Math.round(r.w), 1),
  height: Math.max(Math.round(r.h), 1),
  zIndex: 10 + depth,
});

/**
 * SpaceSniffer's blocks read as physical objects because of the light/dark
 * gradient plus the bevel in `.block`. Depth darkens the fill so nesting stays
 * legible where borders are only a pixel apart.
 */
function fillStyle(color: string | null, depth: number): CSSProperties {
  const base = color || `hsl(32 36% ${Math.max(28, 60 - depth * 6)}%)`;
  const shade = Math.min(depth * 7, 28);
  return {
    background: `linear-gradient(157deg,
      color-mix(in srgb, ${base}, #fff 15%),
      color-mix(in srgb, ${base}, #000 ${15 + shade}%))`,
    color: textOn(base),
  };
}

/** Dark ink on the warm fills; flip to light if a custom colour is dark. */
function textOn(base: string): string {
  const hex = /^#([0-9a-f]{6})$/i.exec(base.trim());
  if (!hex) return '#2a1f10';
  const n = parseInt(hex[1], 16);
  const luma = (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
  return luma > 0.5 ? '#2a1f10' : '#f4efe7';
}

/* ------------------------------------------------------------------ helpers */

const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ');

export function fmtQty(qty: number): string {
  if (!Number.isFinite(qty)) return '0';
  if (Number.isInteger(qty)) return qty.toLocaleString();
  return (Math.round(qty * 100) / 100).toLocaleString();
}

function describe(node: Node): string {
  const bits: string[] = [];
  if (node.totalContainers) bits.push(`${node.totalContainers} spaces`);
  if (node.totalItems) bits.push(`${node.totalItems} items`);
  if (!bits.length) bits.push('empty');
  return bits.join(' · ');
}
