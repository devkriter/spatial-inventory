import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api';
import { buildTree } from './tree';
import { emptySearch, search as runSearch } from './search';
import { ContainerDialog } from './components/ContainerDialog';
import { Sidebar } from './components/Sidebar';
import { TreePanel } from './components/TreePanel';
import { SpaceView, fmtQty } from './components/SpaceView';
import { TypeManager } from './components/TypeManager';
import { SettingsDialog } from './components/SettingsDialog';
import { LabelDialog } from './components/LabelDialog';
import { PrinterDialog } from './components/PrinterDialog';
import { PartNames } from './components/PartNames';
import { Walkthrough, hasSeenWalkthrough, markWalkthroughSeen } from './components/Walkthrough';
import { MobileMenu } from './components/MobileMenu';
import { loadSettings, saveSettings, type Settings } from './settings';
import { useAnyTouch, usePhone, useTouch } from './mobile';
import {
  WORLD_ID,
  type Container,
  type Item,
  type Node,
  type Part,
  type SizeMode,
  type State,
  type StorageType,
  type UnitRect,
  type Workspace,
} from './types';

const MODES: { id: SizeMode; label: string; title: string }[] = [
  { id: 'physical', label: 'Layout', title: 'Blocks match the grid you drew' },
  { id: 'items', label: 'Count', title: 'Treemap: block area follows how many distinct items are inside' },
  { id: 'qty', label: 'Volume', title: 'Treemap: block area follows total quantity held' },
];

/** Only used for the instant before the first fetch lands. */
const BLANK_WORKSPACE: Workspace = {
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
  // click inspects a container, only a double click walks into it.
  const [rootId, setRootId] = useState<number>(WORLD_ID);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selectedStockId, setSelectedStockId] = useState<number | null>(null);
  /** A displaced part — one with no location at all — picked from the tree. */
  const [displacedId, setDisplacedId] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<SizeMode>('physical');
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [typesOpen, setTypesOpen] = useState(false);
  const [tourOpen, setTourOpen] = useState(() => !hasSeenWalkthrough());
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** Which container the label dialog is making labels for. */
  const [labelsFor, setLabelsFor] = useState<number | null>(null);
  const [printerOpen, setPrinterOpen] = useState(false);
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
  const [sheet, setSheet] = useState<'hidden' | 'peek' | 'full'>('hidden');
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
  const showDetails = phone ? sheet !== 'hidden' : settings.showDetails;
  /**
   * Make sure the details are visible, whichever form they take here. Already
   * open is left alone — nudging an expanded sheet back down to a peek, or
   * rewriting the settings on every click, would both be worse than nothing.
   */
  const openDetails = useCallback(() => {
    if (phone) setSheet((s) => (s === 'hidden' ? 'peek' : s));
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
    const landing = target && state.containers.some((c) => c.id === target) ? target : WORLD_ID;
    if (landing !== WORLD_ID) setRootId(landing);
    window.history.replaceState({ rootId: landing }, '', window.location.pathname);
  }, [state]);

  /**
   * Going into a container is navigation, so the browser's Back button should
   * step back out of it rather than leaving the app — especially on a phone,
   * where Back is the system gesture.
   */
  const fromHistory = useRef(false);
  useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      fromHistory.current = true;
      setRootId(Number(e.state?.rootId ?? WORLD_ID));
      setSelectedId(null);
      setSelectedStockId(null);
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

  // On a phone the details are a sheet lying over the map, so they follow the
  // selection: something selected means there is something to say, nothing
  // selected means give the map its screen back.
  useEffect(() => {
    if (!phone) return;
    const anything = selectedId != null || selectedStockId != null || displacedId != null;
    setSheet((s) => (anything ? (s === 'hidden' ? 'peek' : s) : 'hidden'));
  }, [phone, selectedId, selectedStockId, displacedId]);

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
    () => buildTree(state ?? { workspace: BLANK_WORKSPACE, types: [], containers: [], parts: [], stock: [] }),
    [state]
  );
  const world = tree.world;
  const root = tree.byId.get(rootId) ?? world;
  const types = state?.types ?? [];

  const searching = query.trim().length > 0;
  const result = useMemo(
    () => (searching ? runSearch(tree, query) : emptySearch),
    [tree, query, searching]
  );

  /** Catalogue entries stocked nowhere at all — the "Displaced" branch. */
  const displaced = useMemo(() => {
    const stocked = new Set(state?.stock.map((s) => s.part_id));
    return (state?.parts ?? []).filter((p) => !stocked.has(p.id));
  }, [state]);

  // A displaced part that gets put back, or forgotten, stops being displaced.
  const displacedPart = displacedId != null ? displaced.find((p) => p.id === displacedId) ?? null : null;
  useEffect(() => {
    if (displacedId != null && !displacedPart) setDisplacedId(null);
  }, [displacedId, displacedPart]);

  const typeUsage = useMemo(() => {
    const counts = new Map<number, number>();
    for (const c of state?.containers ?? []) {
      if (c.type_id != null) counts.set(c.type_id, (counts.get(c.type_id) ?? 0) + 1);
    }
    return counts;
  }, [state]);

  // The panel follows the selection when there is one, otherwise the level.
  const panelNode = (selectedId != null ? tree.byId.get(selectedId) : undefined) ?? root;
  const labelsNode = labelsFor != null ? tree.byId.get(labelsFor) ?? null : null;

  const selected: Item | null = useMemo(() => {
    if (selectedStockId == null) return null;
    return panelNode.items.find((item) => item.stock.id === selectedStockId) ?? null;
  }, [panelNode, selectedStockId]);

  const select = useCallback((node: Node) => {
    setSelectedId(node.c.id);
    setSelectedStockId(null);
  }, []);

  const open = useCallback((node: Node) => {
    setRootId(node.c.id);
    setSelectedId(null);
    setSelectedStockId(null);
  }, []);

  /**
   * Jump to something and point at it. A part: step into the container holding
   * it. A container: stand in its parent, so you see it highlighted in context.
   */
  const reveal = useCallback(
    (node: Node, item: Item | null) => {
      const stage = item ? node : node.parent ?? tree.world;
      setRootId(stage.c.id);
      setSelectedId(node.c.id);
      setSelectedStockId(item?.stock.id ?? null);
    },
    [tree]
  );

  const up = useCallback(() => {
    setSelectedId(null);
    setSelectedStockId(null);
    setRootId(root.parent ? root.parent.c.id : WORLD_ID);
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
        else if (selectedStockId != null) setSelectedStockId(null);
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
    selectedStockId, selectedId, tree, open, up, settings.backspaceToGoBack,
  ]);

  /* --------------------------------------------------------------- saving */

  const saveContainer = (data: Partial<Container>) => {
    const d = dialog;
    if (!d) return;
    setDialog(null);
    void act(async () => {
      if (d.existing) {
        await api.updateContainer(d.existing.c.id, data);
      } else {
        const parentId = d.parent.c.id === WORLD_ID ? null : d.parent.c.id;
        const created = await api.createContainer({ ...data, parent_id: parentId });
        setRootId(created.id);
      }
    });
  };

  /**
   * A rectangle dragged onto the grid. The drawn size is the footprint; the
   * interior comes from the chosen type, because a 6×12 drawer unit still holds
   * a 12×12 grid of drawers. With no type, what you drew is what you get.
   */
  const drawChild = (parent: Node, rect: UnitRect, name: string, typeId: number | null) => {
    const type = types.find((t) => t.id === typeId);
    void act(() =>
      api.createContainer({
        parent_id: parent.c.id === WORLD_ID ? null : parent.c.id,
        type_id: typeId,
        name,
        x: rect.x,
        y: rect.y,
        w: rect.w,
        h: rect.h,
        layout: type?.layout ?? 'free',
        cols: type?.cols ?? Math.max(1, Math.round(rect.w)),
        rows: type?.rows ?? Math.max(1, Math.round(rect.h)),
        row_origin: parent.c.row_origin,
      })
    );
  };

  const deleteContainer = (node: Node) => {
    const inside = node.totalContainers + node.totalItems;
    const warning = inside
      ? `Delete "${node.c.name}" and everything inside it (${node.totalContainers} spaces, ${node.totalItems} items)?`
      : `Delete "${node.c.name}"?`;
    // Something with contents is always confirmed, whatever the setting says.
    if ((settings.confirmDelete || inside > 0) && !confirm(warning)) return;
    const parentId = node.parent ? node.parent.c.id : WORLD_ID;
    void act(async () => {
      await api.deleteContainer(node.c.id);
      if (rootId === node.c.id) setRootId(parentId);
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
      setRootId(WORLD_ID);
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

  const crumbs: Node[] = [world];
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
              disabled={root.c.id === WORLD_ID}
              aria-label="Back"
            >
              ←
            </button>

            {/* Only the tail of the path fits, and it is the useful end: where
                you are, and the one step above it. */}
            <nav className="crumbs">
              {crumbs.slice(-2).map((node, i, shown) => (
                <span key={node.c.id} style={{ display: 'contents' }}>
                  {(i > 0 || crumbs.length > shown.length) && <span className="crumb-sep">›</span>}
                  <button
                    className={i === shown.length - 1 ? 'crumb current' : 'crumb'}
                    onClick={() => open(node)}
                  >
                    {node.c.name}
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
              disabled={root.c.id === WORLD_ID}
              title={
                root.c.id === WORLD_ID
                  ? 'You are at the top'
                  : `Back to ${root.parent?.c.name ?? 'Workshop'} — or click the space around this level, press Backspace, or right-click`
              }
            >
              ← Back
            </button>

            <nav className="crumbs">
              {crumbs.map((node, i) => (
                <span key={node.c.id} style={{ display: 'contents' }}>
                  {i > 0 && <span className="crumb-sep">›</span>}
                  <button
                    className={i === crumbs.length - 1 ? 'crumb current' : 'crumb'}
                    onClick={() => open(node)}
                  >
                    {node.c.name}
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
          selectedId={selectedId}
          selectedStockId={selectedStockId}
          displaced={displaced}
          selectedPartId={displacedId}
          search={result}
          searching={searching}
          onOpen={(node) => {
            setDisplacedId(null);
            open(node);
            // On a phone the tree covers the map, so picking somewhere to go
            // has to get out of the way to show you that you went there.
            setTreeOpen(false);
          }}
          onReveal={(node, item) => {
            setDisplacedId(null);
            reveal(node, item);
            setTreeOpen(false);
          }}
          onSelectDisplaced={(part) => {
            setDisplacedId(part.id);
            setTreeOpen(false);
            openDetails();
          }}
          onClose={() => (phone ? setTreeOpen(false) : changeSettings({ showTree: false }))}
          onRenameContainer={(node, name) => act(() => api.updateContainer(node.c.id, { name }))}
          onDeleteContainer={deleteContainer}
          onAddInside={(node) => setDialog({ parent: node })}
          onMakeLabels={(node) => setLabelsFor(node.c.id)}
          onRenamePart={(partId, name) => act(() => api.updatePart(partId, { name }))}
          onRemoveStock={(stockId) => act(() => api.deleteStock(stockId))}
          onDeletePart={(partId) => act(() => api.deletePart(partId))}
        />
      )}

      <SpaceView
        root={root}
        types={types}
        mode={mode}
        search={result}
        searching={searching}
        selectedStockId={selectedStockId}
        selectedContainerId={selectedId}
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
        onSelectItem={(item, holder) => {
          setSelectedId(holder.c.id);
          setSelectedStockId(item.stock.id);
          openDetails();
        }}
        onDrawChild={drawChild}
        onDrawPart={(parent, rect, name, qty) =>
          act(() => api.addStock({ container_id: parent.c.id, name, qty, ...rect }))
        }
        onPlaceChild={(node, rect) => act(() => api.updateContainer(node.c.id, rect))}
        onPlaceItem={(item, rect) => act(() => api.updateStock(item.stock.id, rect))}
        onMoveItemInto={(item, target) =>
          // No slot given, so the server finds it a free cell over there.
          act(() => api.updateStock(item.stock.id, { container_id: target.c.id }))
        }
        onMoveContainerInto={(node, target) =>
          act(() =>
            api.updateContainer(node.c.id, {
              parent_id: target.c.id === WORLD_ID ? null : target.c.id,
            })
          )
        }
        onUp={up}
        onDeselect={() => {
          setSelectedId(null);
          setSelectedStockId(null);
          setDisplacedId(null);
        }}
      />

      {showDetails && (
        <Sidebar
          sheet={phone}
          onHeight={setSheetHeight}
          expanded={sheet === 'full'}
          onToggleHeight={() => setSheet((s) => (s === 'full' ? 'peek' : 'full'))}
          tree={tree}
          onClose={() => {
            if (!phone) {
              changeSettings({ showDetails: false });
              return;
            }
            // Dismissing the sheet drops the selection with it. Leaving it
            // behind would mean tapping the same block again changed nothing,
            // so the sheet would refuse to come back.
            setSheet('hidden');
            setSelectedId(null);
            setSelectedStockId(null);
            setDisplacedId(null);
          }}
          node={panelNode}
          root={root}
          selected={selected}
          search={result}
          searching={searching}
          onReveal={reveal}
          onOpen={open}
          onSelectItem={(item) => setSelectedStockId(item?.stock.id ?? null)}
          onAddChild={(parent) => setDialog({ parent })}
          onEditContainer={(node) => setDialog({ parent: node.parent ?? world, existing: node })}
          onMakeLabels={(node) => setLabelsFor(node.c.id)}
          onDeleteContainer={deleteContainer}
          onAddStock={(containerId, name, qty) =>
            act(() => api.addStock({ container_id: containerId, name, qty }))
          }
          onSetQty={(stockId, qty) => act(() => api.updateStock(stockId, { qty }))}
          onRemoveStock={(stockId) => {
            setSelectedStockId(null);
            void act(() => api.deleteStock(stockId));
          }}
          onSavePart={(partId, patch: Partial<Part>) => act(() => api.updatePart(partId, patch))}
          onMoveStock={(stockId, containerId) => {
            setSelectedStockId(null);
            void act(() => api.updateStock(stockId, { container_id: containerId }));
          }}
          displacedPart={displacedPart}
          onPlaceDisplaced={(partId, containerId, qty) =>
            act(async () => {
              const stock = await api.addStock({ container_id: containerId, part_id: partId, qty });
              // Go and look at where it landed, rather than leaving the panel empty.
              setDisplacedId(null);
              setRootId(containerId);
              setSelectedId(containerId);
              setSelectedStockId(stock.id);
            })
          }
          onDismissDisplaced={() => setDisplacedId(null)}
          onDeletePart={(partId) => act(() => api.deletePart(partId))}
          workspace={state.workspace}
          onSaveWorkspace={(patch) => act(() => api.updateWorkspace(patch))}
        />
      )}

      {/* A row of running totals and keyboard hints is worth a strip of a
          monitor and nothing at all of a phone, where the same pixels are the
          difference between a readable drawer and a smudge. The totals move
          into the ⋯ menu instead. */}
      {!phone && (
        <div className="statusbar">
          <span>{tree.flat.length} spaces</span>
          <span>{state.parts.length} distinct items</span>
          <span>{state.stock.length} holdings</span>
          <span>{fmtQty(world.totalQty)} units total</span>
          <span className="spacer" />
          <span>
            {`${root.c.cols} × ${root.c.rows} U · drag to draw · double-click to go inside` +
              (root.c.id === WORLD_ID ? ' · / to search' : ' · click outside to go back')}
          </span>
        </div>
      )}

      {menuOpen && (
        <MobileMenu
          hereName={root.c.name}
          mode={mode}
          modes={MODES}
          onMode={setMode}
          editing={touchEditing}
          onEditing={setTouchEditing}
          stats={{
            spaces: tree.flat.length,
            parts: state.parts.length,
            holdings: state.stock.length,
            units: fmtQty(world.totalQty),
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
        <ContainerDialog
          parent={dialog.parent}
          existing={dialog.existing}
          types={types}
          onSave={saveContainer}
          onManageTypes={() => setTypesOpen(true)}
          onClose={() => setDialog(null)}
        />
      )}

      {typesOpen && (
        <TypeManager
          types={types}
          usage={typeUsage}
          onCreate={(data: Partial<StorageType>) => act(() => api.createType(data))}
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

      <PartNames parts={state.parts} />

      {tourOpen && <Walkthrough onClose={closeTour} phone={phone} touch={touch} />}

      {error && (
        <div className="toast" onClick={() => setError(null)}>
          {error} <span style={{ opacity: 0.6 }}>(click to dismiss)</span>
        </div>
      )}
    </div>
  );
}
