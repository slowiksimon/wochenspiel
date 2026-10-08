// The "Müll" screen: the waste plan of Pfaffstätten as a month view. On top, what goes out next; below, the month with a
// little bin for every pickup, the dates after the next one, and what is good to know. "Eure Tonnen" sets the street
// (it decides the Restmüll area) and the bins the household has; that choice is shared (settings/muell).
// Dates and rules are in muell-core.js, the plan itself in muell-data.js.
import * as M from './muell-core.js';
import { h, $, ico } from './dom.js';
import { toast } from './toast.js';
import { nestSvg, DAY } from './nest.js';
import { openSheet, closeSheet, sheetBar } from './sheet.js';
import { watchSettings, docData } from './hub.js';


const CACHE = 'wp2.muell';                     // the last known choice, so the screen is right before the database answers
const SUBSCRIBED = 'wp2.muell.cal';            // which calendars this phone was sent to subscribe (see paintRemind)
const NS = 'http://www.w3.org/2000/svg';
const tick = () => { try { if (navigator.vibrate) navigator.vibrate(8); } catch (e) { /* not supported */ } };

/* ---------- the little bins ---------- */
// viewBox 12 x 14; two parts each, so a bin can have a lid of another colour (paper: red lid)
const SHAPES = {
  bin: ['M.7 2.4a1.2 1.2 0 0 1 1.2-1.2h8.2a1.2 1.2 0 0 1 1.2 1.2v1.5H.7z', 'M1.3 4.7h9.4l-.8 7.8a1.2 1.2 0 0 1-1.2 1.1H3.3a1.2 1.2 0 0 1-1.2-1.1z'],
  sack: ['M3.1 1.3c-.4-.2-.8.2-.6.6l1 2.4h5l1-2.4c.2-.4-.2-.8-.6-.6L6 2.3z', 'M3.8 4.9C1.9 6.1.7 8.2.7 10.3c0 2.2 1.9 3.3 5.3 3.3s5.3-1.1 5.3-3.3c0-2.1-1.2-4.2-3.1-5.4z'],
  box: ['M.4 4.3a1.1 1.1 0 0 1 1.1-1.1h9a1.1 1.1 0 0 1 1.1 1.1v1.4H.4z', 'M.9 6.5h10.2v5.3a1.1 1.1 0 0 1-1.1 1.1H2a1.1 1.1 0 0 1-1.1-1.1z']
};
function glyph(kind, cls) {
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('class', 'bin k-' + kind + (cls ? ' ' + cls : ''));
  s.setAttribute('viewBox', '0 0 12 14');
  s.setAttribute('aria-hidden', 'true');
  s.setAttribute('focusable', 'false');
  const [lid, body] = SHAPES[M.KIND[kind].shape];
  s.innerHTML = '<path class="body" d="' + body + '"/><path class="lid" d="' + lid + '"/>';
  return s;
}
const chip = ev => h('li', { class: 'mu-chip' }, glyph(ev.kind), h('span', { text: M.label(ev) }));
const names = list => list.map(M.label).join(', ');

/* ---------- state ---------- */
function cached() { try { return JSON.parse(localStorage.getItem(CACHE) || 'null'); } catch (e) { return null; } }
function cache(s) { try { localStorage.setItem(CACHE, JSON.stringify(s)); } catch (e) { /* kept in memory */ } }
const S = { db: null, set: M.cleanSettings(cached()), plan: null, ym: 0, sel: null, built: false };
S.plan = M.schedule(S.set);
const ymOf = d => d.getFullYear() * 12 + d.getMonth();

/* ---------- the screen ---------- */
const el = {};
function build() {
  const screen = $('#screen-muell');
  if (!screen || S.built) return false;
  S.built = true;
  const deco = document.createElement('template'); deco.innerHTML = nestSvg('hero-deco');
  el.cap = h('p', { class: 'cap', id: 'mu-cap' });
  el.next = h('div', { class: 'mu-next', id: 'mu-next' });
  el.setBtn = h('button', { type: 'button', class: 'pillbtn', id: 'mu-set', onclick: () => binsSheet() }, ico('bin'), 'Eure Tonnen');
  el.prompt = h('div', { id: 'mu-prompt' });
  el.title = h('h2', { class: 'mu-month', id: 'mu-mtitle' });
  el.today = h('button', { type: 'button', class: 'today-pill', id: 'mu-today', hidden: true, onclick: () => { S.ym = ymOf(new Date()); S.sel = null; paintMonth(); } }, 'Heute');
  el.prev = h('button', { type: 'button', class: 'mu-nav', id: 'mu-prev', 'aria-label': 'Vorheriger Monat', onclick: () => step(-1) }, ico('prev'));
  el.nextM = h('button', { type: 'button', class: 'mu-nav', id: 'mu-fwd', 'aria-label': 'Nächster Monat', onclick: () => step(1) }, ico('next'));
  el.grid = h('div', { class: 'mu-grid', id: 'mu-grid', role: 'group' });
  el.foot = h('div', { class: 'mu-foot', id: 'mu-foot' });
  el.soon = h('div', { class: 'mu-soon', id: 'mu-soon' });
  el.remind = h('section', { class: 'card mu-remind', id: 'mu-remind', 'aria-label': 'Erinnerung am Vorabend' });
  screen.append(
    h('header', { class: 'hero hero-list hero-muell straw' }, deco.content.firstElementChild,
      h('div', { class: 'hero-in' },
        h('div', { class: 'head' },
          h('div', { class: 'cap-row' }, el.cap),
          h('div', { class: 'ttl-row' }, h('h1', { class: 'ttl', text: 'Müll' })),
          h('div', { class: 'head-btns' }, el.setBtn)),
        el.next)),
    h('div', { class: 'li-wrap mu-wrap' },
      el.prompt,
      h('section', { class: 'card mu-cal', id: 'mu-cal', 'aria-label': 'Monatsansicht' },
        h('div', { class: 'mu-mhead' }, el.title, el.today, h('div', { class: 'mu-navs' }, el.prev, el.nextM)),
        h('div', { class: 'mu-wk', 'aria-hidden': 'true' }, M.DAY_SHORT.map(s => h('span', { text: s }))),
        el.grid, el.foot),
      el.remind,
      el.soon,
      info()));
  S.ym = clampYm(ymOf(new Date()));
  return true;
}
const clampYm = ym => { const r = M.monthRange(new Date()); return Math.min(r.hi, Math.max(r.lo, ym)); };
function step(n) {
  const ym = clampYm(S.ym + n);
  if (ym === S.ym) return;
  S.ym = ym; S.sel = null;
  paintMonth();
}

function info() {
  return h('div', { class: 'howto mu-info', id: 'mu-info' },
    h('h4', { text: 'Gut zu wissen' }),
    h('ul', null,
      h('li', { text: 'Tonnen und gelbe Säcke am Abholtag bis 6 Uhr früh vor dem Haus bereitstellen, die Deckel geschlossen.' }),
      h('li', { text: 'Ist die Altpapiertonne voll, darf am Abholtag noch bis zu einem Drittel ihrer Größe gebündelt oder im Karton danebenstehen.' }),
      h('li', { text: 'Glas kommt zu den Altstoffsammelinseln.' }),
      h('li', null, h('b', { text: 'Altstoffsammelzentrum' }), ', Lederhasgasse 11 (beim Bauhof): samstags 8 bis 10 Uhr, dienstags 15:30 bis 18:30 Uhr (Sommerzeit) und 14:30 bis 16:30 Uhr (Winterzeit). Dort auch Sperrmüll, Elektrogeräte und große Kartons.')),
    h('p', { class: 'mu-src' }, 'Aus dem ' + M.PLAN.source + ', ohne Gewähr. Mehr auf ',
      h('a', { href: 'https://www.gvabaden.at', target: '_blank', rel: 'noopener noreferrer' }, 'gvabaden.at'), '.'));
}

/* ---------- painting ---------- */
function render() {
  if (!S.built && !build()) return;
  const now = new Date();
  paintHero(now);
  paintPrompt();
  paintMonth(now);
  paintRemind();
  paintSoon(now);
  paintTab(now);
}

function paintHero(now) {
  const s = S.set;
  el.cap.textContent = s.street ? s.street + ', Bereich ' + s.area : s.area ? 'Bereich ' + s.area : 'Abfuhrplan ' + M.PLAN.year;
  const nx = M.upcoming(S.plan, now, 1)[0];
  const kids = [];
  if (nx) {
    const n = M.daysBetween(now, nx.date), when = M.whenText(nx.date, now);
    const sub = n <= 1 ? M.longDate(nx.date) : n < 7 ? nx.date.getDate() + '. ' + M.MONTH_LONG[nx.date.getMonth()] + ', ' + M.inDays(nx.date, now) : M.DAY_LONG[M.wd(nx.date)] + ', ' + M.inDays(nx.date, now);
    kids.push(h('p', { class: 'mu-when', text: when }), h('p', { class: 'mu-date', text: sub }),
      h('ul', { class: 'mu-chips', 'aria-label': 'Abholung' }, nx.events.map(chip)),
      h('p', { class: 'mu-rule', text: 'Bis 6 Uhr früh rausstellen' }));
  } else if (!M.KINDS.some(k => s.have[k.id])) {
    kids.push(h('p', { class: 'mu-when', text: 'Keine Tonnen' }), h('p', { class: 'mu-date', text: 'Wählt unter „Eure Tonnen“, welche ihr habt.' }));
  } else {
    kids.push(h('p', { class: 'mu-when', text: 'Plan zu Ende' }),
      h('p', { class: 'mu-date', text: now.getFullYear() > M.PLAN.year || now.getMonth() === 11 ? 'Der Abfuhrplan ' + (M.PLAN.year + 1) + ' ist noch nicht in der App.' : 'Für dieses Jahr stehen keine Termine mehr an.' }));
  }
  el.next.replaceChildren(...kids);
}

function paintPrompt() {
  const s = S.set, show = !s.area && (s.have.rest || s.have.asche);
  el.prompt.replaceChildren(...(show ? [h('div', { class: 'hint mu-hint' },
    h('p', null, h('b', { text: 'Wählt eure Straße' }), ', dann zeigt der Plan euren Restmüll-Tag.'),
    h('button', { type: 'button', id: 'mu-pick', onclick: () => binsSheet(true) }, 'Straße wählen'))] : []));
}

function paintMonth(now = new Date()) {
  const y = Math.floor(S.ym / 12), m = S.ym % 12, r = M.monthRange(now);
  el.title.replaceChildren(M.MONTH_LONG[m] + ' ', h('span', { text: String(y) }));
  el.grid.setAttribute('aria-label', M.MONTH_LONG[m] + ' ' + y);
  el.prev.disabled = S.ym <= r.lo; el.nextM.disabled = S.ym >= r.hi;
  el.today.hidden = S.ym === ymOf(now);
  const todayKey = M.keyOf(now);
  const mk = '<svg class="mu-ring" viewBox="0 0 46 46" aria-hidden="true" focusable="false"><path d="' + DAY.d + '"/></svg>';
  el.grid.replaceChildren(...M.monthCells(y, m).map(d => {
    if (!d) return h('span', { class: 'mu-d is-blank', 'aria-hidden': 'true' });
    const key = M.keyOf(d), ev = S.plan.get(key) || [], hol = M.holiday(key), past = key < todayKey;
    const cls = ['mu-d'];
    if (ev.length) cls.push('has-ev');
    if (key === todayKey) cls.push('is-today');
    if (past) cls.push('is-past');
    if (hol || M.wd(d) === 6) cls.push('is-off');
    const b = h('button', { type: 'button', class: cls.join(' '), dataset: { key, p: '0' }, 'aria-pressed': 'false',
      'aria-label': M.longDate(d) + (hol ? ', ' + hol : '') + ': ' + (ev.length ? names(ev) : 'keine Abholung'),
      onclick: () => pick(key) });
    b.innerHTML = mk;
    b.append(h('span', { class: 'mu-dn', text: String(d.getDate()) }), h('span', { class: 'mu-bins' }, ev.map(e => glyph(e.kind))));
    if (key === todayKey) b.setAttribute('aria-current', 'date');
    return b;
  }));
  paintSel(now);
}

function pick(key) {
  tick();
  S.sel = S.sel === key ? null : key;
  const c = el.grid.querySelector('[data-key="' + key + '"]');
  if (c && S.sel) c.dataset.p = c.dataset.p === '0' ? '1' : '0';           // replays the pen stroke
  paintSel(new Date());
}

function paintSel(now) {
  for (const c of el.grid.querySelectorAll('.mu-d[data-key]')) {
    const on = c.dataset.key === S.sel;
    c.classList.toggle('is-sel', on);
    c.setAttribute('aria-pressed', String(on));
  }
  if (S.sel) {
    const d = M.dateOf(S.sel), ev = S.plan.get(S.sel) || [], hol = M.holiday(S.sel), rel = M.inDays(d, now);
    const sub = [hol, rel].filter(Boolean).join(', ');
    el.foot.replaceChildren(
      h('p', { class: 'mu-fdate' }, h('b', { text: M.longDate(d) }), sub ? h('span', { text: sub }) : null),
      ev.length ? h('ul', { class: 'mu-chips' }, ev.map(chip)) : h('p', { class: 'mu-none', text: M.inPlan(d) ? 'Keine Abholung' : 'Für ' + d.getFullYear() + ' ist noch kein Plan in der App.' }));
    return;
  }
  // no day picked: the bins of this month, as a legend
  const y = Math.floor(S.ym / 12), m = S.ym % 12, seen = new Map();
  for (const d of M.monthCells(y, m)) if (d) for (const ev of S.plan.get(M.keyOf(d)) || []) seen.set(M.label(ev), ev);
  const legend = Array.from(seen.values()).sort((a, b) => M.KINDS.indexOf(M.KIND[a.kind]) - M.KINDS.indexOf(M.KIND[b.kind]) || (a.area || 0) - (b.area || 0));
  el.foot.replaceChildren(legend.length
    ? h('ul', { class: 'mu-legend', 'aria-label': 'Legende' }, legend.map(ev => h('li', null, glyph(ev.kind), h('span', { text: M.label(ev) }))))
    : h('p', { class: 'mu-none', text: y !== M.PLAN.year ? 'Für ' + y + ' ist noch kein Plan in der App.' : 'In diesem Monat keine Abholung.' }));
}

function paintSoon(now) {
  const list = M.upcoming(S.plan, now, 6).slice(1);
  if (!list.length) { el.soon.replaceChildren(); return; }
  el.soon.replaceChildren(
    h('h3', { class: 'mu-h', text: 'Weitere Termine' }),
    h('ul', { class: 'card li-list mu-list' }, list.map(x => h('li', { class: 'row mu-row', dataset: { key: x.key } },
      h('span', { class: 'mu-tile', 'aria-hidden': 'true' }, h('b', { text: String(x.date.getDate()) }), h('small', { text: M.MONTH_SHORT[x.date.getMonth()] })),
      h('span', { class: 'mu-what' },
        h('span', { class: 'sr', text: M.longDate(x.date) + ', ' + M.inDays(x.date, now) + ': ' }),
        h('span', { class: 'mu-names', text: names(x.events) }),
        h('span', { class: 'mu-when2', 'aria-hidden': 'true' },
          h('span', { class: 'mu-bins' }, x.events.map(e => glyph(e.kind))),
          h('span', { class: 'mu-rel', text: M.DAY_LONG[M.wd(x.date)] + ', ' + M.inDays(x.date, now) })))))));
}

// "Erinnerung am Vorabend": the phone's own calendar reminds at 19:00 the evening before every pickup. The app links to the
// calendar file that fits the household's choice (all of them are made by build.mjs); webcal:// hands it to the calendar,
// which subscribes and refreshes it, so a new year's plan arrives by itself.
function subscribed() { try { return JSON.parse(localStorage.getItem(SUBSCRIBED) || 'null'); } catch (e) { return null; } }
const calUrl = (name, scheme) => { const u = new URL('kalender/' + name + '.ics', location.href); u.hash = ''; u.search = ''; return scheme ? scheme + u.href.slice(u.protocol.length) : u.href; };
function paintRemind() {
  const c = M.calendars(S.set);
  if (!c.needsArea && !c.names.length) { el.remind.hidden = true; return; }
  el.remind.hidden = false;
  const head = text => h('div', { class: 'mu-rm-top' },
    h('span', { class: 'mu-rm-ic', 'aria-hidden': 'true' }, ico('bell')),
    h('div', { class: 'mu-rm-t' }, h('h3', { text: 'Erinnerung am Vorabend' }), h('p', { text })));
  if (c.needsArea) {
    el.remind.replaceChildren(head('Wählt zuerst eure Straße, dann kennt der Kalender euren Restmüll-Tag.'),
      h('div', { class: 'mu-rm-acts' }, h('button', { type: 'button', class: 'mu-rm-btn', id: 'mu-rm-street', onclick: () => binsSheet(true) }, 'Straße wählen')));
    return;
  }
  const before = subscribed(), same = before && Array.isArray(before.names) && before.names.join() === c.names.join();
  const note = h('p', { class: 'mu-rm-note' + (before && !same ? ' warn' : ''), id: 'mu-rm-note', role: 'status',
    text: !before ? 'Auf jedem Handy einmal. Neue Abfuhrpläne kommen von selbst dazu.'
      : same ? 'Im Kalender auf „Abonnieren“ getippt? Dann seid ihr fertig. Der Kalender heißt „Müllabfuhr“.'
        : 'Eure Tonnen haben sich geändert. Abonniert den Kalender neu und löscht danach den alten im Kalender.' });
  const mark = () => {
    try { localStorage.setItem(SUBSCRIBED, JSON.stringify({ names: c.names, at: Date.now() })); } catch (e) { /* only the note depends on it */ }
    setTimeout(paintRemind, 300);
  };
  const subs = c.names.map((n, i) => h('a', { class: 'mu-rm-btn' + (i ? ' alt' : ''), href: calUrl(n, 'webcal:'), dataset: { cal: n }, onclick: mark },
    i ? '+ ' + M.KIND[n.slice(6)].sheet : 'Im Kalender abonnieren'));
  const copy = h('button', { type: 'button', class: 'mu-rm-copy', id: 'mu-rm-copy', onclick: async () => {
    const urls = c.names.map(n => calUrl(n)).join('\n');
    let ok = false;
    try { await navigator.clipboard.writeText(urls); ok = true; } catch (e) { ok = false; }
    toast(ok ? (c.names.length > 1 ? 'Links kopiert' : 'Link kopiert') : 'Kopieren ging nicht. Der Link: ' + urls);
  } }, c.names.length > 1 ? 'Links kopieren' : 'Link kopieren');
  el.remind.replaceChildren(head('Euer iPhone meldet sich um ' + M.ALERT_HOUR + ' Uhr am Abend vor jeder Abholung, passend zu euren Tonnen.'),
    h('div', { class: 'mu-rm-acts' }, subs, copy), note);
}

// a dot on the tab when something goes out today or tomorrow
function paintTab(now) {
  const tab = $('#open-muell'), dot = $('#d-muell');
  if (!tab || !dot) return;
  const nx = M.upcoming(S.plan, now, 1)[0];
  const soon = nx && M.daysBetween(now, nx.date) <= 1;
  dot.hidden = !soon;
  tab.setAttribute('aria-label', 'Müll' + (soon ? ', ' + M.inDays(nx.date, now) + ': ' + names(nx.events) : ''));
}

/* ---------- "Eure Tonnen" ---------- */
function binsSheet(toStreet) {
  const draft = { area: S.set.area, street: S.set.street, have: Object.assign({}, S.set.have) };
  const street = h('input', { type: 'text', id: 'mu-street', maxlength: '60', autocomplete: 'off', autocapitalize: 'words', enterkeyhint: 'done', placeholder: 'z. B. Hauptstraße', value: draft.street, 'aria-describedby': 'mu-area-note' });
  const sug = h('ul', { class: 'card li-list mu-sug', id: 'mu-sug', hidden: true });
  const seg = h('div', { class: 'seg', id: 'mu-area', role: 'radiogroup', 'aria-label': 'Abfuhrbereich' });
  const note = h('p', { class: 'note', id: 'mu-area-note' });
  const err = h('p', { class: 'err', role: 'alert', hidden: true });
  const rows = g => h('ul', { class: 'card li-list mu-have' }, M.KINDS.filter(k => (k.group || 1) === g).map(k => {
    const b = h('button', { type: 'button', class: 'mu-tg', role: 'checkbox', dataset: { kind: k.id }, onclick: () => { draft.have[k.id] = !draft.have[k.id]; err.hidden = true; paintRows(); } },
      glyph(k.id, 'big'), h('span', { class: 'mu-tt' }, h('b', { text: k.sheet }), h('small', { text: k.hint })), h('span', { class: 'mu-ck', 'aria-hidden': 'true' }));
    return h('li', { class: 'row' }, b);
  }));
  const have1 = rows(1), have2 = rows(2);
  function paintRows() {
    for (const b of [...have1.querySelectorAll('.mu-tg'), ...have2.querySelectorAll('.mu-tg')]) {
      const on = !!draft.have[b.dataset.kind];
      b.setAttribute('aria-checked', String(on));
      b.querySelector('.mu-ck').replaceChildren(on ? h('span', { class: 'chk chk-done' }, ico('check')) : h('span', { class: 'chk' }, ico('loop')));
    }
  }
  function paintArea() {
    seg.replaceChildren(...[1, 2].map(n => h('button', { type: 'button', role: 'radio', class: 'opt', dataset: { area: String(n) }, 'aria-checked': String(draft.area === n),
      onclick: () => {
        draft.area = n;
        if (draft.street && M.streetArea(draft.street) !== draft.area) { draft.street = ''; street.value = ''; }
        paintArea();
      } }, h('span', { text: 'Bereich ' + n }), h('small', { text: 'Restmüll am ' + M.AREA_DAY[n] }))));
    note.textContent = draft.street ? draft.street + ' gehört zu Bereich ' + draft.area + '.'
      : draft.area ? 'Bereich ' + draft.area + ' gewählt. Eure Straße ist nicht dabei? Dann passt der Bereich aus eurem Abfuhrplan.'
        : 'Tippt den Anfang eurer Straße, die App kennt alle Straßen aus dem Plan.';
  }
  function paintSug() {
    const hits = draft.street ? [] : M.findStreets(street.value);
    sug.hidden = !hits.length;
    sug.replaceChildren(...hits.map(s => h('li', { class: 'row' }, h('button', { type: 'button', class: 'mu-sug-b', dataset: { street: s.name }, onclick: () => {
      draft.street = s.name; draft.area = s.area; street.value = s.name;
      paintSug(); paintArea();
      try { street.blur(); } catch (e) { /* ignore */ }
    } }, h('span', { text: s.name }), h('small', { text: 'Bereich ' + s.area })))));
  }
  street.addEventListener('input', () => {
    const exact = M.streetArea(street.value);
    if (exact) { draft.street = M.streetName(street.value); draft.area = exact; }
    else draft.street = '';
    paintSug(); paintArea();
  });
  street.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const first = sug.querySelector('.mu-sug-b');
    if (first) first.click(); else street.blur();
  });
  function save() {
    const s = M.cleanSettings(draft);
    if (!M.KINDS.some(k => s.have[k.id])) { err.textContent = 'Wählt mindestens eine Tonne.'; err.hidden = false; return; }
    closeSheet();
    if (M.sameSettings(s, S.set)) return;
    apply(s);
    toast('Gespeichert');
    if (S.db) {
      Promise.resolve().then(() => S.db.doc('settings/muell').set(M.settingsDoc(s)))
        .catch(() => toast('Das konnte nicht gespeichert werden. Prüfe dein Internet und versuche es noch einmal.'));
    }
  }
  const box = h('div', { class: 'modal li-sheet mu-sheet', id: 'mu-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Eure Tonnen' },
    sheetBar(h('button', { type: 'button', class: 'cancel', id: 'mu-cancel', onclick: () => closeSheet(), text: 'Abbrechen' }), 'Eure Tonnen',
      h('button', { type: 'button', class: 'save', id: 'mu-save', onclick: save, text: 'Speichern' })),
    h('div', { class: 'modal-body' }, h('div', { class: 'wrap' },
      h('div', { class: 'field' }, h('label', { class: 'lab', for: 'mu-street' }, h('span', { text: 'Eure Straße' }), h('small', { text: 'bestimmt den Restmüll-Tag' })), street, sug),
      h('div', { class: 'field' }, h('div', { class: 'lab', text: 'Abfuhrbereich' }), seg, note),
      h('div', { class: 'field' }, h('div', { class: 'lab', text: 'Diese Tonnen habt ihr' }), have1),
      h('div', { class: 'field' }, h('div', { class: 'lab' }, h('span', { text: 'Wohnhausanlage' }), h('small', { text: 'nur wenn ihr so eine Abholung habt' })), have2),
      err,
      h('p', { class: 'note', text: 'Gilt für euch beide. Die Termine stammen aus dem ' + M.PLAN.source + '.' }))));
  paintRows(); paintArea(); paintSug();
  openSheet(box, toStreet ? el.setBtn : undefined);
  if (toStreet) street.focus({ preventScroll: true });
  else box.querySelector('.cancel').focus({ preventScroll: true });
}

function apply(s) {
  S.set = s;
  S.plan = M.schedule(s);
  cache(s);
  render();
}

/* ---------- start ---------- */
// the screen is drawn at once (the plan needs no network); the household's choice follows from the database
export function start(db) {
  if (S.db || !db) return;
  S.db = db;
  watchSettings(db, snap => {
    const s = M.cleanSettings(docData(snap, 'muell'));
    if (!M.sameSettings(s, S.set)) apply(s); else cache(s);
  }, () => { /* the plan still shows, with the choice this phone knows */ });
}

// a new day (or noon) while the app stays open moves "next" on
let timer = 0;
function arm() {
  clearTimeout(timer);
  const now = new Date(), noon = new Date(now.getFullYear(), now.getMonth(), now.getDate(), M.CUT_HOUR);
  const next = now < noon ? noon : M.addDays(M.dayStart(now), 1);
  timer = setTimeout(() => { render(); arm(); }, Math.min(next - now + 500, 6 * 3600e3));
}
window.addEventListener('ws:screen', e => { if (e.detail && e.detail.screen === 'muell') render(); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { render(); arm(); } });
render();
arm();
