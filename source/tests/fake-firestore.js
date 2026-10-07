// Test double for 'firebase/firestore' (used by `FAKE=1 node build.mjs`). It talks to tests/fake-server.mjs.
// It mimics the parts of the real SDK's contract the adapter relies on, as far as I know them from the docs:
//  - a write promise resolves only once the server confirmed it, and never while the server is unreachable
//  - local writes show up in listeners at once (latency compensation) and are rolled back when the server refuses them
//  - a persistent cache keeps documents AND unsent writes across reloads; a memory cache does not
//  - listeners deliver cached data first, then server data; metadata-only changes do not fire a snapshot
//  - errors are FirestoreError objects whose `code` is e.g. 'permission-denied' (no 'firestore/' prefix)
//  - undefined field values are refused unless `ignoreUndefinedProperties` is set
//  - waitForPendingWrites() resolves once the writes pending at the call are settled (also those from an earlier visit)
const BASE = window.__FAKE_BASE || location.origin + '/__fake';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const clone = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const offlineMs = () => (typeof window.__FAKE_OFFLINE_MS === 'number' ? window.__FAKE_OFFLINE_MS : 1500);
const retryMs = () => (typeof window.__FAKE_RETRY_MS === 'number' ? window.__FAKE_RETRY_MS : 300);

class FirestoreError extends Error {
  constructor(code, message) { super(message || code); this.name = 'FirebaseError'; this.code = code; }
}
export { FirestoreError };

/* ---------- settings objects ---------- */
export const persistentLocalCache = o => ({ kind: 'persistent', o });
export const persistentMultipleTabManager = () => ({ kind: 'multi' });
export const memoryLocalCache = () => ({ kind: 'memory' });

export function initializeFirestore(app, settings = {}) {
  const persistent = !!(settings.localCache && settings.localCache.kind === 'persistent');
  if (persistent && window.__FAKE_PERSIST_THROWS) throw new FirestoreError('failed-precondition', 'persistence not available');
  window.__FAKE_INSTANCES = (window.__FAKE_INSTANCES || 0) + 1;
  return new Fake(app, persistent, !!settings.ignoreUndefinedProperties, settings);
}

/* ---------- refs ---------- */
const refCol = (fs, path) => ({ type: 'collection', firestore: fs, path, id: path.split('/').pop() });
const refDoc = (fs, path) => ({ type: 'document', firestore: fs, path, id: path.split('/').pop() });
function segments(segs) {
  const parts = segs.flatMap(s => String(s).split('/')).filter(s => s !== '');
  if (parts.some(p => p === '.' || p === '..' || /^__.*__$/.test(p))) throw new FirestoreError('invalid-argument', 'Invalid path segment');
  return parts;
}
export function doc(fs, ...segs) {
  const parts = segments(segs);
  if (parts.length % 2 !== 0 || !parts.length) throw new FirestoreError('invalid-argument', 'Invalid document reference. Document references must have an even number of segments, but ' + parts.join('/') + ' has ' + parts.length + '.');
  return refDoc(fs, parts.join('/'));
}
export function collection(fs, ...segs) {
  const parts = segments(segs);
  if (parts.length % 2 !== 1) throw new FirestoreError('invalid-argument', 'Invalid collection reference. Collection references must have an odd number of segments, but ' + parts.join('/') + ' has ' + parts.length + '.');
  return refCol(fs, parts.join('/'));
}
export const where = (field, op, value) => ({ __where: true, field, op, value });
export function query(col, ...constraints) {
  return { type: 'query', firestore: col.firestore, path: col.path, filters: constraints.filter(c => c && c.__where) };
}

/* ---------- filters / snapshots ---------- */
const OPS = { '==': (a, b) => a === b, '!=': (a, b) => a !== b, '<': (a, b) => a < b, '<=': (a, b) => a <= b, '>': (a, b) => a > b, '>=': (a, b) => a >= b };
const matches = (data, filters) => filters.every(f => (OPS[f.op] || OPS['=='])(data[f.field], f.value));
const parentOf = p => p.slice(0, p.lastIndexOf('/'));
const docSnap = (id, data, meta) => ({ id, exists: () => data !== undefined, data: () => clone(data), metadata: meta });
const querySnap = (items, meta) => {
  const docs = items.map(([id, data]) => docSnap(id, data, meta));
  return { docs, size: docs.length, empty: docs.length === 0, metadata: meta, forEach: f => docs.forEach(f) };
};
function assertNoUndefined(v, ignore, path) {
  if (v === undefined) { if (ignore) return; throw new FirestoreError('invalid-argument', 'Function setDoc() called with invalid data. Unsupported field value: undefined (found in field ' + path + ')'); }
  if (v && typeof v === 'object') {
    if (Array.isArray(v)) v.forEach((x, i) => { if (Array.isArray(x)) throw new FirestoreError('invalid-argument', 'Nested arrays are not supported'); assertNoUndefined(x, ignore, path + '[' + i + ']'); });
    else for (const k of Object.keys(v)) assertNoUndefined(v[k], ignore, path ? path + '.' + k : k);
  }
}

/* ---------- the Firestore instance ---------- */
class Fake {
  constructor(app, persistent, ignoreUndefined, settings) {
    this.app = app; this.project = app.options.projectId; this.persistent = persistent; this.ignoreUndefined = ignoreUndefined;
    this.settings = settings;
    this.cacheKey = 'fake.cache.' + this.project;
    this.docs = new Map();      // what the server told us (the local cache)
    this.pending = [];          // writes the server has not confirmed yet, oldest first
    this.listeners = new Set();
    this.waiters = [];          // waitForPendingWrites(): resolve once the writes that were pending at the call are settled
    this.terminated = false; this.flushing = false; this.seq = 0;
    if (persistent) this.load();
  }
  load() {
    try {
      const raw = JSON.parse(localStorage.getItem(this.cacheKey) || 'null');
      if (!raw) return;
      for (const [p, d] of raw.docs || []) this.docs.set(p, d);
      for (const w of raw.pending || []) this.pending.push({ id: ++this.seq, ops: w.ops });
    } catch (e) { /* empty cache */ }
    if (this.pending.length) setTimeout(() => this.flush(), 0);
  }
  save() {
    if (!this.persistent) return;
    try { localStorage.setItem(this.cacheKey, JSON.stringify({ docs: Array.from(this.docs), pending: this.pending.map(w => ({ ops: w.ops })) })); } catch (e) { /* ignore */ }
  }

  /* what a reader sees: server state plus our unsent writes */
  current(path) {
    let data = this.docs.has(path) ? this.docs.get(path) : undefined, touched = false;
    for (const w of this.pending) for (const o of w.ops) {
      if (o.path !== path) continue;
      touched = true;
      if (o.op === 'set') data = clone(o.data);
      else if (o.op === 'update') { if (data !== undefined) data = Object.assign({}, data, clone(o.data)); }
      else data = undefined;
    }
    return { data, pending: touched };
  }
  snapshotFor(target, fromCache) {
    if (target.type === 'document') {
      const c = this.current(target.path);
      return { key: JSON.stringify(c.data === undefined ? null : c.data), make: meta => docSnap(target.id, c.data, meta), pending: c.pending, exists: c.data !== undefined };
    }
    const paths = new Set();
    for (const p of this.docs.keys()) if (parentOf(p) === target.path) paths.add(p);
    for (const w of this.pending) for (const o of w.ops) if (parentOf(o.path) === target.path) paths.add(o.path);
    const items = [];
    let pending = false;
    for (const p of Array.from(paths).sort()) {
      const c = this.current(p);
      if (c.pending) pending = true;
      if (c.data !== undefined && matches(c.data, target.filters || [])) items.push([p.split('/').pop(), c.data]);
    }
    return { key: JSON.stringify(items), make: meta => querySnap(items, meta), pending, exists: items.length > 0 };
  }

  /* listeners */
  listen(target, next, error) {
    const l = { target, next, error, es: null, closed: false, delivered: false, lastKey: null, fromServer: false, reported: new Set(), timer: 0 };
    this.listeners.add(l);
    if (this.hasCached(target)) this.emit(l, true);
    this.connect(l);
    return () => { l.closed = true; clearTimeout(l.timer); if (l.es) l.es.close(); this.listeners.delete(l); };
  }
  hasCached(target) {
    if (target.type === 'document') return this.docs.has(target.path) || this.current(target.path).pending;
    return this.snapshotFor(target).exists;
  }
  emit(l, force) {
    if (l.closed) return;
    const s = this.snapshotFor(l.target);
    if (!force && l.delivered && s.key === l.lastKey) return;
    l.delivered = true; l.lastKey = s.key;
    const meta = { fromCache: !l.fromServer, hasPendingWrites: s.pending };
    try { l.next(s.make(meta)); } catch (e) { setTimeout(() => { throw e; }); }
  }
  fireAll() { for (const l of Array.from(this.listeners)) this.emit(l, false); }
  connect(l) {
    if (this.terminated || l.closed) return;
    const t = l.target;
    const qs = new URLSearchParams({ project: this.project, path: t.path, kind: t.type === 'document' ? 'doc' : 'col', filters: JSON.stringify(t.filters || []) });
    const es = new EventSource(BASE + '/listen?' + qs);
    l.es = es;
    es.addEventListener('snap', ev => {
      if (l.closed) return;
      clearTimeout(l.timer);
      const m = JSON.parse(ev.data);
      if (t.type === 'document') {
        if (m.exists) this.docs.set(t.path, m.data); else this.docs.delete(t.path);
      } else {
        const now = new Set();
        for (const d of m.docs) { const p = t.path + '/' + d.id; now.add(p); this.docs.set(p, d.data); }
        for (const p of l.reported) if (!now.has(p)) this.docs.delete(p);
        l.reported = now;
      }
      l.fromServer = true;
      this.save();
      this.emit(l, !l.delivered);
      this.fireAll();
    });
    es.addEventListener('fail', ev => {
      es.close(); l.es = null;
      const m = JSON.parse(ev.data);
      this.listeners.delete(l); l.closed = true;
      if (l.error) l.error(new FirestoreError(m.code, m.message));
    });
    es.onerror = () => {
      if (l.closed) return;
      l.fromServer = false;
      if (!l.delivered && !l.timer) l.timer = setTimeout(() => { l.timer = 0; this.emit(l, true); }, offlineMs());   // "client is offline": deliver what the cache has
    };
  }

  /* writes */
  write(ops) {
    if (this.terminated) return Promise.reject(new FirestoreError('failed-precondition', 'The client has already been terminated.'));
    for (const o of ops) if (o.data !== undefined) assertNoUndefined(o.data, this.ignoreUndefined, o.path);
    return new Promise((resolve, reject) => {
      this.pending.push({ id: ++this.seq, ops: ops.map(o => ({ op: o.op, path: o.path, data: clone(o.data) })), resolve, reject });
      this.save();
      this.fireAll();
      this.flush();
    });
  }
  async flush() {
    if (this.flushing) return;
    this.flushing = true;
    try {
      while (this.pending.length && !this.terminated) {
        const w = this.pending[0];
        let res;
        try {
          const r = await fetch(BASE + '/write', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ project: this.project, ops: w.ops }) });
          res = await r.json();
        } catch (e) { await sleep(retryMs()); continue; }      // unreachable: keep the write, try again later
        this.pending.shift();
        if (res.error) {
          this.save();
          if (w.reject) w.reject(new FirestoreError(res.error.code, res.error.message));
          this.settled(w.id);
          this.fireAll();                                      // rolled back
          continue;
        }
        for (const o of w.ops) {
          if (o.op === 'set') this.docs.set(o.path, clone(o.data));
          else if (o.op === 'update') this.docs.set(o.path, Object.assign({}, this.docs.get(o.path) || {}, clone(o.data)));
          else this.docs.delete(o.path);
        }
        this.save();
        if (w.resolve) w.resolve();
        this.settled(w.id);
        this.fireAll();
      }
    } finally { this.flushing = false; }
  }
  settled(id) {
    for (const wt of this.waiters) wt.ids.delete(id);
    this.waiters = this.waiters.filter(wt => { if (wt.ids.size) return true; wt.resolve(); return false; });
  }

  async fetchJson(path, params) {
    (window.__FAKE_LOG = window.__FAKE_LOG || []).push('fetch ' + path + ' ' + BASE);
    try {
      const r = await fetch(BASE + path + '?' + new URLSearchParams(Object.assign({ project: this.project }, params)));
      return await r.json();
    } catch (e) { await sleep(offlineMs()); throw new FirestoreError('unavailable', 'Failed to get documents from server (client is offline).'); }
  }
  async terminate() {
    this.terminated = true;
    for (const wt of this.waiters) wt.reject(new FirestoreError('cancelled', 'The client has been terminated.'));
    this.waiters = [];
    for (const l of this.listeners) { l.closed = true; clearTimeout(l.timer); if (l.es) l.es.close(); }
    this.listeners.clear();
  }
}

/* ---------- API ---------- */
export function onSnapshot(target, next, error) {
  if (typeof next !== 'function') throw new FirestoreError('invalid-argument', 'the fake only supports onSnapshot(target, next, error)');
  return target.firestore.listen(target, next, error);
}
export const setDoc = (ref, data) => ref.firestore.write([{ op: 'set', path: ref.path, data }]);
export const updateDoc = (ref, data) => ref.firestore.write([{ op: 'update', path: ref.path, data }]);
export const deleteDoc = ref => ref.firestore.write([{ op: 'delete', path: ref.path }]);
export function writeBatch(fs) {
  const ops = [];
  const api = {
    set(ref, data) { ops.push({ op: 'set', path: ref.path, data }); return api; },
    update(ref, data) { ops.push({ op: 'update', path: ref.path, data }); return api; },
    delete(ref) { ops.push({ op: 'delete', path: ref.path }); return api; },
    commit: () => fs.write(ops)
  };
  return api;
}
export async function getDocFromServer(ref) {
  const res = await ref.firestore.fetchJson('/get', { path: ref.path, kind: 'doc' });
  if (res.error) throw new FirestoreError(res.error.code, res.error.message);
  if (res.exists) ref.firestore.docs.set(ref.path, res.data); else ref.firestore.docs.delete(ref.path);
  ref.firestore.save();
  return docSnap(ref.id, res.exists ? res.data : undefined, { fromCache: false, hasPendingWrites: false });
}
export async function getDoc(ref) {
  try { return await getDocFromServer(ref); } catch (e) {
    if (e.code !== 'unavailable') throw e;
    const c = ref.firestore.current(ref.path);
    if (c.data !== undefined) return docSnap(ref.id, c.data, { fromCache: true, hasPendingWrites: c.pending });
    throw new FirestoreError('unavailable', 'Failed to get document because the client is offline.');
  }
}
export async function getDocs(q) {
  const t = q.type === 'collection' ? Object.assign({}, q, { filters: [] }) : q;
  const res = await t.firestore.fetchJson('/get', { path: t.path, kind: 'col', filters: JSON.stringify(t.filters || []) });
  if (res.error) throw new FirestoreError(res.error.code, res.error.message);
  return querySnap(res.docs.map(d => [d.id, d.data]), { fromCache: false, hasPendingWrites: false });
}
export const terminate = fs => fs.terminate();
export function waitForPendingWrites(fs) {
  const ids = new Set(fs.pending.map(w => w.id));
  if (!ids.size) return Promise.resolve();
  return new Promise((resolve, reject) => { fs.waiters.push({ ids, resolve, reject }); });
}
