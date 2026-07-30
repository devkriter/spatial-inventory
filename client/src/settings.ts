/**
 * Per-device preferences. These live in localStorage rather than the database
 * because they describe how *this* browser behaves — the phone at the bench and
 * the PC across the room reasonably want different answers.
 */
export interface Settings {
  /* navigation */
  singleClickEnters: boolean;
  clickOutsideToGoBack: boolean;
  rightClickToGoBack: boolean;
  backspaceToGoBack: boolean;

  /* view */
  /**
   * How big the interface is drawn — toolbar, panels, menus, dialogs. Not the
   * map: the blocks keep their own scale, which is what the map's own zoom is
   * for. 1 is the design size.
   */
  uiScale: number;
  showGrid: boolean;
  drawDepth: number;
  /** The tree of everything, down the left. */
  showTree: boolean;
  /** The details panel, down the right. */
  showDetails: boolean;

  /* safety */
  confirmDelete: boolean;

  /* labels */
  labelWidthMm: number;
  labelHeightMm: number;
  labelDpi: number;
  labelShowPath: boolean;
  labelShowQr: boolean;
  labelShowAddress: boolean;
  /**
   * What the QR codes point at. Empty means "wherever this page is", which is
   * right on the phone and wrong on the desk — a label printed at
   * `http://localhost:5178` does nothing at all when scanned. Set it to the
   * machine's address on the network and every label works from anywhere.
   */
  labelBaseUrl: string;
  /** Empty means "work it out from the printer". */
  printTask: string;
  printDensity: number;
  printQuantity: number;

  /** Bumped when a default changes in a way that should reach existing users. */
  version: number;
}

const VERSION = 2;

export const DEFAULT_SETTINGS: Settings = {
  singleClickEnters: false,
  clickOutsideToGoBack: true,
  rightClickToGoBack: true,
  backspaceToGoBack: true,

  uiScale: 1,
  showGrid: true,
  drawDepth: 3,
  showTree: true,
  showDetails: true,

  confirmDelete: true,

  labelWidthMm: 50,
  labelHeightMm: 30,
  labelDpi: 203,
  labelShowPath: true,
  labelShowQr: true,
  // Off by default: a printed address goes stale the moment you rearrange, and
  // a label you have to reprint to move something is worse than no label. The
  // QR is the durable pointer — it identifies the container, and the app knows
  // where that container currently is.
  labelShowAddress: false,
  labelBaseUrl: '',
  printTask: '',
  printDensity: 3,
  printQuantity: 1,
  version: VERSION,
};

const KEY = 'inventory.settings.v1';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    // Read the version from what was actually saved. Taking it from the merged
    // object would read the current default and every migration would no-op.
    const from = parsed.version ?? 1;
    // Merge over the defaults so a settings blob written by an older build
    // never leaves a newly added option undefined.
    const stored = { ...DEFAULT_SETTINGS, ...parsed };
    const migrated = migrate(stored, from);
    if (migrated !== stored) saveSettings(migrated);
    return migrated;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/**
 * Applies default changes that should reach settings already saved. Printing the
 * address turned out to be a mistake — move a drawer and every label on it is
 * wrong — so it is switched off once, and stays off unless you turn it back on.
 */
function migrate(stored: Settings, from: number): Settings {
  if (from >= VERSION) return stored;
  return { ...stored, labelShowAddress: false, version: VERSION };
}

/** Guard rails: below this the app is unreadable, above it nothing fits. */
export const UI_SCALE_MIN = 0.8;
export const UI_SCALE_MAX = 1.6;

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* private mode, quota, etc. — the session still works, it just won't stick */
  }
}
