import { useEffect, useState, type ReactNode } from 'react';

const SEEN_KEY = 'inventory.walkthrough.seen.v1';

export const hasSeenWalkthrough = (): boolean => {
  try {
    return localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return true; // no storage: never nag
  }
};

export const markWalkthroughSeen = (): void => {
  try {
    localStorage.setItem(SEEN_KEY, '1');
  } catch {
    /* nothing to do */
  }
};

interface Step {
  title: string;
  body: ReactNode;
}

const KEY = (k: string) => <kbd>{k}</kbd>;

/**
 * The tour is assembled rather than picked, because the two things that vary
 * vary independently. How you move around depends on whether you are using a
 * finger; which controls exist depends on how wide the window is. A tablet is
 * both at once — touch gestures, full toolbar — and neither prepared tour
 * would have described it correctly.
 */
const OVERVIEW: Step = {
  title: 'What you are looking at',
  body: (
    <>
      <p>
        Your storage drawn to scale, one level at a time. Each rectangle is a space —
        a closet, a drawer unit, a drawer, a bin. The <b>orange outline</b> is the
        level you are currently standing in.
      </p>
      <p>
        Everything is measured in <b>units (U)</b> — plain squares, not millimetres.
        A space is a grid of so many units across and down, and each thing inside
        it claims a rectangle of those units.
      </p>
      <p>
        The top level — your <b>Workshop</b> — is a grid too, so you can arrange the room
        itself: put the drawer unit directly under the cabinet, the bench along the far wall.
      </p>
      <p>
        Each space is drawn in <b>two views</b>. From the front it is a slice of whatever holds
        it — a drawer in a cabinet is one slice tall. Open it and you see its floor plan from
        above, which can be a full 12 × 12 grid. So a drawer can hold far more than its slice
        could ever show; when that happens the contents switch from tiles to a compact list, and
        then to a <b>+N more</b> you can open.
      </p>
    </>
  ),
};

/**
 * Driven by a finger. `phone` only changes where the details live and what is
 * folded away — a tablet gets these gestures *and* the full toolbar.
 */
const touchSteps = (phone: boolean): Step[] => [
  {
    title: 'Moving around the map',
    body: (
      <>
        <ul className="wt-list">
          <li><b>Drag</b> anywhere to move the map. That is the default, always — you can never knock something out of place by dragging it.</li>
          <li><b>Pinch</b> to zoom in on a drawer full of small items. Only the map scales; the toolbar and panels stay put. <b>⤢</b> at the bottom puts it back.</li>
          <li>
            <b>Tap</b> a block to inspect it.{' '}
            {phone
              ? 'A sheet slides up describing it; drag its handle for the full details, ✕ to send it away.'
              : 'The panel on the right describes it, and you stay where you are.'}
          </li>
          <li><b>Double-tap</b> a block, or use <b>Open</b> in the panel, to go inside it.</li>
        </ul>
        <p className="wt-note">
          To come back out: tap the empty space around the level, the <b>←</b> button, a
          breadcrumb, or your device's own back gesture — it steps back through the app rather
          than leaving it. <b>▤</b> is the whole inventory as a tree, and search is in the
          toolbar.
        </p>
      </>
    ),
  },
  {
    title: 'Changing things',
    body: (
      <>
        <p>
          <b>✎</b> turns editing on. Dragging still moves the map — everything below needs you
          to mean it, so nothing can happen by accident while you are holding the thing
          one-handed.
        </p>
        <ul className="wt-list">
          <li>
            <b>Tap something, then drag its handles.</b> A selected block grows a round
            <b> ⠿ pad</b> on top to move it and a <b>circle</b> at its bottom-right corner to
            resize. They stay the same size however far you zoom in, so a one-unit slot is as
            easy to grab as a whole closet.
          </li>
          <li>
            <b>＋</b> at the bottom hands you a new rectangle in the biggest clear space, ready
            to be named and then nudged into place — easier than drawing one accurately.
          </li>
          <li>
            <b>Press and hold empty grid</b>, then drag, to draw a rectangle freehand.
          </li>
          <li>
            <b>Press and hold a block</b> to pick it up, then drop it into another space —
            works at any depth, and dropping it on bare grid pulls it up out of whatever it
            was buried in.
          </li>
        </ul>
        <p className="wt-note">
          Items go in without any of this: tap a space and use <b>Put an item in here</b> in
          the panel.{' '}
          {phone && <><b>⋯</b> holds the rest — space types, labels, settings, backups.</>}
        </p>
      </>
    ),
  },
];

/** Driven by a mouse. */
const MOUSE_STEPS: Step[] = [
  {
    title: 'Getting around',
    body: (
      <ul className="wt-list">
        <li><b>Click</b> a block to inspect it. You stay where you are; the panel on the right describes it.</li>
        <li><b>Double-click</b> it, or press {KEY('Enter')}, to go inside.</li>
        <li>
          To come back out: <b>click the empty space around the level</b> (the cursor
          turns into a magnifier there), the <b>← Back</b> button, {KEY('Backspace')},
          a breadcrumb at the top, or right-click anywhere.
        </li>
        <li>Press {KEY('/')} to jump to the search box. {KEY('Esc')} clears whatever is selected.</li>
      </ul>
    ),
  },
  {
    title: 'Building the map',
    body: (
      <>
        <ul className="wt-list">
          <li><b>Drag a rectangle</b> across bare grid to create a space there. Name it, pick a type, done.</li>
          <li>
            <b>Drag a block by its title bar</b> (the strip across the top, marked ⠿) to move it.
            The rest of the block is safe to click — you cannot knock anything out of place by
            accident.
          </li>
          <li><b>Drag the bottom-right corner</b> of a block — the ribbed square — to resize it.</li>
          <li>
            When you finish drawing, the prompt asks whether it is a <b>Space</b> or an <b>Item</b>,
            so a drawer with compartments gets one item per compartment. Every item takes a slot on
            the grid automatically, and drags and resizes just like a space does.
          </li>
          <li>
            <b>Drag an item onto another space</b> to move it there, even one several levels
            down. The target lights up green as you hover it.
          </li>
          <li>Overlaps are refused — the rectangle turns red and the drop is thrown away.</li>
          <li>To put items in, select a space and use <b>Put an item in here</b> on the right.</li>
        </ul>
        <p className="wt-note">
          Typing an item name that already exists reuses it rather than making a duplicate,
          so the same resistor can live in two drawers and still report one total.
        </p>
      </>
    ),
  },
];

/** Only where there is a toolbar to tour — on a phone it is folded into ⋯. */
const TOOLBAR_STEP: Step = {
  title: 'The toolbar, left to right',
  body: (
      <dl className="wt-keys">
        <dt>▤</dt>
        <dd>Show or hide <b>Everything</b> on the left — the whole inventory as a tree, and the
          quickest way to reach somewhere several levels down.</dd>

        <dt>← Back</dt>
        <dd>Up one level. Greyed out when you are already at the top.</dd>

        <dt>Workshop › … ›</dt>
        <dd>Breadcrumbs. Click any one to jump straight back to that level.</dd>

        <dt>Search</dt>
        <dd>
          Every word has to match, so <code>470 resistor</code> narrows and <code>10K</code> will
          not drag in <code>100K</code>. Hits glow blue and everything else dims.
        </dd>

        <dt>Layout · Count · Volume</dt>
        <dd>
          What the size of a block means. <b>Layout</b> is the real grid you drew.
          <b> Count</b> and <b>Volume</b> switch to a treemap where area follows the number of
          distinct items, or the total quantity held — good for spotting what is full.
        </dd>

        <dt>+ Add</dt>
        <dd>Create a space using the full form — needed for a top-level space like a closet,
          optional everywhere else since drawing is quicker.</dd>

        <dt>Types</dt>
        <dd>Define your own kinds of space, each with a default size, layout and colour.
          A type is only a template: changing one never reshapes what you already made.</dd>

        <dt>🏷 Labels</dt>
        <dd>The printer itself — which model, the stock loaded in it, what appears on every label,
          and a test print. To make real labels, select a space and use <b>Labels</b> in the
          details panel instead.</dd>

        <dt>⚙</dt>
        <dd>Settings — turn individual navigation shortcuts on or off, choose how many levels
          are drawn, and set your label size.</dd>

        <dt>↓ Back up</dt>
        <dd>Save everything to a <code>.json</code> file on this computer. Worth doing before
          any big reorganisation.</dd>

        <dt>↑ Restore</dt>
        <dd>Load one of those files back. It <b>replaces everything</b> currently stored, and
          asks you to confirm first.</dd>

        <dt>✎</dt>
        <dd>Touch devices only. Turns layout editing on — until you do, a drag moves the map
          and nothing can be shifted by accident.</dd>

        <dt>☰</dt>
        <dd>Show or hide the <b>Details</b> panel on the right — whatever you last clicked, and
          where you add items.</dd>
      </dl>
  ),
};

export function Walkthrough({
  onClose,
  phone,
  touch,
}: {
  onClose: () => void;
  phone?: boolean;
  touch?: boolean;
}) {
  // Assembled from the two axes independently: gestures follow the pointer,
  // the toolbar tour follows the width. A tablet needs one of each.
  const steps: Step[] = [
    OVERVIEW,
    ...(touch ? touchSteps(!!phone) : MOUSE_STEPS),
    ...(phone ? [] : [TOOLBAR_STEP]),
  ];
  const [step, setStep] = useState(0);
  const last = step === steps.length - 1;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight' && !last) setStep((s) => s + 1);
      if (e.key === 'ArrowLeft' && step > 0) setStep((s) => s - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [last, step, onClose]);

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog walkthrough">
        <header>
          {steps[step].title}
          <span className="spacer" />
          <button className="btn ghost" onClick={onClose}>✕</button>
        </header>

        <div className="body">{steps[step].body}</div>

        <footer>
          <div className="wt-dots">
            {steps.map((s, i) => (
              <button
                key={s.title}
                className={i === step ? 'wt-dot on' : 'wt-dot'}
                title={s.title}
                onClick={() => setStep(i)}
              />
            ))}
          </div>
          <span className="spacer" />
          <button className="btn" onClick={onClose}>Skip</button>
          {step > 0 && <button className="btn" onClick={() => setStep(step - 1)}>Back</button>}
          <button className="btn primary" onClick={() => (last ? onClose() : setStep(step + 1))}>
            {last ? 'Get started' : 'Next'}
          </button>
        </footer>
      </div>
    </div>
  );
}
