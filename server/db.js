import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

const dataDir = process.env.INVENTORY_DATA_DIR || path.join(root, 'data');
fs.mkdirSync(dataDir, { recursive: true });
export const dbPath = path.join(dataDir, 'inventory.db');

// Two drivers can back this app and their prepared-statement APIs agree, so we
// take whichever is available. node:sqlite ships with Node >= 22.5 and needs no
// build step; better-sqlite3 covers older runtimes. Only positional `?`
// parameters are used below, because named-parameter syntax differs.
function openDatabase() {
  try {
    const { DatabaseSync } = require('node:sqlite');
    return { db: new DatabaseSync(dbPath), driver: 'node:sqlite' };
  } catch {
    /* fall through */
  }
  try {
    const Database = require('better-sqlite3');
    return { db: new Database(dbPath), driver: 'better-sqlite3' };
  } catch (err) {
    throw new Error(
      'No SQLite driver available. Use Node 22.5+ (built-in node:sqlite) ' +
        'or run `npm install better-sqlite3`.\nOriginal error: ' + err.message
    );
  }
}

const { db, driver } = openDatabase();
export { db, driver };

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

/*
 * Durability. `synchronous = FULL` is already the default, and is set here
 * anyway so that nobody "optimises" it to NORMAL later without reading this.
 *
 * The checkpoint threshold is the part that needed changing. SQLite folds the
 * write-ahead log back into the database every 1000 pages, and this database is
 * about twenty pages — so in practice it never reached the threshold, and a
 * whole day of edits accumulated in a 4 MB log while inventory.db sat
 * unchanged. A short log is a smaller thing to have to recover, so: every 64
 * pages, which for this workload is every few edits.
 */
db.exec('PRAGMA synchronous = FULL');
db.exec('PRAGMA wal_autocheckpoint = 64');

export const all = (sql, ...params) => db.prepare(sql).all(...params);
export const get = (sql, ...params) => db.prepare(sql).get(...params);

dropLegacyContainers();
db.exec(fs.readFileSync(path.join(here, 'schema.sql'), 'utf8'));
addMissingColumns();
seedStorageTypes();
seedWorkspace();
ensureLocation();

/**
 * The top level used to be a single implicit workshop: the `workspace` row
 * supplied a grid, and everything with no parent sat directly on it. Locations
 * make that explicit — the things with no parent are now *locations*, and the
 * spaces that used to be top-level live inside one.
 *
 * A database from before that has spaces at the top and no location to hold
 * them, so one is made and they move into it. The location inherits the
 * workspace grid as its own interior, which is the grid those spaces were
 * already positioned in, so every rectangle keeps the coordinates it had.
 *
 * Idempotent, and deliberately called from two places: at startup, and again
 * after an import. Restoring a backup taken before locations would otherwise
 * load pre-locations data into a locations-aware app and leave it with none —
 * and restoring a backup is the normal way to move this database about.
 */
export function ensureLocation() {
  if (!needsLocation()) return;
  tx(migrateToLocations);
}

/**
 * The same migration for a caller that is already inside a transaction —
 * importing a dump, which must not half-apply. SQLite has no nested BEGIN, so
 * the transaction has to belong to exactly one of them.
 */
export function ensureLocationInTransaction() {
  if (!needsLocation()) return;
  migrateToLocations();
}

function needsLocation() {
  const { n } = get('SELECT COUNT(*) AS n FROM containers WHERE parent_id IS NULL');
  if (Number(n) === 0) return false; // nothing to move
  // Before and after look alike — spaces with no parent either way — so this
  // cannot be detected from the shape of the data. A marker row it is.
  return !get("SELECT value FROM meta WHERE key = 'locations'");
}

function migrateToLocations() {
  const ws = get('SELECT * FROM workspace WHERE id = 1') || {};
  const name = ws.name || 'Workshop';
  const made = run(
    `INSERT INTO containers (parent_id, type_id, name, x, y, w, h, layout, cols, rows, row_origin, sort)
     VALUES (NULL, NULL, ?, 0, 0, 6, 5, ?, ?, ?, ?, 0)`,
    name,
    ws.layout || 'grid',
    ws.cols || 24,
    ws.rows || 16,
    ws.row_origin || 'top'
  );
  const moved = run(
    'UPDATE containers SET parent_id = ? WHERE parent_id IS NULL AND id <> ?',
    made.lastInsertRowid,
    made.lastInsertRowid
  );
  run("INSERT OR REPLACE INTO meta (key, value) VALUES ('locations', '1')");
  console.log(`locations: created "${name}" and moved ${moved.changes} space(s) into it`);
}

/**
 * `CREATE TABLE IF NOT EXISTS` does nothing to a table that already exists, so
 * columns added to schema.sql after a database was created have to be applied
 * by hand. Adding a nullable column is cheap and lossless.
 */
function addMissingColumns() {
  const wanted = {
    stock: { x: 'REAL', y: 'REAL', w: 'REAL', h: 'REAL' },
  };
  for (const [table, columns] of Object.entries(wanted)) {
    let existing;
    try {
      existing = new Set(all(`PRAGMA table_info(${table})`).map((c) => c.name));
    } catch {
      continue; // no way to introspect: leave well alone
    }
    for (const [name, type] of Object.entries(columns)) {
      if (existing.has(name)) continue;
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
      console.log(`added ${table}.${name}`);
    }
  }
}

/**
 * Containers used to be measured in millimetres with per-cell dimensions. The
 * unit-based schema has no faithful conversion for free-layout placements, so
 * an empty legacy table is simply replaced and a populated one is left alone
 * with instructions — better than silently mangling real data.
 */
function dropLegacyContainers() {
  const table = get(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'containers'"
  );
  if (!table || !/\bcell_w\b/.test(table.sql)) return;

  const { n } = get('SELECT COUNT(*) AS n FROM containers');
  if (Number(n) > 0) {
    throw new Error(
      `${dbPath} uses the old millimetre schema and still holds ${n} containers.\n` +
        'Export a backup from the previous version, move the file aside, and import it into a fresh database.'
    );
  }
  db.exec('DROP TABLE containers');
  console.log('replaced the empty millimetre-era containers table');
}

/**
 * Create the single workspace row. Top-level containers used to be tiled
 * automatically, so their stored placement was meaningless — on the very first
 * run with a real workshop grid, spread them out so nothing starts stacked.
 */
function seedWorkspace() {
  if (get('SELECT id FROM workspace WHERE id = 1')) return;

  const cols = 24;
  run('INSERT INTO workspace (id, cols, rows) VALUES (1, ?, 16)', cols);

  const roots = all('SELECT id FROM containers WHERE parent_id IS NULL ORDER BY sort, id');
  const w = 6;
  const h = 8;
  const perRow = Math.max(1, Math.floor(cols / w));
  roots.forEach((root, i) => {
    run(
      'UPDATE containers SET x = ?, y = ?, w = ?, h = ? WHERE id = ?',
      (i % perRow) * w,
      Math.floor(i / perRow) * h,
      w,
      h,
      root.id
    );
  });
  if (roots.length) console.log(`placed ${roots.length} top-level container(s) on the new workshop grid`);
}

/** A deliberately short starter list — types are meant to be yours. */
function seedStorageTypes() {
  const { n } = get('SELECT COUNT(*) AS n FROM storage_types');
  if (Number(n) > 0) return;

  // Spread across the palette rather than six browns a shade apart, which is
  // what a fresh database used to start as — and still would on any new
  // install, since these colours are only written when there are none.
  const starters = [
    ['Closet',      'free', 16, 20, '#757c85'],
    ['Shelf',       'free', 16, 3,  '#5f8bb2'],
    ['Drawer unit', 'grid', 12, 12, '#4a6b8a'],
    ['Drawer',      'free', 2,  2,  '#86aacb'],
    ['Rack',        'grid', 8,  2,  '#6f7c52'],
    ['Box',         'free', 4,  4,  '#a07a4a'],
  ];
  const stmt = db.prepare(
    'INSERT INTO storage_types (name, layout, cols, rows, color, sort) VALUES (?, ?, ?, ?, ?, ?)'
  );
  starters.forEach((row, i) => stmt.run(...row, i));
}

/**
 * A consistent copy of the whole database, taken on every start.
 *
 * This is the protection that actually matters. Whatever went wrong — a
 * half-applied log, an interrupted checkpoint, a mistaken bulk delete — the
 * answer is the same: there is a recent snapshot to go back to. `VACUUM INTO`
 * is SQLite's own supported way to do it, and unlike copying the file it
 * accounts for the log and cannot catch the database mid-write.
 *
 * The whole thing is under 100 kB, so keeping a fortnight of them is free.
 */
const KEEP_SNAPSHOTS = 14;

export function snapshot() {
  const dir = path.join(dataDir, 'snapshots');
  try {
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const file = path.join(dir, `inventory-${stamp}.db`);
    if (!fs.existsSync(file)) db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);

    const old = fs
      .readdirSync(dir)
      .filter((f) => f.startsWith('inventory-') && f.endsWith('.db'))
      .sort();
    for (const f of old.slice(0, Math.max(0, old.length - KEEP_SNAPSHOTS))) {
      fs.unlinkSync(path.join(dir, f));
    }
    return file;
  } catch (err) {
    // Never let a failed backup stop the app starting — say so and carry on.
    console.warn(`could not write a snapshot: ${err.message}`);
    return null;
  }
}

/**
 * Fold the log back into the database and let go of the file. Called on the way
 * out so a restart never has a log to recover — SIGKILL cannot be caught, but
 * everything short of it can, and this app gets stopped and started a lot.
 */
export function checkpointAndClose() {
  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  } catch {
    /* a reader still open, or already gone: the log stays and is recovered */
  }
  try {
    db.close?.();
  } catch {
    /* already closed */
  }
}

export function run(sql, ...params) {
  const res = db.prepare(sql).run(...params);
  return {
    changes: Number(res.changes),
    lastInsertRowid: Number(res.lastInsertRowid),
  };
}

// db.transaction() is a better-sqlite3 extension, so drive it with statements
// that both drivers understand.
export function tx(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* already rolled back */
    }
    throw err;
  }
}
