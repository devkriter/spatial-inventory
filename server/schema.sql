-- Spatial inventory schema.
--
-- The vocabulary, top to bottom:
--
--   location    a space with nothing above it — a workshop, a bedroom, a
--               lock-up across town. Each is a tree in its own right.
--   space       anywhere a thing can be: a closet, a shelf, a drawer. Spaces
--               nest, and a location is just the outermost one.
--   item        a distinct thing you own, independent of where it is. One row
--               per "470 Ω resistor", however many drawers hold some.
--   holding     an item in a space, with a quantity and a slot. The same
--               resistor in two drawers is two holdings of one item.
--
-- Everything is measured in *units* (U) — abstract squares, not millimetres.
-- Every space is a grid of cols × rows units, and every child claims a
-- rectangle of its parent's units. A 12×12 drawer unit holding 2×1 drawers, a
-- filament rack that is 8×2 with each spool 1×2, a closet that is 20×24 with
-- things dotted around inside it: all the same two numbers.
--
--   layout = 'grid'  -> children snap to whole units, unfilled cells are shown
--                       as slots you can click to fill.
--   layout = 'free'  -> children can sit anywhere on a half-unit step and there
--                       is no expectation of filling the space.
--
-- Both use the same coordinate system, so the choice only affects snapping and
-- how the interior is drawn.

-- Bookkeeping for one-way migrations. A migration that can be detected by
-- looking at the data does not need a row here; one that cannot — because the
-- before and after states are shaped alike — records that it has run.
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- The synthetic level above the locations. Not somewhere you can stand and not
-- somewhere anything is stored — locations have no floor plan between them —
-- but it carries a grid so the client has one uniform thing to lay out.
CREATE TABLE IF NOT EXISTS root_space (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  name       TEXT    NOT NULL DEFAULT 'Workshop',
  layout     TEXT    NOT NULL DEFAULT 'grid',
  cols       INTEGER NOT NULL DEFAULT 24,
  rows       INTEGER NOT NULL DEFAULT 16,
  row_origin TEXT    NOT NULL DEFAULT 'top',
  updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- User-defined kinds of space. These double as the "start from" presets when
-- creating one, and supply its default size, layout and colour.
CREATE TABLE IF NOT EXISTS space_types (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL UNIQUE,
  layout     TEXT    NOT NULL DEFAULT 'grid',
  cols       INTEGER NOT NULL DEFAULT 4,
  rows       INTEGER NOT NULL DEFAULT 4,
  color      TEXT,
  notes      TEXT,
  sort       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS spaces (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  -- Null means this is a location: the top of its own tree.
  parent_id  INTEGER REFERENCES spaces(id) ON DELETE CASCADE,
  type_id    INTEGER REFERENCES space_types(id) ON DELETE SET NULL,
  name       TEXT    NOT NULL,

  -- The rectangle this claims inside its parent, in the parent's units.
  x          REAL    NOT NULL DEFAULT 0,
  y          REAL    NOT NULL DEFAULT 0,
  w          REAL    NOT NULL DEFAULT 1,
  h          REAL    NOT NULL DEFAULT 1,

  -- Its own interior, in units.
  layout     TEXT    NOT NULL DEFAULT 'grid',
  cols       INTEGER NOT NULL DEFAULT 4,
  rows       INTEGER NOT NULL DEFAULT 4,

  -- Small-parts cabinets are usually labelled from the bottom up. Affects the
  -- addresses shown (R3·C2), never the drawing.
  row_origin TEXT    NOT NULL DEFAULT 'top',

  color      TEXT,
  notes      TEXT,
  sort       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_spaces_parent ON spaces(parent_id);

-- The catalogue: one row per distinct thing, independent of where it lives.
-- `part_number` is the manufacturer's, which is what that phrase means on a
-- datasheet — it is not this app's word for an item.
CREATE TABLE IF NOT EXISTS items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  description   TEXT,
  part_number   TEXT,
  manufacturer  TEXT,
  category      TEXT,
  tags          TEXT,
  package       TEXT,
  value         TEXT,
  datasheet_url TEXT,
  image_url     TEXT,
  unit          TEXT NOT NULL DEFAULT 'pcs',
  min_qty       REAL,
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_items_name ON items(name);

-- Where an item actually is. An item may be held in several spaces at once
-- (the same 470R resistor lives in two drawers).
CREATE TABLE IF NOT EXISTS holdings (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id      INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  space_id     INTEGER NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  qty          REAL    NOT NULL DEFAULT 0,
  note         TEXT,

  -- Optional slot on the space's plan-view grid, in its units. NULL means
  -- "somewhere in here" — the item is listed but not pinned to a compartment.
  x            REAL,
  y            REAL,
  w            REAL,
  h            REAL,

  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (item_id, space_id)
);

CREATE INDEX IF NOT EXISTS idx_holdings_space ON holdings(space_id);
CREATE INDEX IF NOT EXISTS idx_holdings_item ON holdings(item_id);
