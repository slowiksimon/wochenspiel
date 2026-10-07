// Pure helpers (no DOM, no Firebase): Firebase config parsing, invite links, room codes, week keys.

const CFG_KEYS = ['apiKey', 'authDomain', 'projectId', 'storageBucket', 'messagingSenderId', 'appId', 'measurementId', 'databaseURL'];
const ROOM_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';   // 31 symbols, no i/l/o/0/1
const ROOM_LEN = 16;
const ROOM_RE = /^[a-z0-9]{16,40}$/;
const PROJECT_RE = /^[a-z][a-z0-9-]{3,29}$/;

/* ---- Firebase config: accept whatever the console shows (npm, CDN, plain object, JSON) ---- */
export function parseFirebaseConfig(text) {
  const src = String(text == null ? '' : text);
  if (!src.trim()) return { ok: false, error: 'empty' };
  const clean = src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:\\])\/\/.*$/gm, '$1');
  const cfg = {};
  const re = /["']?([A-Za-z][A-Za-z0-9_]*)["']?\s*:\s*(["'`])((?:\\.|(?!\2)[^\\\n])*)\2/g;
  let m;
  while ((m = re.exec(clean))) {
    const key = m[1];
    if (CFG_KEYS.includes(key) && !(key in cfg)) cfg[key] = m[3].trim();
  }
  if (!cfg.projectId) return { ok: false, error: 'no-project' };
  cfg.projectId = cfg.projectId.toLowerCase();
  if (!PROJECT_RE.test(cfg.projectId)) return { ok: false, error: 'bad-project', cfg };
  if (!cfg.apiKey) return { ok: false, error: 'no-key', cfg };
  if (!/^[A-Za-z0-9_-]{20,80}$/.test(cfg.apiKey)) return { ok: false, error: 'bad-key', cfg };
  return { ok: true, cfg };
}

/* ---- base64url ---- */
function toB64Url(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromB64Url(s) {
  const pad = s.length % 4 ? '='.repeat(4 - (s.length % 4)) : '';
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/* ---- invite payload: {cfg, room, me} <-> short string ---- */
export function encodeInvite({ cfg, room, me }) {
  const o = { v: 1, p: cfg.projectId, r: room };
  if (cfg.apiKey) o.k = cfg.apiKey;
  if (cfg.appId) o.a = cfg.appId;
  if (cfg.authDomain && cfg.authDomain !== cfg.projectId + '.firebaseapp.com') o.d = cfg.authDomain;
  if (me === 'a' || me === 'b') o.m = me;
  return toB64Url(JSON.stringify(o));
}
export function decodeInvite(payload) {
  try {
    const o = JSON.parse(fromB64Url(String(payload).trim()));
    if (!o || o.v !== 1 || typeof o.p !== 'string' || typeof o.r !== 'string') return null;
    if (!PROJECT_RE.test(o.p) || !ROOM_RE.test(o.r)) return null;
    const cfg = { projectId: o.p, authDomain: typeof o.d === 'string' ? o.d : o.p + '.firebaseapp.com' };
    if (typeof o.k === 'string' && /^[A-Za-z0-9_-]{20,80}$/.test(o.k)) cfg.apiKey = o.k;
    if (typeof o.a === 'string' && o.a.length < 120) cfg.appId = o.a;
    return { cfg, room: o.r, me: o.m === 'a' || o.m === 'b' ? o.m : null };
  } catch (e) { return null; }
}
export function inviteUrl(base, invite) { return String(base).replace(/[#?].*$/, '') + '#j=' + encodeInvite(invite); }

// Accepts a full link, "#j=...", "j=...", or the bare payload (what people paste after copying from a chat). A link that a
// mail program or chat app has broken over several lines is put back together: the pieces after "j=" are appended one by
// one until they decode, so words that follow the link in the same message do no harm.
export function extractInvite(input) {
  const s = String(input == null ? '' : input).trim();
  if (!s) return null;
  const at = s.search(/(?:^|[#?&])j=/);
  if (at >= 0) {
    const rest = s.slice(at).replace(/^[#?&]?j=/, '');
    let acc = '';
    for (const tok of rest.split(/\s+/).filter(Boolean).slice(0, 8)) {
      const good = tok.match(/^[A-Za-z0-9_-]*/)[0];
      acc += good;
      const inv = acc ? decodeInvite(acc) : null;
      if (inv) return inv;
      if (good.length < tok.length) break;
    }
    return null;
  }
  const bare = s.replace(/\s+/g, '');
  if (/^[A-Za-z0-9_-]{60,}$/.test(bare)) return decodeInvite(bare);
  return null;
}

/* ---- ids ---- */
export function makeRoomCode() {
  let out = '';
  while (out.length < ROOM_LEN) {
    const buf = new Uint8Array(32);
    crypto.getRandomValues(buf);
    for (const b of buf) {
      if (b < 248 && out.length < ROOM_LEN) out += ROOM_ALPHABET[b % ROOM_ALPHABET.length];
    }
  }
  return out;
}
export function makeUid() {
  const buf = new Uint8Array(12);
  crypto.getRandomValues(buf);
  let out = 'd_';
  for (const b of buf) out += ROOM_ALPHABET[b % ROOM_ALPHABET.length];
  return out;
}
export const isRoom = s => ROOM_RE.test(String(s));
export const shortRoom = room => '····' + String(room).slice(-4).toUpperCase();

/* ---- week key, same rule as the app: Monday of the local week, YYYY-MM-DD ---- */
export function mondayKey(d) {
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  day.setDate(day.getDate() - ((day.getDay() + 6) % 7));
  const p = n => String(n).padStart(2, '0');
  return day.getFullYear() + '-' + p(day.getMonth() + 1) + '-' + p(day.getDate());
}

/* ---- Firestore rules shown in the wizard (kept here so the tests can check the exact text) ---- */
export const FIRESTORE_RULES = `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /rooms/{room}/{coll}/{id} {
      allow read, write: if room.size() >= 16 && coll in ['tasks', 'slots', 'settings'];
    }
  }
}`;
