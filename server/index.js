import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { db, all, get, run, tx, driver, dbPath, checkpointAndClose, snapshot } from './db.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const PORT = Number(process.env.PORT || 5178);

const app = express();
app.use(express.json({ limit: '20mb' }));

/* ------------------------------------------------------------------ utils */

const CONTAINER_FIELDS = [
  'parent_id', 'type_id', 'name', 'x', 'y', 'w', 'h', 'layout', 'cols', 'rows',
  'row_origin', 'color', 'notes', 'sort',
];

const TYPE_FIELDS = ['name', 'layout', 'cols', 'rows', 'color', 'notes', 'sort'];

const WORKSPACE_FIELDS = ['name', 'layout', 'cols', 'rows', 'row_origin'];

const PART_FIELDS = [
  'name', 'description', 'part_number', 'manufacturer', 'category', 'tags',
  'package', 'value', 'datasheet_url', 'image_url', 'unit', 'min_qty', 'notes',
];

const STOCK_FIELDS = ['part_id', 'container_id', 'qty', 'note', 'x', 'y', 'w', 'h'];

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
  workspace: get('SELECT * FROM workspace WHERE id = 1'),
  types: all('SELECT * FROM storage_types ORDER BY sort, name COLLATE NOCASE'),
  containers: all('SELECT * FROM containers ORDER BY sort, id'),
  parts: all('SELECT * FROM parts ORDER BY name COLLATE NOCASE'),
  stock: all('SELECT * FROM stock ORDER BY id'),
})));

app.patch('/api/workspace', h((req) => {
  update('workspace', 1, pick(req.body, WORKSPACE_FIELDS));
  return get('SELECT * FROM workspace WHERE id = 1');
}));

/* ----------------------------------------------------------- storage types */

app.post('/api/types', h((req) => {
  const data = pick(req.body, TYPE_FIELDS);
  if (!data.name) throw new HttpError(400, 'name is required');
  if (get('SELECT id FROM storage_types WHERE name = ? COLLATE NOCASE', data.name)) {
    throw new HttpError(409, `a storage type called "${data.name}" already exists`);
  }
  return get('SELECT * FROM storage_types WHERE id = ?', insert('storage_types', data));
}));

app.patch('/api/types/:id', h((req) => {
  if (!get('SELECT id FROM storage_types WHERE id = ?', id(req))) {
    throw new HttpError(404, 'storage type not found');
  }
  update('storage_types', id(req), pick(req.body, TYPE_FIELDS));
  return get('SELECT * FROM storage_types WHERE id = ?', id(req));
}));

// Containers keep their own size and layout; they just lose the label.
app.delete('/api/types/:id', h((req) => {
  const changes = run('DELETE FROM storage_types WHERE id = ?', id(req)).changes;
  if (!changes) throw new HttpError(404, 'storage type not found');
  return { ok: true };
}));

/* ------------------------------------------------------------- containers */

app.post('/api/containers', h((req) => {
  const data = pick(req.body, CONTAINER_FIELDS);
  if (!data.name) throw new HttpError(400, 'name is required');
  const newId = insert('containers', data);
  return get('SELECT * FROM containers WHERE id = ?', newId);
}));

app.patch('/api/containers/:id', h((req) => {
  const existing = get('SELECT * FROM containers WHERE id = ?', id(req));
  if (!existing) throw new HttpError(404, 'container not found');

  const data = pick(req.body, CONTAINER_FIELDS);
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

  update('containers', id(req), data);
  return get('SELECT * FROM containers WHERE id = ?', id(req));
}));

app.delete('/api/containers/:id', h((req) => {
  const changes = run('DELETE FROM containers WHERE id = ?', id(req)).changes;
  if (!changes) throw new HttpError(404, 'container not found');
  return { ok: true };
}));

/** Reparenting must not make a node its own ancestor. */
function assertNotDescendant(nodeId, newParentId) {
  let cursor = newParentId;
  const seen = new Set();
  while (cursor) {
    if (cursor === nodeId) throw new HttpError(400, 'cannot move a container into itself');
    if (seen.has(cursor)) break;
    seen.add(cursor);
    cursor = get('SELECT parent_id FROM containers WHERE id = ?', cursor)?.parent_id ?? null;
  }
}

/* ------------------------------------------------------------------ parts */

app.post('/api/parts', h((req) => {
  const data = pick(req.body, PART_FIELDS);
  if (!data.name) throw new HttpError(400, 'name is required');
  const newId = insert('parts', data);
  return get('SELECT * FROM parts WHERE id = ?', newId);
}));

app.patch('/api/parts/:id', h((req) => {
  if (!get('SELECT id FROM parts WHERE id = ?', id(req))) throw new HttpError(404, 'part not found');
  update('parts', id(req), pick(req.body, PART_FIELDS));
  return get('SELECT * FROM parts WHERE id = ?', id(req));
}));

app.delete('/api/parts/:id', h((req) => {
  const changes = run('DELETE FROM parts WHERE id = ?', id(req)).changes;
  if (!changes) throw new HttpError(404, 'part not found');
  return { ok: true };
}));

/* ------------------------------------------------------------------ stock */

/**
 * Every part gets a slot on its container's grid — you always know how much room
 * something takes up, even in a box that is not really organised. This finds the
 * first cell no child container and no other part already claims.
 *
 * Returns null only when the grid is genuinely full; the part is still stored,
 * it just has nowhere of its own and the UI lists it instead of drawing it.
 */
function firstFreeCell(containerId, spanW = 1, spanH = 1) {
  const container = get('SELECT cols, rows FROM containers WHERE id = ?', containerId);
  if (!container) return null;

  const cols = Math.max(Number(container.cols) || 1, 1);
  const rows = Math.max(Number(container.rows) || 1, 1);
  const taken = new Uint8Array(cols * rows);

  const claim = (x, y, w, h) => {
    const x0 = Math.max(0, Math.floor(x));
    const y0 = Math.max(0, Math.floor(y));
    const x1 = Math.min(cols, Math.ceil(x + (w || 1)));
    const y1 = Math.min(rows, Math.ceil(y + (h || 1)));
    for (let j = y0; j < y1; j++) for (let i = x0; i < x1; i++) taken[j * cols + i] = 1;
  };

  for (const c of all('SELECT x, y, w, h FROM containers WHERE parent_id = ?', containerId)) {
    claim(c.x, c.y, c.w, c.h);
  }
  for (const s of all(
    'SELECT x, y, w, h FROM stock WHERE container_id = ? AND x IS NOT NULL',
    containerId
  )) {
    claim(s.x, s.y, s.w, s.h);
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

// Upsert. Accepts either an existing part_id or a bare `name`, so the UI can
// offer "type a name into this drawer" without a separate catalogue step.
app.post('/api/stock', h((req) => tx(() => {
  let partId = req.body.part_id ? Number(req.body.part_id) : null;
  const containerId = Number(req.body.container_id);
  if (!containerId) throw new HttpError(400, 'container_id is required');

  if (!partId) {
    const name = String(req.body.name || '').trim();
    if (!name) throw new HttpError(400, 'part_id or name is required');
    const existing = get('SELECT id FROM parts WHERE name = ? COLLATE NOCASE', name);
    partId = existing ? existing.id : insert('parts', pick({ ...req.body, name }, PART_FIELDS));
  }

  const qty = req.body.qty === undefined ? 0 : Number(req.body.qty);
  let slot = pick(req.body, ['x', 'y', 'w', 'h']);

  const prior = get('SELECT * FROM stock WHERE part_id = ? AND container_id = ?', partId, containerId);
  if (prior) {
    // Already stocked here: add to the count, and move it if a slot was given.
    update('stock', prior.id, { qty: prior.qty + qty, note: req.body.note ?? prior.note, ...slot });
    return get('SELECT * FROM stock WHERE id = ?', prior.id);
  }

  // No slot asked for: take the next free cell, so nothing arrives unplaced.
  if (slot.x == null || slot.y == null) slot = firstFreeCell(containerId) ?? {};

  const newId = insert('stock', {
    part_id: partId,
    container_id: containerId,
    qty,
    note: req.body.note ?? null,
    ...slot,
  });
  return get('SELECT * FROM stock WHERE id = ?', newId);
})));

app.patch('/api/stock/:id', h((req) => {
  const prior = get('SELECT * FROM stock WHERE id = ?', id(req));
  if (!prior) throw new HttpError(404, 'stock not found');

  const data = pick(req.body, STOCK_FIELDS);
  // Moved to a different container without being told where: the old slot means
  // nothing there, so find it a new one.
  const moving = data.container_id != null && Number(data.container_id) !== prior.container_id;
  if (moving && data.x === undefined) {
    Object.assign(data, firstFreeCell(Number(data.container_id)) ?? { x: null, y: null, w: null, h: null });
  }

  update('stock', id(req), data);
  return get('SELECT * FROM stock WHERE id = ?', id(req));
}));

app.delete('/api/stock/:id', h((req) => {
  const changes = run('DELETE FROM stock WHERE id = ?', id(req)).changes;
  if (!changes) throw new HttpError(404, 'stock not found');
  return { ok: true };
}));

/* --------------------------------------------------------- backup / restore */

app.get('/api/export', h(() => ({
  exported_at: new Date().toISOString(),
  version: 3,
  workspace: get('SELECT * FROM workspace WHERE id = 1'),
  types: all('SELECT * FROM storage_types ORDER BY id'),
  containers: all('SELECT * FROM containers ORDER BY id'),
  parts: all('SELECT * FROM parts ORDER BY id'),
  stock: all('SELECT * FROM stock ORDER BY id'),
})));

// Replaces everything. Original ids are preserved so parent/child and stock
// references in the dump stay valid.
app.post('/api/import', h((req) => tx(() => {
  const { workspace, types, containers = [], parts = [], stock = [] } = req.body || {};
  if (workspace) update('workspace', 1, pick(workspace, WORKSPACE_FIELDS));
  // A child may appear before its parent in the dump; check references at commit.
  db.exec('PRAGMA defer_foreign_keys = ON');
  run('DELETE FROM stock');
  run('DELETE FROM parts');
  run('DELETE FROM containers');
  // A dump without a `types` key predates them — keep the ones already defined
  // rather than leaving the database with no storage types at all.
  if (Array.isArray(types)) {
    run('DELETE FROM storage_types');
    for (const t of types) insert('storage_types', { id: t.id, ...pick(t, TYPE_FIELDS) });
  }
  for (const c of containers) insert('containers', { id: c.id, ...pick(c, CONTAINER_FIELDS) });
  for (const p of parts) insert('parts', { id: p.id, ...pick(p, PART_FIELDS) });
  for (const s of stock) insert('stock', { id: s.id, ...pick(s, STOCK_FIELDS) });
  return {
    types: Array.isArray(types) ? types.length : 'kept',
    containers: containers.length,
    parts: parts.length,
    stock: stock.length,
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
