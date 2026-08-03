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

dropLegacySpaces();
// Before the schema, always. `CREATE TABLE IF NOT EXISTS` would otherwise make
// a second, empty `spaces` alongside the populated `containers`, and every
// query would then read the empty one.
renameToSpaceVocabulary();
db.exec(fs.readFileSync(path.join(here, 'schema.sql'), 'utf8'));
addMissingColumns();
seedSpaceTypes();
seedRootSpace();
ensureLocation();

/* ---------------------------------------------------------------- renaming */

/**
 * The tables were once named after the code's first guesses: `containers` for
 * anywhere a thing goes, `parts` for the things (this started as an electronics
 * inventory), `stock` for the join between them. The app has since settled on
 * space / item / holding — the words the interface already used — so the
 * storage matches the vocabulary.
 *
 * Detectable from the schema itself, so no marker row is needed: if
 * `containers` is still there, this has not run.
 */
// Declarations, not `const` arrows: everything here is reached from the startup
// sequence at the top of the file, which runs before a `const` in this module
// scope is bound. Same reason the tables below are declared inside the function.
function tableExists(name) {
  return !!get("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", name);
}

function rowCount(name) {
  return Number(get(`SELECT COUNT(*) AS n FROM "${name}"`).n);
}

function renameToSpaceVocabulary() {
  const TABLE_RENAMES = [
    ['containers', 'spaces'],
    ['parts', 'items'],
    ['stock', 'holdings'],
    ['storage_types', 'space_types'],
    ['workspace', 'root_space'],
  ];
  // Applied after the table rename, so they are addressed by their new names.
  const COLUMN_RENAMES = [
    ['holdings', 'part_id', 'item_id'],
    ['holdings', 'container_id', 'space_id'],
  ];
  // Named for tables that no longer exist; schema.sql makes the replacements.
  const STALE_INDEXES = [
    'idx_containers_parent',
    'idx_parts_name',
    'idx_stock_container',
    'idx_stock_part',
  ];

  if (!TABLE_RENAMES.some(([from]) => tableExists(from))) return;

  tx(() => {
    for (const [from, to] of TABLE_RENAMES) {
      if (!tableExists(from)) continue;
      // An empty table under the new name means a build ran schema.sql before
      // this migration existed. The real data is still in the old one, so the
      // placeholder goes rather than blocking the rename.
      if (tableExists(to)) {
        if (rowCount(to) > 0) {
          throw new Error(
            `cannot rename ${from} to ${to}: both exist and ${to} already holds rows. ` +
              'Move the database aside and restore from a backup.'
          );
        }
        db.exec(`DROP TABLE "${to}"`);
      }
      // Renaming a table also rewrites the REFERENCES clauses that point at it,
      // so the foreign keys survive without being rebuilt by hand.
      db.exec(`ALTER TABLE "${from}" RENAME TO "${to}"`);
    }

    for (const [table, from, to] of COLUMN_RENAMES) {
      if (!tableExists(table)) continue;
      const columns = new Set(all(`PRAGMA table_info("${table}")`).map((c) => c.name));
      if (!columns.has(from) || columns.has(to)) continue;
      db.exec(`ALTER TABLE "${table}" RENAME COLUMN "${from}" TO "${to}"`);
    }

    for (const index of STALE_INDEXES) db.exec(`DROP INDEX IF EXISTS "${index}"`);
  });

  console.log('renamed containers/parts/stock to spaces/items/holdings');
}

/* -------------------------------------------------------------- locations */

/**
 * The top level used to be a single implicit workshop: the root row supplied a
 * grid, and everything with no parent sat directly on it. Locations make that
 * explicit — the things with no parent are now *locations*, and the spaces that
 * used to be top-level live inside one.
 *
 * A database from before that has spaces at the top and no location to hold
 * them, so one is made and they move into it. The location inherits the root
 * grid as its own interior, which is the grid those spaces were already
 * positioned in, so every rectangle keeps the coordinates it had.
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
  // Before and after look alike — spaces with no parent either way — so this
  // cannot be detected from the shape of the data. A marker row it is.
  if (get("SELECT value FROM meta WHERE key = 'locations'")) return false;
  // An empty database needs one too, not just one with spaces to move. There
  // must always be somewhere real to stand: with no location the top level is
  // the synthetic root, which is not a row, so nothing can be put in it.
  return true;
}

function migrateToLocations() {
  const rootSpace = get('SELECT * FROM root_space WHERE id = 1') || {};
  const name = rootSpace.name || 'Workshop';
  const made = run(
    `INSERT INTO spaces (parent_id, type_id, name, x, y, w, h, layout, cols, rows, row_origin, sort)
     VALUES (NULL, NULL, ?, 0, 0, 6, 5, ?, ?, ?, ?, 0)`,
    name,
    rootSpace.layout || 'grid',
    rootSpace.cols || 24,
    rootSpace.rows || 16,
    rootSpace.row_origin || 'top'
  );
  const moved = run(
    'UPDATE spaces SET parent_id = ? WHERE parent_id IS NULL AND id <> ?',
    made.lastInsertRowid,
    made.lastInsertRowid
  );
  run("INSERT OR REPLACE INTO meta (key, value) VALUES ('locations', '1')");
  console.log(
    moved.changes
      ? `locations: created "${name}" and moved ${moved.changes} space(s) into it`
      : `locations: created "${name}"`
  );
}

/**
 * `CREATE TABLE IF NOT EXISTS` does nothing to a table that already exists, so
 * columns added to schema.sql after a database was created have to be applied
 * by hand. Adding a nullable column is cheap and lossless.
 */
function addMissingColumns() {
  const wanted = {
    holdings: { x: 'REAL', y: 'REAL', w: 'REAL', h: 'REAL' },
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
 * Spaces used to be measured in millimetres with per-cell dimensions. The
 * unit-based schema has no faithful conversion for free-layout placements, so
 * an empty legacy table is simply replaced and a populated one is left alone
 * with instructions — better than silently mangling real data.
 *
 * Runs before the vocabulary rename, so the table is still called `containers`
 * unless a later build already renamed it.
 */
function dropLegacySpaces() {
  const name = tableExists('containers') ? 'containers' : 'spaces';
  const table = get(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?",
    name
  );
  if (!table || !/\bcell_w\b/.test(table.sql)) return;

  const { n } = get(`SELECT COUNT(*) AS n FROM "${name}"`);
  if (Number(n) > 0) {
    throw new Error(
      `${dbPath} uses the old millimetre schema and still holds ${n} spaces.\n` +
        'Export a backup from the previous version, move the file aside, and import it into a fresh database.'
    );
  }
  db.exec(`DROP TABLE "${name}"`);
  console.log('replaced the empty millimetre-era spaces table');
}

/**
 * Create the single root row. Top-level spaces used to be tiled automatically,
 * so their stored placement was meaningless — on the very first run with a real
 * workshop grid, spread them out so nothing starts stacked.
 */
function seedRootSpace() {
  if (get('SELECT id FROM root_space WHERE id = 1')) return;

  const cols = 24;
  run('INSERT INTO root_space (id, cols, rows) VALUES (1, ?, 16)', cols);

  const roots = all('SELECT id FROM spaces WHERE parent_id IS NULL ORDER BY sort, id');
  const w = 6;
  const h = 8;
  const perRow = Math.max(1, Math.floor(cols / w));
  roots.forEach((topLevel, i) => {
    run(
      'UPDATE spaces SET x = ?, y = ?, w = ?, h = ? WHERE id = ?',
      (i % perRow) * w,
      Math.floor(i / perRow) * h,
      w,
      h,
      topLevel.id
    );
  });
  if (roots.length) console.log(`placed ${roots.length} top-level space(s) on the new workshop grid`);
}

/** A deliberately short starter list — types are meant to be yours. */
function seedSpaceTypes() {
  const { n } = get('SELECT COUNT(*) AS n FROM space_types');
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
    'INSERT INTO space_types (name, layout, cols, rows, color, sort) VALUES (?, ?, ?, ?, ?, ?)'
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
