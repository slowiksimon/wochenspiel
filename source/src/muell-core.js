// The waste plan: the pure part (no DOM, no Firebase), so it can be tested on its own.
// Which bins go out on which day, for the bins a household has and the Restmüll area of its street.
//
// The household's choice lives in the shared document settings/muell: { area: 0|1|2, street: '…', have: { rest: true, … } }.
// Shared data is untrusted (anyone with the invite link can write it), so it is checked on the way in (cleanSettings).
import { PLAN } from './muell-data.js';

export { PLAN };

// the kinds of bins, in the order they are listed. `shape` is the little drawing (bin, sack, container), `group` 2 are the
// collections for housing estates, which most households do not have.
export const KINDS = [
  { id: 'rest', name: 'Restmüll', sheet: 'Restmülltonne', hint: 'alle 4 Wochen', shape: 'bin', def: true },
  { id: 'asche', name: 'Aschentonne', sheet: 'Aschentonne', hint: 'in der Heizsaison, mit dem Restmüll', shape: 'bin', def: false },
  { id: 'bio', name: 'Biotonne', sheet: 'Biotonne', hint: 'montags, Mitte April bis Oktober jede Woche', shape: 'bin', def: true },
  { id: 'gt', name: 'Gelbe Tonne', sheet: 'Gelbe Tonne', hint: 'alle 2 Wochen', shape: 'bin', def: true },
  { id: 'gs', name: 'Gelber Sack', sheet: 'Gelber Sack', hint: 'alle 6 Wochen', shape: 'sack', def: true },
  { id: 'ap', name: 'Altpapier', sheet: 'Altpapiertonne', hint: 'roter Deckel, alle 9 Wochen', shape: 'bin', def: true },
  { id: 'ap3', name: 'Altpapier', sheet: 'Altpapier 3-wöchig', hint: 'Wohnhausanlagen und Miettonnen', shape: 'box', def: false, group: 2 },
  { id: 'c4', name: 'Container', sheet: 'Container 4-wöchig', hint: 'Restmüll, 1100 Liter', shape: 'box', def: false, group: 2 },
  { id: 'c2', name: 'Container', sheet: 'Container 2-wöchig', hint: 'Restmüll, 1100 Liter', shape: 'box', def: false, group: 2 }
];
export const KIND = Object.fromEntries(KINDS.map(k => [k.id, k]));
// the usual weekday of the Restmüll in each area (holidays move single dates)
export const AREA_DAY = { 1: 'Montag', 2: 'Donnerstag' };
// a pickup of today counts as "next" until noon; after that the app looks ahead
export const CUT_HOUR = 12;

export const DAY_LONG = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
export const DAY_SHORT = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
export const MONTH_LONG = ['Jänner', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
export const MONTH_SHORT = ['Jän.', 'Feb.', 'März', 'Apr.', 'Mai', 'Juni', 'Juli', 'Aug.', 'Sep.', 'Okt.', 'Nov.', 'Dez.'];

/* ---------- dates (local time, weeks start on Monday) ---------- */
const pad = n => String(n).padStart(2, '0');
export const keyOf = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
export const dateOf = key => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d); };
export const dayStart = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
export const wd = d => (d.getDay() + 6) % 7;                                    // 0 = Monday
export const daysBetween = (a, b) => Math.round((dayStart(b) - dayStart(a)) / 864e5);
export const longDate = d => DAY_LONG[wd(d)] + ', ' + d.getDate() + '. ' + MONTH_LONG[d.getMonth()];

/* ---------- streets ---------- */
// "Türkengasse", "tuerkeng.", "TURKEN" and "Hauptstr. 12a" all find their street: case, accents, ß/ss, ä/ae, spaces,
// dots and hyphens do not matter, and a house number is ignored.
export const fold = s => String(s == null ? '' : s).toLocaleLowerCase('de').replace(/ß/g, 'ss').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/ae/g, 'a').replace(/oe/g, 'o').replace(/ue/g, 'u').replace(/[^a-z0-9]/g, '');
const STREETS = PLAN.streets1.map(name => ({ name, area: 1 })).concat(PLAN.streets2.map(name => ({ name, area: 2 })));
export function streetArea(name) {
  const f = fold(name);
  if (!f) return 0;
  const s = STREETS.find(x => fold(x.name) === f);
  return s ? s.area : 0;
}
export const streetName = name => { const f = fold(name); const s = f ? STREETS.find(x => fold(x.name) === f) : null; return s ? s.name : ''; };
export function findStreets(query, max = 6) {
  const q = fold(String(query == null ? '' : query).replace(/\d.*$/, ''));
  if (q.length < 2) return [];
  const hits = [];
  for (const s of STREETS) {
    const f = fold(s.name);
    const at = f.indexOf(q);
    if (at < 0) continue;
    const word = s.name.split(/[\s.-]+/).some(w => fold(w).startsWith(q));
    hits.push({ s, rank: at === 0 ? 0 : word ? 1 : 2 });
  }
  hits.sort((x, y) => x.rank - y.rank || x.s.name.localeCompare(y.s.name, 'de'));
  return hits.slice(0, max).map(x => x.s);
}

/* ---------- the household's choice ---------- */
export const defaultHave = () => Object.fromEntries(KINDS.map(k => [k.id, k.def]));
export function cleanSettings(d) {
  const o = d && typeof d === 'object' ? d : {};
  const hv = o.have && typeof o.have === 'object' ? o.have : {};
  const have = {};
  for (const k of KINDS) have[k.id] = typeof hv[k.id] === 'boolean' ? hv[k.id] : k.def;
  const sa = typeof o.street === 'string' ? streetArea(o.street.slice(0, 80)) : 0;
  let area = o.area === 1 || o.area === 2 ? o.area : 0;
  if (!area) area = sa;
  // a street is only kept when it is one of the plan's and lies in the chosen area
  const street = sa && sa === area ? streetName(o.street) : '';
  return { area, street, have };
}
// what is written to the shared document
export const settingsDoc = s => ({ v: 1, area: s.area, street: s.street, have: Object.assign({}, s.have), at: Date.now() });
export const sameSettings = (x, y) => x.area === y.area && x.street === y.street && KINDS.every(k => x.have[k.id] === y.have[k.id]);

/* ---------- the plan for one household ---------- */
const ORDER = Object.fromEntries(KINDS.map((k, i) => [k.id, i]));
export const label = ev => KIND[ev.kind].name + (ev.area ? ' Bereich ' + ev.area : '');
// day key -> the pickups of that day, [{ kind, area? }], in the order of KINDS. Without a known area both Restmüll areas are
// shown, each with its number (on 28 May both areas share one day: then it is one plain "Restmüll").
export function schedule(settings, plan = PLAN) {
  const s = cleanSettings(settings);
  const map = new Map();
  const add = (md, kind, area) => {
    const key = plan.year + '-' + md;
    let list = map.get(key);
    if (!list) map.set(key, list = []);
    list.push(area ? { kind, area } : { kind });
  };
  const areas = s.area ? [s.area] : [1, 2];
  for (const ar of areas) {
    if (s.have.rest) for (const md of plan['rm' + ar]) add(md, 'rest', s.area ? 0 : ar);
    if (s.have.asche) for (const md of plan['at' + ar]) add(md, 'asche', s.area ? 0 : ar);
  }
  for (const id of ['bio', 'gt', 'gs', 'ap', 'ap3', 'c4', 'c2']) if (s.have[id]) for (const md of plan[id]) add(md, id, 0);
  for (const [key, list] of map) {
    const out = [];
    for (const ev of list) {
      const same = out.find(o => o.kind === ev.kind || (KIND[o.kind].name === KIND[ev.kind].name && KIND[o.kind].shape === KIND[ev.kind].shape));
      if (!same) out.push(ev);
      else if (same.area && ev.area && same.area !== ev.area) delete same.area;   // both areas on one day
    }
    out.sort((x, y) => ORDER[x.kind] - ORDER[y.kind] || (x.area || 0) - (y.area || 0));
    map.set(key, out);
  }
  return map;
}
export const holiday = (key, plan = PLAN) => (key.slice(0, 4) === String(plan.year) && plan.holidays[key.slice(5)]) || '';
export const inPlan = (d, plan = PLAN) => d.getFullYear() === plan.year;

// the day from which "next" is looked for: today, or tomorrow once it is past noon
export const fromDay = now => (now.getHours() >= CUT_HOUR ? addDays(dayStart(now), 1) : dayStart(now));
// the next pickup days, starting at fromDay(now); never beyond the end of the plan
export function upcoming(map, now, n = 6, plan = PLAN) {
  const out = [];
  let d = fromDay(now);
  const first = new Date(plan.year, 0, 1), end = new Date(plan.year, 11, 31);
  if (d < first) d = first;
  for (; d <= end && out.length < n; d = addDays(d, 1)) {
    const key = keyOf(d), ev = map.get(key);
    if (ev && ev.length) out.push({ date: d, key, events: ev });
  }
  return out;
}
// "Heute", "Morgen", a weekday within the coming week, else the date
export function whenText(date, now) {
  const n = daysBetween(now, date);
  if (n === 0) return 'Heute';
  if (n === 1) return 'Morgen';
  if (n > 1 && n < 7) return DAY_LONG[wd(date)];
  return date.getDate() + '. ' + MONTH_LONG[date.getMonth()];
}
export function inDays(date, now) {
  const n = daysBetween(now, date);
  return n === 0 ? 'heute' : n === 1 ? 'morgen' : n > 1 ? 'in ' + n + ' Tagen' : '';
}
// the cells of a month view, Monday first: null for the blank cells before the 1st and after the last day
export function monthCells(year, month) {
  const first = new Date(year, month, 1), n = new Date(year, month + 1, 0).getDate();
  const cells = Array(wd(first)).fill(null);
  for (let i = 1; i <= n; i++) cells.push(new Date(year, month, i));
  while (cells.length % 7) cells.push(null);
  return cells;
}
/* ---------- the calendars to subscribe to (written by build.mjs, see muell-ics.js) ---------- */
// One file per Restmüll area and set of household bins (bit i of the code = CAL_BITS[i]), plus one per housing-estate
// collection, which only a few households have. A static website cannot make a file per request, so all of them exist.
export const CAL_BITS = ['rest', 'asche', 'bio', 'gt', 'gs', 'ap'];
export const ALERT_HOUR = 19;                   // the calendar's alert: 19:00 the evening before a pickup
export const CAL_EXTRA = ['ap3', 'c4', 'c2'];
export const calName = (area, code) => 'muell-b' + area + '-' + code.toString(16).padStart(2, '0');
// the calendar files that fit a household's choice; without a known area the Restmüll (and ash bin) cannot be placed
export function calendars(settings) {
  const s = cleanSettings(settings);
  let code = 0;
  CAL_BITS.forEach((k, i) => { if (s.have[k]) code |= 1 << i; });
  const needsArea = !s.area && (s.have.rest || s.have.asche);
  const names = needsArea ? [] : (code ? [calName(s.area || 1, code)] : []).concat(CAL_EXTRA.filter(k => s.have[k]).map(k => 'muell-' + k));
  return { needsArea, names };
}

// the months the view can show: those of the plan, and the current one if it lies outside the plan
export function monthRange(now, plan = PLAN) {
  const lo = Math.min(plan.year * 12, now.getFullYear() * 12 + now.getMonth());
  const hi = Math.max(plan.year * 12 + 11, now.getFullYear() * 12 + now.getMonth());
  return { lo, hi };
}
