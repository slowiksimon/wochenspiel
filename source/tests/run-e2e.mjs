// End-to-end tests of the standalone app against the fake Firebase (see fake-server.mjs / fake-firestore.js).
//   node build.mjs && FAKE=1 node build.mjs && node tests/run-e2e.mjs
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { netState, launch, phone, reporter, sleep, rect, longPressDrag, visible, text, overlayText, overlayOpen, waitFor, waitText, tapSel, tapLabel, buttons, setValue, decodeQr, shot, net, CONFIG_TEXT, W, UA_IPHONE, UA_ANDROID, showDay, tapTile, scrollToKey, allTiles } from './e2e-lib.mjs';
import { startServer } from './fake-server.mjs';
import * as C from '../src/codec.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const server = await startServer({ dir: path.resolve(here, '../dist-fake') });
const URL0 = server.url;
net.api = server.apiUrl;
const { check, done } = reporter();
const browser = await launch();
const PROJECT = 'wochenspiel-test1';

const room = () => { const k = Object.keys(server.dump(PROJECT)).find(p => p.startsWith('rooms/')); return k ? k.split('/')[1] : null; };
const tiles = page => page.evaluate(() => document.querySelectorAll('#days .tile').length);       // the tiles of the day that is shown (today: 6 in the starter plan)
const meName = page => page.evaluate(() => { const e = document.querySelector('#pcs .pc.is-me .pn'); return e ? e.textContent : ''; });
const onDay = async (page, d, key) => { await showDay(page, d); return page.evaluate(k => !!document.querySelector('#days .tile[data-key="' + k + '"]'), key); };
const junk = page => page.evaluate(() => { const m = document.body.innerText.match(/\b(null|undefined|NaN|\[object)/g); return m ? m.join(',') : ''; });
const slotOf = (key) => server.dump(PROJECT)['rooms/' + room() + '/slots/' + key];
const tileClass = async (page, key) => { await showDay(page, Number(key.split('_').pop())); return page.evaluate(key => { const t = document.querySelector('.tile[data-key="' + key + '"]'); return t ? t.className : null; }, key); };
const stored = (page, k) => page.evaluate(k => localStorage.getItem(k), k);
const overlayJunk = page => page.evaluate(() => { const e = document.querySelector('#ws'); const m = e && !e.hidden ? e.innerText.match(/\b(null|undefined|NaN|\[object)/g) : null; return m ? m.join(',') : ''; });

/* ===================================================================================================================
   0. the page opened as a plain file, and a stored connection the SDK cannot use
   =================================================================================================================== */
console.log('0. opened as a file / unusable connection');
{
  const Z = await phone(browser, URL0, { clipboard: false });
  await Z.page.goto('file://' + path.resolve(here, '../dist-fake/index.html'), { waitUntil: 'load' });
  await waitText(Z.page, /Noch nicht im Netz/, 4000);
  const t = await overlayText(Z.page);
  check('opened from a file: the app explains that it has to be put online', /Noch nicht im Netz/.test(t) && /GitHub/.test(t) && /https:\/\//.test(t), t.slice(0, 200));
  check('…and offers no setup that could not work from a file', !(await buttons(Z.page)).some(b => /Neu einrichten|Einladungslink/.test(b)));
  check('…without page errors', Z.errors.length === 0, Z.errors.join('|'));
  await Z.close();

  const Y = await phone(browser, URL0, { clipboard: false });
  await Y.page.evaluateOnNewDocument(() => localStorage.setItem('ws.v1', JSON.stringify({ v: 1, cfg: { projectId: 'boom-test-1', apiKey: 'AIzaSyD-FAKEKEYFORTESTING0123456789abcd' }, room: 'abcdefghjkmnpqrs' })));
  await Y.page.goto(URL0, { waitUntil: 'load' });
  await waitText(Y.page, /nicht geklappt/, 4000);
  check('a stored connection that breaks the start shows an explanation, not a blank page', /unerwarteter Fehler/.test(await overlayText(Y.page)) && (await buttons(Y.page)).includes('Neu laden'), await overlayText(Y.page));
  await Y.close();
}

/* ===================================================================================================================
   1. first start and the setup wizard (phone A)
   =================================================================================================================== */
console.log('1. setup wizard');
const A = await phone(browser, URL0);
const a = A.page;
await a.goto(URL0, { waitUntil: 'load' });
await waitText(a, /Willkommen/);
check('first start shows the welcome screen', /Willkommen!/.test(await overlayText(a)));
check('welcome offers setup and invite', (await buttons(a)).some(b => b === 'Neu einrichten') && (await buttons(a)).some(b => b === 'Ich habe einen Einladungslink'));
check('no raw JS junk on the welcome screen', (await junk(a)) === '', await junk(a));

await tapLabel(a, 'Neu einrichten');
await waitText(a, /Projekt anlegen/);
check('step 1 explains how to create a project', /Projekt erstellen/.test(await overlayText(a)) && /1\/5/.test(await overlayText(a)));
check('step 1 has a link to the Firebase console', await a.evaluate(() => { const l = document.querySelector('#ws a.ws-ext'); return !!l && l.href === 'https://console.firebase.google.com/' && l.target === '_blank' && /noopener/.test(l.rel); }));
check('no JS junk on step 1', (await overlayJunk(a)) === '');
await shot(a, 'step1.png');
await tapLabel(a, 'Weiter');
check('step 2 explains the database', /Datenbank erstellen/.test(await overlayText(a)) && /Produktionsmodus/.test(await overlayText(a)));
await tapLabel(a, 'Weiter');
const rulesShown = await a.evaluate(() => (document.querySelector('#ws .ws-code') || {}).textContent);
check('step 3 shows exactly the rules text', rulesShown === C.FIRESTORE_RULES, JSON.stringify(rulesShown));
await tapLabel(a, 'Regeln kopieren');
await sleep(150);
const clip = await a.evaluate(() => navigator.clipboard.readText().catch(e => 'ERR ' + e.message));
check('"Regeln kopieren" puts the rules on the clipboard', clip === C.FIRESTORE_RULES, String(clip).slice(0, 80));
check('copy button confirms', /Kopiert/.test(await overlayText(a)));
check('no JS junk on step 3', (await overlayJunk(a)) === '');
await shot(a, 'step3.png');
await tapLabel(a, 'Weiter');
check('step 4 explains the web app registration', /App registrieren/.test(await overlayText(a)) && /firebaseConfig/.test(await overlayText(a)));
await tapLabel(a, 'Weiter');
check('step 5 shows the connect form', /Verbinden/.test(await overlayText(a)) && await visible(a, '#ws-cfg') && await visible(a, '#ws-a') && await visible(a, '#ws-b'));
await tapLabel(a, '‹ Zurück');
check('back goes to the previous step', /Web-App registrieren/.test(await overlayText(a)));
await tapLabel(a, 'Weiter');

// validation of the form
await tapLabel(a, 'Verbindung testen');
check('empty form is refused with a hint', /Füge zuerst die Konfiguration/.test(await overlayText(a)));
await setValue(a, '#ws-cfg', 'das ist keine konfiguration');
await tapLabel(a, 'Verbindung testen');
check('text without projectId is refused', /keine „projectId“/.test(await overlayText(a)));
await setValue(a, '#ws-cfg', CONFIG_TEXT(PROJECT));
await tapLabel(a, 'Verbindung testen');
check('missing names are refused', /gib euch beiden einen Namen/.test(await overlayText(a)));
check('nothing was sent to the server yet', Object.keys(server.dump(PROJECT)).length === 0);
check('no JS junk on step 5', (await overlayJunk(a)) === '');
await shot(a, 'step5.png');

// failure modes during setup
server.setMode(PROJECT, 'denied');
await setValue(a, '#ws-a', 'Simon'); await setValue(a, '#ws-b', 'Anna');

// the half-filled form survives closing the page (people switch to the Firebase console and back; phones discard background pages)
await a.reload({ waitUntil: 'load' });
await waitText(a, /Verbinden/);
check('reload during setup: the wizard resumes at step 5', /5\/5/.test(await overlayText(a)) && await visible(a, '#ws-cfg'), (await overlayText(a)).slice(0, 80));
const formNow = await a.evaluate(() => ({ cfg: document.querySelector('#ws-cfg').value, a: document.querySelector('#ws-a').value, b: document.querySelector('#ws-b').value }));
check('…with the pasted configuration and both names still filled in', formNow.cfg === CONFIG_TEXT(PROJECT) && formNow.a === 'Simon' && formNow.b === 'Anna', JSON.stringify(formNow).slice(0, 120));
await tapLabel(a, '‹ Zurück');
await a.reload({ waitUntil: 'load' });
await waitText(a, /Web-App registrieren/);
check('reload at step 4: the wizard resumes at step 4 (and the form is still kept)', /4\/5/.test(await overlayText(a)));
await tapLabel(a, 'Weiter');
check('…and step 5 shows the kept values again', (await a.evaluate(() => document.querySelector('#ws-a').value)) === 'Simon');
await tapLabel(a, 'Verbindung testen');
await waitText(a, /Regeln/, 8000);
check('refused write explains the rules step', /Hast du die Regeln aus Schritt 3/.test(await overlayText(a)), await overlayText(a));
check('button is usable again after a failure', await a.evaluate(() => !document.querySelector('#ws .ws-btn:last-of-type').disabled));
server.setMode(PROJECT, 'apioff');
await tapLabel(a, 'Verbindung testen');
await waitText(a, /noch nicht angelegt/, 8000);
check('"API not enabled" explains the database step', /noch nicht angelegt/.test(await overlayText(a)), await overlayText(a));
server.setMode(PROJECT, 'nodb');
await tapLabel(a, 'Verbindung testen');
await waitText(a, /nicht gefunden/, 8000);
check('missing database is explained', /Datenbank wurde nicht gefunden/.test(await overlayText(a)), await overlayText(a));
check('failed setup left no household on this phone', (await stored(a, 'ws.v1')) === null);

// the household cannot be written completely (probe works, big write fails), then the retry must start clean
server.setMode(PROJECT, 'batchfail');
await tapLabel(a, 'Verbindung testen');
await waitText(a, /nicht angelegt werden/, 10000);
check('a failed household write is reported', /Der Haushalt konnte nicht angelegt werden/.test(await overlayText(a)), await overlayText(a));
check('…and leaves no connection on the phone', (await stored(a, 'ws.v1')) === null && (await stored(a, 'wp2.me')) === null);
check('…and the form is usable again', await a.evaluate(() => !document.querySelector('#ws .ws-btn:last-of-type').disabled));
const strayRooms = new Set(Object.keys(server.dump(PROJECT)).map(p => p.split('/')[1]));
check('…and no half-written household remains on the server', strayRooms.size === 0, [...strayRooms].join());

// the real thing
server.setMode(PROJECT, 'ok');
await tapLabel(a, 'Verbindung testen');
await waitText(a, /Geschafft/, 10000);
check('setup finishes with the invite screen', /Geschafft!/.test(await overlayText(a)), (await overlayText(a)).slice(0, 200));
const R = room();
check('a 16+ char room code was created', !!R && R.length >= 16, R);
const dump = server.dump(PROJECT);
const mine = p => Object.keys(dump).filter(k => k.startsWith('rooms/' + R + '/' + p + '/'));
check('19 starter tasks were written', mine('tasks').length === 19, String(mine('tasks').length));
const people = dump['rooms/' + R + '/settings/people'];
check('people document holds both names, reward and goal', people && people.a === 'Simon' && people.b === 'Anna' && people.goal === 80 && /Pizza/.test(people.reward), JSON.stringify(people));
check('creator is registered as player A', people && /^d_/.test(people.aId || ''), JSON.stringify(people));
check('the connection test left nothing behind', !('rooms/' + R + '/settings/ping' in dump));
check('nothing was written outside the room', Object.keys(dump).every(k => k.startsWith('rooms/' + R + '/')), Object.keys(dump).filter(k => !k.startsWith('rooms/' + R + '/')).join(','));
check('connection is saved on the phone', !!(await stored(a, 'ws.v1')) && (await stored(a, 'wp2.me')) === 'a');
check('address now carries the invite (#j=)', /#j=/.test(await a.evaluate(() => location.hash)));
const hashA = C.extractInvite(await a.evaluate(() => location.hash));
check('…but no player: a copied address never makes someone else "me"', !!hashA && hashA.room === R && hashA.me === null, JSON.stringify(hashA));
check('the saved setup form is deleted once the household exists', (await stored(a, 'ws.draft')) === null);

/* ---- invite screen + QR ---- */
const link = await a.evaluate(() => (document.querySelector('#ws input[readonly]') || {}).value);
const inv = C.extractInvite(link || '');
check('invite link decodes to this household', !!inv && inv.room === R && inv.cfg.projectId === PROJECT && inv.me === 'b', link);
check('invite link points at the app address', !!link && link.startsWith(URL0 + '#j='), link);
const qr = await decodeQr(a);
check('QR code decodes (camera-like screenshot)', qr === link, String(qr).slice(0, 100));
const qrBox = await a.evaluate(() => { const r = document.querySelector('.ws-qr').getBoundingClientRect(); return { w: r.width }; });
const qrModules = await a.evaluate(() => { const v = document.querySelector('.ws-qr svg').getAttribute('viewBox').split(' ')[2]; return Number(v); });
check('QR modules are big enough to scan (>= 3.5 px per module)', (qrBox.w - 20) / qrModules >= 3.5, 'width ' + qrBox.w + ', modules ' + qrModules);
check('invite screen warns that the link is like a password', /wie ein Passwort/.test(await overlayText(a)));
check('no JS junk on the invite screen', (await overlayJunk(a)) === '', await overlayJunk(a));
await shot(a, 'invite.png');
await tapLabel(a, 'Mein 2. Handy');
const link2 = await a.evaluate(() => document.querySelector('#ws input[readonly]').value);
check('segmented control switches the invite to "me" (second device)', C.extractInvite(link2).me === 'a');
await tapLabel(a, 'Für Anna');
check('…and back to the partner', C.extractInvite(await a.evaluate(() => document.querySelector('#ws input[readonly]').value)).me === 'b');
await tapLabel(a, 'Link kopieren');
await sleep(150);
check('"Link kopieren" copies the invite', (await a.evaluate(() => navigator.clipboard.readText())) === link);
await a.evaluate(() => { [...document.querySelectorAll('#ws button')].find(x => /Kopiert|Link kopieren/.test(x.innerText)).click(); });      // second tap while the confirmation is still showing
await sleep(2000);
check('tapping "Link kopieren" twice quickly does not leave the confirmation as the button label', (await buttons(a)).includes('Link kopieren') && !/Kopiert/.test(await overlayText(a)), (await buttons(a)).join('|'));

await tapLabel(a, 'Weiter');
await sleep(500);
check('overlay closes and the game is visible', !(await overlayOpen(a)) && (await tiles(a)) > 3, 'tiles ' + (await tiles(a)));
check('no install help on desktop-like UA', !(await overlayOpen(a)));

/* ===================================================================================================================
   2. the game on phone A
   =================================================================================================================== */
console.log('2. game on phone A');
await sleep(300);
const hdr = await text(a, '#pcs');
check('player A sees their own name and both initials', /Simon/.test(await meName(a)) && /S/.test(hdr) && /A/.test(hdr), hdr);
check('no "Wer spielt hier?" prompt (creator is player A)', !(await a.evaluate(() => /Wer spielt hier/.test(document.body.innerText))));
check('no raw JS junk in the game', (await junk(a)) === '', await junk(a));
await shot(a, 'game-a.png');
const key0 = W + '_kita-bringen-a_0';
check('Monday tile of the starter plan exists', (await tileClass(a, key0)) !== null);
await a.evaluate(() => { const b = document.querySelector('[data-act="hint"]'); if (b) b.click(); });
await tapTile(a, key0);
const wrote = await waitFor(() => !!slotOf(key0), 4000);
check('tapping a tile writes the slot to the household', !!wrote && slotOf(key0).done === true && slotOf(key0).by === 'a', JSON.stringify(slotOf(key0)));
check('tile shows as done', /done/.test(await tileClass(a, key0)));
check('slot document has the expected fields only', Object.keys(slotOf(key0)).sort().join() === 'at,by,day,done,task,week', Object.keys(slotOf(key0)).join());

/* ===================================================================================================================
   3. phone B joins by the QR code
   =================================================================================================================== */
console.log('3. phone B joins');
const B = await phone(browser, URL0);
const b = B.page;
await b.goto(qr, { waitUntil: 'load' });
await waitFor(async () => !(await overlayOpen(b)) && (await tiles(b)) > 3, 8000);
check('opening the QR link connects phone B without any typing', !(await overlayOpen(b)) && (await tiles(b)) > 3, await overlayText(b));
check('phone B is player B (preset by the invite)', (await stored(b, 'wp2.me')) === 'b');
check('phone B was not asked who it is', !(await b.evaluate(() => /Wer spielt hier/.test(document.body.innerText))));
check('phone B sees its own name (Anna)', /Anna/.test(await meName(b)), await meName(b));
check('phone B sees the tile phone A completed', /done/.test(String(await tileClass(b, key0))));
check('phone B keeps the invite in its address (without a player)', /#j=/.test(await b.evaluate(() => location.hash)) && C.extractInvite(await b.evaluate(() => location.hash)).me === null);
check('phone B stores its own device id', /^d_/.test(await stored(b, 'ws.uid')) && (await stored(b, 'ws.uid')) !== (await stored(a, 'ws.uid')));
await b.evaluate(() => { const x = document.querySelector('[data-act="hint"]'); if (x) x.click(); });

// live sync both ways
const key1 = W + '_kochen-b_1';
await tapTile(b, key1);
await waitFor(() => !!slotOf(key1), 4000);
check('B ticks a tile: stored as done by b', !!slotOf(key1) && slotOf(key1).by === 'b', JSON.stringify(slotOf(key1)));
const seenOnA = await waitFor(async () => /done/.test(String(await tileClass(a, key1))), 5000);
check('…and phone A sees it live', !!seenOnA, String(await tileClass(a, key1)));

// player A and B both see rewards update in the header (smoke: header text equal on both)
await waitFor(async () => (await text(a, '#pcs')) === (await text(b, '#pcs')), 4000);      // the numbers count up for a moment
const hA = await text(a, '#pcs'), hB = await text(b, '#pcs');
check('both phones show the same score header', hA === hB, hA.replace(/\n/g, ' ') + ' | ' + hB.replace(/\n/g, ' '));

/* ===================================================================================================================
   4. dragging on one phone shows up on the other
   =================================================================================================================== */
console.log('4. drag and live sync');
{
  const dk = W + '_abholen-b_2';
  await scrollToKey(a, dk);
  const from = await rect(a, '.tile[data-key="' + dk + '"]');
  const to = await rect(a, '#strip .dcell[data-day="3"]');
  await longPressDrag(a, from, to);
  const moved = await waitFor(() => { const s = slotOf(dk); return s && s.to === 3; }, 5000);
  check('A drags a tile to Thursday: stored with to:3', !!moved, JSON.stringify(slotOf(dk)));
  check('…and phone B shows the tile under Thursday', !!(await waitFor(() => onDay(b, 3, dk), 5000)));
  check('…and no longer under Wednesday', !(await onDay(b, 2, dk)));
}

/* ===================================================================================================================
   4b. the Nest screens on phone A: tabs, week strip, nest in the header, filter, the three drop zones
   =================================================================================================================== */
console.log('4b. tabs, strip, nest, filter, zones');
{
  const attr = (page, sel, name) => page.evaluate((s, n) => { const e = document.querySelector(s); return e ? e.getAttribute(n) : null; }, sel, name);
  const stripInfo = page => page.evaluate(() => { const c = Array.from(document.querySelectorAll('#strip .dcell')); return { sel: c.findIndex(x => x.classList.contains('is-sel')), today: c.findIndex(x => x.getAttribute('aria-current') === 'date'), title: document.querySelector('#lh-title').textContent }; });
  const heroNum = page => page.evaluate(() => Number(document.querySelector('#hero-num').textContent));
  const litLen = page => page.evaluate(() => parseFloat(document.querySelector('#ring .lit').style.strokeDasharray));
  const coinsOf = (page, w) => page.evaluate(w => Number(document.querySelector('#pcs .pc.who-' + w + ' b').textContent), w);
  const labels = page => page.evaluate(() => Array.from(document.querySelectorAll('#days .tile')).map(t => t.getAttribute('aria-label')));
  const zoneTarget = async (page, drop) => { const r = await rect(page, '#dock .zone[data-drop="' + drop + '"]'); const vh = await page.evaluate(() => innerHeight); return { x: r.x, y: vh - 16 - 35 + 20 }; };   // the dock slides in while a task is carried: aim at where it ends up
  const DK = W + '_abholen-b_2';

  // tabs
  await tapSel(a, '#open-shop');
  check('"Einkauf" shows the shopping screen and hides the week', await visible(a, '#screen-shop') && !(await visible(a, '#screen-week')) && (await attr(a, '#open-shop', 'aria-current')) === 'page' && (await attr(a, '#tab-week', 'aria-current')) === null);
  await tapSel(a, '#open-wish');
  check('"Wünsche" shows the wish screen, the egg moved behind it', await visible(a, '#screen-wish') && !(await visible(a, '#screen-shop')) && (await a.evaluate(() => document.querySelector('#tabbar').style.getPropertyValue('--i'))) === '2');
  await tapSel(a, '#tab-week');
  check('"Woche" brings the week back', await visible(a, '#screen-week') && !(await visible(a, '#screen-wish')) && (await attr(a, '#tab-week', 'aria-current')) === 'page');
  check('the tab bar has five tabs, the last ("Ich") opens the settings', (await a.evaluate(() => document.querySelectorAll('#tabbar .tab').length)) === 5 && /Ich/.test(await text(a, '#open-settings')) && (await a.evaluate(() => document.querySelector('#tabbar .tab:last-child').id)) === 'open-settings');

  // the strip
  await showDay(a, 2);
  let si = await stripInfo(a);
  check('week strip: today is marked and picked, the list is called "Heute"', si.today === 2 && si.sel === 2 && si.title === 'Heute', JSON.stringify(si));
  check('the header names the day while this week is shown', /Mittwoch, 7\. Oktober/.test(await text(a, '#range')) && /Woche 41/.test(await text(a, '#kw')) && !(await visible(a, '#thisweek')), await text(a, '#range'));
  await tapSel(a, '#strip .dcell[data-day="3"]');
  si = await stripInfo(a);
  check('tapping Thursday lists Thursday, with the tile that was moved there', si.sel === 3 && si.title === 'Donnerstag' && (await a.evaluate(k => !!document.querySelector('#days .tile[data-key="' + k + '"]'), DK)), JSON.stringify(si));
  check('…and the circle is drawn around the picked day', (await a.evaluate(() => document.querySelector('#strip .dcell[data-day="3"]').getAttribute('aria-pressed'))) === 'true' && (await attr(a, '#strip .dcell[data-day="2"]', 'aria-pressed')) === 'false');
  await tapSel(a, '#strip .dcell[data-day="2"]');
  check('tapping today lists "Heute" again', (await stripInfo(a)).title === 'Heute');
  const dots = await a.evaluate(() => Array.from(document.querySelectorAll('#strip .dcell')).map(c => c.querySelectorAll('.dots i').length));
  check('days with finished tasks carry the dots of the people who did them', dots[0] >= 1 && dots[1] >= 1, dots.join());

  // the nest in the header
  const n0 = await heroNum(a), l0 = await litLen(a), ca0 = await coinsOf(a, 'a');
  const kk = W + '_kita-bringen-a_2';
  await tapTile(a, kk);
  await waitFor(async () => (await heroNum(a)) < n0, 3000);
  await sleep(600);
  const n1 = await heroNum(a), l1 = await litLen(a), ca1 = await coinsOf(a, 'a');
  check('ticking a tile lowers the number in the nest and lengthens its line', n1 < n0 && l1 > l0, 'number ' + n0 + ' -> ' + n1 + ', line ' + l0 + ' -> ' + l1);
  check('…and the coins of the person who did it go up by the same amount', ca1 - ca0 === n0 - n1 && ca1 > ca0, ca0 + ' -> ' + ca1);
  check('the line is never longer than the nest', l1 <= 1000, String(l1));
  await tapTile(a, kk);
  await waitFor(async () => (await heroNum(a)) === n0, 3000);
  await sleep(600);
  check('un-ticking brings number, line and coins back', (await heroNum(a)) === n0 && Math.abs((await litLen(a)) - l0) < 0.5 && (await coinsOf(a, 'a')) === ca0, (await heroNum(a)) + ' / ' + (await litLen(a)));
  await waitFor(() => !slotOf(kk), 4000);

  // filter
  const allL = await labels(a);
  await tapSel(a, '#me-line [data-filter="mine"]');
  const mineL = await labels(a);
  check('"Meine" hides what belongs to the other person', mineL.length > 0 && mineL.length < allL.length && !mineL.some(l => /, Anna,/.test(l)) && allL.some(l => /, Anna,/.test(l)), allL.length + ' -> ' + mineL.length);
  check('…and the choice is remembered on this phone', (await stored(a, 'wp2.filter')) === 'mine');
  await tapSel(a, '#me-line [data-filter="all"]');
  check('"Alle" shows everything again', (await labels(a)).length === allL.length && (await stored(a, 'wp2.filter')) === 'all');

  // the drop zones: while a task is carried the tab bar makes room for three zones
  await scrollToKey(a, kk);
  const fromH = await rect(a, '.tile[data-key="' + kk + '"]');
  const held = await longPressDrag(a, fromH, await zoneTarget(a, 'who:b'), { release: false, endHold: 500 });
  const dock = await a.evaluate(() => ({ dragging: document.body.classList.contains('dragging'), tabbar: getComputedStyle(document.querySelector('#tabbar')).opacity, zones: Array.from(document.querySelectorAll('#dock .zone')).map(z => ({ drop: z.dataset.drop, off: z.classList.contains('off'), hot: z.classList.contains('drop-hot'), t: z.innerText.replace(/\s+/g, ' ').trim() })) }));
  check('while a task is carried the three zones show: Simon (it is his: switched off), "Entfällt", Anna', dock.dragging && dock.zones.length === 3 && dock.zones[0].drop === 'who:a' && dock.zones[0].off && /Simon/.test(dock.zones[0].t) && dock.zones[1].drop === 'skip' && /Entfällt/.test(dock.zones[1].t) && dock.zones[2].drop === 'who:b' && !dock.zones[2].off && /Anna/.test(dock.zones[2].t), JSON.stringify(dock));
  check('…the tab bar steps aside and the zone under the finger lights up', Number(dock.tabbar) < 0.5 && dock.zones[2].hot, JSON.stringify(dock));
  await held.end();
  check('dropping on the other person hands the task over (who:"b")', !!(await waitFor(() => { const x = slotOf(kk); return x && x.who === 'b'; }, 5000)), JSON.stringify(slotOf(kk)));
  check('…with a message that says so and offers "Rückgängig"', /gehört jetzt Anna/.test(await text(a, '#toast')) && /Rückgängig/.test(await text(a, '#toast')), await text(a, '#toast'));
  check('…and the dock is gone again', !(await a.evaluate(() => document.body.classList.contains('dragging'))));
  await showDay(b, 2);
  check('…and phone B sees it as Anna\'s task', !!(await waitFor(async () => (await labels(b)).some(l => /^Kita\/Schule bringen, Anna,/.test(l)), 5000)), (await labels(b)).join('|'));
  await tapLabel(a, 'Rückgängig', '#toast');
  check('"Rückgängig" gives it back (the slot document is removed again)', !!(await waitFor(() => !slotOf(kk), 5000)), JSON.stringify(slotOf(kk)));

  const sk = W + '_bett-b_2';
  await scrollToKey(a, sk);
  const fromS = await rect(a, '.tile[data-key="' + sk + '"]');
  await longPressDrag(a, fromS, await zoneTarget(a, 'skip'));
  check('dropping on "Entfällt" strikes the task for this week (skip:true)', !!(await waitFor(() => { const x = slotOf(sk); return x && x.skip === true; }, 5000)), JSON.stringify(slotOf(sk)));
  check('…the tile shows as struck out and says how to get it back', /skip/.test(await tileClass(a, sk)) && /tippen zum Zurückholen/.test(await a.evaluate(k => document.querySelector('.tile[data-key="' + k + '"]').innerText, sk)));
  await tapTile(a, sk);
  check('tapping a struck-out task brings it back', !!(await waitFor(() => !slotOf(sk), 5000)), JSON.stringify(slotOf(sk)));

  // letting go anywhere else changes nothing
  const cx = W + '_haustier_2';
  await scrollToKey(a, cx);
  const fromC = await rect(a, '.tile[data-key="' + cx + '"]');
  await longPressDrag(a, fromC, { x: fromC.x, y: fromC.y - 60 });
  await sleep(500);
  check('letting go away from every target changes nothing and ends the drag', !slotOf(cx) && !(await a.evaluate(() => document.body.classList.contains('dragging'))) && (await a.evaluate(() => document.querySelectorAll('.tile.ghost').length)) === 0, JSON.stringify(slotOf(cx)));

  // other weeks
  await tapSel(a, '#next');
  check('another week: the header shows its dates and a "Heute" pill leads back', /Woche 42/.test(await text(a, '#kw')) && /12\.–18\./.test(await text(a, '#range')) && await visible(a, '#thisweek'), await text(a, '#range'));
  await tapSel(a, '#thisweek');
  si = await stripInfo(a);
  check('"Heute" returns to this week with today picked', /Woche 41/.test(await text(a, '#kw')) && !(await visible(a, '#thisweek')) && si.sel === 2 && si.title === 'Heute', JSON.stringify(si));
}

/* ---- the finished nest: a tiny household whose goal is one coin ---- */
console.log('4c. the finished nest');
{
  const R3 = 'rrrrrrrrrrrrrrrr';
  server.put(PROJECT, 'rooms/' + R3 + '/settings/people', { a: 'Mia', b: 'Tom', reward: 'Eis essen 🍦', goal: 50 });
  for (const [id, title] of [['t-eins', 'Eins'], ['t-zwei', 'Zwei']]) server.put(PROJECT, 'rooms/' + R3 + '/tasks/' + id, { title, emoji: '✨', who: 'a', days: [2], pts: 1, order: id === 't-eins' ? 10 : 20, createdAt: 1 });
  const N = await phone(browser, URL0);
  const n = N.page;
  await n.goto(C.inviteUrl(URL0, { cfg: inv.cfg, room: R3, me: 'a' }), { waitUntil: 'load' });
  await waitFor(async () => (await tiles(n)) === 2, 8000);
  await n.evaluate(() => { const x = document.querySelector('[data-act="hint"]'); if (x) x.click(); });
  const lbl = () => text(n, '#quest');
  check('the nest says how many coins are missing and for what (the emoji of the reward is left out)', /^1\s/.test(await lbl()) && /Eis essen/.test(await lbl()) && !/🍦/.test(await lbl()), JSON.stringify(await lbl()));
  check('nothing done yet: the nest is empty, the check mark is hidden', (await n.evaluate(() => document.querySelector('#ring .lit').classList.contains('is-empty'))) && !(await visible(n, '#hero-ok')) && (await visible(n, '#hero-num')));
  await tapTile(n, W + '_t-eins_2');
  await waitFor(() => visible(n, '#hero-ok'), 4000);
  check('reaching the goal finishes the nest: check mark instead of the number, "Wochenziel geschafft" and the reward', await visible(n, '#hero-ok') && !(await visible(n, '#hero-num')) && /Wochenziel geschafft/.test(await lbl()) && /Eis essen/.test(await lbl()), JSON.stringify(await lbl()));
  check('…and the line closes the nest completely', Math.abs((await n.evaluate(() => parseFloat(document.querySelector('#ring .lit').style.strokeDasharray))) - 1000) < 0.5);
  await waitFor(async () => /Mia 1/.test((await text(n, '#pcs')).replace(/\s+/g, ' ')), 3000);
  const pcs = (await text(n, '#pcs')).replace(/\s+/g, ' ');
  check('…Mia has the coin, Tom none', pcs.includes('Mia 1') && pcs.includes('Tom 0') && /1 von 1/.test(pcs), pcs);
  await tapTile(n, W + '_t-eins_2');
  await waitFor(async () => !(await visible(n, '#hero-ok')), 4000);
  await waitFor(async () => /^1\s/.test(await lbl()), 3000);
  check('taking the tick back reopens the nest', !(await visible(n, '#hero-ok')) && (await visible(n, '#hero-num')) && /^1\s/.test(await lbl()), JSON.stringify(await lbl()));
  await N.close();
}

/* ===================================================================================================================
   5. offline on phone B
   =================================================================================================================== */
console.log('5. offline');
const k1 = W + '_kochen-a_2', k2 = W + '_geschirr_2';
{
  await b.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  const sw = await b.evaluate(async () => { const reg = await navigator.serviceWorker.getRegistration(); const keys = await caches.keys(); const files = []; for (const k of keys) { const c = await caches.open(k); for (const r of await c.keys()) files.push(new URL(r.url).pathname); } return { active: !!(reg && reg.active), keys, files }; });
  check('service worker is active', sw.active, JSON.stringify(sw));
  check('the cache is named after the scope and the build', sw.keys.length === 1 && /^wochenspiel:\/:[0-9a-f]{10}$/.test(sw.keys[0]), sw.keys.join());
  check('cache holds the page, manifest and icons', ['/index.html', '/manifest.json', '/icon-192.png', '/icon-512.png', '/icon-maskable-512.png', '/apple-touch-icon.png'].every(p => sw.files.includes(p)), sw.files.join());
  await netState(B, 'offline');
  check('going offline shows the Offline notice', !!(await waitFor(async () => /Offline/.test(await text(b, '#notice')), 4000)), await text(b, '#notice'));
  await tapTile(b, k1);
  await tapTile(b, k2);
  await sleep(1800);                                           // longer than the 1.2 s wait for the server's confirmation
  check('offline taps show as done at once', /done/.test(String(await tileClass(b, k1))) && /done/.test(String(await tileClass(b, k2))), String(await tileClass(b, k1)));
  check('offline: the household has not seen them yet', !slotOf(k1) && !slotOf(k2));
  check('offline: phone A does not see them', !/done/.test(String(await tileClass(a, k1))));
  check('offline: no error toast', !/nicht geklappt/.test(await text(b, '#toast')), await text(b, '#toast'));
  await b.reload({ waitUntil: 'load' });
  await waitFor(async () => (await tiles(b)) > 3, 8000);
  check('offline reload: the app starts from the stored copy', (await tiles(b)) > 3 && !(await overlayOpen(b)), 'tiles ' + (await tiles(b)));
  check('offline reload: unsent changes are still there', /done/.test(String(await tileClass(b, k1))) && /done/.test(String(await tileClass(b, k2))));
  check('offline reload: Offline notice is shown', /Offline/.test(await text(b, '#notice')), await text(b, '#notice'));
  check('offline reload: service worker answered (page controlled)', await b.evaluate(() => !!navigator.serviceWorker.controller));
  await shot(b, 'offline-b.png');
  await netState(B, 'online');
  check('back online: both changes reach the household', !!(await waitFor(() => !!slotOf(k1) && !!slotOf(k2), 9000)), JSON.stringify([slotOf(k1), slotOf(k2)]));
  check('back online: Offline notice disappears', !!(await waitFor(async () => !/Offline/.test(await text(b, '#notice')), 4000)));
  check('back online: phone A sees the changes', !!(await waitFor(async () => /done/.test(String(await tileClass(a, k1))) && /done/.test(String(await tileClass(a, k2))), 7000)));
  check('the changes are credited to player B', !!slotOf(k1) && slotOf(k1).by === 'b' && slotOf(k2).by === 'b');
}

/* ===================================================================================================================
   6. joining by pasting the link
   =================================================================================================================== */
console.log('6. join by pasting');
const joinOverlayOk = async p => !(await overlayOpen(p)) && (await tiles(p)) > 3;
{
  const C1 = await phone(browser, URL0);
  const c = C1.page;
  await c.goto(URL0, { waitUntil: 'load' });
  await waitText(c, /Willkommen/);
  await tapLabel(c, 'Ich habe einen Einladungslink');
  check('join screen asks for the link', await visible(c, '#ws-link') && /Einladung/.test(await overlayText(c)));
  await setValue(c, '#ws-link', 'hallo');
  await tapLabel(c, 'Verbinden');
  check('garbage is refused', /nicht nach einem Einladungslink/.test(await overlayText(c)));
  await c.evaluate(l => navigator.clipboard.writeText(l), link);
  await tapLabel(c, 'Aus Zwischenablage');
  await sleep(200);
  check('"Aus Zwischenablage einfügen" fills in the link', (await c.evaluate(() => document.querySelector('#ws-link').value)) === link);
  check('no JS junk on the join screen', (await overlayJunk(c)) === '');
  await setValue(c, '#ws-link', 'Hier ist unser Plan 👉 ' + link + ' viel Spaß!');
  await tapLabel(c, 'Verbinden');
  await waitFor(() => joinOverlayOk(c), 8000);
  check('a link inside a chat message works', await joinOverlayOk(c), await overlayText(c));
  check('phone C became player B', (await stored(c, 'wp2.me')) === 'b');
  check('after joining the address keeps the invite', /#j=/.test(await c.evaluate(() => location.hash)));
  await C1.close();

  // the bare payload (user copied only the part after #j=)
  const D = await phone(browser, URL0);
  await D.page.goto(URL0, { waitUntil: 'load' });
  await waitText(D.page, /Willkommen/);
  await tapLabel(D.page, 'Ich habe einen Einladungslink');
  await setValue(D.page, '#ws-link', link.split('#j=')[1]);
  await tapLabel(D.page, 'Verbinden');
  await waitFor(() => joinOverlayOk(D.page), 8000);
  check('the bare code (without address) works too', await joinOverlayOk(D.page), await overlayText(D.page));
  await D.close();

  // a household that does not exist
  const E = await phone(browser, URL0);
  const ghost = C.encodeInvite({ cfg: inv.cfg, room: 'zzzzzzzzzzzzzzzz', me: 'b' });
  await E.page.goto(URL0 + '#j=' + ghost, { waitUntil: 'load' });
  await waitText(E.page, /gibt es nicht/, 8000);
  check('a link to a missing household is explained', /Diesen Haushalt gibt es nicht/.test(await overlayText(E.page)), await overlayText(E.page));
  const bt = await buttons(E.page);
  check('offered: retry and other link, never "start anyway"', bt.includes('Erneut versuchen') && bt.includes('Anderen Link einfügen') && !bt.some(x => /Trotzdem/.test(x)), bt.join('|'));
  check('nothing was saved for the missing household', (await stored(E.page, 'ws.v1')) === null);
  await E.page.evaluate(() => { location.hash = ''; });

  // rules refuse the read
  server.setMode(PROJECT, 'denied');
  await E.page.goto('about:blank');
  await E.page.goto(link, { waitUntil: 'load' });
  await waitText(E.page, /Verbindung fehlgeschlagen/, 8000);
  check('refused read points to the rules', /Firebase lässt den Zugriff nicht zu/.test(await overlayText(E.page)), await overlayText(E.page));
  check('…and sends the person who joins to the person who did the setup (no setup steps)', /Frag die Person, die den Haushalt eingerichtet hat/.test(await overlayText(E.page)) && !/Schritt \d/.test(await overlayText(E.page)), await overlayText(E.page));
  server.setMode(PROJECT, 'ok');
  await tapLabel(E.page, 'Erneut versuchen');
  await waitFor(() => joinOverlayOk(E.page), 8000);
  check('"Erneut versuchen" connects once the problem is fixed', await joinOverlayOk(E.page), await overlayText(E.page));
  await E.close();

  // no answer at all (15 s timeout in the app)
  const F = await phone(browser, URL0);
  await F.page.goto(URL0, { waitUntil: 'load' });
  server.setMode(PROJECT, 'hang');
  await F.page.goto('about:blank');
  await F.page.goto(link, { waitUntil: 'load' });
  const t0 = Date.now();
  await waitText(F.page, /Verbindung fehlgeschlagen/, 25000);
  check('no answer from Firebase: explained after about 15 s (app timeout)', /Keine Antwort von Firebase/.test(await overlayText(F.page)) && Date.now() - t0 > 13000, (Date.now() - t0) + ' ms: ' + (await overlayText(F.page)).slice(0, 120));
  check('…the text for joining names the internet first and the person who set up (no setup steps)', /Prüfe dein Internet/.test(await overlayText(F.page)) && /Frag die Person, die den Haushalt eingerichtet hat/.test(await overlayText(F.page)) && !/Schritt \d/.test(await overlayText(F.page)), await overlayText(F.page));
  server.setMode(PROJECT, 'ok');
  await F.close();
}

/* ===================================================================================================================
   7. a link to another household while already connected
   =================================================================================================================== */
console.log('7. other household');
{
  const R2 = 'qqqqqqqqqqqqqqqq';
  server.put(PROJECT, 'rooms/' + R2 + '/settings/people', { a: 'Mia', b: 'Tom', reward: 'Kino', goal: 70 });
  const other = C.inviteUrl(URL0, { cfg: inv.cfg, room: R2, me: 'a' });
  await b.goto('about:blank');
  await b.goto(other, { waitUntil: 'load' });
  await waitText(b, /Anderer Haushalt/, 5000);
  const swText = await overlayText(b);
  check('a link for another household asks before switching', /Anderer Haushalt/.test(swText));
  check('…names both households by their short codes (the same code the settings show)', swText.includes('····' + R.slice(-4).toUpperCase()) && swText.includes('····QQQQ'), swText);
  check('…staying is the first, primary choice', (await buttons(b)).filter(Boolean)[0] === 'Beim bisherigen bleiben', (await buttons(b)).join('|'));
  check('…and it says that nothing gets deleted', /bleiben in Firebase erhalten/.test(swText));
  check('no JS junk on the question', (await overlayJunk(b)) === '');
  await tapLabel(b, 'Beim bisherigen bleiben');
  await waitFor(async () => (await tiles(b)) > 3, 5000);
  const kept = JSON.parse(await stored(b, 'ws.v1'));
  check('staying keeps the old household', kept.room === R && (await tiles(b)) > 3 && !(await overlayOpen(b)));
  check('…and the address shows the old household again', C.extractInvite(await b.evaluate(() => location.hash)).room === R);

  // switching to a household that does not exist: the way back to the current one stays open
  await b.goto('about:blank');
  await b.goto(C.inviteUrl(URL0, { cfg: inv.cfg, room: 'zzzzzzzzzzzzzzzz' }), { waitUntil: 'load' });
  await waitText(b, /Anderer Haushalt/, 5000);
  await tapLabel(b, 'Zum neuen Haushalt wechseln');
  await waitText(b, /gibt es nicht/, 8000);
  const failBtns = (await buttons(b)).filter(x => x && !/Zurück/.test(x));
  check('failed switch: staying is offered first, then a retry, and no detour to "other link"', failBtns[0] === 'Beim bisherigen Haushalt bleiben' && failBtns.includes('Erneut versuchen') && !failBtns.includes('Anderen Link einfügen'), failBtns.join('|'));
  check('failed switch: the old household is still the saved one', JSON.parse(await stored(b, 'ws.v1')).room === R);
  await tapLabel(b, '‹ Zurück');
  check('failed switch: "back" returns to the question, not to the welcome screen', /Anderer Haushalt/.test(await overlayText(b)) && !/Willkommen/.test(await overlayText(b)), await overlayText(b));
  await tapLabel(b, 'Zum neuen Haushalt wechseln');
  await waitText(b, /gibt es nicht/, 8000);
  await tapLabel(b, 'Beim bisherigen Haushalt bleiben');
  await waitFor(async () => (await tiles(b)) > 3, 5000);
  check('failed switch: staying brings the old household back', !(await overlayOpen(b)) && (await tiles(b)) > 3 && /Anna/.test(await meName(b)) && C.extractInvite(await b.evaluate(() => location.hash)).room === R);
  await b.goto('about:blank');
  await b.goto(other, { waitUntil: 'load' });
  await waitText(b, /Anderer Haushalt/, 5000);
  await tapLabel(b, 'Zum neuen Haushalt wechseln');
  await waitFor(async () => /Mia/.test(await meName(b)), 8000);
  check('switching connects to the new household as player A', JSON.parse(await stored(b, 'ws.v1')).room === R2 && /Mia/.test(await meName(b)), await meName(b));
  check('the new household has its own (empty) plan', (await tiles(b)) === 0 && /Noch keine Aufgaben/.test(await text(b, '#notice')));
  check('the first household was not touched', Object.keys(server.dump(PROJECT)).filter(p => p.startsWith('rooms/' + R + '/tasks/')).length === 19);
  // back to the original for the following tests
  await b.goto('about:blank');
  await b.goto(C.inviteUrl(URL0, { cfg: inv.cfg, room: R, me: 'b' }), { waitUntil: 'load' });
  await waitText(b, /Anderer Haushalt/, 5000);
  await tapLabel(b, 'Zum neuen Haushalt wechseln');
  await waitFor(async () => (await tiles(b)) > 3, 8000);
  check('switching back restores the plan', (await tiles(b)) > 3 && /Anna/.test(await meName(b)));
  await b.evaluate(() => { const x = document.querySelector('[data-act="hint"]'); if (x) x.click(); });

  // the player of the old household must not be carried over to the new one
  const H = await phone(browser, URL0);
  await H.page.goto(link, { waitUntil: 'load' });
  await waitFor(() => joinOverlayOk(H.page), 8000);
  check('spare phone: joined as player B by the link', (await stored(H.page, 'wp2.me')) === 'b');
  await H.page.goto('about:blank');
  await H.page.goto(C.inviteUrl(URL0, { cfg: inv.cfg, room: R2 }), { waitUntil: 'load' });                // a link without a player, like a copied address
  await waitText(H.page, /Anderer Haushalt/, 5000);
  await tapLabel(H.page, 'Zum neuen Haushalt wechseln');
  const asked = await waitFor(async () => /Wer spielt hier/.test(await H.page.evaluate(() => document.body.innerText)), 8000);
  check('a link without a player does not inherit the old player: the app asks who is playing', !!asked && (await stored(H.page, 'wp2.me')) === null);
  await H.close();
}

/* ===================================================================================================================
   8. connection block in the settings sheet
   =================================================================================================================== */
console.log('8. settings');
{
  await a.evaluate(() => window.scrollTo(0, 0));
  await tapSel(a, '#open-settings');
  const blockText = await waitFor(() => text(a, '.ws-set'), 3000);
  check('settings sheet has the connection block', /Verbindung/.test(blockText) && blockText.includes('····' + R.slice(-4).toUpperCase()) && /Online/.test(blockText) && /Version 2\.2 \([0-9a-f]{6}\)/.test(blockText), blockText);
  await shot(a, 'settings.png');
  check('connection block shows no household secrets', !blockText.includes(R) && !/AIza/.test(blockText));
  await tapLabel(a, 'Einladen / QR-Code', '#modal');
  await waitText(a, /Einladen/, 3000);
  check('"Einladen / QR-Code" opens the invite screen with a way back', /Öffne den Link auf dem anderen Handy/.test(await overlayText(a)) && (await buttons(a)).includes('‹ Zurück zur App'), (await buttons(a)).join('|'));
  check('invite from settings decodes (partner = Anna)', C.extractInvite((await decodeQr(a)) || '') && C.extractInvite(await decodeQr(a)).me === 'b');
  await tapLabel(a, '‹ Zurück zur App');
  check('back closes the invite screen, settings stay open', !(await overlayOpen(a)) && (await visible(a, '#modal')));
  await tapLabel(a, 'Aufs Handy legen', '#modal');
  check('"Aufs Handy legen" shows steps for the browser menu', /Home-Bildschirm|Startbildschirm|Installieren/.test(await overlayText(a)) && (await buttons(a)).includes('‹ Zurück zur App'), (await overlayText(a)).slice(0, 200));
  await tapLabel(a, '‹ Zurück zur App');
  // two-tap disconnect on a spare phone (so A and B stay connected for the next sections)
  const G = await phone(browser, URL0);
  await G.page.goto(link, { waitUntil: 'load' });
  await waitFor(() => joinOverlayOk(G.page), 8000);
  await G.page.evaluate(() => { const x = document.querySelector('[data-act="hint"]'); if (x) x.click(); });
  await tapSel(G.page, '#open-settings');
  await waitFor(() => text(G.page, '.ws-set'), 3000);
  await tapLabel(G.page, 'Von diesem Haushalt trennen', '#modal');
  check('first tap on "trennen" only asks again', /Wirklich trennen\?/.test(await text(G.page, '.ws-del')) && (await stored(G.page, 'ws.v1')) !== null);
  await sleep(3900);
  check('…and gives up asking after a few seconds', /Von diesem Haushalt trennen/.test(await text(G.page, '.ws-del')));
  await tapLabel(G.page, 'Von diesem Haushalt trennen', '#modal');
  await sleep(450);
  await tapLabel(G.page, 'Wirklich trennen', '#modal');
  await waitText(G.page, /Willkommen/, 5000);
  check('confirmed: the phone forgets the household and shows the welcome screen', (await stored(G.page, 'ws.v1')) === null && (await stored(G.page, 'wp2.me')) === null && /Willkommen/.test(await overlayText(G.page)));
  check('…the address no longer carries an invite', !/#j=/.test(await G.page.evaluate(() => location.hash)));
  check('disconnecting does not touch the household data', Object.keys(server.dump(PROJECT)).filter(p => p.startsWith('rooms/' + R + '/tasks/')).length === 19);
  await G.close();
  await a.evaluate(() => { const b2 = document.querySelector('#modal .cancel'); if (b2) b2.click(); });
}

/* ===================================================================================================================
   9. problems while the app is running
   =================================================================================================================== */
console.log('9. problems while running');
{
  const k3 = W + '_haustier_3';
  server.setMode(PROJECT, 'quota');
  await tapTile(b, k3);
  await waitFor(async () => /Tageslimit/.test(await text(b, '#toast')), 4000);
  check('quota exhausted: friendly toast (no claim that the quota is surely used up), tile rolled back', /Tageslimit\?/.test(await text(b, '#toast')) && !/done/.test(String(await tileClass(b, k3))), await text(b, '#toast') + ' | ' + await tileClass(b, k3));
  server.setMode(PROJECT, 'denied');
  const failed = await waitFor(async () => /Zugriff verweigert/.test(await text(b, '#notice')), 4000);
  check('rules refuse the live connection: notice names the rules', !!failed, await text(b, '#notice'));
  check('…and tells whoever did the setup where to look', /Wer den Haushalt eingerichtet hat/.test(await text(b, '#notice')) && /Firestore → Regeln/.test(await text(b, '#notice')), await text(b, '#notice'));
  await sleep(300);
  await tapTile(b, k3);
  await waitFor(async () => /Regeln im Firebase-Projekt/.test(await text(b, '#toast')), 4000);
  check('refused write: toast names the rules', /Regeln im Firebase-Projekt/.test(await text(b, '#toast')), await text(b, '#toast'));
  check('…the same notice shows on phone A (every connected phone is affected)', /Zugriff verweigert/.test(await text(a, '#notice')), await text(a, '#notice'));
  server.setMode(PROJECT, 'ok');
  await b.reload({ waitUntil: 'load' });
  await waitFor(async () => (await tiles(b)) > 3, 8000);
  check('after fixing the rules a reload brings everything back', (await tiles(b)) > 3 && !/Zugriff verweigert/.test(await text(b, '#notice')) && /done/.test(String(await tileClass(b, k1))));
  await a.reload({ waitUntil: 'load' });
  await waitFor(async () => (await tiles(a)) > 3, 8000);
  check('phone A recovers the same way', (await tiles(a)) > 3 && !/Zugriff verweigert/.test(await text(a, '#notice')));
  check('no JS junk in the game after all this', (await junk(b)) === '', await junk(b));
}

/* ===================================================================================================================
   9b. changes the server never confirms (nothing in Firebase answers writes): the person is told after ~20 s
   =================================================================================================================== */
console.log('9b. changes that cannot be sent');
{
  const k4 = W + '_haustier_3', k5 = W + '_bad_6';
  const J = await phone(browser, URL0);                       // a third phone: it leaves a change unsent and then restarts
  await J.page.goto(link, { waitUntil: 'load' });
  await waitFor(() => joinOverlayOk(J.page), 8000);
  await J.page.evaluate(() => { const x = document.querySelector('[data-act="hint"]'); if (x) x.click(); });
  await b.evaluate(() => window.scrollTo(0, 0));
  server.setMode(PROJECT, 'nowrite');
  await tapTile(b, k4);
  await scrollToKey(J.page, k5);
  await tapTile(J.page, k5);
  await sleep(2000);
  check('unconfirmed: the tick shows at once and no error toast appears', /done/.test(String(await tileClass(b, k4))) && !/nicht geklappt/.test(await text(b, '#toast')));
  check('…and for the first seconds nothing is reported', !/Noch nicht gesendet/.test(await text(b, '#notice')), await text(b, '#notice'));
  await J.page.reload({ waitUntil: 'load' });                  // the unsent tick of J survives the restart (persistent queue)
  await waitFor(() => joinOverlayOk(J.page), 8000);
  check('restart: the unsent tick is still there', /done/.test(String(await tileClass(J.page, k5))), String(await tileClass(J.page, k5)));
  const seen = await waitFor(async () => /Noch nicht gesendet/.test(await text(b, '#notice')), 24000);
  check('after ~20 s the person is told that the change is not arriving', !!seen && /auf diesem Handy gespeichert/.test(await text(b, '#notice')), await text(b, '#notice'));
  check('…and it is not mistaken for being offline', !/Offline/.test(await text(b, '#notice')), await text(b, '#notice'));
  const seenJ = await waitFor(async () => /Noch nicht gesendet/.test(await text(J.page, '#notice')), 24000);
  check('a change left over from an earlier visit is reported too', !!seenJ, await text(J.page, '#notice'));
  check('nothing reached the household meanwhile', !slotOf(k4) && !slotOf(k5));
  server.setMode(PROJECT, 'ok');
  const arrived = await waitFor(() => !!slotOf(k4) && !!slotOf(k5), 12000);
  check('once Firebase answers again both changes arrive', !!arrived, JSON.stringify([slotOf(k4), slotOf(k5)]));
  check('…and the notice disappears on both phones', !!(await waitFor(async () => !/Noch nicht gesendet/.test(await text(b, '#notice')) && !/Noch nicht gesendet/.test(await text(J.page, '#notice')), 8000)), await text(b, '#notice') + ' | ' + await text(J.page, '#notice'));
  check('…and phone A sees the change', !!(await waitFor(async () => /done/.test(String(await tileClass(a, k4))), 8000)));
  await J.close();
  // undo, so the following sections start from the same plan
  await tapTile(b, k4);
  await waitFor(() => !slotOf(k4), 5000);
}

/* ===================================================================================================================
   10. install help per platform
   =================================================================================================================== */
console.log('10. install help');
{
  const I = await phone(browser, URL0, { ua: UA_IPHONE });
  await I.page.goto(link, { waitUntil: 'load' });
  await waitText(I.page, /Aufs Handy legen/, 8000);
  const t = await overlayText(I.page);
  check('iPhone: after joining, the Home-Screen steps appear', /Safari/.test(t) && /Zum Home-Bildschirm/.test(t) && /Teilen/.test(t), t.slice(0, 300));
  check('iPhone: the steps mention the separate storage fallback', /Mein 2\. Handy/.test(t));
  check('no JS junk on the install help', (await overlayJunk(I.page)) === '');
  await shot(I.page, 'install-ios.png');
  await tapLabel(I.page, 'Verstanden');
  check('"Verstanden" opens the game', !(await overlayOpen(I.page)) && (await waitFor(() => joinOverlayOk(I.page), 5000)));
  await I.page.reload({ waitUntil: 'load' });
  await sleep(600);
  check('the install help is shown only once', !(await overlayOpen(I.page)));
  await I.close();
  const An = await phone(browser, URL0, { ua: UA_ANDROID });
  await An.page.goto(link, { waitUntil: 'load' });
  await waitText(An.page, /Aufs Handy legen/, 8000);
  check('Android: install help names "App installieren"', /App installieren/.test(await overlayText(An.page)));
  await An.close();
}

/* ===================================================================================================================
   11. everything the app writes: new / edited / deleted tasks, settings, un-ticking, other weeks, who-am-I
   =================================================================================================================== */
console.log('11. editing');
{
  const tasksOnServer = () => Object.entries(server.dump(PROJECT)).filter(([p]) => p.startsWith('rooms/' + R + '/tasks/')).map(([p, d]) => Object.assign({ _id: p.split('/').pop() }, d));
  const findTask = title => tasksOnServer().find(t => t.title === title);
  const titleOnPage = async (page, t) => { await showDay(page, 4); return page.evaluate(t => [...document.querySelectorAll('#days .t-title')].some(e => e.textContent.includes(t)), t); };      // the new task is a Friday task
  await a.evaluate(() => window.scrollTo(0, 0));
  await a.evaluate(() => { const x = document.querySelector('[data-act="hint"]'); if (x) x.click(); });

  // new task
  await showDay(a, 4);
  await tapSel(a, '.add[data-add="4"]');
  await waitFor(() => visible(a, '#f-title'), 3000);
  await setValue(a, '#f-title', 'Fenster putzen');
  await tapSel(a, '#modal .save');
  const created = await waitFor(() => findTask('Fenster putzen'), 4000);
  check('a new task is stored with the expected fields', !!created && created.who === 'a' && JSON.stringify(created.days) === '[4]' && created.pts === 1 && typeof created.order === 'number' && typeof created.createdAt === 'number' && !('once' in created) && /^t[a-z0-9]+$/.test(created._id), JSON.stringify(created));
  check('…and it appears on phone B', !!(await waitFor(() => titleOnPage(b, 'Fenster putzen'), 5000)));

  // edit it (hold in place opens the editor)
  const tk = W + '_' + (created ? created._id : 'x') + '_4';
  const hasTile = await waitFor(() => a.evaluate(k => !!document.querySelector('.tile[data-key="' + k + '"]'), tk), 4000);
  check('the new tile shows on phone A (Friday)', !!hasTile, await a.evaluate(() => [...document.querySelectorAll('.tile')].map(t => t.dataset.key).filter(k => /_4$/.test(k)).join(',')) + ' | modal: ' + await text(a, '#modal'));
  await scrollToKey(a, tk);
  const pos = await rect(a, '.tile[data-key="' + tk + '"]');
  const th = await a.touchscreen.touchStart(pos.x, pos.y); await sleep(700); await th.end(); await sleep(300);
  check('holding a tile in place opens the editor', /Bearbeiten/.test(await text(a, '#modal')), await text(a, '#modal'));
  await setValue(a, '#f-title', 'Fenster putzen!');
  await tapSel(a, '#modal .save');
  check('editing rewrites the same document', !!(await waitFor(() => { const t = findTask('Fenster putzen!'); return t && t._id === created._id && !findTask('Fenster putzen'); }, 4000)));
  check('…and phone B shows the new title', !!(await waitFor(() => titleOnPage(b, 'Fenster putzen!'), 5000)));

  // delete it (two taps)
  await a.touchscreen.touchStart(pos.x, pos.y).then(async t => { await sleep(700); await t.end(); });
  await sleep(300);
  await tapSel(a, '#modal .del');
  check('delete asks to confirm first', /Wirklich löschen/.test(await text(a, '#modal .del')) && !!findTask('Fenster putzen!'));
  await tapSel(a, '#modal .del');                                                // a double tap does not confirm
  await sleep(150);
  check('a double tap does not delete', !!findTask('Fenster putzen!') && /Wirklich löschen/.test(await text(a, '#modal .del')));
  await sleep(450);
  await tapSel(a, '#modal .del');
  check('confirmed delete removes the document', !!(await waitFor(() => !findTask('Fenster putzen!'), 4000)) && tasksOnServer().length === 19);
  check('…and phone B no longer shows it', !!(await waitFor(async () => !(await titleOnPage(b, 'Fenster putzen!')), 5000)));

  // settings
  await a.evaluate(() => window.scrollTo(0, 0));
  await tapSel(a, '#open-settings');
  await waitFor(() => visible(a, '#n-r'), 3000);
  const before = server.dump(PROJECT)['rooms/' + R + '/settings/people'];
  await setValue(a, '#n-r', 'Kino 🎬');
  await tapLabel(a, '70 %', '#modal');
  await tapSel(a, '#modal .save');
  const saved = await waitFor(() => server.dump(PROJECT)['rooms/' + R + '/settings/people'].reward === 'Kino 🎬', 4000);
  const after = server.dump(PROJECT)['rooms/' + R + '/settings/people'];
  check('settings: reward and goal are saved, names and device ids kept', !!saved && after.goal === 70 && after.a === 'Simon' && after.b === 'Anna' && after.aId === before.aId && !!after.aId, JSON.stringify(after));
  check('…and phone B shows the new reward', !!(await waitFor(async () => /Kino/.test(await text(b, '#quest')), 5000)), await text(b, '#quest'));

  // un-tick
  await a.evaluate(() => window.scrollTo(0, 0));
  await scrollToKey(a, key0);
  await tapTile(a, key0);
  check('ticking a done tile again removes the slot document', !!(await waitFor(() => !slotOf(key0), 4000)), JSON.stringify(slotOf(key0)));
  check('…and phone B shows it open again', !!(await waitFor(async () => !/done/.test(String(await tileClass(b, key0))), 5000)));

  // next week
  await tapSel(a, '#next');
  await sleep(500);
  const k42 = '2026-10-12_kochen-a_0';
  await scrollToKey(a, k42);
  await tapTile(a, k42);
  const w42 = await waitFor(() => !!slotOf(k42), 4000);
  check('ticking in the next week writes into that week', !!w42 && slotOf(k42).week === '2026-10-12', JSON.stringify(slotOf(k42)));
  await tapSel(a, '#thisweek');
  await sleep(400);

  // who am I (phone B): "Du spielst als" in the settings sheet
  await b.evaluate(() => window.scrollTo(0, 0));
  await tapSel(b, '#open-settings');
  await waitFor(() => visible(b, '#modal .opt.who-b'), 3000);
  check('"Du spielst als" offers both players by name, the current one is marked', /Simon/.test(await text(b, '#modal')) && /Anna/.test(await text(b, '#modal')) && (await b.evaluate(() => document.querySelector('#modal .opt.who-b').getAttribute('aria-checked'))) === 'true');
  await tapSel(b, '#modal .opt.who-b');
  const bid = await stored(b, 'ws.uid');
  const ppl = await waitFor(() => server.dump(PROJECT)['rooms/' + R + '/settings/people'].bId === bid, 4000);
  const p2 = server.dump(PROJECT)['rooms/' + R + '/settings/people'];
  check('choosing a player remembers this phone as that player (bId), keeps the rest', !!ppl && p2.aId === before.aId && p2.goal === 70 && p2.reward === 'Kino 🎬', JSON.stringify(p2));
  await tapSel(b, '#modal .cancel');
  check('closing the settings without saving leaves the game as it was', !(await visible(b, '#modal')) && (await meName(b)) === 'Anna');

  // share button (phones have navigator.share)
  const S = await phone(browser, URL0, { pre: () => { navigator.share = async d => { window.__shared = d; }; } });
  await S.page.goto(link, { waitUntil: 'load' });
  await waitFor(() => joinOverlayOk(S.page), 8000);
  await S.page.evaluate(() => { const x = document.querySelector('[data-act="hint"]'); if (x) x.click(); });
  await tapSel(S.page, '#open-settings');
  await waitFor(() => text(S.page, '.ws-set'), 3000);
  await tapLabel(S.page, 'Einladen / QR-Code', '#modal');
  await waitText(S.page, /Link teilen/, 3000);
  await tapLabel(S.page, 'Link teilen');
  const shared = await S.page.evaluate(() => window.__shared);
  check('"Link teilen" hands the invite to the phone\'s share sheet', !!shared && /Slowik/.test(shared.title) && C.extractInvite(shared.url) && C.extractInvite(shared.url).room === R, JSON.stringify(shared));
  await S.close();
  const unexpected = e => !/ERR_INTERNET_DISCONNECTED|ERR_EMPTY_RESPONSE|ERR_CONNECTION_(RESET|CLOSED)|Failed to load resource: the server responded with a status of (403|404)/.test(e);   // refused or dropped on purpose while testing offline and unsent writes
  check('no unexpected page errors on phones A and B in the whole run', A.errors.filter(unexpected).length === 0 && B.errors.filter(unexpected).length === 0, A.errors.concat(B.errors).filter(unexpected).join('|'));
}

/* ===================================================================================================================
   12. updates: a new version of the files replaces the stored copy
   =================================================================================================================== */
console.log('12. update');
{
  const fs = await import('node:fs');
  const dir = path.resolve(here, '../dist-fake');
  const idx = path.join(dir, 'index.html'), sw = path.join(dir, 'sw.js');
  const idx0 = fs.readFileSync(idx, 'utf8'), sw0 = fs.readFileSync(sw, 'utf8');
  try {
    fs.writeFileSync(idx, idx0.replace('<title>Slowik</title>', '<title>Slowik NEU</title>'));
    fs.writeFileSync(sw, sw0.replace(/const VERSION = '[^']*'/, "const VERSION = 'v2test'"));
    await b.reload({ waitUntil: 'load' });
    check('online reload serves the new version at once', (await b.title()) === 'Slowik NEU', await b.title());
    const swSwapped = await waitFor(async () => { const k = await b.evaluate(() => caches.keys()); return k.length === 1 && k[0] === 'wochenspiel:/:v2test'; }, 8000);
    check('the new service worker installs and replaces the old cache', !!swSwapped, (await b.evaluate(() => caches.keys())).join());
    await netState(B, 'offline');
    await b.reload({ waitUntil: 'load' });
    check('offline reload now serves the new version', (await b.title()) === 'Slowik NEU', await b.title());
    await netState(B, 'online');

    // a page that is not ours (captive portal, error page) must not replace the stored copy
    fs.writeFileSync(idx, '<!doctype html><meta charset="utf-8"><title>Anmelden</title><p>Bitte im WLAN anmelden</p>');
    await b.goto(URL0, { waitUntil: 'load' });
    check('online, a foreign answer from the network is shown as it is', (await b.title()) === 'Anmelden', await b.title());
    await sleep(400);
    await netState(B, 'offline');
    await b.goto(URL0, { waitUntil: 'load' });
    await waitFor(async () => (await tiles(b)) > 3, 8000);
    check('…but it did not replace the stored app: offline the app starts as before', (await b.title()) === 'Slowik NEU' && (await tiles(b)) > 3, await b.title());
    await netState(B, 'online');
    // other files opened inside the scope never touch the stored page either
    fs.writeFileSync(idx, idx0.replace('<title>Slowik</title>', '<title>Slowik NEU</title>'));
    await b.goto(URL0 + 'manifest.json', { waitUntil: 'load' });
    await b.goto(URL0, { waitUntil: 'load' });
    await netState(B, 'offline');
    await b.goto(URL0, { waitUntil: 'load' });
    check('after opening a JSON file in the scope, the offline start still shows the app', (await b.title()) === 'Slowik NEU', await b.title());
    await netState(B, 'online');

    // a network that accepts the request but never answers: the stored copy is used after about 4 s
    await netState(B, 'hang');
    const t4 = Date.now();
    await b.goto(URL0, { waitUntil: 'load' });
    const slowMs = Date.now() - t4;
    await waitFor(async () => (await tiles(b)) > 3, 8000);
    check('a silent network: the stored app opens after about 4 s', slowMs > 3500 && slowMs < 9000 && (await b.title()) === 'Slowik NEU' && (await tiles(b)) > 3, slowMs + ' ms, ' + await b.title());

    // the host answers with an error page (a hiccup at GitHub): the stored app is shown instead, and it stays stored
    await netState(B, '503');
    await b.goto(URL0, { waitUntil: 'load' });
    await waitFor(async () => (await tiles(b)) > 3, 8000);
    check('an error answer (503) from the host: the stored app is shown, not the error page', (await b.title()) === 'Slowik NEU' && (await tiles(b)) > 3, await b.title());
    await netState(B, 'offline');
    await b.goto(URL0, { waitUntil: 'load' });
    await waitFor(async () => (await tiles(b)) > 3, 8000);
    check('…and the error page did not replace the stored copy', (await b.title()) === 'Slowik NEU' && (await tiles(b)) > 3, await b.title());
    await netState(B, 'online');
  } finally { fs.writeFileSync(idx, idx0); fs.writeFileSync(sw, sw0); }
}

await A.close().catch(() => {}); await B.close().catch(() => {});
await browser.close();
await server.close();
process.exitCode = done() ? 1 : 0;
