-- Spatial inventory schema.
--
-- Everything is measured in *units* (U) — abstract squares, not millimetres.
-- Every storage medium is a grid of cols × rows units, and every child claims a
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

-- The top level is a container too. It is not a row in `containers` because it
-- has no parent and there is exactly one of it, but it has the same grid, so
-- closets and benches can be placed against each other the same way drawers are
-- placed inside a cabinet.
-- Bookkeeping for one-way migrations. A migration that can be detected by
-- looking at the data does not need a row here; one that cannot — because the
-- before and after states are shaped alike — records that it has run.
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workspace (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  name       TEXT    NOT NULL DEFAULT 'Workshop',
  layout     TEXT    NOT NULL DEFAULT 'grid',
  cols       INTEGER NOT NULL DEFAULT 24,
  rows       INTEGER NOT NULL DEFAULT 16,
  row_origin TEXT    NOT NULL DEFAULT 'top',
  updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- User-defined storage types. These double as the "start from" presets when
-- creating a container, and supply its default size, layout and colour.
CREATE TABLE IF NOT EXISTS storage_types (
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

CREATE TABLE IF NOT EXISTS containers (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_id  INTEGER REFERENCES containers(id) ON DELETE CASCADE,
  type_id    INTEGER REFERENCES storage_types(id) ON DELETE SET NULL,
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

CREATE INDEX IF NOT EXISTS idx_containers_parent ON containers(parent_id);

-- The catalogue: one row per distinct thing, independent of where it lives.
CREATE TABLE IF NOT EXISTS parts (
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

CREATE INDEX IF NOT EXISTS idx_parts_name ON parts(name);

-- Where a part actually is. A part may sit in several containers at once
-- (the same 470R resistor lives in two drawers).
CREATE TABLE IF NOT EXISTS stock (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  part_id      INTEGER NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
  container_id INTEGER NOT NULL REFERENCES containers(id) ON DELETE CASCADE,
  qty          REAL    NOT NULL DEFAULT 0,
  note         TEXT,

  -- Optional slot on the container's plan-view grid, in its units. NULL means
  -- "somewhere in here" — the part is listed but not pinned to a compartment.
  x            REAL,
  y            REAL,
  w            REAL,
  h            REAL,

  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (part_id, container_id)
);

CREATE INDEX IF NOT EXISTS idx_stock_container ON stock(container_id);
CREATE INDEX IF NOT EXISTS idx_stock_part ON stock(part_id);
