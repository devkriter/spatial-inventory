/**
 * What kind of machine is this.
 *
 * Deliberately *not* a device type. There is no reliable way to ask the web
 * what it is running on, and the usual guess — the user agent — is wrong for
 * exactly the case that matters here: since iPadOS 13, Safari on an iPad
 * reports itself as `Macintosh; Intel Mac OS X`. Sniffing for "iPad" finds
 * nothing. (The only tell is `MacIntel` with more than one touch point, which
 * `niimbot.ts` uses because a printer message has to name the platform.)
 *
 * What can be asked, reliably and dynamically, is what the machine can *do*.
 * Three separate questions, because they have three different answers:
 *
 * - **Narrow** decides whether the shell folds. An iPad in landscape has room
 *   for the tree, the map and the details panel, and would be worse off with a
 *   phone toolbar — so this one really is about size.
 * - **Coarse** decides the gesture model and how big things have to be. True on
 *   a phone and on an iPad; false on a desktop.
 * - **Touchable** asks only whether fingers are possible at all — true on an
 *   iPad with a trackpad attached, and on a Windows convertible, where the
 *   primary pointer is fine but the screen is still a screen you can prod.
 *
 * A device can be any combination of the three, and the parts of the app that
 * care each pick the one they actually mean.
 */
import { useEffect, useState } from 'react';

/**
 * Kept in step with the matching `@media` block in styles.css by hand — if the
 * two disagree, the layout reflows while the code still thinks it is on a
 * desktop.
 *
 * The second clause is a phone held sideways. Modern iPhones are 844–956 px
 * across in landscape, comfortably past any sane width threshold, but they are
 * only ~400 px tall — which is the dimension that actually decides whether the
 * desktop shell fits.
 */
export const PHONE_QUERY = '(max-width: 860px), (max-height: 520px) and (pointer: coarse)';

/** The main pointing device is a fingertip. True on a phone and on an iPad. */
const TOUCH_QUERY = '(pointer: coarse)';

/**
 * There is *a* touchscreen, whatever is driving the cursor. An iPad with a
 * Magic Keyboard reports a fine primary pointer, but the glass is still there
 * and a finger on it must pan the map rather than scroll the page.
 */
const ANY_TOUCH_QUERY = '(any-pointer: coarse)';

function useMediaQuery(query: string): boolean {
  // Read synchronously on the first render: a phone that started out being
  // told it was a desktop would build the whole desktop shell and then throw
  // it away, and the map would measure itself against the wrong box.
  const [matches, setMatches] = useState(
    () => typeof window !== 'undefined' && !!window.matchMedia?.(query).matches
  );

  useEffect(() => {
    const mq = window.matchMedia(query);
    const sync = () => setMatches(mq.matches);
    sync(); // rotating the phone before this ran would otherwise be missed
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, [query]);

  return matches;
}

/**
 * `?phone=1` and `?touch=1` force either mode on, `=0` forces it off. Read once
 * at load, before the deep-link handler tidies the query string away.
 *
 * Worth the three lines: it is the only way to see the touch model on a machine
 * that has no touchscreen, which is where the code gets written.
 */
function override(key: string): boolean | null {
  try {
    const value = new URLSearchParams(window.location.search).get(key);
    if (value === null) return null;
    return value !== '0' && value !== 'false';
  } catch {
    return null;
  }
}

const FORCE_PHONE = override('phone');
const FORCE_TOUCH = override('touch');

/**
 * Some browsers answer `any-pointer` badly or not at all; a non-zero touch
 * point count is the same claim from a different direction, so either will do.
 */
const HAS_TOUCH_POINTS =
  typeof navigator !== 'undefined' && (navigator.maxTouchPoints ?? 0) > 0;

/** Too narrow for side panels and a usable map at the same time. */
export const usePhone = (): boolean => {
  const matches = useMediaQuery(PHONE_QUERY);
  return FORCE_PHONE ?? matches;
};

/** Driven by a finger: bigger targets, no hover, gestures need more slop. */
export const useTouch = (): boolean => {
  const matches = useMediaQuery(TOUCH_QUERY);
  return FORCE_TOUCH ?? matches;
};

/**
 * A finger is *possible*, even if something more precise is in charge. Used
 * only for the things that must be true whenever the screen might be touched —
 * chiefly claiming the gesture so a drag pans the map instead of scrolling the
 * page. Which gesture model a given drag gets is then decided per event, from
 * `pointerType`, so a trackpad and a fingertip can both do the right thing on
 * the same machine at the same time.
 */
export const useAnyTouch = (): boolean => {
  const matches = useMediaQuery(ANY_TOUCH_QUERY);
  return FORCE_TOUCH ?? (matches || HAS_TOUCH_POINTS);
};
