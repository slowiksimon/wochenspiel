// The "Putzen" screen: every room of the house by floor, and for each room its jobs (Saugen, Wischen, …). A job shows when it
// was last done, and its colour drains like straw from a full field to an empty one as its rhythm runs out; overdue jobs turn
// dark. One tap on a job: done today (with "Rückgängig"). The room's sheet sets the rhythms, adds or removes jobs and enters
// earlier dates. On top: the most urgent job, with one tap to tick it off. Data and rules: putz-core.js.
import * as P from './putz-core.js';
import { h, $, ico } from './dom.js';
import { toast } from './toast.js';
import { nestSvg } from './nest.js';
import { setBadge } from './nav.js';
import { openSheet, closeSheet, sheetBar, armable } from './sheet.js';
import { watchSettings, docData } from './hub.js';

const tick = () => { try { if (navigator.vibrate) navigator.vibrate(8); } catch (e) { /* not supported */ } };
const S = {
  db: null, uid: null, loaded: false, failed: false, offline: navigator.onLine === false, stuck: false,
  rooms: P.defaultRooms(), stored: false, done: new Map(), people: { a: '', b: '', aId: null, bId: null }, stamp: null
};
const personName = w => (w === 'a' ? S.people.a || 'Person 1' : w === 'b' ? S.people.b || 'Person 2' : '');
// who this phone belongs to: the same rule as the game and the lists
function me() {
  const p = S.people;
  if (S.uid && p.aId === S.uid) return 'a';
  if (S.uid && p.bId === S.uid) return 'b';
  try { const l = localStorage.getItem('wp2.me'); if (l === 'a' || l === 'b') return l; } catch (e) { /* blocked */ }
  return null;
}

/* ---------- writing ---------- */
const failed = () => toast('Das konnte nicht gespeichert werden. Prüfe dein Internet und versuche es noch einmal.');
const send = p => { Promise.resolve(p).catch(failed); };
function putDone(roomId, key, rec) {
  if (!S.db) return;
  const ref = S.db.doc('settings/' + P.doneId(roomId, key));
  send(rec ? ref.set(rec) : ref.delete());
}
function putRooms(rooms) { if (S.db) send(S.db.doc('settings/putz').set(P.roomsDoc(rooms))); }

// a job done today; "Rückgängig" puts back exactly what was there before
function markDone(it) {
  tick();
  const key = it.room.id + '-' + it.job.k, prev = S.done.get(key) || null;
  S.stamp = key;
  putDone(it.room.id, it.job.k, P.doneRecord(prev, Date.now(), me()));
  toast(it.room.n + ': ' + P.jobName(it.job) + ' erledigt', { undo: () => putDone(it.room.id, it.job.k, prev) });
}

/* ---------- the screen ---------- */
const el = {};
function build() {
  const screen = $('#screen-putz');
  if (!screen || el.built) return !!el.built;
  el.built = true;
  const deco = document.createElement('template'); deco.innerHTML = nestSvg('hero-deco');
  el.cap = h('p', { class: 'cap', id: 'pz-cap' });
  el.next = h('div', { class: 'pz-next', id: 'pz-next' });
  el.status = h('p', { class: 'li-status', id: 'pz-status', role: 'status', hidden: true });
  el.list = h('div', { class: 'pz-list', id: 'pz-list' });
  screen.append(
    h('header', { class: 'hero hero-list hero-putz straw' }, deco.content.firstElementChild,
      h('div', { class: 'hero-in' },
        h('div', { class: 'head' },
          h('div', { class: 'cap-row' }, el.cap),
          h('div', { class: 'ttl-row' }, h('h1', { class: 'ttl', text: 'Putzen' })),
          h('div', { class: 'head-btns' }, h('button', { type: 'button', class: 'plus-btn', id: 'pz-add', 'aria-label': 'Raum hinzufügen', onclick: () => roomSheet(null) }, ico('plus')))),
        el.next)),
    h('div', { class: 'li-wrap pz-wrap' }, el.status, el.list));
  return true;
}

function render() {
  if (!build()) return;
  const now = new Date();
  const ov = P.overview(S.rooms, S.done, now);
  paintHero(ov, now);
  paintStatus();
  keepFocus(() => paintList(ov));
  setBadge('putz', S.loaded ? ov.due.length : 0);
  const tab = $('#open-putz');
  if (tab) tab.setAttribute('aria-label', 'Putzen' + (S.loaded && ov.due.length ? ', ' + ov.due.length + ' fällig' : ''));
  if (S.stamp) { const k = S.stamp; S.stamp = null; setTimeout(() => { const c = el.list.querySelector('[data-key="' + k + '"]'); if (c) c.classList.remove('stamp'); }, 1200); }
}

function lastText(it, long) {
  if (!it.rec) return 'noch nie';
  return P.sinceText(it.st.since, !long) + (long && it.rec.by ? ', ' + personName(it.rec.by) : '');
}

function paintHero(ov) {
  el.cap.textContent = !S.loaded ? '' : ov.due.length ? ov.due.length + ' fällig' : ov.recorded ? 'Alles erledigt' : 'Noch nichts eingetragen';
  if (!S.loaded) { el.next.replaceChildren(); return; }
  const top = ov.due[0];
  if (top) {
    el.next.replaceChildren(
      h('p', { class: 'pz-big', text: top.room.n }),
      h('p', { class: 'pz-what', text: P.jobName(top.job) + ', ' + P.dueText(top.st) }),
      h('p', { class: 'pz-last', text: 'Zuletzt ' + lastText(top, true) }),
      h('div', { class: 'pz-acts' },
        h('button', { type: 'button', class: 'pillbtn pz-done', id: 'pz-top-done', onclick: () => markDone(top) }, ico('check'), 'Erledigt'),
        ov.due.length > 1 ? h('span', { class: 'pz-more', text: 'und ' + (ov.due.length - 1) + ' weitere' }) : null));
  } else if (!ov.recorded) {
    el.next.replaceChildren(
      h('p', { class: 'pz-big', text: 'Wann war was?' }),
      h('p', { class: 'pz-what soft', text: 'Tippt unten auf eine Arbeit, wenn sie erledigt ist. Frühere Termine tragt ihr im Raum nach.' }));
  } else {
    const n = ov.next;
    el.next.replaceChildren(
      h('p', { class: 'pz-big', text: 'Alles sauber' }),
      h('p', { class: 'pz-what soft', text: n ? 'Als Nächstes ' + n.room.n + ': ' + P.jobName(n.job) + ', ' + P.dueText(n.st) : 'Nichts ist fällig.' }));
  }
}

function paintStatus() {
  const m = S.failed ? 'Die Putzübersicht kann gerade nicht geladen werden. Prüfe dein Internet.'
    : S.stuck ? 'Noch nicht gesendet: Der Server antwortet gerade nicht. Eure Änderungen bleiben auf diesem Handy und werden nachgeschickt.'
      : S.offline ? 'Du bist offline. Änderungen werden gesendet, sobald du wieder Netz hast.' : '';
  el.status.textContent = m; el.status.hidden = !m;
}

function chip(it) {
  const key = it.room.id + '-' + it.job.k, st = it.st;
  const label = it.room.n + ': ' + (P.JOBS[it.job.k] ? P.JOBS[it.job.k].long : it.job.n) + ', '
    + (it.rec ? 'zuletzt ' + P.sinceText(st.since) + (it.rec.by ? ' von ' + personName(it.rec.by) : '') + ', ' + P.dueText(st) : 'noch nie erledigt')
    + '. Antippen: heute erledigt';
  const b = h('button', { type: 'button', class: 'pz-chip is-' + st.state + (S.stamp === key ? ' stamp' : ''), dataset: { key, job: it.job.k }, 'aria-label': label, onclick: () => markDone(it) },
    h('b', { text: P.jobName(it.job) }),
    h('small', null, it.rec && it.rec.by ? h('i', { class: 'dot who-' + it.rec.by }) : null, lastText(it, false)));
  b.style.setProperty('--fill', st.fill.toFixed(3));
  return b;
}

function roomRow(r) {
  const soon = r.soon[0];
  const state = r.due ? r.due + ' fällig' : soon ? P.jobName(soon.job) + ' ' + P.dueText(soon.st).replace(' fällig', '') : '';
  return h('li', { class: 'row pz-room' + (r.due ? ' has-due' : ''), dataset: { room: r.room.id } },
    h('button', { type: 'button', class: 'pz-rhead', 'aria-label': r.room.n + ' bearbeiten' + (r.due ? ', ' + r.due + ' fällig' : ''), onclick: () => roomSheet(r.room) },
      h('span', { class: 'pz-rname', text: r.room.n }),
      state ? h('span', { class: 'pz-rstate' + (r.due ? ' is-due' : ''), text: state }) : null,
      ico('next', 'pz-chev')),
    r.jobs.length ? h('div', { class: 'pz-chips' }, r.jobs.map(chip)) : h('p', { class: 'pz-nojobs', text: 'Noch keine Arbeiten. Tippt auf den Raum, um welche hinzuzufügen.' }));
}

function paintList(ov) {
  if (!S.loaded) { el.list.replaceChildren(empty('Lade …')); return; }
  const nodes = [];
  for (const f of P.FLOORS) {
    const rows = ov.byRoom.filter(r => r.room.f === f.id);
    if (!rows.length) continue;
    const due = rows.reduce((n, r) => n + r.due, 0);
    nodes.push(h('h3', { class: 'li-group pz-floor' }, f.name, due ? h('span', { class: 'cnt pz-cnt', text: due + ' fällig' }) : null),
      h('ul', { class: 'card li-list pz-rooms', 'aria-label': f.name }, rows.map(roomRow)));
  }
  if (!nodes.length) nodes.push(empty('Noch keine Räume', 'Legt mit + euren ersten Raum an.'));
  nodes.push(h('button', { type: 'button', class: 'pz-addroom', id: 'pz-add2', onclick: () => roomSheet(null) }, ico('plus'), 'Raum hinzufügen'),
    h('p', { class: 'pz-help', text: 'Eine Arbeit antippen: heute erledigt. Einen Raum antippen: Rhythmus ändern, frühere Termine nachtragen, Arbeiten hinzufügen.' }));
  el.list.replaceChildren(...nodes);
}
const empty = (head, text) => h('div', { class: 'li-empty' }, h('span', { class: 'eic', 'aria-hidden': 'true' }, ico('broom')), h('strong', { text: head }), text ? h('p', { text }) : null);

// repainting must not throw a keyboard user out of the job they are on
function keepFocus(fn) {
  const ae = document.activeElement;
  const key = ae && ae.dataset ? ae.dataset.key : null;
  fn();
  if (key) { const e = el.list.querySelector('[data-key="' + CSS.escape(key) + '"]'); if (e) { try { e.focus({ preventScroll: true }); } catch (x) { /* ignore */ } } }
}

/* ---------- a room's sheet: name, floor, jobs with rhythm and the last time they were done ---------- */
const ymd = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
function roomSheet(room) {
  const isNew = !room;
  const orig = room ? JSON.parse(JSON.stringify(room)) : null;
  const draft = room ? JSON.parse(JSON.stringify(room)) : { id: P.newRoomId(), n: '', f: 'eg', j: [{ k: 'saugen', e: 7 }, { k: 'wischen', e: 14 }] };
  const dates = new Map();                                      // job key -> the time chosen in this sheet
  const name = h('input', { type: 'text', id: 'pz-name', maxlength: String(P.MAX_ROOM_NAME), autocomplete: 'off', autocapitalize: 'sentences', placeholder: 'z. B. Gästezimmer', value: draft.n });
  const seg = h('div', { class: 'seg', id: 'pz-floor', role: 'radiogroup', 'aria-label': 'Stockwerk' });
  const jobsBox = h('div', { class: 'pz-jobs', id: 'pz-jobs' });
  const addBox = h('div', { class: 'pz-addjobs', id: 'pz-addjobs' });
  const err = h('p', { class: 'err', role: 'alert', hidden: true });
  const showErr = m => { err.textContent = m; err.hidden = false; };
  const paintSeg = () => seg.replaceChildren(...P.FLOORS.map(f => h('button', { type: 'button', role: 'radio', class: 'opt', dataset: { floor: f.id }, 'aria-checked': String(draft.f === f.id), onclick: () => { draft.f = f.id; paintSeg(); } }, h('span', { text: f.name }))));

  function lastLine(j) {
    const chosen = dates.get(j.k), rec = S.done.get(draft.id + '-' + j.k);
    if (chosen) return 'Neu: ' + P.shortDate(new Date(chosen)) + ' (wird gespeichert)';
    if (!rec) return 'Noch nie erledigt';
    return 'Zuletzt ' + P.shortDate(new Date(rec.at)) + ', ' + P.sinceText(P.daysBetween(new Date(rec.at), new Date())) + (rec.by ? ', ' + personName(rec.by) : '');
  }
  function paintJobs() {
    const today = new Date(), yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
    jobsBox.replaceChildren(...draft.j.map((j, i) => {
      const own = !P.JOBS[j.k];
      const title = own
        ? h('input', { type: 'text', class: 'pz-jname', maxlength: String(P.MAX_JOB_NAME), autocomplete: 'off', autocapitalize: 'sentences', placeholder: 'z. B. Kühlschrank', 'aria-label': 'Name der Arbeit', value: j.n || '', oninput: e => { j.n = e.target.value; } })
        : h('div', { class: 'pz-jt' }, h('b', { text: P.JOBS[j.k].name }), h('small', { text: P.jobHint(draft, j) }));
      const opts = P.EVERY.includes(j.e) ? P.EVERY : P.EVERY.concat([j.e]).sort((a, b) => a - b);
      const every = h('select', { class: 'pz-every', 'aria-label': 'Rhythmus', onchange: e => { j.e = Number(e.target.value); } }, opts.map(e => h('option', { value: String(e), text: P.everyText(e) })));
      every.value = String(j.e);
      const date = h('input', { type: 'date', class: 'pz-dinput', max: ymd(today), min: ymd(new Date(today.getFullYear() - 2, today.getMonth(), today.getDate())), 'aria-label': 'Anderes Datum',
        onchange: e => { const v = e.target.value; if (!v) return; const [y, m, d] = v.split('-').map(Number); dates.set(j.k, P.atNoon(new Date(y, m - 1, d))); paintJobs(); } });
      const set = at => { dates.set(j.k, at); paintJobs(); };
      return h('div', { class: 'pz-job', dataset: { job: j.k } },
        h('div', { class: 'pz-jrow' }, title, every,
          h('button', { type: 'button', class: 'pz-jdel', 'aria-label': (own ? j.n || 'Arbeit' : P.JOBS[j.k].name) + ' entfernen', onclick: () => { draft.j.splice(i, 1); dates.delete(j.k); paintJobs(); paintAdd(); } }, ico('x'))),
        h('p', { class: 'pz-jlast', text: lastLine(j) }),
        h('div', { class: 'pz-q' },
          h('button', { type: 'button', class: 'pz-qbtn', dataset: { q: 'heute' }, onclick: () => set(Date.now()) }, 'Heute erledigt'),
          h('button', { type: 'button', class: 'pz-qbtn', dataset: { q: 'gestern' }, onclick: () => set(P.atNoon(yesterday)) }, 'Gestern'),
          h('label', { class: 'pz-qbtn pz-date' }, 'Datum …', date)));
    }));
    if (!draft.j.length) jobsBox.append(h('p', { class: 'note', text: 'Noch keine Arbeiten. Fügt unten welche hinzu.' }));
  }
  function paintAdd() {
    const have = new Set(draft.j.map(j => j.k));
    const full = draft.j.length >= P.MAX_JOBS;
    addBox.replaceChildren(...(full ? [h('p', { class: 'note', text: 'Mehr als ' + P.MAX_JOBS + ' Arbeiten gehen nicht.' })] : P.JOB_KEYS.filter(k => !have.has(k)).map(k =>
      h('button', { type: 'button', class: 'pz-addjob', dataset: { add: k }, onclick: () => { draft.j.push({ k, e: P.JOBS[k].every }); paintJobs(); paintAdd(); } }, ico('plus'), P.JOBS[k].name))
      .concat([h('button', { type: 'button', class: 'pz-addjob', dataset: { add: 'own' }, onclick: () => {
        draft.j.push({ k: P.newJobKey(), n: '', e: 14 }); paintJobs(); paintAdd();
        const ins = jobsBox.querySelectorAll('.pz-jname'); if (ins.length) ins[ins.length - 1].focus();
      } }, ico('plus'), 'Eigene Arbeit')])));
  }

  function save() {
    const n = name.value.replace(/\s+/g, ' ').trim().slice(0, P.MAX_ROOM_NAME);
    if (!n) { showErr('Gib dem Raum einen Namen.'); name.focus(); return; }
    for (const j of draft.j) if (!P.JOBS[j.k]) { j.n = String(j.n || '').replace(/\s+/g, ' ').trim().slice(0, P.MAX_JOB_NAME); if (!j.n) { showErr('Gib jeder eigenen Arbeit einen Namen.'); return; } }
    draft.n = n;
    const rooms = S.rooms.map(r => JSON.parse(JSON.stringify(r)));
    const at = rooms.findIndex(r => r.id === draft.id);
    if (at >= 0) rooms[at] = draft; else rooms.push(draft);
    if (rooms.length > P.MAX_ROOMS) { showErr('Mehr als ' + P.MAX_ROOMS + ' Räume gehen nicht.'); return; }
    closeSheet();
    const changed = isNew || JSON.stringify(P.roomsDoc([orig])) !== JSON.stringify(P.roomsDoc([draft]));
    if (changed) putRooms(P.cleanRooms(P.roomsDoc(rooms)));
    for (const [k, t] of dates) if (draft.j.some(j => j.k === k)) putDone(draft.id, k, P.doneRecord(S.done.get(draft.id + '-' + k) || null, t, me()));
    if (orig) for (const j of orig.j) if (!draft.j.some(x => x.k === j.k) && S.done.has(orig.id + '-' + j.k)) putDone(orig.id, j.k, null);
    toast(isNew ? '„' + n + '“ angelegt' : 'Gespeichert');
  }
  function remove() {
    const before = S.rooms.map(r => JSON.parse(JSON.stringify(r)));
    const recs = orig.j.map(j => [j.k, S.done.get(orig.id + '-' + j.k)]).filter(x => x[1]);
    closeSheet();
    putRooms(before.filter(r => r.id !== orig.id));
    for (const [k] of recs) putDone(orig.id, k, null);
    toast('„' + orig.n + '“ gelöscht', { undo: () => { putRooms(before); for (const [k, rec] of recs) putDone(orig.id, k, rec); } });
  }

  const box = h('div', { class: 'modal li-sheet pz-sheet', id: 'pz-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': isNew ? 'Neuer Raum' : draft.n },
    sheetBar(h('button', { type: 'button', class: 'cancel', id: 'pz-cancel', onclick: () => closeSheet(), text: 'Abbrechen' }), isNew ? 'Neuer Raum' : draft.n,
      h('button', { type: 'button', class: 'save', id: 'pz-save', onclick: save, text: 'Speichern' })),
    h('div', { class: 'modal-body' }, h('div', { class: 'wrap' },
      h('div', { class: 'field' }, h('label', { class: 'lab', for: 'pz-name', text: 'Raum' }), name),
      h('div', { class: 'field' }, h('div', { class: 'lab', text: 'Stockwerk' }), seg),
      h('div', { class: 'field' }, h('div', { class: 'lab' }, h('span', { text: 'Arbeiten' }), h('small', { text: 'Rhythmus und zuletzt erledigt' })), jobsBox, addBox),
      err,
      isNew ? null : armable(h('button', { type: 'button', class: 'del', id: 'pz-del' }), 'Raum löschen', 'Wirklich löschen?', remove),
      h('p', { class: 'note', text: 'Gilt für euch beide.' }))));
  paintSeg(); paintJobs(); paintAdd();
  openSheet(box);
  if (isNew) name.focus({ preventScroll: true }); else box.querySelector('.cancel').focus({ preventScroll: true });
}

/* ---------- start ---------- */
export function start(db, { uid } = {}) {
  if (S.db || !db) return;
  S.db = db; S.uid = uid || null;
  watchSettings(db, snap => {
    const r = P.parseDocs(snap.docs);
    const p = docData(snap, 'people') || {};
    const s = v => (typeof v === 'string' ? v.trim().slice(0, 14) : '');
    S.people = { a: s(p.a), b: s(p.b), aId: typeof p.aId === 'string' ? p.aId : null, bId: typeof p.bId === 'string' ? p.bId : null };
    S.rooms = r.rooms; S.stored = r.stored; S.done = r.done; S.loaded = true; S.failed = false;
    render();
  }, () => { S.failed = true; S.loaded = true; render(); });
}

window.addEventListener('ws:unsent', ev => { S.stuck = !!(ev.detail && ev.detail.stuck); if (el.built) paintStatus(); });
const net = () => { S.offline = navigator.onLine === false; if (el.built) paintStatus(); };
window.addEventListener('online', net); window.addEventListener('offline', net);
// a new day while the app stays open: the days since and the due jobs move on
let timer = 0;
function arm() {
  clearTimeout(timer);
  const now = new Date(), next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  timer = setTimeout(() => { render(); arm(); }, Math.min(next - now + 500, 6 * 3600e3));
}
window.addEventListener('ws:screen', e => { if (e.detail && e.detail.screen === 'putz') render(); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { render(); arm(); } });
render();
arm();
