import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api';
import { buildTree } from './tree';
import { emptySearch, search as runSearch } from './search';
import { SpaceDialog } from './components/SpaceDialog';
import { Sidebar } from './components/Sidebar';
import { TreePanel } from './components/TreePanel';
import { SpaceView, fmtQty } from './components/SpaceView';
import { TypeManager } from './components/TypeManager';
import { SettingsDialog } from './components/SettingsDialog';
import { LabelDialog } from './components/LabelDialog';
import { PrinterDialog } from './components/PrinterDialog';
import { ItemNames } from './components/ItemNames';
import { Walkthrough, hasSeenWalkthrough, markWalkthroughSeen } from './components/Walkthrough';
import { MobileMenu } from './components/MobileMenu';
import { LocationMenu } from './components/LocationMenu';
import { NameDialog } from './components/NameDialog';
import { loadSettings, saveSettings, type Settings } from './settings';
import { useAnyTouch, usePhone, useTouch } from './mobile';
import {
  ROOT_ID,
  type Space,
  type Holding,
  type Node,
  type Item,
  type SizeMode,
  type State,
  type SpaceType,
  type UnitRect,
  type RootSpace,
} from './types';

const MODES: { id: SizeMode; label: string; title: string }[] = [
  { id: 'physical', label: 'Layout', title: 'Blocks match the grid you drew' },
  { id: 'items', label: 'Count', title: 'Treemap: block area follows how many distinct items are inside' },
  { id: 'qty', label: 'Volume', title: 'Treemap: block area follows total quantity held' },
];

/** Only used for the instant before the first fetch lands. */
const BLANK_ROOT_SPACE: RootSpace = {
  id: 1,
  name: 'Workshop',
  layout: 'grid',
  cols: 24,
  rows: 16,
  row_origin: 'top',
  updated_at: '',
};

interface DialogState {
  parent: Node;
  existing?: Node;
}

export default function App() {
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Where you are standing, and what you are looking at, are separate: a single
  // click inspects a space, only a double click walks into it.
  const [rootId, setRootId] = useState<number>(ROOT_ID);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selectedHoldingId, setSelectedHoldingId] = useState<number | null>(null);
  /** A displaced item — one with no location at all — picked from the tree. */
  const [displacedId, setDisplacedId] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<SizeMode>('physical');
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [typesOpen, setTypesOpen] = useState(false);
  const [tourOpen, setTourOpen] = useState(() => !hasSeenWalkthrough());
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** Which space the label dialog is making labels for. */
  const [labelsFor, setLabelsFor] = useState<number | null>(null);
  const [printerOpen, setPrinterOpen] = useState(false);
  /** A one-field 'what shall it be called' dialog, in the app rather than the browser. */
  const [naming, setNaming] = useState<
    { title: string; value?: string; confirm?: string; onSave: (name: string) => void } | null
  >(null);
  const [settings, setSettings] = useState<Settings>(loadSettings);

  /* ------------------------------------------------------------ phone shell */

  const phone = usePhone();
  const touch = useTouch();
  const anyTouch = useAnyTouch();
  /**
   * On a phone the panels are overlays, so they cannot follow the persisted
   * `showTree`/`showDetails` — a saved "on" would open the app with the map
   * buried. They start closed and are opened by hand, or by the selection.
   */
  const [treeOpen, setTreeOpen] = useState(false);
  const [sheet, setSheet] = useState<'bar' | 'full'>('bar');
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  /**
   * Layout editing is opt-in wherever a fingertip is the pointer — a tablet as
   * much as a phone. Rearranging with a finger is a thing you have to mean, and
   * while you are looking for a resistor at the bench you do not mean it.
   */
  const [touchEditing, setTouchEditing] = useState(false);
  /** How much of the map the details sheet is covering, so it can keep clear. */
  const [sheetHeight, setSheetHeight] = useState(0);
  const editing = !touch || touchEditing;

  const changeSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveSettings(next);
      return next;
    });
  }, []);

  /**
   * The interface size is one number that every chrome dimension is written
   * against, so it lives on the root element rather than being threaded through
   * components. The map deliberately does not read it — its scale is its own.
   */
  useEffect(() => {
    document.documentElement.style.setProperty('--ui', String(settings.uiScale));
  }, [settings.uiScale]);

  const showTree = phone ? treeOpen : settings.showTree;
  const showDetails = phone || settings.showDetails;
  /**
   * Make sure the details are visible, whichever form they take here. Already
   * open is left alone — nudging an expanded sheet back down to a peek, or
   * rewriting the settings on every click, would both be worse than nothing.
   */
  const openDetails = useCallback(() => {
    if (phone) setSheet('full');
    else if (!settings.showDetails) changeSettings({ showDetails: true });
  }, [phone, settings.showDetails, changeSettings]);

  const searchRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(async () => {
    try {
      setState(await api.state());
    } catch (err) {
      setError(String((err as Error).message));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // `?go=<id>` is what the QR code on a printed label points at, so scanning a
  // drawer from your phone lands you inside it.
  const deepLinked = useRef(false);
  useEffect(() => {
    if (deepLinked.current || !state) return;
    const target = Number(new URLSearchParams(window.location.search).get('go'));
    deepLinked.current = true;
    const landing = target && state.spaces.some((c) => c.id === target) ? target : ROOT_ID;
    if (landing !== ROOT_ID) setRootId(landing);
    window.history.replaceState({ rootId: landing }, '', window.location.pathname);
  }, [state]);

  /**
   * Going into a space is navigation, so the browser's Back button should
   * step back out of it rather than leaving the app — especially on a phone,
   * where Back is the system gesture.
   */
  const fromHistory = useRef(false);
  useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      fromHistory.current = true;
      setRootId(Number(e.state?.rootId ?? ROOT_ID));
      setSelectedId(null);
      setSelectedHoldingId(null);
      setDisplacedId(null);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    if (fromHistory.current) {
      fromHistory.current = false; // came *from* the back button; do not re-push
      return;
    }
    if (window.history.state?.rootId === rootId) return;
    window.history.pushState({ rootId }, '');
  }, [rootId]);

  // Deselecting collapses an open sheet — it was describing the thing you just
  // let go of. Selecting does *not* open it: the band already names what is
  // selected, and a sheet leaping over the map on every tap is what made the
  // old peek state so costly.
  useEffect(() => {
    if (!phone) return;
    const anything = selectedId != null || selectedHoldingId != null || displacedId != null;
    if (!anything) setSheet('bar');
  }, [phone, selectedId, selectedHoldingId, displacedId]);

  // Any mutation just refetches: the dataset is small and this keeps the tree,
  // the aggregates and the view trivially consistent.
  const act = useCallback(
    async (fn: () => Promise<unknown>) => {
      try {
        await fn();
        await reload();
      } catch (err) {
        setError(String((err as Error).message));
      }
    },
    [reload]
  );

  const tree = useMemo(
    () => buildTree(state ?? { rootSpace: BLANK_ROOT_SPACE, types: [], spaces: [], items: [], holdings: [] }),
    [state]
  );
  const rootSpace = tree.rootSpace;
  const types = state?.types ?? [];

  /**
   * Locations are the spaces with nothing above them: a workshop, a bedroom, a
   * lock-up across town. Each is a tree in its own right, reached from the
   * switcher rather than by navigating — there is no floor plan of the world,
   * and pretending there is would put a level in the way of every trip.
   */
  const locations = rootSpace.children;
  // Never stand on the synthetic root. If nothing sensible is selected — first
  // load, or the location you were in has been deleted — fall into the first.
  const standingOn = tree.byId.get(rootId);
  const root =
    standingOn && standingOn.space.id !== ROOT_ID ? standingOn : locations[0] ?? rootSpace;
  /** The location the current level belongs to, for the switcher's label. */
  const location = root.path.length ? tree.byId.get(root.path[0].id) ?? root : root;

  const searching = query.trim().length > 0;
  const result = useMemo(
    () => (searching ? runSearch(tree, query) : emptySearch),
    [tree, query, searching]
  );

  /** Catalogue entries held nowhere at all — the "Displaced" branch. */
  const displaced = useMemo(() => {
    const held = new Set(state?.holdings.map((s) => s.item_id));
    return (state?.items ?? []).filter((p) => !held.has(p.id));
  }, [state]);

  // A displaced item that gets put back, or forgotten, stops being displaced.
  const displacedItem = displacedId != null ? displaced.find((p) => p.id === displacedId) ?? null : null;
  useEffect(() => {
    if (displacedId != null && !displacedItem) setDisplacedId(null);
  }, [displacedId, displacedItem]);

  const typeUsage = useMemo(() => {
    const counts = new Map<number, number>();
    for (const c of state?.spaces ?? []) {
      if (c.type_id != null) counts.set(c.type_id, (counts.get(c.type_id) ?? 0) + 1);
    }
    return counts;
  }, [state]);

  // The panel follows the selection when there is one, otherwise the level.
  const panelNode = (selectedId != null ? tree.byId.get(selectedId) : undefined) ?? root;
  const labelsNode = labelsFor != null ? tree.byId.get(labelsFor) ?? null : null;

  const selected: Holding | null = useMemo(() => {
    if (selectedHoldingId == null) return null;
    return panelNode.holdings.find((holding) => holding.row.id === selectedHoldingId) ?? null;
  }, [panelNode, selectedHoldingId]);

  const select = useCallback((node: Node) => {
    setSelectedId(node.space.id);
    setSelectedHoldingId(null);
  }, []);

  const open = useCallback((node: Node) => {
    setRootId(node.space.id);
    setSelectedId(null);
    setSelectedHoldingId(null);
  }, []);

  /**
   * Jump to something and point at it. An item: step into the space holding
   * it. A space: stand in its parent, so you see it highlighted in context.
   */
  const reveal = useCallback(
    (node: Node, holding: Holding | null) => {
      const stage = holding ? node : node.parent ?? tree.rootSpace;
      setRootId(stage.space.id);
      setSelectedId(node.space.id);
      setSelectedHoldingId(holding?.row.id ?? null);
    },
    [tree]
  );

  const up = useCallback(() => {
    setSelectedId(null);
    setSelectedHoldingId(null);
    // A location is the top of its own tree; above it is the switcher, not a
    // level, so Back stops here rather than surfacing on a synthetic root.
    if (!root.parent || root.parent.space.id === ROOT_ID) return;
    setRootId(root.parent.space.id);
  }, [root]);

  const closeTour = useCallback(() => {
    markWalkthroughSeen();
    setTourOpen(false);
  }, []);

  /* ------------------------------------------------------------ shortcuts */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Not every keydown targets an element — one dispatched at the window
      // has no `closest`, and blindly calling it would throw in here.
      const target = e.target instanceof Element ? e.target : null;
      const typing = !!target?.closest('input, textarea, select');

      if (e.key === '/' && !typing) {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (e.key === 'Escape') {
        if (menuOpen) setMenuOpen(false);
        else if (tourOpen) closeTour();
        else if (labelsFor != null) setLabelsFor(null);
        else if (printerOpen) setPrinterOpen(false);
        else if (settingsOpen) setSettingsOpen(false);
        else if (typesOpen) setTypesOpen(false);
        else if (dialog) setDialog(null);
        else if (selectedHoldingId != null) setSelectedHoldingId(null);
        else if (selectedId != null) setSelectedId(null);
        else if (query) setQuery('');
        else (document.activeElement as HTMLElement | null)?.blur();
        return;
      }
      // Enter walks into whatever is selected, mirroring the double click.
      if (e.key === 'Enter' && !typing && selectedId != null) {
        const node = tree.byId.get(selectedId);
        if (node) open(node);
        return;
      }
      if (
        typing || dialog || typesOpen || tourOpen || settingsOpen || printerOpen || menuOpen ||
        labelsFor != null
      )
        return;
      if ((e.key === 'Backspace' || e.key === 'ArrowLeft') && settings.backspaceToGoBack) {
        e.preventDefault();
        up();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    dialog, typesOpen, tourOpen, settingsOpen, printerOpen, menuOpen, labelsFor, closeTour, query,
    selectedHoldingId, selectedId, tree, open, up, settings.backspaceToGoBack,
  ]);

  /* --------------------------------------------------------------- saving */

  const saveSpace = (data: Partial<Space>) => {
    const d = dialog;
    if (!d) return;
    setDialog(null);
    void act(async () => {
      if (d.existing) {
        await api.updateSpace(d.existing.space.id, data);
      } else {
        const parentId = d.parent.space.id === ROOT_ID ? null : d.parent.space.id;
        const created = await api.createSpace({ ...data, parent_id: parentId });
        setRootId(created.id);
      }
    });
  };

  /**
   * A rectangle dragged onto the grid. The drawn size is the footprint; the
   * interior comes from the chosen type, because a 6×12 drawer unit still holds
   * a 12×12 grid of drawers. With no type, what you drew is what you get.
   */
  /**
   * A new location, made on the spot. Deliberately not the "add a space" form:
   * that asks which type it is and how much room it takes up inside its parent,
   * and a location has no parent and no footprint anywhere. All it needs is a
   * name and a grid to start drawing on, so it gets the standard 24 × 16 and
   * you are dropped straight into it.
   */
  const createLocation = () => {
    setNaming({
      title: 'New location',
      confirm: 'Create',
      onSave: (name) => makeLocation(name),
    });
  };

  const makeLocation = (name: string) => {
    void act(async () => {
      const made = await api.createSpace({
        parent_id: null,
        name,
        x: 0,
        y: 0,
        w: 6,
        h: 5,
        layout: 'grid',
        cols: 24,
        rows: 16,
        row_origin: 'top',
      });
      setSelectedId(null);
      setSelectedHoldingId(null);
      setDisplacedId(null);
      setRootId(made.id);
    });
  };

  const renameLocation = (node: Node) => {
    setNaming({
      title: 'Rename location',
      value: node.space.name,
      onSave: (name) => {
        if (name !== node.space.name) void act(() => api.updateSpace(node.space.id, { name }));
      },
    });
  };

  /** The tree renames spaces and items too; same dialog, different subject. */
  const askName = (title: string, value: string, apply: (name: string) => void) =>
    setNaming({ title, value, onSave: (name) => name !== value && apply(name) });

  const drawChild = (parent: Node, rect: UnitRect, name: string, typeId: number | null) => {
    const type = types.find((t) => t.id === typeId);
    void act(() =>
      api.createSpace({
        parent_id: parent.space.id === ROOT_ID ? null : parent.space.id,
        type_id: typeId,
        name,
        x: rect.x,
        y: rect.y,
        w: rect.w,
        h: rect.h,
        layout: type?.layout ?? 'free',
        cols: type?.cols ?? Math.max(1, Math.round(rect.w)),
        rows: type?.rows ?? Math.max(1, Math.round(rect.h)),
        row_origin: parent.space.row_origin,
      })
    );
  };

  const deleteSpace = (node: Node) => {
    const inside = node.totalSpaces + node.totalHoldings;
    const warning = inside
      ? `Delete "${node.space.name}" and everything inside it (${node.totalSpaces} spaces, ${node.totalHoldings} items)?`
      : `Delete "${node.space.name}"?`;
    // Something with contents is always confirmed, whatever the setting says.
    if ((settings.confirmDelete || inside > 0) && !confirm(warning)) return;
    const parentId = node.parent ? node.parent.space.id : ROOT_ID;
    void act(async () => {
      await api.deleteSpace(node.space.id);
      if (rootId === node.space.id) setRootId(parentId);
    });
  };

  const exportAll = async () => {
    try {
      const dump = await api.exportAll();
      const blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `inventory-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(String((err as Error).message));
    }
  };

  const importAll = (file: File) => {
    if (!confirm('Importing replaces everything currently in the database. Continue?')) return;
    void act(async () => {
      const dump = JSON.parse(await file.text());
      await api.importAll(dump);
      setRootId(ROOT_ID);
    });
  };

  /* ----------------------------------------------------------------- view */

  if (!state) {
    return (
      <div className="app">
        <div className="empty-state"><p>Loading inventory…</p></div>
      </div>
    );
  }

  // The crumb trail starts at the location, not above it. Locations are picked
  // from the switcher in its place — each is its own tree, and stacking them
  // under a synthetic root would add a level that leads nowhere useful.
  const crumbs: Node[] = [];
  for (const c of root.path) {
    const node = tree.byId.get(c.id);
    if (node) crumbs.push(node);
  }

  const searchBox = (
    <div className="search">
      <input
        ref={searchRef}
        value={query}
        placeholder={phone ? 'Search items and spaces' : 'Search items and spaces   /'}
        // A phone keyboard should offer Search, not a newline, and must not
        // "helpfully" capitalise or correct a part number like 10k or M3x8.
        type="search"
        enterKeyHint="search"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        onChange={(e) => setQuery(e.target.value)}
      />
      {query && <button className="clear" onClick={() => setQuery('')}>✕</button>}
    </div>
  );

  return (
    <div className="app">
      <div className="topwrap">
        {phone ? (
          <div className="topbar phone">
            <button
              className={treeOpen ? 'btn ghost on' : 'btn ghost'}
              onClick={() => setTreeOpen((v) => !v)}
              aria-label="Everything, as a tree"
            >
              ▤
            </button>

            <button
              className="btn ghost"
              onClick={up}
              disabled={root.space.id === ROOT_ID}
              aria-label="Back"
            >
              ←
            </button>

            <LocationMenu
              locations={locations}
              current={location}
              onPick={open}
              onCreate={createLocation}
              onRename={renameLocation}
            />

            {/* Only the tail of the trail below the location fits, and it is
                the useful end: where you are, and the step above it. */}
            <nav className="crumbs">
              {crumbs.slice(1).slice(-2).map((node, i, shown) => (
                <span key={node.space.id} style={{ display: 'contents' }}>
                  <span className="crumb-sep">›</span>
                  <button
                    className={i === shown.length - 1 ? 'crumb current' : 'crumb'}
                    onClick={() => open(node)}
                  >
                    {node.space.name}
                  </button>
                </span>
              ))}
            </nav>

            <button
              className={searchOpen || query ? 'btn ghost on' : 'btn ghost'}
              onClick={() => {
                const next = !(searchOpen || query);
                setSearchOpen(next);
                if (!next) setQuery('');
                else setTimeout(() => searchRef.current?.focus(), 0);
              }}
              aria-label="Search"
            >
              ⌕
            </button>

            <button
              className={touchEditing ? 'btn ghost on' : 'btn ghost'}
              onClick={() => setTouchEditing((v) => !v)}
              aria-label={touchEditing ? 'Stop editing the layout' : 'Edit the layout'}
            >
              ✎
            </button>

            <button className="btn ghost" onClick={() => setMenuOpen(true)} aria-label="Menu">
              ⋯
            </button>
          </div>
        ) : (
          <div className="topbar">
            <button
              className={settings.showTree ? 'btn ghost on' : 'btn ghost'}
              onClick={() => changeSettings({ showTree: !settings.showTree })}
              title="The tree of everything, on the left"
            >
              ▤
            </button>

            <button
              className="btn back"
              onClick={up}
              disabled={root.space.id === ROOT_ID}
              title={
                root.space.id === ROOT_ID
                  ? 'You are at the top'
                  : `Back to ${root.parent?.space.name ?? 'Workshop'} — or click the space around this level, press Backspace, or right-click`
              }
            >
              ← Back
            </button>

            <LocationMenu
              locations={locations}
              current={location}
              onPick={open}
              onCreate={createLocation}
              onRename={renameLocation}
            />

            <nav className="crumbs">
              {crumbs.slice(1).map((node, i, trail) => (
                <span key={node.space.id} style={{ display: 'contents' }}>
                  <span className="crumb-sep">›</span>
                  <button
                    className={i === trail.length - 1 ? 'crumb current' : 'crumb'}
                    onClick={() => open(node)}
                  >
                    {node.space.name}
                  </button>
                </span>
              ))}
            </nav>

            {searchBox}

            <div className="segmented" title="How block size is decided">
              {MODES.map((m) => (
                <button
                  key={m.id}
                  className={mode === m.id ? 'on' : ''}
                  title={m.title}
                  onClick={() => setMode(m.id)}
                >
                  {m.label}
                </button>
              ))}
            </div>

            <button className="btn" onClick={() => setDialog({ parent: root })}>+ Add</button>
            <button className="btn" onClick={() => setTypesOpen(true)} title="Define your space types">
              Types
            </button>
            <button
              className="btn"
              onClick={exportAll}
              title="Save everything — spaces, items and quantities — to a .json file on this computer"
            >
              ↓ Back up
            </button>
            <label
              className="btn"
              title="Load a .json backup. This replaces everything currently in the database."
              style={{ cursor: 'pointer' }}
            >
              ↑ Restore
              <input
                type="file"
                accept="application/json"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (file) importAll(file);
                }}
              />
            </label>
            <button
              className="btn"
              onClick={() => setPrinterOpen(true)}
              title="Label printer, stock size and defaults"
            >
              🏷 Labels
            </button>
            {/* A tablet gets the full toolbar but is still driven by a finger,
                so it needs the same way out of edit mode the phone has. */}
            {touch && (
              <button
                className={touchEditing ? 'btn ghost on' : 'btn ghost'}
                onClick={() => setTouchEditing((v) => !v)}
                title={
                  touchEditing
                    ? 'Editing the layout — tap to stop'
                    : 'Edit the layout: handles on the selection, hold to draw or pick up'
                }
              >
                ✎
              </button>
            )}
            <button className="btn ghost" onClick={() => setSettingsOpen(true)} title="Settings">
              ⚙
            </button>
            <button
              className={settings.showDetails ? 'btn ghost on' : 'btn ghost'}
              onClick={() => changeSettings({ showDetails: !settings.showDetails })}
              title="Details panel, on the right"
            >
              ☰
            </button>
            <button className="btn ghost" onClick={() => setTourOpen(true)} title="How this works">
              ?
            </button>
          </div>
        )}

        {/* The search field needs the whole width on a phone, so it gets its
            own row rather than competing with navigation for the toolbar. */}
        {phone && (searchOpen || query) && <div className="searchbar">{searchBox}</div>}
      </div>

      {phone && showTree && <div className="scrim" onClick={() => setTreeOpen(false)} />}

      {showTree && (
        <TreePanel
          tree={tree}
          root={root}
          location={location}
          selectedId={selectedId}
          selectedHoldingId={selectedHoldingId}
          displaced={displaced}
          selectedItemId={displacedId}
          search={result}
          searching={searching}
          onOpen={(node) => {
            setDisplacedId(null);
            open(node);
            // On a phone the tree covers the map, so picking somewhere to go
            // has to get out of the way to show you that you went there.
            setTreeOpen(false);
          }}
          onReveal={(node, holding) => {
            setDisplacedId(null);
            reveal(node, holding);
            setTreeOpen(false);
          }}
          onSelectDisplaced={(item) => {
            setDisplacedId(item.id);
            setTreeOpen(false);
            openDetails();
          }}
          onClose={() => (phone ? setTreeOpen(false) : changeSettings({ showTree: false }))}
          onAskName={askName}
          onRenameSpace={(node, name) => act(() => api.updateSpace(node.space.id, { name }))}
          onDeleteSpace={deleteSpace}
          onAddInside={(node) => setDialog({ parent: node })}
          onMakeLabels={(node) => setLabelsFor(node.space.id)}
          onRenameItem={(itemId, name) => act(() => api.updateItem(itemId, { name }))}
          onRemoveHolding={(holdingId) => act(() => api.deleteHolding(holdingId))}
          onDeleteItem={(itemId) => act(() => api.deleteItem(itemId))}
        />
      )}

      <SpaceView
        root={root}
        types={types}
        mode={mode}
        search={result}
        searching={searching}
        selectedHoldingId={selectedHoldingId}
        selectedSpaceId={selectedId}
        // Three levels of nesting on a 6-inch screen is a mosaic of specks.
        maxDepth={phone ? Math.min(settings.drawDepth, 2) : settings.drawDepth}
        showGrid={settings.showGrid}
        editing={editing}
        touch={touch}
        anyTouch={anyTouch}
        insetBottom={phone ? sheetHeight : 0}
        singleClickEnters={settings.singleClickEnters}
        clickOutsideToGoBack={settings.clickOutsideToGoBack}
        // A long press is how a phone raises a context menu; wiring that to
        // "go up a level" would make the map lurch about at random.
        rightClickToGoBack={settings.rightClickToGoBack && !touch}
        onSelect={select}
        onOpen={open}
        onSelectHolding={(holding, holder) => {
          setSelectedId(holder.space.id);
          setSelectedHoldingId(holding.row.id);
          openDetails();
        }}
        onDrawChild={drawChild}
        onDrawItem={(parent, rect, name, qty) =>
          act(() => api.addHolding({ space_id: parent.space.id, name, qty, ...rect }))
        }
        onPlaceChild={(node, rect) => act(() => api.updateSpace(node.space.id, rect))}
        onPlaceHolding={(holding, rect) => act(() => api.updateHolding(holding.row.id, rect))}
        onMoveHoldingInto={(holding, target) =>
          // No slot given, so the server finds it a free cell over there.
          act(() => api.updateHolding(holding.row.id, { space_id: target.space.id }))
        }
        onMoveSpaceInto={(node, target) =>
          act(() =>
            api.updateSpace(node.space.id, {
              parent_id: target.space.id === ROOT_ID ? null : target.space.id,
            })
          )
        }
        onUp={up}
        onDeselect={() => {
          setSelectedId(null);
          setSelectedHoldingId(null);
          setDisplacedId(null);
        }}
      />

      {showDetails && (
        <Sidebar
          sheet={phone}
          onHeight={setSheetHeight}
          expanded={sheet === 'full'}
          onToggleHeight={() => setSheet((s) => (s === 'full' ? 'bar' : 'full'))}
          tree={tree}
          onClose={() => {
            if (!phone) {
              changeSettings({ showDetails: false });
              return;
            }
            // Dismissing the sheet drops the selection with it. Leaving it
            // behind would mean tapping the same block again changed nothing,
            // so the sheet would refuse to come back.
            setSheet('bar');
            setSelectedId(null);
            setSelectedHoldingId(null);
            setDisplacedId(null);
          }}
          node={panelNode}
          root={root}
          selected={selected}
          search={result}
          searching={searching}
          onReveal={reveal}
          onOpen={open}
          onSelectHolding={(holding) => setSelectedHoldingId(holding?.row.id ?? null)}
          onAddChild={(parent) => setDialog({ parent })}
          onEditSpace={(node) => setDialog({ parent: node.parent ?? rootSpace, existing: node })}
          onMakeLabels={(node) => setLabelsFor(node.space.id)}
          onDeleteSpace={deleteSpace}
          onAddHolding={(spaceId, name, qty) =>
            act(() => api.addHolding({ space_id: spaceId, name, qty }))
          }
          onSetQty={(holdingId, qty) => act(() => api.updateHolding(holdingId, { qty }))}
          onRemoveHolding={(holdingId) => {
            setSelectedHoldingId(null);
            void act(() => api.deleteHolding(holdingId));
          }}
          onSaveItem={(itemId, patch: Partial<Item>) => act(() => api.updateItem(itemId, patch))}
          onMoveHolding={(holdingId, spaceId) => {
            setSelectedHoldingId(null);
            void act(() => api.updateHolding(holdingId, { space_id: spaceId }));
          }}
          displacedItem={displacedItem}
          onPlaceDisplaced={(itemId, spaceId, qty) =>
            act(async () => {
              const holding = await api.addHolding({ space_id: spaceId, item_id: itemId, qty });
              // Go and look at where it landed, rather than leaving the panel empty.
              setDisplacedId(null);
              setRootId(spaceId);
              setSelectedId(spaceId);
              setSelectedHoldingId(holding.id);
            })
          }
          onDismissDisplaced={() => setDisplacedId(null)}
          onDeleteItem={(itemId) => act(() => api.deleteItem(itemId))}
          rootSpace={state.rootSpace}
          onSaveRootSpace={(patch) => act(() => api.updateRootSpace(patch))}
          onSaveLocation={(node, patch) => act(() => api.updateSpace(node.space.id, patch))}
        />
      )}

      {/* A row of running totals and keyboard hints is worth a strip of a
          monitor and nothing at all of a phone, where the same pixels are the
          difference between a readable drawer and a smudge. The totals move
          into the ⋯ menu instead. */}
      {!phone && (
        <div className="statusbar">
          <span>{tree.flat.length} spaces</span>
          <span>{state.items.length} distinct items</span>
          <span>{state.holdings.length} holdings</span>
          <span>{fmtQty(rootSpace.totalQty)} units total</span>
          <span className="spacer" />
          <span>
            {`${root.space.cols} × ${root.space.rows} U · drag to draw · double-click to go inside` +
              (root.space.id === ROOT_ID ? ' · / to search' : ' · click outside to go back')}
          </span>
        </div>
      )}

      {menuOpen && (
        <MobileMenu
          hereName={root.space.name}
          mode={mode}
          modes={MODES}
          onMode={setMode}
          editing={touchEditing}
          onEditing={setTouchEditing}
          stats={{
            spaces: tree.flat.length,
            items: state.items.length,
            holdings: state.holdings.length,
            units: fmtQty(rootSpace.totalQty),
          }}
          onDetails={() => setSheet('full')}
          onAdd={() => setDialog({ parent: root })}
          onTypes={() => setTypesOpen(true)}
          onLabels={() => setPrinterOpen(true)}
          onSettings={() => setSettingsOpen(true)}
          onTour={() => setTourOpen(true)}
          onExport={exportAll}
          onImport={importAll}
          onClose={() => setMenuOpen(false)}
        />
      )}

      {dialog && (
        <SpaceDialog
          parent={dialog.parent}
          existing={dialog.existing}
          types={types}
          onSave={saveSpace}
          onManageTypes={() => setTypesOpen(true)}
          onClose={() => setDialog(null)}
        />
      )}

      {typesOpen && (
        <TypeManager
          types={types}
          usage={typeUsage}
          onCreate={(data: Partial<SpaceType>) => act(() => api.createType(data))}
          onUpdate={(id, data) => act(() => api.updateType(id, data))}
          onDelete={(id) => act(() => api.deleteType(id))}
          onClose={() => setTypesOpen(false)}
        />
      )}

      {settingsOpen && (
        <SettingsDialog
          settings={settings}
          onChange={changeSettings}
          onReplayWalkthrough={() => {
            setSettingsOpen(false);
            setTourOpen(true);
          }}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {printerOpen && (
        <PrinterDialog
          settings={settings}
          onChange={changeSettings}
          onClose={() => setPrinterOpen(false)}
        />
      )}

      {labelsNode && (
        <LabelDialog
          node={labelsNode}
          settings={settings}
          onOpenPrinter={() => setPrinterOpen(true)}
          onClose={() => setLabelsFor(null)}
        />
      )}

      <ItemNames items={state.items} />

      {naming && (
        <NameDialog
          title={naming.title}
          value={naming.value}
          confirm={naming.confirm}
          label="Name"
          onSave={naming.onSave}
          onClose={() => setNaming(null)}
        />
      )}

      {tourOpen && <Walkthrough onClose={closeTour} phone={phone} touch={touch} />}

      {error && (
        <div className="toast" onClick={() => setError(null)}>
          {error} <span style={{ opacity: 0.6 }}>(click to dismiss)</span>
        </div>
      )}
    </div>
  );
}
