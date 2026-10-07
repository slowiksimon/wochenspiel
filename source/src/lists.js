// Shopping list and wish list: the two screens behind the "Einkauf" and "Wünsche" tabs.
// Data and rules for the items are in lists-core.js; they live in the household's own Firebase like everything else.
import * as L from './lists-core.js';
import { h, $, ico } from './dom.js';
import { toast as say } from './toast.js';
import { nestSvg } from './nest.js';
import { setBadge } from './nav.js';
import { openSheet, closeSheet, sheetBar } from './sheet.js';

const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);
const tick = () => { try { if (navigator.vibrate) navigator.vibrate(8); } catch (e) { /* not supported */ } };
// the faint nest outline in the corner of a hero
const deco = () => { const t = document.createElement('template'); t.innerHTML = nestSvg('hero-deco'); return t.content.firstElementChild; };
const shortLink = u => { const s = u.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/$/, ''); return s.length > 34 ? s.slice(0, 33) + '…' : s; };
// how important a wish is: three beads, all filled for "Wichtig", one for "Irgendwann"
const beads = n => h('span', { class: 'beads', role: 'img', 'aria-label': 'Wichtigkeit ' + (4 - n) + ' von 3' }, [1, 2, 3].map(i => h('i', { class: i <= 4 - n ? 'on' : '' })));
const checkEl = done => (done ? h('span', { class: 'chk chk-done', 'aria-hidden': 'true' }, ico('check')) : h('span', { class: 'chk', 'aria-hidden': 'true' }, ico('loop')));
const emptyEl = (icon, head, text) => h('div', { class: 'li-empty' }, h('span', { class: 'eic', 'aria-hidden': 'true' }, ico(icon)), h('strong', { text: head }), text ? h('p', { text }) : null);

let started = false;

export function start(db, { uid } = {}) {
  const shopScreen = $('#screen-shop'), wishScreen = $('#screen-wish');
  if (started || !db || !shopScreen || !wishScreen) return;
  started = true;

  const S = {
    shop: [], wish: [], loaded: false, failed: false,
    people: { a: '', b: '', aId: null, bId: null },
    offline: navigator.onLine === false, stuck: false
  };
  const personName = w => (w === 'a' ? S.people.a || 'Person 1' : S.people.b || 'Person 2');
  const ini = w => (personName(w)[0] || '?').toUpperCase();
  // who this phone belongs to: the same rule the game uses (own id in the household, else the choice made on this phone)
  function me() {
    const p = S.people;
    if (uid && p.aId === uid) return 'a';
    if (uid && p.bId === uid) return 'b';
    try { const l = localStorage.getItem('wp2.me'); if (l === 'a' || l === 'b') return l; } catch (e) { /* blocked */ }
    return null;
  }

  /* ---------- the shopping screen ---------- */
  const shopCap = h('p', { class: 'cap' });
  const shopInput = h('input', { type: 'text', id: 'li-add', maxlength: String(L.MAX_TITLE), enterkeyhint: 'done', autocomplete: 'off', autocapitalize: 'sentences', placeholder: 'Was fehlt? z. B. Milch', 'aria-label': 'Neuer Einkauf' });
  const addForm = h('form', { class: 'li-add', onsubmit: e => { e.preventDefault(); addShop(); } },
    ico('plus'), shopInput, h('button', { type: 'submit', class: 'li-plus', id: 'li-plus', text: 'Hinzufügen' }));
  shopInput.addEventListener('paste', e => {
    const tx = (e.clipboardData && e.clipboardData.getData('text')) || '';
    if (/[\n\r]/.test(tx.trim())) { e.preventDefault(); importSheet(tx); }
  });
  const impBtn = h('button', { type: 'button', class: 'pillbtn', id: 'li-import', onclick: () => importSheet('') }, ico('paste'), 'Liste einfügen');
  const shopStatus = h('p', { class: 'li-status', role: 'status', hidden: true });
  const shopItems = h('div', { class: 'li-items', id: 'li-shop-items' });
  shopScreen.append(
    h('header', { class: 'hero hero-list straw' }, deco(),
      h('div', { class: 'hero-in' },
        h('div', { class: 'head' },
          h('div', { class: 'cap-row' }, shopCap),
          h('div', { class: 'ttl-row' }, h('h1', { class: 'ttl', text: 'Einkauf' })),
          h('div', { class: 'head-btns' }, impBtn)),
        addForm)),
    h('div', { class: 'li-wrap' }, shopStatus, shopItems));

  /* ---------- the wish screen ---------- */
  const wishCap = h('p', { class: 'cap' });
  const newWish = h('button', { type: 'button', class: 'plus-btn', id: 'li-new-wish', 'aria-label': 'Wunsch hinzufügen', onclick: () => wishSheet(null) }, ico('plus'));
  const sum = h('p', { class: 'li-sum' });
  const total = h('p', { class: 'li-total' });
  const bar = h('div', { class: 'li-bar', 'aria-hidden': 'true' });
  const sumBox = h('div', { class: 'li-hero-sum', hidden: true }, sum, total, bar);
  const wishStatus = h('p', { class: 'li-status', role: 'status', hidden: true });
  const wishItems = h('div', { class: 'li-items', id: 'li-wish-items' });
  wishScreen.append(
    h('header', { class: 'hero hero-list hero-wish straw' }, deco(),
      h('div', { class: 'hero-in' },
        h('div', { class: 'head' },
          h('div', { class: 'cap-row' }, wishCap),
          h('div', { class: 'ttl-row' }, h('h1', { class: 'ttl', text: 'Wünsche' })),
          h('div', { class: 'head-btns' }, newWish)),
        sumBox)),
    h('div', { class: 'li-wrap' }, wishStatus, wishItems));

  /* ---------- small helpers ---------- */
  const toast = (msg, undo) => say(msg, undo ? { undo } : undefined);
  // a button that needs a second tap within a few seconds (deleting more than one thing, or something that is not one tap to redo)
  function armable(btn, label, armedLabel, action) {
    let armed = false, timer = 0, armedAt = 0;
    const set = t => { const l = btn.querySelector('.al'); if (l) l.textContent = t; else btn.textContent = t; };
    set(label);
    btn.addEventListener('click', () => {
      if (!armed) {
        armed = true; armedAt = Date.now(); btn.classList.add('is-armed'); set(armedLabel);
        clearTimeout(timer); timer = setTimeout(() => { armed = false; btn.classList.remove('is-armed'); set(label); }, 3500);
        return;
      }
      if (Date.now() - armedAt < 400) return;                                 // the same double tap
      clearTimeout(timer); armed = false; action();
    });
    return btn;
  }
  // repainting must not throw a keyboard user out of the row they are on
  function keepFocus(fn) {
    const ae = document.activeElement;
    const row = ae && ae.closest ? ae.closest('[data-id]') : null;
    const id = row && row.dataset.id, cls = ae && ae.classList && ['li-main', 'li-tick', 'li-del', 'li-title'].find(c => ae.classList.contains(c));
    fn();
    if (id && cls) {
      const el = document.querySelector('[data-id="' + CSS.escape(id) + '"] .' + cls);
      if (el) { try { el.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
    }
  }

  /* ---------- writing ---------- */
  const failed = () => toast('Das konnte nicht gespeichert werden. Prüfe dein Internet und versuche es noch einmal.');
  const send = p => { Promise.resolve(p).catch(failed); };
  const ref = id => db.doc('settings/' + id);
  const shopDoc = it => { const d = { t: it.t, at: it.at, done: it.done }; if (it.by) d.by = it.by; if (it.done) d.doneAt = it.doneAt; return d; };
  const wishDoc = w => {
    const d = { t: w.t, at: w.at, prio: w.prio, got: w.got };
    if (w.price != null) d.price = w.price;
    if (w.note) d.note = w.note;
    if (w.by) d.by = w.by;
    if (w.got) d.gotAt = w.gotAt;
    return d;
  };
  const putShop = it => send(ref(it.id).set(shopDoc(it)));
  const putWish = w => send(ref(w.id).set(wishDoc(w)));
  const drop = id => send(ref(id).delete());

  function addShop() {
    const t = shopInput.value.replace(/\s+/g, ' ').trim().slice(0, L.MAX_TITLE);
    if (!t) return;
    const same = S.shop.filter(i => L.norm(i.t) === L.norm(t));
    const open = same.find(i => !i.done), ticked = same.find(i => i.done);
    if (open) { toast('„' + open.t + '“ steht schon auf der Liste'); }
    else if (ticked) { putShop(Object.assign({}, ticked, { done: false, doneAt: 0 })); toast('„' + ticked.t + '“ wieder auf der Liste'); }
    else putShop({ id: L.newId(L.SHOP), t, by: me(), at: Date.now(), done: false, doneAt: 0 });
    shopInput.value = '';
    shopInput.focus({ preventScroll: true });
  }
  // several titles at once (pasted list): new ones are added, ticked ones come back, ones already open are skipped
  function addMany(titles) {
    let added = 0, back = 0, skipped = 0;
    const t0 = Date.now();
    titles.forEach((t, i) => {
      const same = S.shop.filter(x => L.norm(x.t) === L.norm(t));
      const open = same.find(x => !x.done), ticked = same.find(x => x.done);
      if (open) skipped++;
      else if (ticked) { putShop(Object.assign({}, ticked, { done: false, doneAt: 0 })); back++; }
      else { putShop({ id: L.newId(L.SHOP), t, by: me(), at: t0 + (titles.length - i), done: false, doneAt: 0 }); added++; }
    });
    return { added, back, skipped };
  }
  function toggleShop(it) {
    tick();
    putShop(Object.assign({}, it, it.done ? { done: false, doneAt: 0 } : { done: true, doneAt: Date.now() }));
  }
  function removeShop(it) {
    drop(it.id);
    toast('„' + it.t + '“ entfernt', () => putShop(it));
  }
  function clearDone() {
    const gone = S.shop.filter(i => i.done);
    if (!gone.length) return;
    for (const it of gone) drop(it.id);
    toast(plural(gone.length, 'Eintrag entfernt', 'Einträge entfernt'), () => gone.forEach(putShop));
  }
  function toggleWish(w) {
    tick();
    putWish(Object.assign({}, w, w.got ? { got: false, gotAt: 0 } : { got: true, gotAt: Date.now() }));
  }

  /* ---------- painting ---------- */
  function paint() {
    const nShop = S.shop.filter(i => !i.done).length;
    setBadge('shop', nShop);
    $('#open-shop').setAttribute('aria-label', 'Einkauf' + (nShop ? ', ' + nShop + ' offen' : ''));
    paintStatus(); paintShop(); paintWish();
  }
  function paintStatus() {
    const m = S.failed ? 'Die Listen können gerade nicht geladen werden. Prüfe dein Internet.'
      : S.stuck ? 'Noch nicht gesendet: Der Server antwortet gerade nicht. Eure Änderungen bleiben auf diesem Handy und werden nachgeschickt.'
        : S.offline ? 'Du bist offline. Änderungen werden gesendet, sobald du wieder Netz hast.' : '';
    for (const el of [shopStatus, wishStatus]) { el.textContent = m; el.hidden = !m; }
  }

  function shopRow(it) {
    return h('li', { class: 'row li-row who-' + (it.by || 'both') + (it.done ? ' done' : ''), dataset: { id: it.id } },
      h('button', { type: 'button', class: 'li-main', role: 'checkbox', 'aria-checked': String(it.done), onclick: () => toggleShop(it) },
        checkEl(it.done), h('span', { class: 'li-text', text: it.t }),
        it.by ? h('span', { class: 'ini', title: personName(it.by), text: ini(it.by) }) : null),
      h('button', { type: 'button', class: 'li-del', 'aria-label': '„' + it.t + '“ entfernen', onclick: () => removeShop(it) }, ico('x')));
  }
  function paintShop() {
    const open = S.shop.filter(i => !i.done), done = S.shop.filter(i => i.done), nodes = [];
    shopCap.textContent = !S.loaded ? '' : !S.shop.length ? 'Noch nichts auf der Liste' : open.length + ' offen' + (done.length ? ', ' + done.length + ' abgehakt' : '');
    if (!S.loaded) nodes.push(emptyEl('cart', 'Lade …'));
    else if (!open.length && !done.length) nodes.push(emptyEl('cart', 'Die Liste ist leer', 'Trag ein, was ihr beim nächsten Einkauf braucht. Ihr beide seht sie sofort.'));
    else if (!open.length) nodes.push(emptyEl('check', 'Alles besorgt', 'Nichts mehr auf der Liste.'));
    if (open.length) nodes.push(h('ul', { class: 'card li-list', 'aria-label': 'Noch zu besorgen' }, open.map(shopRow)));
    if (done.length) {
      const clear = armable(h('button', { type: 'button', class: 'clear li-clear' }, ico('trash'), h('span', { class: 'al' })), 'Abgehakte entfernen', 'Wirklich entfernen?', clearDone);
      nodes.push(h('div', { class: 'sect' }, h('h3', null, 'Abgehakt', h('span', { class: 'cnt', text: String(done.length) })), clear));
      nodes.push(h('ul', { class: 'card li-list', 'aria-label': 'Abgehakt' }, done.map(shopRow)));
    }
    keepFocus(() => shopItems.replaceChildren(...nodes));
  }

  function wishCard(w) {
    const note = w.note ? h('p', { class: 'li-note' }, L.linkify(w.note).map(s => (s.href ? h('a', { href: s.href, target: '_blank', rel: 'noopener noreferrer', title: s.href }, ico('link'), shortLink(s.text)) : s.text))) : null;
    return h('li', { class: 'row li-card who-' + (w.by || 'both') + (w.got ? ' got' : '') + (note ? ' has-note' : ''), dataset: { id: w.id } },
      h('button', { type: 'button', class: 'li-tick', role: 'checkbox', 'aria-checked': String(w.got), 'aria-label': '„' + w.t + '“ angeschafft', onclick: () => toggleWish(w) }, checkEl(w.got)),
      h('div', { class: 'li-body', onclick: e => { if (!e.target.closest('a, button')) wishSheet(w); } },
        h('div', { class: 'li-top' }, h('button', { type: 'button', class: 'li-title', onclick: () => wishSheet(w), text: w.t }), w.price != null ? h('span', { class: 'li-price', text: L.fmtEur(w.price) }) : null),
        w.by ? h('div', { class: 'li-foot' }, h('i', { class: 'dot' }), 'von ' + personName(w.by)) : null,
        note));
  }
  function paintWish() {
    const open = S.wish.filter(w => !w.got), got = S.wish.filter(w => w.got), nodes = [];
    const tot = L.wishTotals(S.wish);
    wishCap.textContent = !S.loaded ? '' : !S.wish.length ? 'Noch keine Wünsche' : open.length + ' offen' + (got.length ? ', ' + got.length + ' angeschafft' : '');
    /* what all open wishes cost together, and how that splits over the three priorities */
    sumBox.hidden = !tot.n;
    if (tot.n) {
      sum.textContent = !tot.priced ? 'Noch kein Preis eingetragen' : tot.priced < tot.n ? 'Zusammen, ' + tot.priced + ' von ' + tot.n + ' mit Preis' : tot.n === 1 ? 'Ein Wunsch mit Preis' : 'Zusammen, alle ' + tot.n + ' mit Preis';
      total.textContent = tot.priced ? L.fmtEur(tot.total) : '';
      total.hidden = !tot.priced;
      const parts = L.PRIOS.map(o => ({ n: o.n, v: open.filter(w => w.prio === o.n && w.price != null).reduce((s, w) => s + w.price, 0) })).filter(p => p.v > 0);
      bar.replaceChildren(...parts.map(p => h('i', { class: 'p' + p.n, style: { flex: p.v + ' 1 6px' } })));
      bar.hidden = !parts.length;
    }
    if (!S.loaded) nodes.push(emptyEl('sparkle', 'Lade …'));
    else if (!S.wish.length) nodes.push(emptyEl('sparkle', 'Noch keine Wünsche', 'Sammelt hier, was ihr euch langfristig anschaffen wollt: ein neues Sofa, ein Urlaub, ein Auto …'));
    for (const o of L.PRIOS) {
      const g = open.filter(w => w.prio === o.n);
      if (g.length) nodes.push(h('h3', { class: 'li-group' }, o.label, beads(o.n)), h('ul', { class: 'card li-list', 'aria-label': o.label }, g.map(wishCard)));
    }
    if (got.length) nodes.push(h('h3', { class: 'li-group' }, 'Angeschafft'), h('ul', { class: 'card li-list', 'aria-label': 'Angeschafft' }, got.map(wishCard)));
    keepFocus(() => wishItems.replaceChildren(...nodes));
  }

  /* ---------- sheets: the wish editor and "paste a list" (see sheet.js) ---------- */

  function wishSheet(w) {
    const editing = !!w;
    let prio = w ? w.prio : 2;
    const t = h('input', { type: 'text', id: 'wish-t', maxlength: String(L.MAX_TITLE), autocomplete: 'off', autocapitalize: 'sentences', placeholder: 'z. B. Neue Waschmaschine', value: w ? w.t : '' });
    const p = h('input', { type: 'text', id: 'wish-p', inputmode: 'decimal', maxlength: '12', autocomplete: 'off', placeholder: 'z. B. 1.299', value: w ? L.priceText(w.price) : '' });
    const n = h('textarea', { id: 'wish-n', rows: '3', maxlength: String(L.MAX_NOTE), placeholder: 'Modell, Link zum Angebot, warum …', value: w ? w.note : '' });
    const err = h('p', { class: 'err', role: 'alert', hidden: true });
    const showErr = m => { err.textContent = m; err.hidden = false; };
    const seg = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Wie wichtig?' });
    const paintSeg = () => seg.replaceChildren(...L.PRIOS.map(o => h('button', { type: 'button', role: 'radio', class: 'opt', 'aria-checked': String(prio === o.n), onclick: () => { prio = o.n; paintSeg(); } }, beads(o.n), h('span', { text: o.label }))));
    function save() {
      const name = t.value.replace(/\s+/g, ' ').trim().slice(0, L.MAX_TITLE);
      if (!name) { showErr('Gib dem Wunsch einen Namen.'); t.focus(); return; }
      const pr = L.parsePrice(p.value);
      if (!pr.ok) { showErr('Den Preis verstehe ich nicht. Schreib ihn zum Beispiel als 1.299 oder 49,90.'); p.focus(); return; }
      // an existing wish is changed on top of what it is now (the other phone may have ticked it while this sheet was open)
      const live = w && S.wish.find(x => x.id === w.id);
      const next = w ? Object.assign({}, live || w) : { id: L.newId(L.WISH), by: me(), at: Date.now(), got: false, gotAt: 0 };
      Object.assign(next, { t: name, price: pr.value, note: n.value.trim().slice(0, L.MAX_NOTE), prio });
      putWish(next);
      closeSheet();
      toast(editing ? 'Gespeichert' : 'Wunsch hinzugefügt');
    }
    const enter = e => { if (e.key === 'Enter') { e.preventDefault(); save(); } };
    t.addEventListener('keydown', enter); p.addEventListener('keydown', enter);
    const del = editing ? armable(h('button', { type: 'button', class: 'del', id: 'wish-del' }), 'Wunsch löschen', 'Wirklich löschen?', () => { drop(w.id); closeSheet(); toast('„' + w.t + '“ gelöscht', () => putWish(w)); }) : null;
    const el = h('div', { class: 'modal li-sheet', id: 'li-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': editing ? 'Wunsch bearbeiten' : 'Neuer Wunsch' },
      sheetBar(h('button', { type: 'button', class: 'cancel', id: 'wish-cancel', onclick: () => closeSheet(), text: 'Abbrechen' }), editing ? 'Wunsch' : 'Neuer Wunsch',
        h('button', { type: 'button', class: 'save', id: 'wish-save', onclick: save, text: 'Speichern' })),
      h('div', { class: 'modal-body' }, h('div', { class: 'wrap' },
        h('div', { class: 'field' }, h('label', { class: 'lab', for: 'wish-t', text: 'Was wünscht ihr euch?' }), t),
        h('div', { class: 'field' }, h('label', { class: 'lab', for: 'wish-p' }, h('span', { text: 'Preis ungefähr' }), h('small', { text: 'freiwillig, in Euro' })), p),
        h('div', { class: 'field' }, h('div', { class: 'lab', text: 'Wie wichtig?' }), seg),
        h('div', { class: 'field' }, h('label', { class: 'lab', for: 'wish-n' }, h('span', { text: 'Notiz oder Link' }), h('small', { text: 'freiwillig' })), n),
        err, del)));
    paintSeg();
    openSheet(el);
    if (!editing) t.focus({ preventScroll: true }); else el.querySelector('.cancel').focus({ preventScroll: true });
  }

  /* paste a whole list */
  function importSheet(prefill) {
    const ta = h('textarea', { id: 'imp-t', rows: '8', placeholder: 'Hier einfügen, zum Beispiel:\nMilch\n2 Brote\nÄpfel', value: prefill || '' });
    const info = h('p', { class: 'li-imp-n', role: 'status' });
    const save = h('button', { type: 'button', class: 'save', id: 'imp-save', text: 'Hinzufügen' });
    const upd = () => {
      const r = L.parseList(ta.value);
      info.textContent = !ta.value.trim() ? 'Jede Zeile wird ein eigener Punkt. Aufzählungszeichen und Nummern werden entfernt.' : r.items.length ? plural(r.items.length, 'Punkt wird hinzugefügt', 'Punkte werden hinzugefügt') + (r.cut ? ' (' + r.cut + ' weitere sind zu viel)' : '') : 'Keine Punkte gefunden.';
      save.disabled = !r.items.length;
    };
    ta.addEventListener('input', upd);
    save.addEventListener('click', () => {
      const r = L.parseList(ta.value);
      if (!r.items.length) return;
      const res = addMany(r.items);
      closeSheet();
      const parts = [plural(res.added + res.back, 'Punkt hinzugefügt', 'Punkte hinzugefügt')];
      if (res.skipped) parts.push(res.skipped + ' standen schon drauf');
      toast(res.added + res.back ? parts.join(', ') : 'Alles stand schon auf der Liste');
    });
    const el = h('div', { class: 'modal li-sheet', id: 'li-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Liste einfügen' },
      sheetBar(h('button', { type: 'button', class: 'cancel', id: 'imp-cancel', onclick: () => closeSheet(), text: 'Abbrechen' }), 'Liste einfügen', save),
      h('div', { class: 'modal-body' }, h('div', { class: 'wrap' },
        h('div', { class: 'field' }, h('label', { class: 'lab', for: 'imp-t', text: 'Eure Liste' }), ta), info)));
    upd();
    openSheet(el);
    ta.focus({ preventScroll: true });
  }

  /* ---------- live data ---------- */
  // One listener on the settings collection brings the items and the names (settings/people is one of its documents).
  // (Every listener costs the test server one connection of the six a browser opens to one host; the real SDK shares one.)
  const peopleOf = doc => {
    let d = null; try { d = doc ? doc.data() : null; } catch (e) { d = null; }
    d = d && typeof d === 'object' ? d : {};
    const s = v => (typeof v === 'string' ? v.trim().slice(0, 14) : '');
    return { a: s(d.a), b: s(d.b), aId: typeof d.aId === 'string' ? d.aId : null, bId: typeof d.bId === 'string' ? d.bId : null };
  };
  db.collection('settings').onSnapshot(snap => {
    const r = L.parseItems(snap.docs);
    S.shop = r.shop; S.wish = r.wish; S.loaded = true; S.failed = false;
    S.people = peopleOf(snap.docs.find(d => d.id === 'people'));
    paint();
  }, () => { S.failed = true; S.loaded = true; paint(); });
  window.addEventListener('ws:unsent', ev => { S.stuck = !!(ev.detail && ev.detail.stuck); paintStatus(); });
  const net = () => { S.offline = navigator.onLine === false; paintStatus(); };
  window.addEventListener('online', net); window.addEventListener('offline', net);
  paint();
}
