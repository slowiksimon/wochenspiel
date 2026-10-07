// Browser test of the shopping list and the wish list with two phones on the fake Firebase.   node tests/run-lists.mjs
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, phone, sleep, waitFor, waitText, tapLabel, tapSel, setValue, visible, text, netState, net, CONFIG_TEXT, reporter, UA_IPHONE } from './e2e-lib.mjs';
import { startServer } from './fake-server.mjs';
import * as C from '../src/codec.js';
const here = path.dirname(fileURLToPath(import.meta.url));
const server = await startServer({ dir: path.resolve(here, '../dist-fake') });
net.api = server.apiUrl;
const { check, done } = reporter();
const browser = await launch();
const PROJECT = 'wochenspiel-test1';
const URL0 = server.url;

// A creates the household, B joins by the invite link
const A = await phone(browser, URL0, { ua: UA_IPHONE }), a = A.page;
await a.goto(URL0, { waitUntil: 'load' });
await waitText(a, /Willkommen/);
await tapLabel(a, 'Neu einrichten');
for (let i = 0; i < 4; i++) await tapLabel(a, 'Weiter');
await setValue(a, '#ws-cfg', CONFIG_TEXT()); await setValue(a, '#ws-a', 'Simon'); await setValue(a, '#ws-b', 'Anna');
await tapLabel(a, 'Verbindung testen');
await waitText(a, /Geschafft/, 8000);
const link = await a.evaluate(() => (document.querySelector('#ws input[readonly]') || {}).value);
const R = C.extractInvite(link).room;
await tapLabel(a, 'Weiter'); await waitText(a, /Aufs Handy legen/, 3000); await tapLabel(a, 'Verstanden');
const B = await phone(browser, URL0, { ua: UA_IPHONE }), b = B.page;
await b.goto(link, { waitUntil: 'load' });
await waitText(b, /Aufs Handy legen/, 8000); await tapLabel(b, 'Verstanden');
await waitFor(async () => (await b.evaluate(() => document.querySelectorAll('#days .tile').length)) > 3, 8000);
await sleep(600);
const docs = () => { const d = server.dump(PROJECT), o = {}; for (const k of Object.keys(d)) { const m = k.match(/^rooms\/[^/]+\/settings\/((shop|wish)-.*)$/); if (m) o[m[1]] = d[k]; } return o; };
const find = (pre, t) => Object.entries(docs()).find(([id, v]) => id.startsWith(pre) && v.t === t);
const rowsOf = (P, sel) => (P.page || P).evaluate(sel => Array.from(document.querySelectorAll(sel)).map(e => e.innerText.replace(/\s+/g, ' ').trim()), sel);
const open = async (P, which) => { await tapSel(P.page, '#open-' + which); await waitFor(() => visible(P.page, '#screen-' + which), 3000); };
const closeLists = async P => { await tapSel(P.page, '#tab-week'); await sleep(250); };     // the lists are screens behind the tabs: "closing" one means going back to the week
const add = async (P, t) => { await setValue(P.page, '#li-add', t); await tapSel(P.page, '#li-plus'); await sleep(300); };
const toastText = P => text(P.page, '#toast');

console.log('1. the tabs');
check('both phones have the Einkauf and Wünsche tabs', await visible(a, '#open-shop') && await visible(a, '#open-wish') && await visible(b, '#open-shop') && await visible(b, '#open-wish'));
check('the two list screens are closed at the start', !(await visible(a, '#screen-shop')) && !(await visible(a, '#screen-wish')) && await visible(a, '#screen-week'));
check('no number on the Einkauf tab while the list is empty', !(await visible(a, '#n-shop')));

console.log('2. shopping list');
await open(A, 'shop'); await open(B, 'shop');
check('empty state is shown', /Die Liste ist leer/.test(await text(a, '#li-shop-items')) && /Noch nichts auf der Liste/.test(await text(a, '#screen-shop .cap')), await text(a, '#li-shop-items'));
await add(A, 'Milch'); await add(A, '  Vollkornbrot  '); await add(A, '');
check('items are written as settings documents with the author', (() => { const m = find('shop-', 'Milch'), v = find('shop-', 'Vollkornbrot'); return m && v && m[1].by === 'a' && m[1].done === false && Object.keys(docs()).length === 2; })(), JSON.stringify(docs()));
check('the input is empty again after adding', (await a.$eval('#li-add', e => e.value)) === '');
check('the header counts what is open and the tab shows the same number', /^2 offen/.test(await text(a, '#screen-shop .cap')) && (await text(a, '#n-shop')) === '2', await text(a, '#screen-shop .cap') + ' | ' + await text(a, '#n-shop'));
check('phone B sees both items live, newest first', await waitFor(async () => (await rowsOf(B, '#li-shop-items .li-row')).join('|').startsWith('Vollkornbrot'), 4000) && (await rowsOf(B, '#li-shop-items .li-row')).length === 2, (await rowsOf(B, '#li-shop-items .li-row')).join('|'));
await add(A, 'milch');
check('a duplicate is not added twice and says so', Object.keys(docs()).length === 2 && /steht schon/.test(await toastText(A)), await toastText(A));
await add(B, 'Eier'); await sleep(300);
check('B adds an item with author b, A sees it', find('shop-', 'Eier')[1].by === 'b' && await waitFor(async () => (await rowsOf(A, '#li-shop-items .li-row')).some(r => /^Eier/.test(r)), 4000));
// tick on B
await b.evaluate(() => { const r = Array.from(document.querySelectorAll('#li-shop-items .li-row')).find(e => /Milch/.test(e.innerText)); r.querySelector('.li-main').setAttribute('data-t', '1'); });
await tapSel(b, '[data-t="1"]');
check('ticking on B is stored with a time', await waitFor(() => { const m = find('shop-', 'Milch'); return m && m[1].done === true && m[1].doneAt > 0; }, 3000));
check('A sees it moved to "Abgehakt" (count 1)', await waitFor(async () => (await text(a, '#li-shop-items .sect .cnt')) === '1', 4000) && /Abgehakt/.test(await text(a, '#li-shop-items .sect h3')) && (await rowsOf(a, '#li-shop-items .li-row.done')).length === 1);
check('the number on the tab shows what is still open (2)', (await text(a, '#n-shop')) === '2' && /2 offen, 1 abgehakt/.test(await text(a, '#screen-shop .cap')), await text(a, '#n-shop') + ' | ' + await text(a, '#screen-shop .cap'));
await add(A, 'Milch');
check('adding a ticked item again puts it back on the list (no duplicate)', await waitFor(() => { const m = find('shop-', 'Milch'); return m && m[1].done === false; }, 3000) && Object.keys(docs()).length === 3);
// tick two, remove one with undo
for (const t of ['Milch', 'Eier']) {
  await a.evaluate(t => { const r = Array.from(document.querySelectorAll('#li-shop-items .li-row:not(.done)')).find(e => e.innerText.startsWith(t)); r.querySelector('.li-main').setAttribute('data-t', '1'); }, t);
  await tapSel(a, '[data-t="1"]'); await a.evaluate(() => document.querySelectorAll('[data-t]').forEach(e => e.removeAttribute('data-t')));
}
await waitFor(async () => (await text(a, '#li-shop-items .sect .cnt')) === '2', 3000);
await a.evaluate(() => { const r = Array.from(document.querySelectorAll('#li-shop-items .li-row')).find(e => /Eier/.test(e.innerText)); r.querySelector('.li-del').setAttribute('data-t', '1'); });
await tapSel(a, '[data-t="1"]'); await a.evaluate(() => document.querySelectorAll('[data-t]').forEach(e => e.removeAttribute('data-t')));
check('removing deletes the document', await waitFor(() => !find('shop-', 'Eier'), 3000));
await tapLabel(a, 'Rückgängig', '#toast');
check('"Rückgängig" brings it back (still ticked)', await waitFor(() => { const e = find('shop-', 'Eier'); return e && e[1].done === true; }, 3000));
await tapLabel(a, 'Abgehakte entfernen', '#screen-shop');
check('clearing is armed first: nothing deleted yet', Object.keys(docs()).length === 3 && /Wirklich/.test(await text(a, '#li-shop-items')));
await tapLabel(a, 'Wirklich', '#screen-shop');                                  // an immediate second tap (a double tap) does not confirm
await sleep(150);
check('a double tap does not confirm the removal', Object.keys(docs()).length === 3 && /Wirklich/.test(await text(a, '#li-shop-items')));
await sleep(450);
await tapLabel(a, 'Wirklich', '#screen-shop');
check('second tap removes the ticked items, the open one stays', await waitFor(() => Object.keys(docs()).length === 1, 3000) && !!find('shop-', 'Vollkornbrot'), Object.keys(docs()).join());
check('B sees the same', await waitFor(async () => (await rowsOf(B, '#li-shop-items .li-row')).length === 1, 4000));
await tapLabel(a, 'Rückgängig', '#toast');
check('undo of "clear" restores the ticked items', await waitFor(() => Object.keys(docs()).length === 3, 3000));
await tapLabel(a, 'Abgehakte entfernen', '#screen-shop'); await sleep(450); await tapLabel(a, 'Wirklich', '#screen-shop'); await waitFor(() => Object.keys(docs()).length === 1, 3000);

console.log('3. tabs and sheets');
check('the week tab leaves the list: the week is back, the list is hidden', await (async () => { await closeLists(A); return await visible(a, '#screen-week') && !(await visible(a, '#screen-shop')); })());
const hist0 = await a.evaluate(() => history.length);
await open(A, 'wish'); await open(A, 'shop'); await closeLists(A);
check('switching between the tabs adds nothing to the browser history', (await a.evaluate(() => history.length)) === hist0 && a.url().startsWith(URL0));
await open(A, 'shop');
check('a second tap on the active tab is harmless and the page can scroll', await (async () => { await tapSel(a, '#open-shop'); await sleep(300); return await visible(a, '#screen-shop') && (await a.evaluate(() => getComputedStyle(document.documentElement).overflow)) !== 'hidden'; })());
check('the number on the tab follows B\'s changes', await (async () => { await add(B, 'Käse'); await sleep(500); return (await text(a, '#n-shop')) === '2'; })(), await text(a, '#n-shop'));
await closeLists(B);

console.log('3b. paste a whole list');
await open(A, 'shop');
const before = Object.keys(docs()).length;
await tapSel(a, '#li-import');
check('the import sheet opens, "Hinzufügen" is disabled while empty', await visible(a, '#li-sheet') && await a.$eval('#imp-save', e => e.disabled));
await setValue(a, '#imp-t', 'Einkaufsliste\n- Reis\n* 2 Zwiebeln\n1. Tomaten\n[ ] Vollkornbrot\n\n☐ Reis\n');
check('a live line says how many items it found', /5\s+Punkte/.test(await text(a, '.li-imp-n')) && !(await a.$eval('#imp-save', e => e.disabled)), await text(a, '.li-imp-n'));
await open(B, 'shop');
await tapSel(a, '#imp-save');
check('every line became its own item (bullets gone, repeats dropped)', await waitFor(() => Object.keys(docs()).length === before + 4, 3000) && ['Einkaufsliste', 'Reis', '2 Zwiebeln', 'Tomaten'].every(t => find('shop-', t)) && !find('shop-', '- Reis'), Object.values(docs()).map(d => d.t).join('|'));
check('items already on the list are skipped and the toast says so', /4\s+Punkte hinzugefügt, 1 standen schon drauf/.test(await toastText(A)), await toastText(A));
check('the import closes and B sees the new items', !(await visible(a, '#li-sheet')) && await waitFor(async () => (await rowsOf(B, '#li-shop-items .li-row')).some(r => /Zwiebeln/.test(r)), 4000));
check('pasted items are authored by the person who pasted', find('shop-', 'Tomaten')[1].by === 'a');
// a multi-line paste straight into the input field opens the sheet with the text
await a.evaluate(() => { const i = document.querySelector('#li-add'); const dt = new DataTransfer(); dt.setData('text/plain', 'Nudeln\nPesto'); i.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); });
await sleep(300);
check('pasting several lines into the input opens the import with that text', await visible(a, '#li-sheet') && (await a.$eval('#imp-t', e => e.value)) === 'Nudeln\nPesto' && !(await a.$eval('#li-add', e => e.value)));
await a.evaluate(() => history.back()); await sleep(400);
check('back button closes the import first (the list stays)', !(await visible(a, '#li-sheet')) && await visible(a, '#screen-shop') && !find('shop-', 'Nudeln'));
await tapSel(a, '#li-import'); await a.keyboard.press('Escape'); await sleep(300);
check('Escape closes the import sheet too', !(await visible(a, '#li-sheet')) && await visible(a, '#screen-shop'));
check('while a sheet is open the page behind it is inert', await (async () => { await tapSel(a, '#li-import'); const inert = await a.evaluate(() => document.querySelector('#app').inert && document.querySelector('#tabbar').inert); await tapSel(a, '#imp-cancel'); return inert && !(await a.evaluate(() => document.querySelector('#app').inert)); })());
await closeLists(A);

console.log('4. wish list');
await open(A, 'wish');
check('wish screen is shown with the empty state', await visible(a, '#screen-wish') && await visible(a, '#li-new-wish') && /Noch keine Wünsche/.test(await text(a, '#li-wish-items')) && !(await visible(a, '#screen-wish .li-total')));
await tapSel(a, '#li-new-wish');
check('the editor opens', await visible(a, '#li-sheet'));
await tapSel(a, '#wish-save');
check('an empty title is refused with a hint', /Namen/.test(await text(a, '#li-sheet .err')) && Object.keys(docs()).filter(k => k.startsWith('wish-')).length === 0);
await setValue(a, '#wish-t', 'Neue Waschmaschine'); await setValue(a, '#wish-p', 'viel');
await tapSel(a, '#wish-save');
check('an unreadable price is refused with a hint', /Preis/.test(await text(a, '#li-sheet .err')) && !find('wish-', 'Neue Waschmaschine'));
await setValue(a, '#wish-p', '1.299,50'); await setValue(a, '#wish-n', 'Angebot: https://example.com/w, 8 kg\njavascript:alert(1)');
await tapLabel(a, 'Wichtig', '#li-sheet');
await tapSel(a, '#wish-save');
const w1 = await waitFor(() => find('wish-', 'Neue Waschmaschine'), 3000) && find('wish-', 'Neue Waschmaschine')[1];
check('the wish is stored with price, priority, note and author', w1 && w1.price === 1299.5 && w1.prio === 1 && w1.by === 'a' && w1.got === false && /example\.com/.test(w1.note), JSON.stringify(w1));
check('the editor closes after saving', !(await visible(a, '#li-sheet')));
const link1 = await a.evaluate(() => Array.from(document.querySelectorAll('#li-wish-items .li-note a')).map(x => x.href + '|' + x.target + '|' + x.rel));
check('the link in the note is clickable (new tab, noopener), javascript: is not', link1.length === 1 && link1[0].startsWith('https://example.com/w|_blank|noopener'), link1.join());
// second and third wish
for (const [t, p, prio] of [['Urlaub in Portugal', '2400', 'Normal'], ['Sofa', '', 'Irgendwann']]) {
  await tapSel(a, '#li-new-wish'); await setValue(a, '#wish-t', t); await setValue(a, '#wish-p', p);
  await tapLabel(a, prio, '#li-sheet'); await tapSel(a, '#wish-save'); await sleep(300);
}
check('three wishes stored', Object.keys(docs()).filter(k => k.startsWith('wish-')).length === 3);
const sumText = await text(a, '.li-sum'), totText = await text(a, '.li-total');
check('the header counts the open wishes and adds up the priced ones', /2 von 3 mit Preis/.test(sumText) && /3\.699,50/.test(totText), sumText + ' | ' + totText);
check('…and the bar splits the sum by priority (one segment per priority with a price)', (await a.evaluate(() => document.querySelectorAll('.li-bar i').length)) === 2);
check('wishes are grouped and ordered by priority', (await rowsOf(a, '#li-wish-items .li-card .li-title')).join('|') === 'Neue Waschmaschine|Urlaub in Portugal|Sofa', (await rowsOf(a, '#li-wish-items .li-card .li-title')).join('|'));
// B sees them, and who wrote it
await open(B, 'wish');
check('B sees the wishes with "von Simon"', await waitFor(async () => /von Simon/.test(await text(b, '#li-wish-items')), 4000), await text(b, '#li-wish-items'));
// B edits the Sofa: price, priority
await b.evaluate(() => { const c = Array.from(document.querySelectorAll('#li-wish-items .li-card')).find(e => /Sofa/.test(e.innerText)); c.querySelector('.li-title').setAttribute('data-t', '1'); });
await tapSel(b, '[data-t="1"]'); await b.evaluate(() => document.querySelectorAll('[data-t]').forEach(e => e.removeAttribute('data-t')));
check('tapping a wish opens it filled in', await visible(b, '#li-sheet') && (await b.$eval('#wish-t', e => e.value)) === 'Sofa' && (await b.$eval('#wish-p', e => e.value)) === '');
await setValue(b, '#wish-p', '899,9'); await tapLabel(b, 'Wichtig', '#li-sheet'); await tapSel(b, '#wish-save');
const sofa = await waitFor(() => { const s = find('wish-', 'Sofa'); return s && s[1].price === 899.9 && s[1].prio === 1; }, 3000) && find('wish-', 'Sofa')[1];
check('editing keeps the author and changes price and priority', sofa && sofa.by === 'a' && sofa.price === 899.9 && sofa.prio === 1, JSON.stringify(sofa));
check('A sees the change live, sum updated', await waitFor(async () => /4\.599,40/.test(await text(a, '.li-total')), 4000), await text(a, '.li-total'));
// A has the Sofa open while the other phone ticks it as acquired; A then saves a note: the tick must not be lost
await a.evaluate(() => { const c = Array.from(document.querySelectorAll('#li-wish-items .li-card')).find(e => /Sofa/.test(e.innerText)); c.querySelector('.li-title').setAttribute('data-t', '1'); });
await tapSel(a, '[data-t="1"]'); await a.evaluate(() => document.querySelectorAll('[data-t]').forEach(e => e.removeAttribute('data-t')));
const sofa0 = find('wish-', 'Sofa');
server.put(PROJECT, 'rooms/' + R + '/settings/' + sofa0[0], Object.assign({}, sofa0[1], { got: true, gotAt: Date.now() }));
await waitFor(() => { const s = find('wish-', 'Sofa'); return s && s[1].got === true; }, 3000);
await sleep(500);
await setValue(a, '#wish-n', 'mit Schlaffunktion'); await tapSel(a, '#wish-save');
const sofa1 = await waitFor(() => { const s = find('wish-', 'Sofa'); return s && s[1].note === 'mit Schlaffunktion'; }, 3000) && find('wish-', 'Sofa')[1];
check('saving an edit keeps what the other phone changed meanwhile (still acquired)', sofa1 && sofa1.got === true && sofa1.gotAt > 0, JSON.stringify(sofa1));
server.put(PROJECT, 'rooms/' + R + '/settings/' + sofa0[0], sofa0[1]);                       // back to how it was for the checks that follow
await waitFor(async () => /4\.599,40/.test(await text(a, '.li-total')), 4000);
// got
await a.evaluate(() => { const c = Array.from(document.querySelectorAll('#li-wish-items .li-card')).find(e => /Urlaub/.test(e.innerText)); c.querySelector('.li-tick').setAttribute('data-t', '1'); });
await tapSel(a, '[data-t="1"]'); await a.evaluate(() => document.querySelectorAll('[data-t]').forEach(e => e.removeAttribute('data-t')));
check('ticking a wish marks it as acquired (own section, out of the sum)', await waitFor(() => { const u = find('wish-', 'Urlaub in Portugal'); return u && u[1].got === true && u[1].gotAt > 0; }, 3000) && /Angeschafft/.test(await text(a, '#li-wish-items')) && !/2\.400/.test(await text(a, '.li-total')), await text(a, '.li-total'));
// delete with undo
await tapSel(a, '#li-wish-items .li-card.got .li-title'); 
await tapSel(a, '#wish-del');
check('deleting is armed first', !!find('wish-', 'Urlaub in Portugal') && /Wirklich/.test(await text(a, '#wish-del')));
await sleep(450);
await tapSel(a, '#wish-del');
check('second tap deletes and closes the editor', await waitFor(() => !find('wish-', 'Urlaub in Portugal'), 3000) && !(await visible(a, '#li-sheet')));
await tapLabel(a, 'Rückgängig', '#toast');
check('undo restores the wish (still acquired)', await waitFor(() => { const u = find('wish-', 'Urlaub in Portugal'); return u && u[1].got === true; }, 3000));
// back button closes the editor first
await tapSel(a, '#li-new-wish'); await a.evaluate(() => history.back()); await sleep(400);
check('back button closes only the editor, the list stays', !(await visible(a, '#li-sheet')) && await visible(a, '#screen-wish'));
await closeLists(A);

console.log('5. offline');
await netState(A, 'offline'); await sleep(300);
await open(A, 'shop');
await add(A, 'Offline-Tee'); await sleep(600);
check('offline: the item shows up at once and the screen says it is not sent yet', (await rowsOf(a, '#li-shop-items .li-row')).some(r => /Offline-Tee/.test(r)) && /Internet|offline|nicht/i.test(await text(a, '#screen-shop .li-status')), await text(a, '#screen-shop .li-status'));
await netState(A, 'online'); await a.evaluate(() => window.dispatchEvent(new Event('online')));
check('back online: it is stored and B sees it', await waitFor(() => !!find('shop-', 'Offline-Tee'), 15000) && await waitFor(async () => (await rowsOf(B, '#li-shop-items .li-row')).some(r => /Offline-Tee/.test(r)), 8000));
check('the status line is gone again', await waitFor(async () => !(await visible(a, '#screen-shop .li-status')), 8000));

console.log('6. robustness');
// foreign / broken documents in settings never break the screen
server.put(PROJECT, 'rooms/' + R + '/settings/shop-zzbroken', { t: 5, done: 'yes' });
server.put(PROJECT, 'rooms/' + R + '/settings/shop-zzhtml', { t: '<img src=x onerror=alert(1)>', at: Date.now(), done: false });
server.put(PROJECT, 'rooms/' + R + '/settings/wish-zzbroken', { price: 'x' });
await sleep(800);
check('broken documents are ignored, markup is shown as plain text', (await rowsOf(a, '#li-shop-items .li-row')).some(r => r.includes('<img src=x')) && (await a.evaluate(() => !document.querySelector('#li-shop-items img'))));
check('the game itself still works next to the lists (settings/people untouched)', (await b.evaluate(() => document.querySelectorAll('#days .tile').length)) > 3 && /Anna/.test(await text(b, '#pcs')));
await closeLists(A); await closeLists(B);
const real = A.errors.concat(B.errors).filter(e => !/ERR_INTERNET_DISCONNECTED/.test(e));   // the deliberate offline phase logs failed requests
check('no page errors on either phone', real.length === 0, real.join(' | '));
await A.close(); await B.close(); await browser.close(); await server.close();
process.exitCode = done() ? 1 : 0;
