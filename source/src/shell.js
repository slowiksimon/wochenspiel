// Standalone shell: boots the app on the household's own Firebase project.
// It defines window.claude (the tiny runtime the app was written against) before the app starts, and shows the
// setup / join / invite screens on top of the app until a connection exists.
import qrcode from 'qrcode-generator';
import * as C from './codec.js';
import * as A from './adapter.js';
import { starterTasks } from './seed.js';
import * as Lists from './lists.js';
import * as Muell from './muell.js';
import { iconSvg } from './nest.js';
import { lock, unlock } from './inert.js';

const VERSION = '2.1';
const BUILD = ((document.querySelector('meta[name="ws-build"]') || {}).content || '').slice(0, 6);
const LS = { conn: 'ws.v1', uid: 'ws.uid', me: 'wp2.me', installSeen: 'ws.install', draft: 'ws.draft' };
const CONSOLE_URL = 'https://console.firebase.google.com/';

/* ---------- storage that never throws ---------- */
const mem = new Map();
const store = {
  get(k) { try { const v = localStorage.getItem(k); if (v != null) return v; } catch (e) { /* blocked */ } return mem.has(k) ? mem.get(k) : null; },
  set(k, v) { mem.set(k, v); try { localStorage.setItem(k, v); } catch (e) { /* kept in memory */ } },
  del(k) { mem.delete(k); try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }
};
function loadConn() {
  try {
    const o = JSON.parse(store.get(LS.conn) || 'null');
    if (o && o.cfg && typeof o.cfg.projectId === 'string' && C.isRoom(o.room)) return { cfg: o.cfg, room: o.room };
  } catch (e) { /* ignore */ }
  return null;
}
const saveConn = conn => store.set(LS.conn, JSON.stringify({ v: 1, cfg: conn.cfg, room: conn.room }));
function getUid() {
  let u = store.get(LS.uid);
  if (!u) { u = C.makeUid(); store.set(LS.uid, u); }
  return u;
}
// The invite stays in the address (#j=…): iPhones may take the current address for the Home-Screen icon, and a Home-Screen
// app does not see Safari's storage, so this lets the icon connect itself on first start. It carries no player ("m"):
// whoever opens a copy of the address is asked who they are.
function keepInviteInUrl(conn) {
  try { history.replaceState(null, '', C.inviteUrl(location.pathname, { cfg: conn.cfg, room: conn.room })); } catch (e) { /* not essential */ }
}

// A half-finished setup survives closing the browser (people switch to the Firebase console and back, and phones
// discard background pages), so the form is kept on the device until the household exists.
function loadDraft() {
  try { const d = JSON.parse(store.get(LS.draft) || 'null'); if (d && d.v === 1) return d; } catch (e) { /* ignore */ }
  return null;
}
function saveDraft(patch) { store.set(LS.draft, JSON.stringify(Object.assign({ v: 1, step: 1, cfg: '', a: '', b: '' }, loadDraft() || {}, patch))); }
const clearDraft = () => store.del(LS.draft);

/* ---------- tiny DOM helper ---------- */
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  if (props) {
    for (const k of Object.keys(props)) {
      const v = props[k];
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'style') Object.assign(el.style, v);
      else if (k === 'value') el.value = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

/* ---------- environment ---------- */
const ua = navigator.userAgent || '';
const isIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isAndroid = /Android/.test(ua);
const isMobile = isIOS || isAndroid;
const isStandalone = () => (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
let installPrompt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e; });

/* ---------- the runtime the app talks to ---------- */
let session = null;
let readyResolve;
const ready = new Promise(r => { readyResolve = r; });
window.claude = {
  use(name) {
    if (name === 'db') return ready.then(s => s.db);
    if (name === 'user') return ready.then(s => s.user);
    return Promise.resolve(null);
  }
};

function startSession(conn) {
  if (session) return session;
  session = A.connect(conn.cfg, conn.room, { uid: getUid() });
  session.conn = conn;
  readyResolve(session);
  // shopping list and wish list sit next to the game; the game must start even if they ever fail
  try { Lists.start(session.db, { uid: getUid() }); } catch (e) { /* not essential */ }
  try { Muell.start(session.db); } catch (e) { /* not essential */ }
  return session;
}

/* ---------- overlay ---------- */
let ov = null;
function mount() {
  if (ov) return ov;
  ov = {
    root: h('div', { class: 'ws', id: 'ws', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Einrichtung', hidden: true }),
    title: h('h2', { text: '' }), step: h('span', { class: 'ws-step' }), back: h('button', { type: 'button', class: 'ws-back' }),
    body: h('div', { class: 'ws-wrap' })
  };
  ov.root.append(
    h('div', { class: 'ws-bar straw' }, ov.back, ov.title, ov.step),
    h('div', { class: 'ws-body' }, ov.body));
  document.body.append(ov.root);
  return ov;
}
function show(title, nodes, opts = {}) {
  const o = mount();
  o.title.textContent = title;
  o.step.textContent = opts.step || '';
  if (opts.back) { o.back.textContent = opts.backLabel || '‹ Zurück'; o.back.onclick = opts.back; o.back.style.visibility = 'visible'; }
  else { o.back.textContent = ''; o.back.onclick = null; o.back.style.visibility = 'hidden'; }
  o.body.replaceChildren(...[].concat(nodes).flat(Infinity).filter(Boolean));
  o.root.hidden = false;
  lock('ws');
  document.documentElement.classList.add('ws-open');
  const body = o.root.querySelector('.ws-body');
  if (body) body.scrollTop = 0;
}
function closeOverlay() {
  if (!ov) return;
  ov.root.hidden = true;
  unlock('ws');
  document.documentElement.classList.remove('ws-open');
}
const btn = (label, onclick, cls, sub) => h('button', { type: 'button', class: 'ws-btn ' + (cls || ''), onclick }, h('span', { class: 'ws-btn-l', text: label }), sub ? h('span', { class: 'ws-btn-s', text: sub }) : null);
const para = (text, cls) => h('p', { class: cls || '', text });
const spinner = () => h('span', { class: 'ws-spin', 'aria-hidden': 'true' });

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch (e) { /* fall back */ }
  try {
    const ta = h('textarea', { value: text, readonly: true, style: { position: 'fixed', top: '-1000px' } });
    document.body.append(ta); ta.select(); ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy'); ta.remove(); return ok;
  } catch (e) { return false; }
}
// shows `text` on a button for a moment; the original label is remembered on the element, so tapping again while the
// confirmation is still shown never turns the confirmation into the "original"
function flash(button, text) {
  const l = button.querySelector('.ws-btn-l') || button;
  if (l.dataset.orig == null) l.dataset.orig = l.textContent;
  l.textContent = text;
  clearTimeout(l._flash);
  l._flash = setTimeout(() => { l.textContent = l.dataset.orig; delete l.dataset.orig; }, 1600);
}

// something unexpected went wrong inside the shell: say so and offer a way out, never a blank page
function fatal(e) {
  const m = String((e && e.message) || e || '').slice(0, 160);
  show('Das hat nicht geklappt', [
    h('p', { class: 'ws-err', role: 'alert', text: 'Es ist ein unerwarteter Fehler aufgetreten' + (m ? ' (' + m + ')' : '') + '. Eure Daten sind in Firebase sicher.' }),
    btn('Neu laden', () => location.reload())
  ]);
}

/* ---------- screens ---------- */
function welcome() {
  show('Slowik', [
    h('div', { class: 'ws-hero' }, h('div', { html: iconSvg('app-icon') }), h('h3', { text: 'Willkommen!' })),
    para('Aufgaben gemeinsam abhaken, verschieben und Münzen sammeln. Eure Handys gleichen sich über euer eigenes, kostenloses Firebase-Projekt ab.', 'lead'),
    btn('Neu einrichten', () => setup(1), '', 'Ich lege den Haushalt an (ca. 10 Minuten)'),
    btn('Ich habe einen Einladungslink', () => join(''), 'alt', 'Die andere Person hat schon eingerichtet'),
    para('Eure Daten liegen in eurem eigenen Firebase-Projekt. Nur wer den Einladungslink hat, kommt heran.', 'ws-note')
  ]);
}

function join(prefill, note, back) {
  const ta = h('textarea', { id: 'ws-link', rows: '4', placeholder: 'Link hier einfügen', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', value: prefill || '' });
  const err = h('p', { class: 'ws-err', role: 'alert', hidden: !note, text: note || '' });
  const go = btn('Verbinden', () => {
    const inv = C.extractInvite(ta.value);
    if (!inv) { err.textContent = 'Das sieht nicht nach einem Einladungslink aus. Kopiere den ganzen Link aus der Nachricht.'; err.hidden = false; return; }
    connecting(inv);
  });
  const paste = navigator.clipboard && navigator.clipboard.readText
    ? btn('Aus Zwischenablage einfügen', async () => {
      try { ta.value = await navigator.clipboard.readText(); err.hidden = true; } catch (e) { err.textContent = 'Einfügen wurde blockiert. Halte das Feld gedrückt und wähle „Einfügen“.'; err.hidden = false; }
    }, 'alt')
    : null;
  show('Einladung', [
    para('Öffne die Nachricht mit dem Link, kopiere den ganzen Link und füge ihn hier ein.', 'lead'),
    ta, err, paste, go
  ], { back: back || welcome });
}

// leave the link alone and carry on with the household this phone already belongs to
function stay() {
  const own = loadConn();
  if (!own) { welcome(); return; }
  keepInviteInUrl(own);
  startSession(own);
  closeOverlay();
}

async function connecting(inv, { quiet } = {}) {
  try {
    const own = loadConn();
    const sameHousehold = !!own && own.room === inv.room && own.cfg.projectId === inv.cfg.projectId;
    const switching = !!own && !sameHousehold;
    show('Verbinde …', [h('div', { class: 'ws-wait' }, spinner(), para('Ich prüfe die Verbindung zu eurem Haushalt.'))]);
    const res = await A.probeRead(inv.cfg, inv.room);
    if (res.ok && res.exists) {
      saveConn(inv);
      if (inv.me) store.set(LS.me, inv.me); else if (!sameHousehold) store.del(LS.me);      // never carry the player over from another household
      clearDraft();
      startSession(inv);
      keepInviteInUrl(inv);
      if (!quiet && isMobile && !isStandalone() && !store.get(LS.installSeen)) installHelp(() => closeOverlay());
      else closeOverlay();
      return;
    }
    const msg = res.ok
      ? 'Diesen Haushalt gibt es nicht. Ist der Link vollständig kopiert? Er muss aus der gleichen Firebase-Datenbank stammen.'
      : A.explain(res.error, 'join');
    const retry = btn('Erneut versuchen', () => connecting(inv, { quiet }), switching ? 'alt' : '');
    show('Verbindung fehlgeschlagen', [
      h('p', { class: 'ws-err', role: 'alert', text: msg }),
      switching ? btn('Beim bisherigen Haushalt bleiben', stay) : null,
      retry,
      switching ? null : btn('Anderen Link einfügen', () => join(''), 'alt')
    ], { back: switching ? () => confirmSwitch(inv) : welcome });
  } catch (e) { fatal(e); }
}

/* setup wizard: 1 project, 2 database, 3 rules, 4 web app, 5 connect */
const STEPS = ['Projekt', 'Datenbank', 'Regeln', 'App', 'Verbinden'];
function dots(n) { return h('div', { class: 'ws-dots', role: 'img', 'aria-label': 'Schritt ' + n + ' von ' + STEPS.length }, STEPS.map((s, i) => h('i', { class: i + 1 === n ? 'on' : i + 1 < n ? 'done' : '' }))); }
// numbered steps: running text (strings and bold words) stays together in one paragraph, buttons and code blocks follow below it
const isInline = n => typeof n === 'string' || (n && n.nodeType === 1 && n.tagName === 'B');
const ol = items => h('ol', { class: 'ws-ol' }, items.map(x => {
  const parts = [].concat(x);
  const inline = parts.filter(isInline);
  return h('li', null, h('div', { class: 'ws-li' }, inline.length ? h('p', null, inline) : null, parts.filter(n => !isInline(n))));
}));
const hint = text => h('p', { class: 'ws-note', text });
const strong = t => h('b', { text: t });
function link(label, href) { return h('a', { class: 'ws-btn alt ws-ext', href, target: '_blank', rel: 'noopener noreferrer' }, h('span', { class: 'ws-btn-l', text: label })); }

function setup(n) {
  saveDraft({ step: n });
  const next = btn('Weiter', () => setup(n + 1));
  const back = n === 1 ? welcome : () => setup(n - 1);
  const o = { step: n + '/5', back };
  if (n === 1) {
    show('Projekt anlegen', [dots(n),
      para('Firebase ist die kostenlose Datenbank von Google, über die sich eure Handys abgleichen.', 'lead'),
      ol([
        ['Öffne die Firebase-Konsole und melde dich mit deinem Google-Konto an.', link('Firebase-Konsole öffnen', CONSOLE_URL)],
        ['Tippe auf ', strong('„Projekt erstellen“'), ' (Create a project) und gib einen Namen ein, zum Beispiel „Slowik“.'],
        ['Google Analytics brauchst du nicht. Schalte es aus, falls danach gefragt wird.'],
        ['Warte, bis das Projekt fertig ist. Dann hier auf „Weiter“.']
      ]),
      hint('Tipp: Am Computer geht das Einrichten bequemer. Du kannst jederzeit unterbrechen, die App merkt sich, wo du warst.'),
      next], o);
  } else if (n === 2) {
    show('Datenbank anlegen', [dots(n),
      ol([
        ['Öffne im Menü links ', strong('„Firestore“'), ' (unter „Erstellen“ bzw. „Datenbanken & Speicher“).'],
        ['Tippe auf ', strong('„Datenbank erstellen“'), ' (Create database).'],
        ['Datenbank-ID „(default)“ lassen. Wirst du nach der Edition gefragt: „Standard“. Standort: eine Region in Europa, zum Beispiel „eur3“ oder „europe-west3“. Der Standort lässt sich danach nicht mehr ändern.'],
        ['Regelmodus: ', strong('„Produktionsmodus“'), '. Dann „Erstellen“.']
      ]), next], o);
  } else if (n === 3) {
    const code = h('pre', { class: 'ws-code', tabindex: '0', text: C.FIRESTORE_RULES });
    const copy = btn('Regeln kopieren', async function () { const ok = await copyText(C.FIRESTORE_RULES); flash(this, ok ? 'Kopiert ✓' : 'Markiere den Text und kopiere ihn'); }, 'alt');
    show('Regeln einfügen', [dots(n),
      ol([
        ['Wechsle in Firestore oben auf den Tab ', strong('„Regeln“'), ' (Rules).'],
        ['Lösche den ganzen Text dort und füge diesen ein:', code, copy],
        ['Tippe auf ', strong('„Veröffentlichen“'), ' (Publish).']
      ]),
      hint('Die Regeln erlauben nur Zugriff auf Haushalte mit einem langen Zufalls-Code. Wer den Code nicht kennt, kommt nicht an eure Daten.'),
      next], o);
  } else if (n === 4) {
    show('Web-App registrieren', [dots(n),
      ol([
        ['Gehe in Firebase zur ', strong('Projektübersicht'), ' und tippe auf das Web-Symbol ', strong('</>'), '.'],
        ['Spitzname zum Beispiel „Slowik“. „Firebase Hosting“ nicht anhaken. Dann ', strong('„App registrieren“'), '.'],
        ['Du siehst einen Code-Block mit ', strong('firebaseConfig'), '. Kopiere ihn komplett (markieren, kopieren).']
      ]),
      hint('Später wiederfinden: Zahnrad ⚙ → Projekteinstellungen → Allgemein → Meine Apps → Konfiguration.'),
      next], o);
  } else {
    setupFinal(o);
  }
}

function setupFinal(o) {
  const draft = loadDraft() || {};
  const cfgText = h('textarea', { id: 'ws-cfg', rows: '6', placeholder: 'Konfiguration aus Firebase hier einfügen', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', value: draft.cfg || '' });
  const nameA = h('input', { type: 'text', id: 'ws-a', maxlength: '14', autocomplete: 'off', placeholder: 'Dein Name', value: draft.a || '' });
  const nameB = h('input', { type: 'text', id: 'ws-b', maxlength: '14', autocomplete: 'off', placeholder: 'Name der anderen Person', value: draft.b || '' });
  const keep = () => saveDraft({ cfg: cfgText.value, a: nameA.value, b: nameB.value });
  for (const f of [cfgText, nameA, nameB]) f.addEventListener('input', keep);
  const err = h('p', { class: 'ws-err', role: 'alert', hidden: true });
  const paste = navigator.clipboard && navigator.clipboard.readText
    ? btn('Aus Zwischenablage einfügen', async () => { try { cfgText.value = await navigator.clipboard.readText(); err.hidden = true; keep(); } catch (e) { /* user can paste by hand */ } }, 'alt') : null;
  const GO_LABEL = 'Verbindung testen und starten';
  const label = t => { const l = go.querySelector('.ws-btn-l'); if (l) l.textContent = t; };
  const go = btn(GO_LABEL, async () => {
    if (go.disabled) return;
    const fail = m => { err.textContent = m; err.hidden = false; go.disabled = false; go.classList.remove('busy'); label(GO_LABEL); };
    err.hidden = true;
    try {
      const parsed = C.parseFirebaseConfig(cfgText.value);
      if (!parsed.ok) {
        fail({
          empty: 'Füge zuerst die Konfiguration aus Firebase ein (Schritt 4).',
          'no-project': 'Ich finde keine „projectId“. Kopiere den ganzen Code-Block aus Firebase (Schritt 4).',
          'bad-project': 'Die Projekt-ID sieht ungewöhnlich aus. Kopiere den Code-Block noch einmal komplett.',
          'no-key': 'Ich finde keinen „apiKey“. Kopiere den ganzen Code-Block aus Firebase (Schritt 4).',
          'bad-key': 'Der API-Schlüssel sieht ungewöhnlich aus. Kopiere den Code-Block noch einmal komplett.'
        }[parsed.error] || 'Die Konfiguration konnte nicht gelesen werden.');
        return;
      }
      const a = nameA.value.trim(), b = nameB.value.trim();
      if (!a || !b) { fail('Bitte gib euch beiden einen Namen.'); return; }
      go.disabled = true; go.classList.add('busy'); label('Teste die Verbindung …');
      const room = C.makeRoomCode();
      const res = await A.probeWrite(parsed.cfg, room);
      if (!res.ok) { fail(A.explain(res.error, 'setup')); return; }
      label('Lege den Haushalt an …');
      const conn = { cfg: parsed.cfg, room };
      const people = { a, b, reward: 'Pizza-Abend 🍕', goal: 80, aId: getUid() };
      // The household is written with a throw-away connection. Only when the server has confirmed everything does this
      // phone save the connection and start its real session, so a failed attempt leaves nothing behind and can be repeated.
      const tmp = A.connect(conn.cfg, conn.room, { uid: getUid(), persistent: false });
      try {
        await tmp.seed(people, starterTasks(C.mondayKey(new Date()), Date.now()));
      } catch (e) { await tmp.close(); fail('Der Haushalt konnte nicht angelegt werden. ' + A.explain(A.normError(e), 'setup')); return; }
      await tmp.close();
      saveConn(conn);
      store.set(LS.me, 'a');
      clearDraft();
      const s = startSession(conn);
      s.people = { a, b };
      keepInviteInUrl(conn);
      invite({ fresh: true });
    } catch (e) { fail('Unerwarteter Fehler: ' + String((e && e.message) || e).slice(0, 160)); }
  });
  show('Verbinden', [dots(5),
    h('div', { class: 'ws-field' }, h('label', { for: 'ws-cfg', text: 'Konfiguration aus Firebase' }), cfgText, paste),
    h('div', { class: 'ws-field' }, h('label', { for: 'ws-a' }, h('span', { class: 'ini ini-s who-a', text: '1' }), 'Dein Name (Blau)'), nameA),
    h('div', { class: 'ws-field' }, h('label', { for: 'ws-b' }, h('span', { class: 'ini ini-s who-b', text: '2' }), 'Name der anderen Person (Rot)'), nameB),
    err, go], o);
}

/* invite: link + QR for the other phone (or a second device of your own) */
function qrSvg(text) {
  const qr = qrcode(0, 'M');
  qr.addData(text, 'Byte');
  qr.make();
  const n = qr.getModuleCount(), q = 3;
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += 'M' + (c + q) + ',' + (r + q) + 'h1v1h-1z';
  const size = n + q * 2;
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + size + ' ' + size + '" shape-rendering="crispEdges" role="img" aria-label="QR-Code zum Verbinden"><rect width="' + size + '" height="' + size + '" fill="#fff"/><path d="' + d + '" fill="#000"/></svg>';
}
async function peopleNames() {
  if (session && session.people) return session.people;
  let p = { a: 'Person 1', b: 'Person 2' };
  try {
    const snap = await session.db.doc('settings/people').get();
    const d = snap.exists ? snap.data() : null;
    if (d) p = { a: String(d.a || p.a).slice(0, 14), b: String(d.b || p.b).slice(0, 14) };
  } catch (e) { /* keep defaults */ }
  session.people = p;
  return p;
}
async function invite({ fresh, back } = {}) {
  if (!session) return;
  const names = await peopleNames();
  const me = store.get(LS.me) === 'b' ? 'b' : 'a';
  const partner = me === 'a' ? 'b' : 'a';
  let target = partner;
  const base = location.origin + location.pathname;
  const out = h('div', { class: 'ws-invite' });
  const finishBtn = btn(fresh ? 'Weiter' : 'Fertig', () => {
    if (fresh && isMobile && !isStandalone() && !store.get(LS.installSeen)) installHelp(() => closeOverlay());
    else closeOverlay();
  });
  function paint() {
    const url = C.inviteUrl(base, { cfg: session.conn.cfg, room: session.conn.room, me: target });
    const seg = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Einladung für' },
      [[partner, 'Für ' + names[partner]], [me, 'Mein 2. Handy']].map(([w, label]) =>
        h('button', { type: 'button', role: 'radio', class: 'opt who-' + w, 'aria-checked': String(target === w), onclick: () => { target = w; paint(); } },
          h('span', { class: 'ini ini-s who-' + w, text: (names[w][0] || '?').toUpperCase() }), h('span', { class: 'on-name', text: label }))));
    const field = h('input', { type: 'text', readonly: true, value: url, 'aria-label': 'Einladungslink', onfocus: e => e.target.select() });
    const share = navigator.share
      ? btn('Link teilen', async () => { try { await navigator.share({ title: 'Slowik', text: 'Hier ist Slowik, unser Wochenplan. Link öffnen und „Zum Home-Bildschirm“ wählen.', url }); } catch (e) { /* cancelled */ } })
      : null;
    const copy = btn('Link kopieren', async function () { const ok = await copyText(url); flash(this, ok ? 'Kopiert ✓' : 'Markiere den Link und kopiere ihn'); }, share ? 'alt' : '');
    out.replaceChildren(...[seg, h('div', { class: 'ws-qr', html: qrSvg(url) }), para('Mit der Kamera scannen, oder den Link verschicken.', 'ws-note ws-center'), field, share, copy].filter(Boolean));
  }
  paint();
  show(fresh ? 'Geschafft!' : 'Einladen', [
    fresh ? para('Euer Haushalt steht. Dein Handy ist schon verbunden. Jetzt die andere Person:', 'lead') : para('Öffne den Link auf dem anderen Handy, dann ist es sofort verbunden.', 'lead'),
    out,
    para('Der Link ist wie ein Passwort: Wer ihn hat, kann eure Liste sehen und ändern. Teile ihn nur untereinander.', 'ws-note'),
    finishBtn
  ], fresh ? {} : { back: back || closeOverlay, backLabel: '‹ Zurück zur App' });
}

/* add to home screen */
function installHelp(done, opts = {}) {
  store.set(LS.installSeen, '1');
  const steps = isIOS
    ? [
      ['Öffne die App in ', strong('Safari'), ' (in WhatsApp & Co.: unten rechts „In Safari öffnen“).'],
      ['Tippe auf das Teilen-Symbol (Quadrat mit Pfeil), oder auf ⋯ und dann „Teilen“.'],
      ['Wähle ', strong('„Zum Home-Bildschirm“'), '. Falls es „Als Web-App öffnen“ gibt: einschalten. Dann „Hinzufügen“.'],
      ['Öffne die App künftig über das neue Symbol. Fragt sie dort nach einem Einladungslink (iPhones trennen Safari und Home-Bildschirm): Kopiere den Link noch einmal, aus der Nachricht oder in Safari unter „Ich“ → „Einladen / QR-Code“ → „Mein 2. Handy“, und füge ihn in der App ein.']
    ]
    : isAndroid
      ? [
        ['Tippe in Chrome oben rechts auf ', strong('⋮'), '.'],
        ['Wähle ', strong('„App installieren“'), ' (oder „Zum Startbildschirm hinzufügen“).'],
        ['Öffne die App künftig über das neue Symbol.']
      ]
      : [
        ['Öffne das Menü deines Browsers und wähle „Installieren“ oder „Zum Startbildschirm hinzufügen“.'],
        ['Die App läuft danach wie eine normale App mit eigenem Symbol.']
      ];
  const install = installPrompt
    ? btn('Jetzt installieren', async () => { try { installPrompt.prompt(); await installPrompt.userChoice; } catch (e) { /* ignore */ } installPrompt = null; })
    : null;
  show('Aufs Handy legen', [
    para('Damit die App wie eine richtige App startet, lege sie auf den Home-Bildschirm.', 'lead'),
    ol(steps), install,
    btn('Verstanden', done, install ? 'alt' : '')
  ], opts.back ? { back: opts.back, backLabel: '‹ Zurück zur App' } : {});
}

// a link for another household than the one this phone belongs to: show both, so nobody switches by accident
function confirmSwitch(inv) {
  const own = loadConn();
  if (!own) { connecting(inv); return; }
  show('Anderer Haushalt', [
    para('Dieses Handy gehört schon zu einem Haushalt (' + C.shortRoom(own.room) + '). Der Link gehört zu einem anderen (' + C.shortRoom(inv.room) + '). Möchtest du wechseln?', 'lead'),
    btn('Beim bisherigen bleiben', stay),
    btn('Zum neuen Haushalt wechseln', () => connecting(inv), 'alt'),
    para('Die Aufgaben des bisherigen Haushalts bleiben in Firebase erhalten. Um später dorthin zurückzukehren, brauchst du dessen Einladungslink.', 'ws-note')
  ]);
}

/* ---------- block inside the app's settings sheet ---------- */
function settingsBlock() {
  if (!session) return null;
  const online = () => (navigator.onLine === false ? 'Offline' : 'Online');
  const reset = h('button', { type: 'button', class: 'ws-del' }, 'Von diesem Haushalt trennen');
  let armed = false, timer = 0, armedAt = 0;
  reset.addEventListener('click', () => {
    if (!armed) {
      armed = true; armedAt = Date.now(); reset.classList.add('is-armed'); reset.textContent = 'Wirklich trennen?';
      clearTimeout(timer); timer = setTimeout(() => { armed = false; reset.classList.remove('is-armed'); reset.textContent = 'Von diesem Haushalt trennen'; }, 3500);
      return;
    }
    if (Date.now() - armedAt < 400) return;                                   // the same double tap
    store.del(LS.conn); store.del(LS.me); store.del(LS.installSeen); clearDraft();
    location.replace(location.pathname);
  });
  return h('div', { class: 'ws-set' },
    h('h4', { text: 'Verbindung' }),
    h('p', { class: 'ws-meta', text: 'Haushalt ' + C.shortRoom(session.conn.room) + ' · ' + online() + ' · Version ' + VERSION + (BUILD ? ' (' + BUILD + ')' : '') }),
    h('div', { class: 'ws-set-row' },
      h('button', { type: 'button', class: 'ws-mini', onclick: () => invite({ back: closeOverlay }) }, 'Einladen / QR-Code'),
      h('button', { type: 'button', class: 'ws-mini', onclick: () => installHelp(closeOverlay, { back: closeOverlay }) }, 'Aufs Handy legen')),
    reset);
}
window.__WS = { settingsBlock, version: VERSION };

/* ---------- boot ---------- */
function registerWorker() {
  if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').then(reg => reg.update()).catch(() => { /* the app works without it (and updating needs a network) */ });
  });
}
// the page was opened as a file from a computer or a phone's file manager: nothing can work from there
function fileGuard() {
  show('Slowik', [
    h('div', { class: 'ws-hero' }, h('div', { html: iconSvg('app-icon') }), h('h3', { text: 'Noch nicht im Netz' })),
    para('Du hast diese Datei direkt auf dem Gerät geöffnet. So kann die App nicht funktionieren: Sie muss im Internet liegen, damit eure Handys sie öffnen können.', 'lead'),
    para('Lade alle Dateien aus dem ZIP bei GitHub hoch und schalte dort „Pages“ ein (siehe Anleitung, Teil 1). Öffne danach die Adresse, die GitHub dir nennt. Sie beginnt mit https://.')
  ]);
}
function boot() {
  registerWorker();
  if (location.protocol === 'file:') { fileGuard(); return; }
  try {
    const conn = loadConn();
    const inv = C.extractInvite(location.hash);
    if (inv) {
      const same = conn && conn.room === inv.room && conn.cfg.projectId === inv.cfg.projectId;
      if (!conn) { connecting(inv); return; }
      if (!same) { confirmSwitch(inv); return; }
    }
    if (conn) { startSession(conn); return; }
    const d = loadDraft();
    if (d && (d.step >= 2 || d.cfg || d.a || d.b)) { setup(d.step >= 1 && d.step <= 5 ? d.step : 1); return; }
    welcome();
  } catch (e) { fatal(e); }
}
boot();
