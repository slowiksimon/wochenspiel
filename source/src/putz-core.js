// The cleaning overview: the pure part (no DOM, no Firebase), so it can be tested on its own.
//
// Every room has a few jobs (Saugen, Wischen, …), each with a rhythm in days. For every job the app keeps when it was last
// done and by whom; from that and the rhythm follows its state: never recorded, fine, due soon, due today, overdue.
//
// In the household's settings collection (the security rules every household has published allow only tasks, slots and
// settings, so this needs no change in Firebase):
//   settings/putz                    { v: 1, rooms: [{ id, n: name, f: 'og'|'eg'|'kg', j: [{ k: job key, n?: own name, e: days }] }] }
//                                     missing until the rooms are first changed: then the rooms below are used
//   settings/putz-d-<room>-<job>      { at: time it was done, by: 'a'|'b'|null, h: [earlier { at, by }] }
// One document per job, so two phones can tick different jobs at the same moment without overwriting each other.
// Shared data is untrusted (anyone with the invite link can write it): everything is checked on the way in.

export const FLOORS = [
  { id: 'og', name: 'Obergeschoss' },
  { id: 'eg', name: 'Erdgeschoss' },
  { id: 'kg', name: 'Keller' }
];
export const FLOOR = Object.fromEntries(FLOORS.map(f => [f.id, f]));

// the usual jobs; `every` is the rhythm a new room starts with
export const JOBS = {
  saugen: { name: 'Saugen', long: 'Staubsaugen', every: 7 },
  wischen: { name: 'Wischen', long: 'Boden wischen', every: 14 },
  staub: { name: 'Staub', long: 'Staub wischen', every: 14 },
  putzen: { name: 'Putzen', long: 'Putzen', every: 7 },
  betten: { name: 'Betten', long: 'Bettwäsche wechseln', every: 14 },
  fenster: { name: 'Fenster', long: 'Fenster putzen', every: 90 }
};
export const JOB_KEYS = Object.keys(JOBS);
// what "Putzen" means in a room
const PUTZEN = { bad: 'WC, Waschbecken, Dusche, Spiegel', klo: 'WC und Waschbecken', kueche: 'Herd, Arbeitsfläche, Spüle' };

// the rhythms to choose from
export const EVERY = [3, 7, 14, 21, 30, 60, 90, 180];
export function everyText(e) {
  return { 1: 'jeden Tag', 7: 'jede Woche', 14: 'alle 2 Wochen', 21: 'alle 3 Wochen', 30: 'jeden Monat', 60: 'alle 2 Monate', 90: 'alle 3 Monate', 180: 'alle 6 Monate' }[e] || 'alle ' + e + ' Tage';
}

/* ---------- the rooms of the house, as the household listed them; used until it changes them ---------- */
const J = (k, e) => ({ k, e });
const LIVING = () => [J('saugen', 7), J('wischen', 14), J('staub', 14), J('fenster', 90)];
const BED = () => [J('saugen', 7), J('wischen', 14), J('staub', 14), J('betten', 14), J('fenster', 90)];
export const DEFAULT_ROOMS = [
  { id: 'schlaf', n: 'Schlafzimmer', f: 'og', j: BED() },
  { id: 'spiel', n: 'Spielzimmer', f: 'og', j: LIVING() },
  { id: 'kinder', n: 'Kinderzimmer', f: 'og', j: BED() },
  { id: 'bad', n: 'Bad', f: 'og', j: [J('saugen', 7), J('wischen', 7), J('putzen', 7), J('fenster', 90)] },
  { id: 'stiege', n: 'Stiege', f: 'og', j: [J('saugen', 7), J('wischen', 14)] },
  { id: 'wohn', n: 'Wohnzimmer', f: 'eg', j: LIVING() },
  { id: 'buero', n: 'Büro', f: 'eg', j: LIVING() },
  { id: 'kueche', n: 'Küche', f: 'eg', j: [J('saugen', 7), J('wischen', 7), J('putzen', 7), J('fenster', 90)] },
  { id: 'buero2', n: 'Büro 2', f: 'eg', j: LIVING() },
  { id: 'klo', n: 'Klo', f: 'eg', j: [J('saugen', 7), J('wischen', 7), J('putzen', 7)] },
  { id: 'vorraum', n: 'Vorraum', f: 'eg', j: [J('saugen', 7), J('wischen', 7)] },
  { id: 'abstell', n: 'Abstellraum', f: 'eg', j: [J('saugen', 30), J('wischen', 60)] },
  { id: 'keller', n: 'Keller', f: 'kg', j: [J('saugen', 30), J('wischen', 90)] }
];
export const defaultRooms = () => JSON.parse(JSON.stringify(DEFAULT_ROOMS));

export const MAX_ROOMS = 30, MAX_JOBS = 10, MAX_ROOM_NAME = 30, MAX_JOB_NAME = 24, MAX_HIST = 5;
const ID_RE = /^[a-z0-9]{1,20}$/, OWN_RE = /^x[a-z0-9]{1,12}$/;
const line = (v, n) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '');
const who = v => (v === 'a' || v === 'b' ? v : null);
const days = v => (Number.isInteger(v) && v >= 1 && v <= 365 ? v : 0);

export const jobName = j => (JOBS[j.k] ? JOBS[j.k].name : j.n);
export function jobHint(room, j) {
  if (j.k === 'putzen') return PUTZEN[room.id] || 'Oberflächen und Armaturen';
  return JOBS[j.k] ? JOBS[j.k].long : '';
}

// the rooms as stored (settings/putz) -> a clean list; anything broken is dropped, nothing stored -> the default rooms
export function cleanRooms(doc) {
  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.rooms)) return defaultRooms();
  const out = [], ids = new Set();
  for (const r of doc.rooms.slice(0, MAX_ROOMS)) {
    if (!r || typeof r !== 'object' || typeof r.id !== 'string' || !ID_RE.test(r.id) || ids.has(r.id)) continue;
    const n = line(r.n, MAX_ROOM_NAME);
    if (!n) continue;
    const jobs = [], keys = new Set();
    for (const j of Array.isArray(r.j) ? r.j.slice(0, MAX_JOBS) : []) {
      if (!j || typeof j !== 'object' || typeof j.k !== 'string' || keys.has(j.k)) continue;
      const std = !!JOBS[j.k], own = OWN_RE.test(j.k);
      if (!std && !own) continue;
      const name = own ? line(j.n, MAX_JOB_NAME) : '';
      if (own && !name) continue;
      keys.add(j.k);
      jobs.push(own ? { k: j.k, n: name, e: days(j.e) || 14 } : { k: j.k, e: days(j.e) || JOBS[j.k].every });
    }
    ids.add(r.id);
    out.push({ id: r.id, n, f: FLOOR[r.f] ? r.f : 'eg', j: jobs });
  }
  return out;
}
export const roomsDoc = rooms => ({ v: 1, rooms: rooms.map(r => ({ id: r.id, n: r.n, f: r.f, j: r.j.map(j => (j.n ? { k: j.k, n: j.n, e: j.e } : { k: j.k, e: j.e })) })) });

// when a job was done: { at, by, h }, or null; times in the future (beyond a day of clock difference) are not believed
export function cleanDone(d, now = Date.now()) {
  if (!d || typeof d !== 'object') return null;
  const ok = v => typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= now + 36 * 3600e3;
  if (!ok(d.at)) return null;
  const h = (Array.isArray(d.h) ? d.h : []).filter(x => x && ok(x.at)).slice(0, MAX_HIST).map(x => ({ at: x.at, by: who(x.by) }));
  return { at: d.at, by: who(d.by), h };
}
export const doneId = (room, key) => 'putz-d-' + room + '-' + key;
// the documents of the settings collection -> rooms and the "done" records by "room-job"
export function parseDocs(docs, now = Date.now()) {
  let roomsData = null;
  const done = new Map();
  for (const d of docs || []) {
    if (!d || typeof d.id !== 'string') continue;
    let data; try { data = d.data(); } catch (e) { data = null; }
    if (d.id === 'putz') roomsData = data;
    else if (d.id.startsWith('putz-d-')) { const v = cleanDone(data, now); if (v) done.set(d.id.slice(7), v); }
  }
  return { rooms: cleanRooms(roomsData), stored: !!(roomsData && Array.isArray(roomsData.rooms)), done };
}
// a job was done (now, or on another day): the new record keeps the previous ones
export const doneRecord = (prev, at, by) => ({ at, by: who(by), h: prev ? [{ at: prev.at, by: prev.by }].concat(prev.h || []).slice(0, MAX_HIST) : [] });
// …and taken back: the previous record (or nothing)
export const undoRecord = rec => (rec && rec.h && rec.h.length ? { at: rec.h[0].at, by: rec.h[0].by, h: rec.h.slice(1) } : null);

/* ---------- dates (local calendar days) ---------- */
const dayStart = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const daysBetween = (a, b) => Math.round((dayStart(b) - dayStart(a)) / 864e5);
export const DAY_LONG = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
export const DAY_SHORT = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
export const MONTH_SHORT = ['Jän.', 'Feb.', 'März', 'Apr.', 'Mai', 'Juni', 'Juli', 'Aug.', 'Sep.', 'Okt.', 'Nov.', 'Dez.'];
export const shortDate = d => DAY_SHORT[(d.getDay() + 6) % 7] + ', ' + d.getDate() + '. ' + MONTH_SHORT[d.getMonth()];
// a day chosen in the sheet ("yesterday", a date) counts at noon, so it is the same day wherever the clock is a little off
export const atNoon = d => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12).getTime();

/* ---------- the state of a job ---------- */
// since: whole days since it was done (0 = today); left: days until it is due again (0 = due today, below 0 = overdue);
// fill: how fresh it is, 1 just done .. 0 due
export function status(job, rec, now) {
  if (!rec) return { state: 'nie', since: null, left: null, fill: 0, due: false };
  const since = Math.max(0, daysBetween(new Date(rec.at), now));
  const left = job.e - since;
  const soon = job.e <= 7 ? 1 : job.e <= 30 ? 3 : 7;
  const state = left < 0 ? 'ueber' : left === 0 ? 'heute' : left <= soon ? 'bald' : 'ok';
  return { state, since, left, fill: Math.max(0, Math.min(1, left / job.e)), due: left <= 0 };
}
export function sinceText(since, short) {
  if (since == null) return 'noch nie';
  if (since === 0) return 'heute';
  if (since === 1) return 'gestern';
  if (since < 14) return 'vor ' + since + (short ? ' T.' : ' Tagen');
  if (since < 60) return 'vor ' + Math.floor(since / 7) + (short ? ' Wo.' : ' Wochen');
  const m = Math.round(since / 30);
  return 'vor ' + m + (short ? ' Mon.' : m === 1 ? ' Monat' : ' Monaten');
}
export function dueText(st) {
  if (st.state === 'nie') return 'noch nie erledigt';
  if (st.left < 0) return 'seit ' + -st.left + (st.left === -1 ? ' Tag' : ' Tagen') + ' fällig';
  if (st.left === 0) return 'heute fällig';
  if (st.left === 1) return 'morgen fällig';
  return 'in ' + st.left + ' Tagen fällig';
}

// everything the screen shows, in one pass: per room its jobs with their state, what is due, and what is most urgent
export function overview(rooms, done, now) {
  const items = [];
  const byRoom = rooms.map(r => {
    const jobs = r.j.map(j => {
      const rec = done.get(r.id + '-' + j.k) || null;
      const it = { room: r, job: j, rec, st: status(j, rec, now) };
      items.push(it);
      return it;
    });
    return { room: r, jobs, due: jobs.filter(x => x.st.due).length, soon: jobs.filter(x => x.st.state === 'bald') };
  });
  const due = items.filter(x => x.st.due);
  // most urgent first: the more of its rhythm a job is behind, the sooner it comes; then the longer overdue, the earlier
  due.sort((x, y) => (-y.st.left / y.job.e) - (-x.st.left / x.job.e) || x.st.left - y.st.left);
  const recorded = items.filter(x => x.rec);
  const next = recorded.filter(x => !x.st.due).sort((x, y) => x.st.left - y.st.left || x.job.e - y.job.e)[0] || null;
  return { byRoom, due, next, recorded: recorded.length, total: items.length };
}

export const newRoomId = () => 'r' + Math.random().toString(36).slice(2, 10).replace(/[^a-z0-9]/g, '') + Date.now().toString(36).slice(-3);
export const newJobKey = () => 'x' + Math.random().toString(36).slice(2, 9).replace(/[^a-z0-9]/g, '');
