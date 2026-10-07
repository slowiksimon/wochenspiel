// Firestore adapter: gives the app the small `db` / `user` API it was written against (the same one the Claude
// artifact runtime offers), but backed by the household's own Firebase project. Everything of the household lives
// under rooms/{code}/…; per-device preferences (data/users/…) never leave the phone.
import { initializeApp, deleteApp } from 'firebase/app';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager, memoryLocalCache,
  doc as fsDoc, collection as fsCollection, query as fsQuery, where as fsWhere,
  onSnapshot as fsOnSnapshot, setDoc, updateDoc, deleteDoc, getDoc, getDocs, getDocFromServer, writeBatch, terminate, waitForPendingWrites
} from 'firebase/firestore';

const ACK_WAIT = 1200;            // how long a write may keep its caller waiting before we let the app move on (offline)
const STUCK_AFTER = 20000;        // writes that the server has not confirmed for this long are reported as "not sent"
const CLOSE_WAIT = 3000;          // closing a connection must never keep the screen waiting
const CFG_KEYS = ['apiKey', 'authDomain', 'projectId', 'storageBucket', 'messagingSenderId', 'appId', 'measurementId'];

/* ---------- errors ---------- */
export function normError(e) {
  if (e && e.__ws) return e;
  const raw = e && e.code != null ? String(e.code) : '';
  const code = raw.replace(/^firestore\//, '').replace(/-/g, '_') || (e && e.name === 'TimeoutError' ? 'timeout' : 'unknown');
  const err = new Error(e && e.message ? e.message : code);
  err.code = code; err.__ws = true; err.cause = e;
  return err;
}
const timeoutError = () => Object.assign(new Error('timeout'), { code: 'timeout', __ws: true });
export function withTimeout(p, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(timeoutError()), ms);
    Promise.resolve(p).then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(normError(e)); });
  });
}
function emitWriteError(err) {
  try { window.dispatchEvent(new CustomEvent('ws:writeerror', { detail: err })); } catch (e) { /* ignore */ }
}
// Resolve when the server confirmed the write, or after ACK_WAIT (offline / slow) so the app is never held hostage.
// A rejection that arrives after the wait is reported through the `ws:writeerror` event instead.
function settle(p) {
  trackWrite(p);
  return new Promise((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => { done = true; resolve(); }, ACK_WAIT);
    Promise.resolve(p).then(() => { if (!done) { done = true; clearTimeout(timer); resolve(); } }, e => {
      const err = normError(e);
      if (!done) { done = true; clearTimeout(timer); reject(err); } else emitWriteError(err);
    });
  });
}

// "Not sent" detection. A write that is still unconfirmed after ACK_WAIT is kept on the phone and retried by the SDK, so
// the app carries on. If the server stays silent for STUCK_AFTER (database missing, quota used up, a network that lets
// nothing through) nothing else would tell the person that the other phone is not getting their changes, so the app is
// told through `ws:unsent`. While the phone is simply offline the app shows its Offline notice instead.
const sync = { n: 0, timer: 0, stuck: false };
function setStuck(v) {
  if (v === sync.stuck) return;
  sync.stuck = v;
  try { window.dispatchEvent(new CustomEvent('ws:unsent', { detail: { stuck: v } })); } catch (e) { /* ignore */ }
}
export function trackWrite(p) {
  sync.n++;
  if (sync.n === 1) { clearTimeout(sync.timer); sync.timer = setTimeout(() => setStuck(true), STUCK_AFTER); }
  const finished = () => {
    sync.n = Math.max(0, sync.n - 1);
    if (sync.n === 0) { clearTimeout(sync.timer); sync.timer = 0; setStuck(false); }
  };
  Promise.resolve(p).then(finished, finished);
}

/* ---------- Firebase handle ---------- */
function cleanCfg(cfg) {
  const out = {};
  for (const k of CFG_KEYS) if (typeof cfg[k] === 'string' && cfg[k]) out[k] = cfg[k];
  return out;
}
// The name of an app is part of the key of its persistent cache (IndexedDB). The household's own connection therefore
// always uses the same name; short-lived connections (checks, seeding) get a fresh one each time.
const SESSION_NAME = '[ws]';
let openNo = 0;
export function openFirestore(cfg, { persistent = true, name } = {}) {
  const app = initializeApp(cleanCfg(cfg), name || 'tmp-' + (++openNo));
  const make = cache => initializeFirestore(app, { localCache: cache, experimentalAutoDetectLongPolling: true, ignoreUndefinedProperties: true });
  let fs;
  try { fs = make(persistent ? persistentLocalCache({ tabManager: persistentMultipleTabManager() }) : memoryLocalCache()); }
  catch (e) { fs = make(memoryLocalCache()); }
  return {
    app, fs,
    // never keeps the caller waiting for longer than CLOSE_WAIT, whatever the SDK is doing
    close() {
      const shut = (async () => {
        try { await terminate(fs); } catch (e) { /* ignore */ }
        try { await deleteApp(app); } catch (e) { /* ignore */ }
      })();
      return Promise.race([shut, new Promise(r => setTimeout(r, CLOSE_WAIT))]);
    }
  };
}

/* ---------- snapshot wrappers (the app reads `exists` as a property, like the artifact runtime) ---------- */
const wrapDoc = s => {
  const exists = s.exists();
  return { id: s.id, exists, data: () => (exists ? s.data() : undefined), metadata: s.metadata };
};
const wrapQuery = s => {
  const docs = s.docs.map(wrapDoc);
  return { docs, size: docs.length, empty: docs.length === 0, docChanges: () => [], metadata: s.metadata };
};

/* ---------- local-only documents (data/users/<uid>/…): per-device preferences ---------- */
const memLocal = new Map();
function localDoc(path) {
  const key = 'ws.local.' + path;
  const listeners = new Set();
  const read = () => {
    try { const raw = localStorage.getItem(key); if (raw) return JSON.parse(raw); } catch (e) { /* fall through */ }
    return memLocal.has(key) ? JSON.parse(memLocal.get(key)) : null;
  };
  const write = d => {
    const raw = JSON.stringify(d);
    memLocal.set(key, raw);
    try { localStorage.setItem(key, raw); } catch (e) { /* kept in memory */ }
  };
  const snap = () => { const d = read(); return { id: path.split('/').pop(), exists: !!d, data: () => (d ? Object.freeze(d) : undefined), metadata: { fromCache: false, hasPendingWrites: false } }; };
  const fire = () => { for (const l of Array.from(listeners)) l(); };
  return {
    id: path.split('/').pop(), path,
    get: async () => snap(),
    set: async d => { write(d); fire(); },
    update: async d => { write(Object.assign({}, read() || {}, d)); fire(); },
    delete: async () => { memLocal.delete(key); try { localStorage.removeItem(key); } catch (e) { /* ignore */ } fire(); },
    onSnapshot(next) {
      const l = () => next(snap());
      listeners.add(l);
      Promise.resolve().then(l);
      return () => listeners.delete(l);
    }
  };
}

/* ---------- the household's documents ---------- */
function remoteDoc(ctx, path) {
  const ref = fsDoc(ctx.fs, 'rooms', ctx.room, ...path.split('/'));
  return {
    id: ref.id, path,
    get: async () => wrapDoc(await getDoc(ref)),
    set: d => settle(setDoc(ref, d)),
    update: d => settle(updateDoc(ref, d)),
    delete: () => settle(deleteDoc(ref)),
    onSnapshot: (next, err) => fsOnSnapshot(ref, s => next(wrapDoc(s)), e => { if (err) err(normError(e)); })
  };
}
function remoteCollection(ctx, path, filters) {
  const col = fsCollection(ctx.fs, 'rooms', ctx.room, ...path.split('/'));
  const q = () => (filters.length ? fsQuery(col, ...filters.map(f => fsWhere(f[0], f[1], f[2]))) : col);
  return {
    doc: id => remoteDoc(ctx, path + '/' + id),
    where: (f, op, v) => remoteCollection(ctx, path, filters.concat([[f, op, v]])),
    get: async () => wrapQuery(await getDocs(q())),
    onSnapshot: (next, err) => fsOnSnapshot(q(), s => next(wrapQuery(s)), e => { if (err) err(normError(e)); })
  };
}

/* ---------- session ---------- */
export function connect(cfg, room, { uid, persistent = true, name } = {}) {
  const handle = openFirestore(cfg, { persistent, name: name || (persistent ? SESSION_NAME : undefined) });
  const ctx = { fs: handle.fs, room };
  const db = {
    doc: path => (String(path).startsWith('data/') ? localDoc(String(path)) : remoteDoc(ctx, path)),
    collection: path => remoteCollection(ctx, path, [])
  };
  const user = {
    id: async () => uid,
    can: async () => true,
    isOwner: async () => true,
    canEdit: async () => true,
    me: async () => ({ id: uid, name: '', avatarUrl: '', color: '#000', email: null, isOwner: true, canEdit: true })
  };
  async function seed(people, tasks) {
    const batch = writeBatch(ctx.fs);
    batch.set(fsDoc(ctx.fs, 'rooms', room, 'settings', 'people'), people);
    for (const t of tasks) batch.set(fsDoc(ctx.fs, 'rooms', room, 'tasks', t.id), t.data);
    await withTimeout(batch.commit(), 20000);
  }
  // writes that an earlier visit left unsent (kept in the persistent cache) count as unsent until the server has them
  if (persistent) { try { trackWrite(waitForPendingWrites(ctx.fs)); } catch (e) { /* not essential */ } }
  return { db, user, seed, close: handle.close, fs: ctx.fs };
}

/* ---------- connection checks used by the setup / join screens ---------- */
// Each check uses its own short-lived connection (memory cache only) and always closes it again.
async function withProbe(cfg, fn) {
  let o = null;
  try { o = openFirestore(cfg, { persistent: false }); return await fn(o); }
  catch (e) { return { ok: false, error: normError(e) }; }
  finally { if (o) await o.close(); }
}
export const probeWrite = (cfg, room, ms = 15000) => withProbe(cfg, async o => {
  const ref = fsDoc(o.fs, 'rooms', room, 'settings', 'ping');
  await withTimeout(setDoc(ref, { t: Date.now() }), ms);
  const snap = await withTimeout(getDocFromServer(ref), ms);
  if (!snap.exists()) throw Object.assign(new Error('not found'), { code: 'not_found', __ws: true });
  await withTimeout(deleteDoc(ref), ms);
  return { ok: true };
});
export const probeRead = (cfg, room, ms = 15000) => withProbe(cfg, async o => {
  const snap = await withTimeout(getDocFromServer(fsDoc(o.fs, 'rooms', room, 'settings', 'people')), ms);
  return { ok: true, exists: snap.exists() };
});

// German explanation of a failure, for the person who sets things up ("setup") or the one who joins ("join").
// What Firebase really answers when something is missing is often only "unavailable" or silence, so that case names every
// likely cause. Whoever joins cannot fix anything in Firebase and is pointed to the person who did the setup.
export function explain(error, step) {
  const code = error && error.code;
  const msg = (error && error.message) || '';
  const join = step === 'join';
  const ask = ' Frag die Person, die den Haushalt eingerichtet hat.';
  if (code === 'permission_denied' && /has not been used|is disabled|enable it by visiting/i.test(msg)) {
    return join
      ? 'Die Datenbank im Firebase-Projekt ist noch nicht angelegt.' + ask
      : 'Die Firestore-Datenbank ist in diesem Projekt noch nicht angelegt. Mach Schritt 2 der Einrichtung (Firestore → „Datenbank erstellen“).';
  }
  if (code === 'permission_denied') {
    return join
      ? 'Firebase lässt den Zugriff nicht zu. Die Regeln im Firebase-Projekt sind vermutlich nicht veröffentlicht.' + ask
      : 'Firebase lehnt das Speichern ab. Hast du die Regeln aus Schritt 3 eingefügt und auf „Veröffentlichen“ getippt?';
  }
  if (code === 'timeout' || code === 'unavailable' || code === 'deadline_exceeded') {
    return join
      ? 'Keine Antwort von Firebase. Prüfe dein Internet (WLAN oder mobile Daten) und versuche es noch einmal. Klappt es weiter nicht:' + ask
      : 'Keine Antwort von Firebase. Ist die Datenbank genau in diesem Projekt angelegt (Schritt 2)? Stimmen Projekt-ID und API-Schlüssel (Schritt 4)? Prüfe auch dein Internet.';
  }
  if (code === 'not_found') {
    return join
      ? 'Die Datenbank wurde nicht gefunden. Vermutlich ist der Link veraltet.' + ask
      : 'Die Datenbank wurde nicht gefunden. Lege sie in Firebase unter „Firestore“ an (Schritt 2).';
  }
  if (code === 'failed_precondition') {
    return join
      ? 'Firebase meldet ein Problem mit der Datenbank.' + ask
      : 'Firebase meldet ein Problem mit der Datenbank. Lege sie unter „Firestore“ neu an oder prüfe, ob sie fertig erstellt ist.';
  }
  if (code === 'resource_exhausted') return 'Firebase nimmt gerade nichts an (vielleicht ist das Tageslimit erreicht). Versuche es später oder morgen noch einmal.';
  return 'Unerwarteter Fehler (' + (code || 'unbekannt') + '). ' + (msg || '');
}
