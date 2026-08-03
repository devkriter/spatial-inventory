import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import express from 'express';
import {
  db, all, get, run, tx, driver, dbPath, checkpointAndClose, snapshot,
  ensureLocationInTransaction,
} from './db.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const PORT = Number(process.env.PORT || 5178);

const app = express();
app.use(express.json({ limit: '20mb' }));

/* ------------------------------------------------------------------ utils */

const SPACE_FIELDS = [
  'parent_id', 'type_id', 'name', 'x', 'y', 'w', 'h', 'layout', 'cols', 'rows',
  'row_origin', 'color', 'notes', 'sort',
];

const TYPE_FIELDS = ['name', 'layout', 'cols', 'rows', 'color', 'notes', 'sort'];

const ROOT_SPACE_FIELDS = ['name', 'layout', 'cols', 'rows', 'row_origin'];

// `part_number` is the manufacturer's part number, off the datasheet. It is not
// this app's word for an item and does not get renamed with the rest.
const ITEM_FIELDS = [
  'name', 'description', 'part_number', 'manufacturer', 'category', 'tags',
  'package', 'value', 'datasheet_url', 'image_url', 'unit', 'min_qty', 'notes',
];

const HOLDING_FIELDS = ['item_id', 'space_id', 'qty', 'note', 'x', 'y', 'w', 'h'];

/** Keep only known columns, and normalise `undefined` away. */
function pick(body, fields) {
  const out = {};
  for (const f of fields) {
    if (body[f] !== undefined) out[f] = body[f] === '' ? null : body[f];
  }
  return out;
}

function insert(table, data) {
  const keys = Object.keys(data);
  if (!keys.length) throw new HttpError(400, 'nothing to insert');
  const sql = `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`;
  return run(sql, ...keys.map((k) => data[k])).lastInsertRowid;
}

function update(table, id, data) {
  const keys = Object.keys(data);
  if (!keys.length) return 0;
  const sql = `UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(', ')},
               updated_at = datetime('now') WHERE id = ?`;
  return run(sql, ...keys.map((k) => data[k]), id).changes;
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Wrap an async/sync handler so thrown errors become JSON responses. */
const h = (fn) => (req, res, next) => {
  try {
    const out = fn(req, res);
    if (out !== undefined && !res.headersSent) res.json(out);
  } catch (err) {
    next(err);
  }
};

const id = (req) => Number(req.params.id);

/* ------------------------------------------------------------------ state */

// The whole dataset in one request. A hobby inventory is a few thousand rows at
// most, and having it client-side makes the spatial view and search instant.
app.get('/api/state', h(() => ({
  rootSpace: get('SELECT * FROM root_space WHERE id = 1'),
  types: all('SELECT * FROM space_types ORDER BY sort, name COLLATE NOCASE'),
  spaces: all('SELECT * FROM spaces ORDER BY sort, id'),
  items: all('SELECT * FROM items ORDER BY name COLLATE NOCASE'),
  holdings: all('SELECT * FROM holdings ORDER BY id'),
})));

app.patch('/api/root-space', h((req) => {
  update('root_space', 1, pick(req.body, ROOT_SPACE_FIELDS));
  return get('SELECT * FROM root_space WHERE id = 1');
}));

/* --------------------------------------------------------------- space types */

app.post('/api/space-types', h((req) => {
  const data = pick(req.body, TYPE_FIELDS);
  if (!data.name) throw new HttpError(400, 'name is required');
  if (get('SELECT id FROM space_types WHERE name = ? COLLATE NOCASE', data.name)) {
    throw new HttpError(409, `a space type called "${data.name}" already exists`);
  }
  return get('SELECT * FROM space_types WHERE id = ?', insert('space_types', data));
}));

app.patch('/api/space-types/:id', h((req) => {
  if (!get('SELECT id FROM space_types WHERE id = ?', id(req))) {
    throw new HttpError(404, 'space type not found');
  }
  update('space_types', id(req), pick(req.body, TYPE_FIELDS));
  return get('SELECT * FROM space_types WHERE id = ?', id(req));
}));

// Spaces keep their own size and layout; they just lose the label.
app.delete('/api/space-types/:id', h((req) => {
  const changes = run('DELETE FROM space_types WHERE id = ?', id(req)).changes;
  if (!changes) throw new HttpError(404, 'space type not found');
  return { ok: true };
}));

/* ----------------------------------------------------------------- spaces */

app.post('/api/spaces', h((req) => {
  const data = pick(req.body, SPACE_FIELDS);
  if (!data.name) throw new HttpError(400, 'name is required');
  const newId = insert('spaces', data);
  return get('SELECT * FROM spaces WHERE id = ?', newId);
}));

app.patch('/api/spaces/:id', h((req) => {
  const existing = get('SELECT * FROM spaces WHERE id = ?', id(req));
  if (!existing) throw new HttpError(404, 'space not found');

  const data = pick(req.body, SPACE_FIELDS);
  if (data.parent_id !== undefined && data.parent_id !== null) {
    assertNotDescendant(id(req), Number(data.parent_id));
  }

  // Moved somewhere else without being told where to sit: its old coordinates
  // mean nothing in the new parent, so find it a free cell there.
  const target = data.parent_id === undefined ? undefined : data.parent_id;
  const moving = target !== undefined && Number(target) !== existing.parent_id;
  if (moving && data.x === undefined) {
    const spot = target === null ? null : firstFreeCell(Number(target), existing.w, existing.h);
    Object.assign(data, spot ?? { x: 0, y: 0 });
  }

  update('spaces', id(req), data);
  return get('SELECT * FROM spaces WHERE id = ?', id(req));
}));

app.delete('/api/spaces/:id', h((req) => {
  const changes = run('DELETE FROM spaces WHERE id = ?', id(req)).changes;
  if (!changes) throw new HttpError(404, 'space not found');
  return { ok: true };
}));

/** Reparenting must not make a node its own ancestor. */
function assertNotDescendant(nodeId, newParentId) {
  let cursor = newParentId;
  const seen = new Set();
  while (cursor) {
    if (cursor === nodeId) throw new HttpError(400, 'cannot move a space into itself');
    if (seen.has(cursor)) break;
    seen.add(cursor);
    cursor = get('SELECT parent_id FROM spaces WHERE id = ?', cursor)?.parent_id ?? null;
  }
}

/* ------------------------------------------------------------------ items */

app.post('/api/items', h((req) => {
  const data = pick(req.body, ITEM_FIELDS);
  if (!data.name) throw new HttpError(400, 'name is required');
  const newId = insert('items', data);
  return get('SELECT * FROM items WHERE id = ?', newId);
}));

app.patch('/api/items/:id', h((req) => {
  if (!get('SELECT id FROM items WHERE id = ?', id(req))) throw new HttpError(404, 'item not found');
  update('items', id(req), pick(req.body, ITEM_FIELDS));
  return get('SELECT * FROM items WHERE id = ?', id(req));
}));

app.delete('/api/items/:id', h((req) => {
  const changes = run('DELETE FROM items WHERE id = ?', id(req)).changes;
  if (!changes) throw new HttpError(404, 'item not found');
  return { ok: true };
}));

/* --------------------------------------------------------------- holdings */

/**
 * Every item gets a slot on its space's grid — you always know how much room
 * something takes up, even in a box that is not really organised. This finds the
 * first cell no child space and no other holding already claims.
 *
 * Returns null only when the grid is genuinely full; the item is still stored,
 * it just has nowhere of its own and the UI lists it instead of drawing it.
 */
function firstFreeCell(spaceId, spanW = 1, spanH = 1) {
  const space = get('SELECT cols, rows FROM spaces WHERE id = ?', spaceId);
  if (!space) return null;

  const cols = Math.max(Number(space.cols) || 1, 1);
  const rows = Math.max(Number(space.rows) || 1, 1);
  const taken = new Uint8Array(cols * rows);

  const claim = (x, y, w, h) => {
    const x0 = Math.max(0, Math.floor(x));
    const y0 = Math.max(0, Math.floor(y));
    const x1 = Math.min(cols, Math.ceil(x + (w || 1)));
    const y1 = Math.min(rows, Math.ceil(y + (h || 1)));
    for (let j = y0; j < y1; j++) for (let i = x0; i < x1; i++) taken[j * cols + i] = 1;
  };

  for (const c of all('SELECT x, y, w, h FROM spaces WHERE parent_id = ?', spaceId)) {
    claim(c.x, c.y, c.w, c.h);
  }
  for (const holding of all(
    'SELECT x, y, w, h FROM holdings WHERE space_id = ? AND x IS NOT NULL',
    spaceId
  )) {
    claim(holding.x, holding.y, holding.w, holding.h);
  }

  // Something being re-parented keeps its own size, so look for a gap that fits.
  const w = Math.max(1, Math.ceil(Number(spanW) || 1));
  const h = Math.max(1, Math.ceil(Number(spanH) || 1));
  const fits = (x, y) => {
    if (x + w > cols || y + h > rows) return false;
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (taken[j * cols + i]) return false;
    return true;
  };

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (fits(x, y)) return { x, y, w: spanW, h: spanH };
    }
  }
  return null;
}

// Upsert. Accepts either an existing item_id or a bare `name`, so the UI can
// offer "type a name into this drawer" without a separate catalogue step.
app.post('/api/holdings', h((req) => tx(() => {
  let itemId = req.body.item_id ? Number(req.body.item_id) : null;
  const spaceId = Number(req.body.space_id);
  // Not `!spaceId`: id 0 is the client's synthetic root, so a genuine attempt to
  // put something at the top level used to fail claiming the id was missing.
  // Say what is actually wrong instead.
  if (!Number.isFinite(spaceId) || spaceId <= 0) {
    throw new HttpError(400, 'a real place is required — the top level is not one');
  }
  if (!get('SELECT id FROM spaces WHERE id = ?', spaceId)) {
    throw new HttpError(404, 'that place no longer exists');
  }

  if (!itemId) {
    const name = String(req.body.name || '').trim();
    if (!name) throw new HttpError(400, 'item_id or name is required');
    const existing = get('SELECT id FROM items WHERE name = ? COLLATE NOCASE', name);
    itemId = existing ? existing.id : insert('items', pick({ ...req.body, name }, ITEM_FIELDS));
  }

  const qty = req.body.qty === undefined ? 0 : Number(req.body.qty);
  let slot = pick(req.body, ['x', 'y', 'w', 'h']);

  const prior = get('SELECT * FROM holdings WHERE item_id = ? AND space_id = ?', itemId, spaceId);
  if (prior) {
    // Already held here: add to the count, and move it if a slot was given.
    update('holdings', prior.id, { qty: prior.qty + qty, note: req.body.note ?? prior.note, ...slot });
    return get('SELECT * FROM holdings WHERE id = ?', prior.id);
  }

  // No slot asked for: take the next free cell, so nothing arrives unplaced.
  if (slot.x == null || slot.y == null) slot = firstFreeCell(spaceId) ?? {};

  const newId = insert('holdings', {
    item_id: itemId,
    space_id: spaceId,
    qty,
    note: req.body.note ?? null,
    ...slot,
  });
  return get('SELECT * FROM holdings WHERE id = ?', newId);
})));

app.patch('/api/holdings/:id', h((req) => {
  const prior = get('SELECT * FROM holdings WHERE id = ?', id(req));
  if (!prior) throw new HttpError(404, 'holding not found');

  const data = pick(req.body, HOLDING_FIELDS);
  // Moved to a different space without being told where: the old slot means
  // nothing there, so find it a new one.
  const moving = data.space_id != null && Number(data.space_id) !== prior.space_id;
  if (moving && data.x === undefined) {
    Object.assign(data, firstFreeCell(Number(data.space_id)) ?? { x: null, y: null, w: null, h: null });
  }

  update('holdings', id(req), data);
  return get('SELECT * FROM holdings WHERE id = ?', id(req));
}));

app.delete('/api/holdings/:id', h((req) => {
  const changes = run('DELETE FROM holdings WHERE id = ?', id(req)).changes;
  if (!changes) throw new HttpError(404, 'holding not found');
  return { ok: true };
}));

/* --------------------------------------------------------- backup / restore */

/**
 * A dump carries both vocabularies.
 *
 * The new keys are what this version reads. The old ones — `containers`,
 * `parts`, `stock` — are written alongside them so that a backup taken here can
 * still be restored into a copy of the app that predates the rename. Without
 * that, restoring a new dump into an old build would find no `containers` key,
 * read it as an empty list, and wipe everything while reporting success. The
 * duplication costs a few kilobytes and removes an entire way to lose data.
 *
 * Drop the aliases once no old build is left anywhere.
 */
app.get('/api/export', h(() => {
  const rootSpace = get('SELECT * FROM root_space WHERE id = 1');
  const types = all('SELECT * FROM space_types ORDER BY id');
  const spaces = all('SELECT * FROM spaces ORDER BY id');
  const items = all('SELECT * FROM items ORDER BY id');
  const holdings = all('SELECT * FROM holdings ORDER BY id');

  return {
    exported_at: new Date().toISOString(),
    version: 4,
    rootSpace,
    types,
    spaces,
    items,
    holdings,
    // Which one-way migrations this data has already been through. Without it a
    // restore cannot tell a database that predates locations from one whose
    // locations are simply its top level, and would "migrate" the second by
    // pushing every location down a level.
    meta: all('SELECT key, value FROM meta ORDER BY key'),
    /* read by builds from before the rename */
    workspace: rootSpace,
    containers: spaces,
    parts: items,
    stock: holdings.map(({ item_id, space_id, ...rest }) => ({
      ...rest,
      part_id: item_id,
      container_id: space_id,
    })),
  };
}));

/**
 * The reverse: accept either vocabulary, so a backup taken before the rename
 * restores unchanged. Moving this database between machines is done with these
 * two endpoints, so the old shape has to keep working.
 */
function readDump(body) {
  const d = body || {};
  const holdings = d.holdings ?? d.stock ?? [];
  return {
    rootSpace: d.rootSpace ?? d.workspace ?? null,
    types: d.types,
    spaces: d.spaces ?? d.containers ?? [],
    items: d.items ?? d.parts ?? [],
    holdings: holdings.map((row) => ({
      ...row,
      item_id: row.item_id ?? row.part_id,
      space_id: row.space_id ?? row.container_id,
    })),
    meta: Array.isArray(d.meta) ? d.meta : null,
  };
}

// Replaces everything. Original ids are preserved so parent/child and holding
// references in the dump stay valid.
app.post('/api/import', h((req) => tx(() => {
  const { rootSpace, types, spaces, items, holdings, meta } = readDump(req.body);
  if (rootSpace) update('root_space', 1, pick(rootSpace, ROOT_SPACE_FIELDS));
  // A child may appear before its parent in the dump; check references at commit.
  db.exec('PRAGMA defer_foreign_keys = ON');
  run('DELETE FROM holdings');
  run('DELETE FROM items');
  run('DELETE FROM spaces');
  // A dump without a `types` key predates them — keep the ones already defined
  // rather than leaving the database with no space types at all.
  if (Array.isArray(types)) {
    run('DELETE FROM space_types');
    for (const t of types) insert('space_types', { id: t.id, ...pick(t, TYPE_FIELDS) });
  }
  for (const s of spaces) insert('spaces', { id: s.id, ...pick(s, SPACE_FIELDS) });
  for (const i of items) insert('items', { id: i.id, ...pick(i, ITEM_FIELDS) });
  for (const holding of holdings) {
    insert('holdings', { id: holding.id, ...pick(holding, HOLDING_FIELDS) });
  }
  // Which migrations the *dump* has been through, which is not necessarily what
  // this database has been through — restoring replaces the data, so it replaces
  // that history too.
  //
  // A dump with no `meta` at all predates the idea, and therefore predates
  // locations: its top-level spaces are furniture with nothing to hold them, so
  // it gets the migration a startup would have applied. A dump that carries
  // `meta` says for itself whether that has already happened. Running it anyway
  // would push every location down a level, one level per restore.
  run('DELETE FROM meta');
  if (meta) {
    for (const row of meta) {
      if (row && row.key != null) run('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', String(row.key), String(row.value ?? ''));
    }
  }
  ensureLocationInTransaction();
  return {
    types: Array.isArray(types) ? types.length : 'kept',
    spaces: spaces.length,
    items: items.length,
    holdings: holdings.length,
  };
})));

/* ------------------------------------------------------------------ static */

const dist = path.join(root, 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(dist, 'index.html'));
  });
}

app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.message || 'internal error' });
});

/**
 * Every address this machine can be reached at from the rest of the house.
 * Printing them is the difference between "it works on my phone" and squinting
 * at `ipconfig` output — the phone has to be told where to look.
 */
function lanAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((n) => n && n.family === 'IPv4' && !n.internal)
    .map((n) => n.address);
}

// Ctrl-C, a terminal closing, a supervisor stopping the service: all of them
// get a chance to put the write-ahead log away tidily first.
let closing = false;
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) {
  process.on(signal, () => {
    if (closing) return;
    closing = true;
    checkpointAndClose();
    process.exit(0);
  });
}
process.on('exit', () => {
  if (!closing) checkpointAndClose();
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`inventory api    http://localhost:${PORT}  (sqlite driver: ${driver})`);
  console.log(`database         ${dbPath}`);
  const saved = snapshot();
  if (saved) console.log(`snapshot         ${saved}`);
  for (const address of lanAddresses()) {
    console.log(`on your phone    http://${address}:${PORT}`);
  }
  if (!fs.existsSync(dist)) console.log('no dist/ build yet — run `npm run dev` for the UI');
});
