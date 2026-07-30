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

  const starters = [
    ['Closet',      'free', 16, 20, '#8a6a45'],
    ['Shelf',       'free', 16, 3,  '#8f7550'],
    ['Drawer unit', 'grid', 12, 12, '#a07a4a'],
    ['Drawer',      'free', 2,  2,  '#bb9159'],
    ['Rack',        'grid', 8,  2,  '#7d6448'],
    ['Box',         'free', 4,  4,  '#96703f'],
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
