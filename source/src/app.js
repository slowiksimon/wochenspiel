// The game, in the Nest design: this week's tasks, tapped off, carried to another day, handed over or dropped.
// Everything on the "Woche" screen is drawn here (the nest, the week strip, the day's list) and so are the sheets for
// editing tasks, the names, the reward and "who am I". The shopping list and the wish list are in lists.js.
//
// Data (all in the household's Firestore, see adapter.js):  tasks/{id}  slots/{week_task_day}  settings/people
import { h, $, $$, ico } from './dom.js';
import { toast, hideToast, announce } from './toast.js';
import { DAY, HOT } from './nest.js';
import { lock, unlock } from './inert.js';

const DAY_LONG = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
const DAY_SHORT = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const MONTH = ['Jän', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
const MONTH_LONG = ['Jänner', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const WHO = ['a', 'b', 'both'];
const LS = { me: 'wp2.me', hint: 'wp2.hint', filter: 'wp2.filter' };
const LONG_PRESS = 260, TOUCH_SLOP = 10, MOUSE_SLOP = 5, OPTIM_TTL = 6000;
const DEFAULT_REWARD = 'Eine kleine Belohnung';
const CONFETTI = ['#F0C25A', '#E3A72F', '#0F73A8', '#D8442B', '#2A211B', '#F8D77F'];
const CONFETTI_DARK = ['#F0C25A', '#E3A72F', '#4DB3E8', '#FF7B5E', '#F4EEE3', '#F8D77F'];

document.documentElement.lang = 'de';
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage may be blocked */ } }
};
const reduceMotion = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
const darkMode = () => !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
const buzz = p => { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) { /* not supported */ } };
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/* ---------- state ---------- */
const state = {
  db: null, uid: null, canWrite: null, blocked: false,
  unavailable: false, failed: false, offline: false, stuck: false,
  loaded: { tasks: false, people: false, prefs: false },
  prefs: { hint: false }, prefsRef: null,
  tasks: [], slots: new Map(), slotsKey: '', optim: new Map(),
  people: { a: 'Person 1', b: 'Person 2', reward: DEFAULT_REWARD, goal: 80, aId: null, bId: null },
  me: null, manualMe: null, prompted: false,
  filter: 'all', hintGone: false,
  offset: 0, weekStart: null, weekKey: '', todayKey: '', todayIdx: 0, todayLong: '', thisYear: 0,
  sel: 0, selAuto: true,                      // the day whose tasks are listed; it follows today until a day is picked
  model: null, dirty: false, modalOpen: false, fxKey: null,
  unsubSlots: null, lastFocus: null
};
const drag = { pend: null, on: null, lastType: 'mouse' };
let lastScroll = 0;

/* ---------- dates (local time, weeks start on Monday) ---------- */
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const mondayOf = d => addDays(d, -((d.getDay() + 6) % 7));
const pad = n => String(n).padStart(2, '0');
const ymd = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t - y0) / 86400000 + 1) / 7);
}
function computeWeek() {
  const now = new Date();
  const prevToday = state.todayKey;
  state.todayKey = ymd(now);
  if (prevToday && prevToday !== state.todayKey) state.selAuto = true;                   // a new day has begun: the list follows today again
  state.todayIdx = (now.getDay() + 6) % 7;
  state.todayLong = DAY_LONG[state.todayIdx] + ', ' + now.getDate() + '. ' + MONTH_LONG[now.getMonth()];
  state.thisYear = now.getFullYear();
  state.weekStart = addDays(mondayOf(now), state.offset * 7);
  state.weekKey = ymd(state.weekStart);
  if (state.selAuto && state.offset === 0) state.sel = state.todayIdx;
}
function rangeText() {
  const s = state.weekStart, e = addDays(s, 6);
  const yr = (s.getFullYear() !== state.thisYear || e.getFullYear() !== state.thisYear) ? ' ' + e.getFullYear() : '';
  if (s.getMonth() === e.getMonth()) return s.getDate() + '.–' + e.getDate() + '. ' + MONTH[e.getMonth()] + yr;
  return s.getDate() + '. ' + MONTH[s.getMonth()] + ' – ' + e.getDate() + '. ' + MONTH[e.getMonth()] + yr;
}

/* ---------- data helpers (shared data is untrusted: validate on read) ---------- */
const str = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n || 80) : '');
function cleanTask(id, d) {
  const days = Array.isArray(d.days)
    ? [...new Set(d.days.map(Number).filter(n => Number.isInteger(n) && n >= 0 && n <= 6))].sort((x, y) => x - y)
    : [];
  return {
    id, title: str(d.title, 40), emoji: str(d.emoji, 10) || '✨',
    who: WHO.includes(d.who) ? d.who : 'both', days,
    pts: clamp(Math.round(Number(d.pts)) || 1, 1, 3),
    once: typeof d.once === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.once) ? d.once : null,
    order: Number.isFinite(d.order) ? d.order : 1e6,
    createdAt: Number.isFinite(d.createdAt) ? d.createdAt : 0
  };
}
function cleanSlot(d) {
  return {
    done: d.done === true,
    by: d.by === 'a' || d.by === 'b' ? d.by : null,
    at: Number.isFinite(d.at) ? d.at : 0,
    to: Number.isInteger(d.to) && d.to >= 0 && d.to <= 6 ? d.to : null,
    who: d.who === 'a' || d.who === 'b' ? d.who : null,
    skip: d.skip === true
  };
}
function cleanPeople(d) {
  const goal = Number(d.goal);
  return {
    a: str(d.a, 14) || 'Person 1', b: str(d.b, 14) || 'Person 2',
    reward: str(d.reward, 40) || DEFAULT_REWARD,
    goal: [50, 60, 70, 80, 90, 100].includes(goal) ? goal : 80,
    aId: typeof d.aId === 'string' ? d.aId : null, bId: typeof d.bId === 'string' ? d.bId : null
  };
}
const sameSlot = (x, y) => {
  if (!x || !y) return !x && !y;
  return x.done === y.done && x.by === y.by && x.to === y.to && x.who === y.who && x.skip === y.skip;
};
const newId = () => 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
function hash32(s) {
  let x = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 0x01000193) >>> 0; }
  return x >>> 0;
}
const other = w => (w === 'a' ? 'b' : 'a');
const nameOf = w => (w === 'a' ? state.people.a : w === 'b' ? state.people.b : 'Beide');
// how a person is named in the lists: "Du" for the one holding the phone
const whoLabel = w => (w === 'both' ? 'Ihr beide' : w === state.me ? 'Du' : nameOf(w));
function initials() {
  const A = [...state.people.a.trim()], B = [...state.people.b.trim()];
  let ia = A[0] || 'A', ib = B[0] || 'B';
  if (ia.toLowerCase() === ib.toLowerCase()) { ia = A.slice(0, 2).join(''); ib = B.slice(0, 2).join(''); }
  return { a: ia.toUpperCase(), b: ib.toUpperCase() };
}
const readOnly = () => !!state.db && (state.canWrite === false || state.blocked);
const canPlay = () => !!state.db && !readOnly();
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);
// the reward as it is spoken in the nest: without pictures, and never an empty line
const rewardText = () => {
  const r = state.people.reward.replace(/[\p{Extended_Pictographic}‍️]/gu, '').replace(/\s+/g, ' ').trim();
  return r && r !== DEFAULT_REWARD ? r : '';
};

/* slot overlay: our own pending writes shadow the remote state until confirmed */
function effSlot(key) {
  const o = state.optim.get(key);
  if (o && Date.now() - o.ts < OPTIM_TTL) return o.data;
  return state.slots.get(key) || null;
}

function buildModel() {
  const W = state.weekKey;
  const ready = state.slotsKey === W;
  const origKeys = Array.from({ length: 7 }, () => []);
  const entries = [];
  for (const t of state.tasks) {
    if (!t.title || (t.once && t.once !== W)) continue;
    for (const d of t.days) { const key = W + '_' + t.id + '_' + d; entries.push({ t, d, key }); origKeys[d].push(key); }
  }
  const lucky = new Set();
  for (let d = 0; d < 7; d++) {
    const keys = origKeys[d].sort();
    if (keys.length >= 3) lucky.add(keys[hash32(W + '|' + d) % keys.length]);
  }
  const days = Array.from({ length: 7 }, () => []);
  const byKey = new Map();
  for (const { t, d, key } of entries) {
    const s = ready ? effSlot(key) : null;
    const inst = {
      key, week: W, task: t, orig: d, day: s && s.to != null ? s.to : d,
      who: s && s.who ? s.who : t.who, done: !!(s && s.done), skip: !!(s && s.skip),
      lucky: lucky.has(key), pts: t.pts, slot: s
    };
    inst.by = inst.done ? (s.by || (inst.who !== 'both' ? inst.who : null)) : null;
    inst.value = inst.pts * (inst.lucky ? 2 : 1);
    inst.helper = !!(inst.done && inst.who !== 'both' && inst.by && inst.by !== inst.who);
    inst.coins = inst.done ? inst.value + (inst.helper ? 1 : 0) : 0;
    days[inst.day].push(inst);
    byKey.set(key, inst);
  }
  let total = 0, done = 0;
  const coins = { a: 0, b: 0 };
  const stat = [];
  for (let d = 0; d < 7; d++) {
    days[d].sort((x, y) => x.task.order - y.task.order || x.task.title.localeCompare(y.task.title, 'de'));
    let n = 0, k = 0, a = false, b = false;
    for (const inst of days[d]) {
      if (inst.skip) continue;
      n++; total += inst.value;
      if (inst.done) {
        k++; done += inst.value;
        if (inst.by) { coins[inst.by] += inst.coins; if (inst.by === 'a') a = true; else b = true; }
      }
    }
    stat.push({ n, done: k, a, b });
  }
  return { days, byKey, total, done, coins, stat, ready };
}
const goalPts = m => Math.ceil(m.total * state.people.goal / 100);
const goalReached = m => m.total > 0 && m.done >= goalPts(m);

/* ---------- rendering ---------- */
function render() {
  if (drag.pend || drag.on) { state.dirty = true; return; }
  state.dirty = false;
  state.model = buildModel();
  renderBar();
  renderHead();
  renderMe();
  renderHint();
  renderNotice();
  renderBoard();
}

const numCache = new WeakMap();
function setNum(el, v) {
  const old = numCache.get(el);
  numCache.set(el, v);
  if (old === undefined || old === v || reduceMotion()) { el.textContent = String(v); return; }
  el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
  const t0 = performance.now();
  const step = now => {
    const k = Math.min(1, (now - t0) / 450);
    el.textContent = String(Math.round(old + (v - old) * k));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// the week strip: seven days, each with the pen marks that can appear around its number (see style.css)
function buildStrip() {
  const mk = (cls, size, inner) => '<svg class="mk ' + cls + '" viewBox="0 0 ' + size + ' ' + size + '" aria-hidden="true" focusable="false">' + inner + '</svg>';
  $('#strip').replaceChildren(...DAY_SHORT.map((s, i) => {
    const b = h('button', { type: 'button', class: 'dcell', dataset: { day: i, drop: 'day:' + i, p: '0' } });
    b.innerHTML = mk('ring-dash', 46, '<circle cx="23" cy="23" r="18.6"/>')
      + mk('ring-sel', 46, '<path d="' + DAY.d + '"/>')
      + mk('ring-hot', 52, '<circle cx="26" cy="26" r="19.8"/><path d="' + HOT.d + '"/>')
      + '<span class="dn">' + s + '</span><span class="dd"></span><span class="dots"></span>';
    return b;
  }));
}
function buildScore() {
  const pc = w => h('span', { class: 'pc who-' + w, dataset: { who: w } }, h('span', { class: 'pn' }), ' ', h('b', { text: '0' }));
  $('#pcs').replaceChildren(pc('a'), h('i', { class: 'sep' }), pc('b'), h('i', { class: 'sep tot-sep' }), h('span', { class: 'tot' }));
}

function renderBar() {
  const m = state.model, cur = state.offset === 0;
  $('#kw').textContent = 'Woche ' + isoWeek(state.weekStart);
  $('#range').textContent = cur ? state.todayLong : rangeText();
  $('#thisweek').hidden = cur;

  /* the nest grows with the coins that are in; it is finished when the weekly goal is reached */
  const gp = goalPts(m), reached = goalReached(m);
  const frac = m.total ? clamp(m.done / gp, 0, 1) : 0;
  const lit = $('#ring .lit');
  if (lit) { lit.style.strokeDasharray = (frac * 1000).toFixed(1) + ' 2000'; lit.classList.toggle('is-empty', frac <= 0); }
  const num = $('#hero-num'), ok = $('#hero-ok'), lbl = $('#hero-lbl');
  /* until tasks, people and this week's ticks have arrived the numbers are not real: they stay hidden, and the first real ones appear at once (no count-up from 0) */
  const settled = !state.db || (state.loaded.tasks && state.loaded.people && m.ready);
  $('#quest').classList.toggle('is-wait', !settled);
  num.hidden = reached; ok.toggleAttribute('hidden', !reached);                 // an SVG has no .hidden property: the attribute it is
  setNum(num, m.total ? Math.max(0, gp - m.done) : 0);
  if (!settled) numCache.delete(num);
  const rw = rewardText();
  const reward = t => h('span', { class: 'rw' + (t.length > 18 ? ' long' : ''), text: t });
  let lines;
  if (!m.total) lines = !state.loaded.tasks ? [] : m.days.some(d => d.length) ? ['Alles entfällt'] : ['Noch keine Aufgaben'];
  else if (reached) lines = [h('b', { text: 'Wochenziel geschafft' }), reward(rw || DEFAULT_REWARD)];
  else lines = rw ? ['Münzen bis', reward(rw)] : ['Münzen bis zur', reward('Belohnung')];
  lbl.replaceChildren(...lines);
  $('#ring').setAttribute('aria-label', m.total ? (reached ? 'Wochenziel geschafft' : 'Noch ' + plural(Math.max(0, gp - m.done), 'Münze', 'Münzen') + ' bis zur Belohnung') + ', ' + m.done + ' von ' + gp : lines[0] || '');

  /* who earned what */
  for (const row of $$('#pcs .pc')) {
    const w = row.dataset.who;
    $('.pn', row).textContent = nameOf(w);
    row.classList.toggle('is-me', state.me === w);
    row.title = nameOf(w) + ': ' + plural(m.coins[w], 'Münze', 'Münzen');
    setNum($('b', row), m.coins[w]);
    if (!settled) numCache.delete($('b', row));
  }
  const tot = $('#pcs .tot'), tsep = $('#pcs .tot-sep');
  tot.textContent = gp ? m.done + ' von ' + gp : '';
  tot.hidden = tsep.hidden = !gp;
  $('#pcs').classList.toggle('is-wait', !settled);

  /* the strip */
  $$('#strip .dcell').forEach((c, i) => {
    const date = addDays(state.weekStart, i), st = m.stat[i];
    const isToday = cur && i === state.todayIdx, isSel = i === state.sel;
    c.classList.toggle('is-today', isToday);
    c.classList.toggle('is-sel', isSel);
    c.classList.toggle('is-full', st.n > 0 && st.done === st.n);
    $('.dd', c).textContent = String(date.getDate());
    $('.dots', c).replaceChildren(...(st.a ? [h('i', { class: 'a' })] : []), ...(st.b ? [h('i', { class: 'b' })] : []));
    c.setAttribute('aria-pressed', String(isSel));
    if (isToday) c.setAttribute('aria-current', 'date'); else c.removeAttribute('aria-current');
    c.setAttribute('aria-label', DAY_LONG[i] + ' ' + date.getDate() + '. ' + MONTH_LONG[date.getMonth()] + ', ' + (st.n ? st.done + ' von ' + st.n + ' erledigt' : 'nichts geplant'));
  });
}

function renderHead() {
  const m = state.model, d = state.sel, st = m.stat[d];
  $('#lh-title').textContent = state.offset === 0 && d === state.todayIdx ? 'Heute' : DAY_LONG[d];
  let sub = '';
  if (st.n) sub = st.done === st.n ? 'Alles geschafft' : st.done + ' von ' + st.n + ' erledigt';
  else if (m.days[d].length) sub = 'Alles entfällt';
  else if (state.tasks.length) sub = 'Freier Tag';
  $('#lh-sub').textContent = sub;
}

function renderMe() {
  const box = $('#me-line');
  if (!state.db) { box.replaceChildren(); return; }
  const kids = [];
  if (state.me) {
    kids.push(h('div', { class: 'seg2', role: 'group', 'aria-label': 'Anzeige' },
      h('button', { type: 'button', dataset: { filter: 'all' }, 'aria-pressed': String(state.filter === 'all'), text: 'Alle' }),
      h('button', { type: 'button', dataset: { filter: 'mine' }, 'aria-pressed': String(state.filter === 'mine'), text: 'Meine' })));
  } else if (canPlay() && state.loaded.people) {
    kids.push(h('button', { type: 'button', class: 'who-chip', dataset: { act: 'who' }, text: 'Wer bist du?' }));
  }
  box.replaceChildren(...kids);
}

const hintSeen = () => state.hintGone || state.prefs.hint || !!store.get(LS.hint);
function renderHint() {
  const box = $('#hint');
  const show = canPlay() && state.loaded.prefs && state.tasks.length > 0 && !hintSeen();
  if (!show) { box.replaceChildren(); return; }
  box.replaceChildren(h('div', { class: 'hint' },
    h('p', null, h('b', { text: 'Antippen' }), ' = erledigt. ', h('b', { text: 'Gedrückt halten und ziehen' }), ' = auf einen anderen Tag schieben, abgeben oder streichen. Mit ×2 markierte Aufgaben zählen doppelt.'),
    h('button', { type: 'button', dataset: { act: 'hint' }, text: 'Verstanden' })));
}

function renderNotice() {
  const box = $('#notice');
  let n = null;
  if (state.unavailable) n = ['Hier lässt sich nichts speichern', 'Öffne den Plan in der Claude-App, damit ihr gemeinsam abhaken könnt.'];
  else if (state.failed === 'permission_denied' && window.__WS) n = ['Zugriff verweigert', 'Firebase lässt das Lesen nicht zu. Die Regeln im Firebase-Projekt sind vermutlich nicht (mehr) veröffentlicht. Wer den Haushalt eingerichtet hat, prüft das unter Firestore → Regeln.'];
  else if (state.failed) n = ['Verbindung unterbrochen', 'Die Daten werden nicht mehr aktualisiert. Lade die Seite neu.'];
  else if (state.offline) n = ['Offline', 'Alles bleibt gespeichert und wird gesendet, sobald du wieder online bist.'];
  else if (state.stuck && window.__WS) n = ['Noch nicht gesendet', 'Deine Änderungen sind auf diesem Handy gespeichert, kommen aber bei Firebase nicht an. Prüfe dein Internet. Sie werden weiter gesendet, sobald es klappt.'];
  else if (readOnly()) n = ['Nur ansehen', 'Du darfst hier nichts ändern. Bitte den Besitzer, dich als Editor einzuladen.'];
  else if (state.loaded.tasks && !state.tasks.length) n = ['Noch keine Aufgaben', 'Tippe oben auf +, um die erste Aufgabe anzulegen.'];
  box.replaceChildren(...(n ? [h('div', { class: 'notice', role: 'status' }, h('strong', { text: n[0] }), n[1])] : []));
}

const dotEl = w => h('i', { class: 'dot who-' + w });
const whoDots = w => (w === 'both' ? h('span', { class: 'dots2', 'aria-hidden': 'true' }, dotEl('a'), dotEl('b')) : h('span', { class: 'dots2', 'aria-hidden': 'true' }, dotEl(w)));
const iniEl = (w, ini, small) => (w === 'both'
  ? h('span', { class: 'ini-pair', 'aria-hidden': 'true' }, h('span', { class: 'ini who-a' + (small ? ' ini-s' : ''), text: ini.a }), h('span', { class: 'ini who-b' + (small ? ' ini-s' : ''), text: ini.b }))
  : h('span', { class: 'ini who-' + w + (small ? ' ini-s' : ''), 'aria-hidden': 'true', text: ini[w] }));
const coinEl = cls => ico('coin', 'coin' + (cls ? ' ' + cls : ''));
const pipsFor = n => h('span', { class: 'pips' }, Array.from({ length: n }, () => coinEl()));

function tileEl(inst, live) {
  const vis = inst.done && inst.by ? inst.by : inst.who;
  const cls = ['tile', 'who-' + vis];
  if (inst.done) cls.push('done');
  if (inst.skip) cls.push('skip');
  if (inst.lucky && !inst.skip) cls.push('lucky');
  if (state.fxKey === inst.key) { cls.push('stamp'); state.fxKey = null; }
  const status = inst.skip ? 'entfällt' : inst.done ? 'erledigt von ' + nameOf(inst.by) : 'offen';
  const label = inst.task.title + ', ' + nameOf(inst.who) + ', ' + plural(inst.value, 'Münze', 'Münzen') + (inst.lucky ? ' (doppelt)' : '') + ', ' + status;
  const chk = inst.skip ? h('span', { class: 'chk chk-skip', 'aria-hidden': 'true' })
    : inst.done ? h('span', { class: 'chk chk-done', 'aria-hidden': 'true' }, ico('check'))
      : h('span', { class: 'chk', 'aria-hidden': 'true' }, ico('loop'));
  const meta = h('span', { class: 't-meta' });
  if (inst.skip) meta.append('Entfällt · tippen zum Zurückholen');
  else {
    meta.append(whoDots(vis), h('span', { class: 'nm', text: whoLabel(vis) }));
    if (inst.lucky) meta.append(h('span', { class: 'mult', text: '×2' }));
    if (inst.helper) meta.append(h('span', { class: 'mult', text: 'Helfer +1' }));
  }
  return h('div', {
    class: cls.join(' '), role: 'button', tabindex: live ? '0' : '-1', 'aria-pressed': String(inst.done), 'aria-label': label,
    'aria-keyshortcuts': 'e', dataset: { key: inst.key }
  },
  chk,
  h('span', { class: 't-body' }, h('span', { class: 't-title', text: inst.task.title }), meta),
  !inst.done && !inst.skip ? h('span', { class: 'cpill' }, coinEl(), '+' + inst.value) : null);
}

function renderBoard() {
  const m = state.model, live = canPlay(), d = state.sel;
  const box = $('#days');
  const ae = document.activeElement;
  const focusKey = ae && ae.classList && ae.classList.contains('tile') && box.contains(ae) ? ae.dataset.key : null;
  box.classList.toggle('is-loading', !m.ready && !!state.db);
  const all = m.days[d];
  const list = all.filter(inst => state.filter !== 'mine' || !state.me || inst.who === state.me || inst.who === 'both');
  const kids = [];
  if (!state.loaded.tasks) kids.push(h('div', { class: 'free', text: 'Einen Moment …' }));
  else if (list.length) kids.push(...list.map(inst => tileEl(inst, live)));
  else if (all.length) kids.push(h('div', { class: 'free' }, h('b', { text: 'Nichts für dich' }), 'Die Aufgaben dieses Tages gehören ' + nameOf(other(state.me)) + '.'));
  else if (state.tasks.length) kids.push(h('div', { class: 'free' }, h('b', { text: 'Freier Tag' }), 'Hier ist nichts geplant.'));
  kids.push(h('button', { type: 'button', class: 'row-add add', dataset: { add: d }, 'aria-label': 'Aufgabe für ' + DAY_LONG[d] + ' hinzufügen' }, ico('plus'), 'Aufgabe hinzufügen'));
  box.replaceChildren(...kids);
  if (focusKey) {
    const el = tileByKey(focusKey);
    if (el) el.focus({ preventScroll: true });
  }
}

// a day is picked: the pen draws a circle around it (the animation is replayed by flipping data-p), the list changes to that day
function selectDay(d, byUser) {
  if (byUser) state.selAuto = d === state.todayIdx && state.offset === 0;
  state.sel = d;
  const c = $('#strip .dcell[data-day="' + d + '"]');
  if (c) c.dataset.p = c.dataset.p === '0' ? '1' : '0';
  render();
}

/* the strip sticks to the top while the list scrolls; a thin shadow tells when it does */
let stuckRaf = 0;
function updateStuck() {
  stuckRaf = 0;
  const bar = $('#bar'), sb = $('#stripbar');
  if (bar && sb) sb.classList.toggle('is-stuck', bar.getBoundingClientRect().bottom <= 1 && bar.offsetHeight > 0);
}
window.addEventListener('scroll', () => { lastScroll = performance.now(); if (!stuckRaf) stuckRaf = requestAnimationFrame(updateStuck); }, { passive: true });

/* ---------- effects ---------- */
const fxLayer = () => $('#fx');
const palette = () => (darkMode() ? CONFETTI_DARK : CONFETTI);
function burst(x, y, n, power) {
  if (reduceMotion()) return;
  const layer = fxLayer(), colors = palette();
  for (let i = 0; i < n; i++) {
    const p = h('i', { class: 'conf' + (i % 3 === 0 ? ' r' : '') });
    p.style.background = colors[i % colors.length];
    p.style.left = x + 'px'; p.style.top = y + 'px';
    layer.append(p);
    if (!p.animate) { p.remove(); continue; }
    const ang = Math.random() * Math.PI * 2, dist = (38 + Math.random() * 62) * power;
    const dx = Math.cos(ang) * dist, dy = Math.sin(ang) * dist - 26 * power;
    const rot = Math.round(Math.random() * 600 - 300);
    const a = p.animate([
      { transform: 'translate(-50%,-50%) scale(1) rotate(0deg)', opacity: 1 },
      { transform: 'translate(calc(-50% + ' + dx + 'px),calc(-50% + ' + dy + 'px)) scale(.9) rotate(' + rot / 2 + 'deg)', opacity: 1, offset: 0.65 },
      { transform: 'translate(calc(-50% + ' + dx * 1.05 + 'px),calc(-50% + ' + (dy + 46) + 'px)) scale(.5) rotate(' + rot + 'deg)', opacity: 0 }
    ], { duration: 700 + Math.random() * 380, easing: 'cubic-bezier(.2,.7,.3,1)' });
    a.onfinish = () => p.remove();
  }
}
function rain() {
  if (reduceMotion()) return;
  const layer = fxLayer(), w = window.innerWidth, colors = palette();
  for (let i = 0; i < 70; i++) {
    const p = h('i', { class: 'conf' + (i % 3 === 0 ? ' r' : '') });
    p.style.background = colors[i % colors.length];
    p.style.left = Math.random() * w + 'px'; p.style.top = '-12px';
    layer.append(p);
    if (!p.animate) { p.remove(); continue; }
    const drift = Math.random() * 120 - 60;
    const a = p.animate([
      { transform: 'translate(0,0) rotate(0deg)', opacity: 1 },
      { transform: 'translate(' + drift + 'px,' + window.innerHeight * 0.9 + 'px) rotate(' + Math.round(Math.random() * 900 - 450) + 'deg)', opacity: 1, offset: 0.85 },
      { transform: 'translate(' + drift + 'px,' + window.innerHeight + 'px) rotate(900deg)', opacity: 0 }
    ], { duration: 1500 + Math.random() * 1400, delay: Math.random() * 500, easing: 'cubic-bezier(.3,.1,.6,1)' });
    a.onfinish = () => p.remove();
  }
}
function floatText(x, y, text, withCoin) {
  const el = h('span', { class: 'float' }, text, withCoin ? coinEl() : null);
  el.style.left = x + 'px'; el.style.top = y + 'px';
  fxLayer().append(el);
  if (!el.animate || reduceMotion()) { setTimeout(() => el.remove(), 900); return; }
  const a = el.animate([
    { transform: 'translate(-50%,-30%) scale(.6)', opacity: 0 },
    { transform: 'translate(-50%,-90%) scale(1.15)', opacity: 1, offset: 0.25 },
    { transform: 'translate(-50%,-190%) scale(1)', opacity: 0 }
  ], { duration: 950, easing: 'ease-out' });
  a.onfinish = () => el.remove();
}
const centerOf = el => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
const tileByKey = key => $$('#days .tile').find(t => t.dataset.key === key) || null;

function celebrate(inst, before, after) {
  buzz(18);
  const el = tileByKey(inst.key);
  if (el) {
    const c = centerOf(el), chk = $('.chk', el), cc = chk ? centerOf(chk) : c;
    burst(cc.x, cc.y, inst.lucky ? 22 : 12, inst.lucky ? 1.3 : 1);
    const got = after.byKey.get(inst.key);
    floatText(c.x, c.y - 14, '+' + (got ? got.coins : inst.value), true);
  }
  const d = inst.day;
  if (after.stat[d].n > 0 && after.stat[d].done === after.stat[d].n && !(before.stat[d].n > 0 && before.stat[d].done === before.stat[d].n)) {
    const cell = $('#strip .dcell[data-day="' + d + '"]');
    if (cell) { const c = centerOf(cell); setTimeout(() => burst(c.x, c.y, 16, 1.1), 260); }
    announce(DAY_LONG[d] + ' geschafft');
  }
  if (goalReached(after) && !goalReached(before)) {
    buzz([20, 40, 20, 40, 60]);
    setTimeout(rain, 200);
    toast('Wochenziel geschafft! Belohnung: ' + state.people.reward);
  } else if (after.total > 0 && after.done === after.total && before.done !== before.total) {
    setTimeout(rain, 200);
    toast('Perfekte Woche – alles erledigt! 🏆');
  }
}

/* ---------- writing ---------- */
const queues = new Map();
function enqueue(key, fn) {
  const prev = queues.get(key) || Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  queues.set(key, next);
  next.catch(() => {}).then(() => { if (queues.get(key) === next) queues.delete(key); });
  return next;
}
function onWriteError(e) {
  const code = e && e.code;
  if (code === 'invalid_argument' && state.canWrite == null) { state.blocked = true; render(); return; }
  if (code === 'quota_exceeded') toast('Der Speicher ist voll. Lösche alte Aufgaben.');
  else if (code === 'resource_exhausted') toast(window.__WS ? 'Firebase nimmt gerade nichts an (Tageslimit?). Versuche es später nochmal.' : 'Zu schnell. Warte kurz und versuche es nochmal.');
  else if (code === 'permission_denied' && window.__WS) toast('Firebase lässt das Speichern nicht zu. Die Regeln im Firebase-Projekt sind wohl nicht veröffentlicht.');
  else toast('Das hat nicht geklappt. Prüfe die Verbindung.');
}
function guardWrite() {
  if (canPlay()) return true;
  if (!state.db) toast('Hier lässt sich nichts speichern. Öffne den Plan in der Claude-App.');
  else toast('Du kannst den Plan nur ansehen.');
  return false;
}
function slotDoc(inst, s) {
  const o = { week: inst.week, task: inst.task.id, day: inst.orig };
  if (s.done) { o.done = true; if (s.by) o.by = s.by; if (s.at) o.at = s.at; }
  if (s.to != null) o.to = s.to;
  if (s.who) o.who = s.who;
  if (s.skip) o.skip = true;
  return o;
}
function patchSlot(inst, patch) {
  const prev = effSlot(inst.key);
  const next = Object.assign({ done: false, by: null, at: 0, to: null, who: null, skip: false }, prev || {}, patch);
  if (next.to === inst.orig) next.to = null;
  if (next.who === inst.task.who) next.who = null;
  if (!next.done) { next.by = null; next.at = 0; }
  const empty = !next.done && next.to == null && !next.who && !next.skip;
  writeSlot(inst, empty ? null : next);
  return prev;
}
function writeSlot(inst, data) {
  const key = inst.key, db = state.db;
  state.optim.set(key, { data, ts: Date.now() });
  setTimeout(() => { const o = state.optim.get(key); if (o && Date.now() - o.ts >= OPTIM_TTL) { state.optim.delete(key); render(); } }, OPTIM_TTL + 50);
  render();
  enqueue('slots/' + key, () => (data ? db.doc('slots/' + key).set(slotDoc(inst, data)) : db.doc('slots/' + key).delete()))
    .catch(e => { state.optim.delete(key); render(); onWriteError(e); });
}
function restoreSlot(inst, prev) { writeSlot(inst, prev); }

function toggleDone(inst) {
  if (!guardWrite() || !state.model.ready) return;
  if (!state.me) { openWho(); return; }
  if (inst.skip) { patchSlot(inst, { skip: false }); announce(inst.task.title + ' zurückgeholt'); return; }
  const before = state.model;
  if (!inst.done) {
    state.fxKey = inst.key;
    patchSlot(inst, { done: true, by: state.me, at: Date.now() });
    celebrate(inst, before, state.model);
    announce(inst.task.title + ' erledigt');
  } else {
    patchSlot(inst, { done: false });
    announce(inst.task.title + ' wieder offen');
  }
}
function moveTile(inst, day) {
  const prev = patchSlot(inst, { to: day });
  buzz(14);
  toast(inst.task.title + ' ist jetzt am ' + DAY_LONG[day], { undo: () => restoreSlot(inst, prev) });
}
function handOver(inst, who) {
  const prev = patchSlot(inst, { who });
  buzz(14);
  toast(inst.task.title + ' gehört jetzt ' + nameOf(who), { undo: () => restoreSlot(inst, prev) });
}
function skipTile(inst) {
  const prev = patchSlot(inst, { skip: true });
  buzz(14);
  toast(inst.task.title + ' entfällt', { undo: () => restoreSlot(inst, prev) });
}

/* ---------- drag & drop: a task is lifted and carried to a day in the strip, or to one of the three zones at the bottom.
   Both stay in reach while the list scrolls (the strip sticks to the top, the dock is fixed), so the page never scrolls by itself. ---------- */
function setupDock(inst) {
  const ini = initials();
  $$('#dock .zone').forEach(z => {
    const k = z.dataset.drop, sub = $('.zs', z);
    if (k.startsWith('who:')) {
      const w = k.slice(4);
      $('[data-z="badge"]', z).textContent = ini[w];
      $('[data-z="name"]', z).textContent = nameOf(w);
      z.classList.toggle('off', inst.done || inst.who === w);
      sub.textContent = inst.done ? 'erledigt' : inst.who === w ? 'schon zugeteilt' : 'Abgeben';
    } else {
      z.classList.toggle('off', inst.done);
      sub.textContent = inst.done ? 'erledigt' : 'diese Woche';
    }
    z.classList.remove('drop-hot');
  });
}
function targetAt(x, y) {
  const el = document.elementFromPoint(x, y);
  const t = el && el.closest ? el.closest('[data-drop]') : null;
  if (!t) return null;
  const inst = drag.on.inst, kind = t.dataset.drop;
  if (kind.startsWith('day:')) { const d = Number(kind.slice(4)); return d === inst.day ? null : { el: t, kind: 'day', day: d }; }
  if (t.classList.contains('off')) return null;
  if (kind === 'skip') return { el: t, kind: 'skip' };
  if (kind.startsWith('who:')) return { el: t, kind: 'who', who: kind.slice(4) };
  return null;
}
function setHot(t) {
  const d = drag.on;
  if (d.hot === (t && t.el)) return;
  if (d.hot) d.hot.classList.remove('drop-hot');
  d.hot = t ? t.el : null;
  d.hotKind = t ? (t.kind === 'day' ? 'day' : 'zone') : null;
  if (t) { t.el.classList.add('drop-hot'); buzz(6); }
}
// The carried task follows the finger. Over a day it hovers just under the strip (so the circle that is drawn around that
// day stays visible); over a zone at the bottom it shrinks.
function placeGhost(d) {
  const lift = d.type === 'touch' ? 30 : 0;
  let cx = d.x, cy = d.y - lift, rot = -2.5, sc = 1.03;
  if (d.hotKind === 'day') {
    const sb = $('#stripbar').getBoundingClientRect();
    cy = sb.bottom + 12 + d.h / 2; rot = -3; sc = 1;
  } else if (d.hotKind === 'zone') { rot = 0; sc = 0.6; }
  cx = clamp(cx, d.w / 2 + 8, Math.max(d.w / 2 + 8, window.innerWidth - d.w / 2 - 8));
  d.ghost.style.transform = 'translate3d(' + Math.round(cx - d.w / 2) + 'px,' + Math.round(cy - d.h / 2) + 'px,0) rotate(' + rot + 'deg) scale(' + sc + ')';
  d.hy = d.y - lift;
}
function loop() {
  const d = drag.on;
  if (!d) return;
  if (performance.now() - d.t0 > 60000) { cleanupDrag(); return; }
  placeGhost(d);
  setHot(targetAt(d.x, d.hy));
  d.raf = requestAnimationFrame(loop);
}
function lift() {
  const p = drag.pend;
  if (!p) return;
  clearTimeout(p.timer);
  const ghost = p.tile.cloneNode(true);
  ghost.classList.remove('pressing', 'stamp'); ghost.classList.add('ghost');
  ghost.removeAttribute('tabindex'); ghost.removeAttribute('role'); ghost.removeAttribute('data-key'); ghost.setAttribute('aria-hidden', 'true');
  document.body.append(ghost);
  const gr = ghost.getBoundingClientRect();
  drag.on = Object.assign({}, p, { ghost, w: gr.width, h: gr.height, hot: null, hotKind: null, raf: 0, hy: p.y });
  drag.pend = null;
  p.tile.classList.remove('pressing');
  p.tile.classList.add('lifted');
  document.body.classList.add('dragging');
  $('#dock').setAttribute('aria-hidden', 'false');
  setupDock(p.inst);
  hideToast();
  buzz(14);
  placeGhost(drag.on);
  drag.on.raf = requestAnimationFrame(loop);
}
function endGestures() {
  window.removeEventListener('pointermove', onPointerMove);
  window.removeEventListener('pointerup', onPointerUp);
  window.removeEventListener('pointercancel', onPointerCancel);
}
function cleanupDrag() {
  const d = drag.on;
  if (d) {
    cancelAnimationFrame(d.raf);
    if (d.hot) d.hot.classList.remove('drop-hot');
    d.ghost.remove();
    d.tile.classList.remove('lifted');
  }
  if (drag.pend) { clearTimeout(drag.pend.timer); drag.pend.tile.classList.remove('pressing'); }
  drag.on = null; drag.pend = null;
  document.body.classList.remove('dragging');
  $('#dock').setAttribute('aria-hidden', 'true');
  endGestures();
  if (state.dirty) render();
}
// Some phones still send a click to the spot where a long press ended. If that press has just opened the editor, the click
// would land in the sheet (on a button under the finger), so for a moment the clicks near that spot are dropped.
function swallowClickAt(x, y) {
  const until = performance.now() + 600;
  const off = () => document.removeEventListener('click', swallow, true);
  const swallow = ev => {
    if (performance.now() > until) { off(); return; }
    if (Math.hypot(ev.clientX - x, ev.clientY - y) < 48) { ev.preventDefault(); ev.stopPropagation(); }
  };
  document.addEventListener('click', swallow, true);
  setTimeout(off, 650);
}
function onPointerDown(e) {
  if (drag.pend || drag.on || state.modalOpen) return;
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  const tile = e.target.closest ? e.target.closest('.tile') : null;
  if (!tile || !canPlay() || !state.model || !state.model.ready) return;       // until this week's ticks are in, a tap could overwrite one
  const inst = state.model.byKey.get(tile.dataset.key);
  if (!inst) return;
  drag.lastType = e.pointerType;
  const touch = e.pointerType === 'touch';
  drag.pend = { id: e.pointerId, type: touch ? 'touch' : 'mouse', x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, tile, inst, key: inst.key, t0: performance.now(), timer: 0,
    stopsScroll: touch && performance.now() - lastScroll < 110 };   /* a touch that only stops a fling is not a tap */
  if (touch && !inst.skip) drag.pend.timer = setTimeout(lift, LONG_PRESS);
  if (!inst.skip) tile.classList.add('pressing');
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerCancel);
}
function onPointerMove(e) {
  const p = drag.on || drag.pend;
  if (!p || e.pointerId !== p.id) return;
  if (e.pointerType === 'mouse' && e.buttons === 0) { cleanupDrag(); return; }       // the button was let go outside the window
  p.x = e.clientX; p.y = e.clientY;
  if (drag.on) return;
  const dist = Math.hypot(p.x - p.x0, p.y - p.y0);
  if (p.type === 'touch') { if (dist > TOUCH_SLOP) cleanupDrag(); }
  else if (dist > MOUSE_SLOP && !p.inst.skip) lift();
}
function onPointerCancel(e) {
  const p = drag.on || drag.pend;
  if (!p || e.pointerId !== p.id) return;
  cleanupDrag();
}
function onPointerUp(e) {
  const p = drag.on || drag.pend;
  if (!p || e.pointerId !== p.id) return;
  p.x = e.clientX; p.y = e.clientY;
  if (drag.on) {
    const d = drag.on, t = targetAt(d.x, d.hy), moved = Math.hypot(d.x - d.x0, d.y - d.y0);
    const inst = d.inst;
    cleanupDrag();
    if (t) {
      if (t.kind === 'day') moveTile(inst, t.day);
      else if (t.kind === 'who') handOver(inst, t.who);
      else if (t.kind === 'skip') skipTile(inst);
    } else if (d.type === 'touch' && moved < 12) { swallowClickAt(d.x, d.y); openEditor({ id: inst.task.id }); }
    return;
  }
  const inst = p.inst, dist = Math.hypot(p.x - p.x0, p.y - p.y0);
  cleanupDrag();
  if (!p.stopsScroll && dist <= (p.type === 'touch' ? TOUCH_SLOP : MOUSE_SLOP)) toggleDone(inst);
}
window.addEventListener('touchmove', e => { if (drag.on && e.cancelable) e.preventDefault(); }, { passive: false });
document.addEventListener('contextmenu', e => {
  if (!e.target.closest || !e.target.closest('.tile')) return;
  e.preventDefault();
  if (drag.lastType === 'mouse' && !drag.on && !drag.pend && canPlay()) {
    const t = e.target.closest('.tile'), inst = state.model.byKey.get(t.dataset.key);
    if (inst) openEditor({ id: inst.task.id });
  }
});
window.addEventListener('blur', () => { if (drag.on || drag.pend) cleanupDrag(); });

/* ---------- sheets ---------- */
function openModal(o) {
  const m = $('#modal');
  state.modalOpen = true; state.lastFocus = document.activeElement;
  document.documentElement.classList.add('modal-open');
  m.replaceChildren(
    h('div', { class: 'modal-bar straw' },
      h('button', { type: 'button', class: 'cancel', onclick: closeModal, text: o.cancelLabel || 'Abbrechen' }),
      h('h3', { text: o.title }),
      o.onSave ? h('button', { type: 'button', class: 'save', onclick: o.onSave, text: o.saveLabel || 'Speichern' }) : h('span')),
    h('div', { class: 'modal-body' }, h('div', { class: 'wrap' }, o.body)));
  m.setAttribute('aria-label', o.title);
  m.hidden = false;
  lock('modal');
  if (!m.contains(document.activeElement)) m.focus({ preventScroll: true });
}
function closeModal() {
  const m = $('#modal');
  m.hidden = true; m.replaceChildren();
  state.modalOpen = false;
  unlock('modal');
  document.documentElement.classList.remove('modal-open');
  const f = state.lastFocus;
  state.lastFocus = null;
  if (f && f.isConnected && f.focus) { try { f.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
  if (state.dirty) render();
}
function showErr(el, msg) { el.textContent = msg; el.hidden = false; }

/* a task: new, or changed for all weeks */
function openEditor(opts) {
  if (!guardWrite()) return;
  const ex = opts.id ? state.tasks.find(t => t.id === opts.id) : null;
  if (opts.id && !ex) return;
  const f = ex
    ? { title: ex.title, who: ex.who, days: ex.days.slice(), pts: ex.pts, repeat: ex.once ? 'once' : 'weekly' }
    : { title: '', who: state.me || 'both', days: opts.day != null ? [opts.day] : [], pts: 1, repeat: 'weekly' };
  const ini = initials();
  const title = h('input', { type: 'text', id: 'f-title', maxlength: '40', autocomplete: 'off', autocapitalize: 'sentences', placeholder: 'z. B. Kita-Tasche packen', value: f.title });
  const err = h('p', { class: 'err', role: 'alert', hidden: true });
  const whoBox = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Wer' });
  const ptsBox = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Aufwand' });
  const dayBox = h('div', { class: 'chips', role: 'group', 'aria-label': 'Tage' });
  const repBox = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Wiederholung' });
  let saving = false, armed = false, armTimer = 0, armedAt = 0;

  function sync() {
    whoBox.replaceChildren(...['a', 'b', 'both'].map(w => h('button', { type: 'button', role: 'radio', class: 'opt who-' + w, 'aria-checked': String(f.who === w), onclick: () => { f.who = w; sync(); } },
      iniEl(w, ini, true), h('span', { class: 'on-name', text: w === 'both' ? 'Beide' : nameOf(w) }))));
    ptsBox.replaceChildren(...[[1, 'Leicht'], [2, 'Mittel'], [3, 'Schwer']].map(([n, label]) => h('button', { type: 'button', role: 'radio', class: 'opt pts', 'aria-checked': String(f.pts === n), onclick: () => { f.pts = n; sync(); } },
      pipsFor(n), h('span', { text: label }))));
    dayBox.replaceChildren(...DAY_SHORT.map((s, i) => h('button', { type: 'button', class: 'chip', 'aria-pressed': String(f.days.includes(i)), 'aria-label': DAY_LONG[i], text: s,
      onclick: () => { f.days = f.days.includes(i) ? f.days.filter(x => x !== i) : f.days.concat(i).sort((x, y) => x - y); sync(); } })));
    if (!ex || ex.once) {
      repBox.replaceChildren(...[['weekly', 'Jede Woche'], ['once', 'Nur Woche ' + isoWeek(state.weekStart)]].map(([k, label]) => h('button', { type: 'button', role: 'radio', class: 'opt', 'aria-checked': String(f.repeat === k), onclick: () => { f.repeat = k; sync(); } }, h('span', { text: label }))));
    }
  }

  async function save() {
    if (saving) return;
    const t = title.value.trim();
    if (!t) { showErr(err, 'Gib der Aufgabe einen Namen.'); title.focus(); return; }
    if (!f.days.length) { showErr(err, 'Wähle mindestens einen Tag.'); return; }
    saving = true;
    const id = ex ? ex.id : newId();
    const data = {
      title: t, emoji: ex ? ex.emoji : '✨', who: f.who, days: f.days, pts: f.pts,
      order: ex ? ex.order : Math.max(0, ...state.tasks.map(x => (x.order < 1e6 ? x.order : 0))) + 10,
      createdAt: ex && ex.createdAt ? ex.createdAt : Date.now()
    };
    if (f.repeat === 'once') data.once = ex && ex.once ? ex.once : state.weekKey;
    try {
      await enqueue('tasks/' + id, () => state.db.doc('tasks/' + id).set(data));
      closeModal();
      toast(ex ? 'Gespeichert' : 'Aufgabe angelegt');
    } catch (e) { saving = false; onWriteError(e); }
  }
  async function remove() {
    if (saving) return;
    if (!armed) {
      armed = true; armedAt = Date.now(); delBtn.classList.add('is-armed'); delBtn.textContent = 'Wirklich löschen?';
      clearTimeout(armTimer);
      armTimer = setTimeout(() => { armed = false; delBtn.classList.remove('is-armed'); delBtn.textContent = 'Aufgabe löschen'; }, 3500);
      return;
    }
    if (Date.now() - armedAt < 400) return;                                   // the same double tap
    saving = true;
    try { await enqueue('tasks/' + ex.id, () => state.db.doc('tasks/' + ex.id).delete()); closeModal(); toast('Aufgabe gelöscht'); }
    catch (e) { saving = false; onWriteError(e); }
  }
  const delBtn = ex ? h('button', { type: 'button', class: 'del', onclick: remove, text: 'Aufgabe löschen' }) : null;
  title.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); save(); } });

  openModal({
    title: ex ? 'Bearbeiten' : 'Neue Aufgabe', onSave: save,
    body: [
      h('div', { class: 'field' }, h('label', { class: 'lab', for: 'f-title', text: 'Was ist zu tun?' }), title),
      h('div', { class: 'field' }, h('div', { class: 'lab', text: 'Wer?' }), whoBox),
      h('div', { class: 'field' }, h('div', { class: 'lab' }, h('span', { text: 'Wie viel Aufwand?' }), h('small', { text: 'Münzen fürs Team' })), ptsBox),
      h('div', { class: 'field' },
        h('div', { class: 'lab' }, h('span', { text: 'An welchen Tagen?' }),
          h('span', { class: 'quick' },
            h('button', { type: 'button', text: 'Mo–Fr', onclick: () => { f.days = [0, 1, 2, 3, 4]; sync(); } }),
            h('button', { type: 'button', text: 'Jeden Tag', onclick: () => { f.days = [0, 1, 2, 3, 4, 5, 6]; sync(); } }))),
        dayBox),
      !ex || ex.once ? h('div', { class: 'field' }, h('div', { class: 'lab', text: 'Wie oft?' }), repBox) : h('p', { class: 'note', text: 'Änderungen gelten für alle Wochen. Einzelne Aufgaben verschiebst du direkt im Plan.' }),
      err, delBtn
    ]
  });
  sync();
  if (!ex) title.focus();
}

/* the "Ich" tab: who am I, names, reward, goal; below that the connection of this phone */
function openSettings() {
  if (!guardWrite()) return;
  const p = state.people;
  const ia = h('input', { type: 'text', id: 'n-a', maxlength: '14', autocomplete: 'off', value: p.a });
  const ib = h('input', { type: 'text', id: 'n-b', maxlength: '14', autocomplete: 'off', value: p.b });
  const ir = h('input', { type: 'text', id: 'n-r', maxlength: '40', autocomplete: 'off', value: p.reward, placeholder: 'z. B. Pizza-Abend' });
  const err = h('p', { class: 'err', role: 'alert', hidden: true });
  const goalBox = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Teamziel' });
  const meBox = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Du spielst als' });
  const ini = initials();
  let goal = p.goal, saving = false;
  function sync() {
    goalBox.replaceChildren(...[60, 70, 80, 90].map(g => h('button', { type: 'button', role: 'radio', class: 'opt', 'aria-checked': String(goal === g), onclick: () => { goal = g; sync(); } }, h('span', { text: g + ' %' }))));
    meBox.replaceChildren(...['a', 'b'].map(w => h('button', { type: 'button', role: 'radio', class: 'opt who-' + w, 'aria-checked': String(state.me === w), onclick: () => { setMe(w); sync(); } },
      iniEl(w, ini, true), h('span', { class: 'on-name', text: nameOf(w) }))));
  }
  async function save() {
    if (saving) return;
    const a = ia.value.trim(), b = ib.value.trim(), r = ir.value.trim();
    if (!a || !b) { showErr(err, 'Bitte gib beiden Personen einen Namen.'); return; }
    saving = true;
    const doc = { a, b, reward: r || DEFAULT_REWARD, goal };
    const cur = state.people;                                                  // not the copy from opening the sheet: "Du spielst als" may have changed since
    if (cur.aId) doc.aId = cur.aId;
    if (cur.bId) doc.bId = cur.bId;
    try { await enqueue('settings/people', () => state.db.doc('settings/people').set(doc)); closeModal(); toast('Gespeichert'); }
    catch (e) { saving = false; onWriteError(e); }
  }
  openModal({
    title: 'Einstellungen', onSave: save,
    body: [
      h('div', { class: 'field' }, h('div', { class: 'lab', text: 'Du spielst als' }), meBox),
      h('div', { class: 'field' }, h('label', { class: 'lab start', for: 'n-a' }, h('span', { class: 'ini ini-s who-a', text: ini.a }), h('span', { text: 'Name (Blau)' })), ia),
      h('div', { class: 'field' }, h('label', { class: 'lab start', for: 'n-b' }, h('span', { class: 'ini ini-s who-b', text: ini.b }), h('span', { text: 'Name (Rot)' })), ib),
      h('div', { class: 'field' }, h('label', { class: 'lab', for: 'n-r', text: 'Belohnung, wenn ihr das Ziel schafft' }), ir),
      h('div', { class: 'field' }, h('div', { class: 'lab' }, h('span', { text: 'Teamziel' }), h('small', { text: 'Anteil aller Münzen der Woche' })), goalBox),
      err,
      h('div', { class: 'howto' },
        h('h4', { text: 'So zählt’s' }),
        h('ul', null,
          h('li', { text: 'Jede Aufgabe bringt 1 bis 3 Münzen, je nach Aufwand.' }),
          h('li', { text: 'Pro Tag zählt eine Aufgabe doppelt (×2).' }),
          h('li', { text: 'Wer eine Aufgabe der anderen Person erledigt, bekommt +1 Münze Helfer-Bonus.' }),
          h('li', { text: 'Das Nest ist fertig, wenn ihr das Teamziel erreicht. Dann gibt es die Belohnung.' }))),
      window.__WS && window.__WS.settingsBlock ? window.__WS.settingsBlock() : null
    ]
  });
  sync();
}

/* who are you */
function openWho() {
  if (!state.db || readOnly()) return;
  const ini = initials();
  const pick = w => h('button', { type: 'button', class: 'pick who-' + w, onclick: () => chooseMe(w) }, h('span', { class: 'ini', 'aria-hidden': 'true', text: ini[w] }), h('span', { text: nameOf(w) }));
  openModal({
    title: 'Spielerwahl', cancelLabel: 'Später',
    body: h('div', { class: 'who-q' },
      h('h3', { text: 'Wer spielt hier?' }),
      h('p', { text: 'Dein Handy merkt sich das. Deine Münzen landen bei dir.' }),
      pick('a'), pick('b'))
  });
}
function setMe(w) {
  state.manualMe = w; state.me = w;
  store.set(LS.me, w);
  render();
  if (state.db && state.uid && canPlay()) {
    const p = state.people, doc = { a: p.a, b: p.b, reward: p.reward, goal: p.goal };
    if (p.aId) doc.aId = p.aId;
    if (p.bId) doc.bId = p.bId;
    doc[w + 'Id'] = state.uid;
    if (doc[other(w) + 'Id'] === state.uid) delete doc[other(w) + 'Id'];
    state.people = Object.assign({}, p, { aId: doc.aId || null, bId: doc.bId || null });
    enqueue('settings/people', () => state.db.doc('settings/people').set(doc)).catch(() => { /* the choice still works on this device */ });
  }
}
function chooseMe(w) { closeModal(); setMe(w); }
function resolveMe() {
  const p = state.people;
  let me = state.manualMe;
  if (!me && state.uid) { if (p.aId === state.uid) me = 'a'; else if (p.bId === state.uid) me = 'b'; }
  if (!me) { const l = store.get(LS.me); if (l === 'a' || l === 'b') me = l; }
  state.me = me || null;
}

/* ---------- live data ---------- */
function onDbError(e) { state.failed = (e && e.code) || true; render(); }
function subscribeSlots() {
  if (!state.db) return;
  if (state.unsubSlots) { state.unsubSlots(); state.unsubSlots = null; }
  const key = state.weekKey;
  state.slotsKey = '';
  state.unsubSlots = state.db.collection('slots').where('week', '==', key).onSnapshot(snap => {
    if (key !== state.weekKey) return;
    const next = new Map();
    for (const d of snap.docs) next.set(d.id, cleanSlot(d.data() || {}));
    state.slots = next; state.slotsKey = key;
    for (const [k, o] of Array.from(state.optim)) if (sameSlot(next.get(k) || null, o.data)) state.optim.delete(k);
    render();
  }, onDbError);
}
function maybeAskWho() {
  if (state.prompted || !state.loaded.people || !state.loaded.tasks) return;
  if (state.me || !canPlay()) return;
  state.prompted = true;
  openWho();
}
async function init() {
  let db = null;
  try { db = window.claude && window.claude.use ? await window.claude.use('db') : null; } catch (e) { db = null; }
  if (!db) { state.unavailable = true; state.loaded.tasks = true; state.loaded.people = true; state.loaded.prefs = true; render(); return; }
  state.db = db;
  try {
    const user = await window.claude.use('user');
    if (user) {
      state.canWrite = await user.can('data.write');
      state.uid = await user.id();
    }
  } catch (e) { /* unknown: a refused write decides */ }
  if (state.uid) {
    try {
      state.prefsRef = db.doc('data/users/' + state.uid + '/prefs');
      state.prefsRef.onSnapshot(snap => {
        const d = snap.exists ? (snap.data() || {}) : {};
        state.prefs = { hint: d.hint === true };
        state.loaded.prefs = true; render();
      }, () => { state.loaded.prefs = true; render(); });
    } catch (e) { state.prefsRef = null; state.loaded.prefs = true; }
  } else state.loaded.prefs = true;
  db.collection('tasks').onSnapshot(snap => {
    state.tasks = snap.docs.map(d => cleanTask(d.id, d.data() || {}));
    state.loaded.tasks = true; render(); maybeAskWho();
  }, onDbError);
  db.doc('settings/people').onSnapshot(snap => {
    state.people = cleanPeople(snap.exists ? (snap.data() || {}) : {});
    state.loaded.people = true; resolveMe(); render(); maybeAskWho();
  }, onDbError);
  subscribeSlots();
  render();
}

/* ---------- events ---------- */
function goWeek(offset) {
  state.offset = offset;
  computeWeek(); subscribeSlots(); render();
}
$('#prev').addEventListener('click', () => goWeek(state.offset - 1));
$('#next').addEventListener('click', () => goWeek(state.offset + 1));
$('#thisweek').addEventListener('click', () => { state.selAuto = true; goWeek(0); });
$('#add-top').addEventListener('click', () => openEditor({ day: state.sel }));
$('#strip').addEventListener('click', e => {
  const c = e.target.closest('.dcell');
  if (c) selectDay(Number(c.dataset.day), true);
});
$('#open-settings').addEventListener('click', openSettings);
$('#me-line').addEventListener('click', e => {
  const f = e.target.closest('[data-filter]');
  if (f) { state.filter = f.dataset.filter; store.set(LS.filter, state.filter); render(); return; }
  if (e.target.closest('[data-act="who"]')) openWho();
});
$('#hint').addEventListener('click', e => {
  if (e.target.closest('[data-act="hint"]')) {
    state.hintGone = true; store.set(LS.hint, '1'); render();
    if (state.prefsRef) state.prefsRef.set({ hint: true }).catch(() => { /* a private preference, not worth a message */ });
  }
});
const board = $('#days');
board.addEventListener('pointerdown', onPointerDown);
board.addEventListener('click', e => {
  const add = e.target.closest('.add');
  if (add) { openEditor({ day: Number(add.dataset.add) }); return; }
  const tile = e.target.closest('.tile');
  if (tile && e.detail === 0 && canPlay()) {          /* keyboard / assistive tech activation */
    const inst = state.model.byKey.get(tile.dataset.key);
    if (inst) toggleDone(inst);
  }
});
board.addEventListener('keydown', e => {
  const tile = e.target.closest ? e.target.closest('.tile') : null;
  if (!tile || !canPlay() || state.modalOpen) return;
  const inst = state.model.byKey.get(tile.dataset.key);
  if (!inst) return;
  if (e.key === 'e' || e.key === 'E') { e.preventDefault(); openEditor({ id: inst.task.id }); }
  else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (!e.repeat) toggleDone(inst); }
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && state.modalOpen) closeModal(); });
if (window.__WS) {                                   /* standalone build: own Firebase backend, may be offline */
  window.addEventListener('ws:writeerror', ev => { state.optim.clear(); render(); onWriteError(ev.detail); });
  window.addEventListener('ws:unsent', ev => { state.stuck = !!(ev.detail && ev.detail.stuck); render(); });
  const syncNet = () => { const off = navigator.onLine === false; if (off !== state.offline) { state.offline = off; render(); } };
  window.addEventListener('online', syncNet);
  window.addEventListener('offline', syncNet);
  state.offline = navigator.onLine === false;
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { if (drag.on || drag.pend) cleanupDrag(); return; }
  const before = state.weekKey;
  computeWeek();
  if (state.weekKey !== before) subscribeSlots();
  render();
});

/* ---------- start ---------- */
try {
  const f = store.get(LS.filter);
  if (f === 'mine' || f === 'all') state.filter = f;
} catch (e) { /* ignore */ }
computeWeek();
buildStrip();
buildScore();
render();
init();
updateStuck();
