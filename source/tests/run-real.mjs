// The REAL Firebase SDK (production bundle in dist/) in Chromium, without any server: every request to a non-local host is
// refused, so Firestore runs on its local layer only. Checks that the adapter works with the real SDK's API and that the
// persistent cache keeps data and unsent writes across a reload. Real server behaviour (rules, quotas) cannot be tested here.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, phone, reporter, sleep, visible, text, overlayText, overlayOpen, waitFor, waitText, tapSel, tapLabel, setValue, CONFIG_TEXT, W, allTiles } from './e2e-lib.mjs';
import { startServer } from './fake-server.mjs';
import * as C from '../src/codec.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const server = await startServer({ dir: process.env.DIST ? path.resolve(process.env.DIST) : path.resolve(here, '../dist') });
const URL0 = server.url;
const { check, done } = reporter();
const browser = await launch();
const cfg = C.parseFirebaseConfig(CONFIG_TEXT('wochenspiel-test1')).cfg;
const ROOM = 'realsdkroom2345x';
const tiles = allTiles;          // every tile of the week (the game lists one day at a time; allTiles walks through the strip)
const logs = [];

async function realPhone(opts = {}) {
  const P = await phone(browser, URL0, Object.assign({ now: false }, opts));      // real clock: the SDK compares its own timestamps
  P.page.on('console', m => { if (['warning', 'error'].includes(m.type())) logs.push(m.type() + ': ' + m.text().slice(0, 240)); });
  // what the test itself causes (refused requests, the SDK saying it cannot reach Google) is not an error of the app
  P.realErrors = () => P.errors.filter(e => !/ERR_INTERNET_DISCONNECTED|Could not reach Cloud Firestore backend/.test(e));
  await P.page.setRequestInterception(true);
  P.blocked = [];
  P.page.on('request', req => {
    const u = new URL(req.url());
    if (u.hostname === '127.0.0.1' || u.protocol === 'data:' || u.protocol === 'blob:') return req.continue();
    P.blocked.push(u.hostname);
    return req.abort('internetdisconnected');
  });
  return P;
}
const joined = conn => page => page.evaluateOnNewDocument(c => { if (!localStorage.getItem('ws.v1')) { localStorage.setItem('ws.v1', JSON.stringify({ v: 1, cfg: c.cfg, room: c.room })); localStorage.setItem('wp2.me', 'a'); localStorage.setItem('wp2.hint', '1'); } }, conn);

/* ---- 1. first start with the real bundle ---- */
console.log('1. real bundle, first start');
{
  const P = await realPhone();
  await P.page.goto(URL0, { waitUntil: 'load' });
  await waitText(P.page, /Willkommen/);
  check('real bundle shows the welcome screen', /Willkommen!/.test(await overlayText(P.page)));
  check('no page errors on first start', P.realErrors().length === 0, P.realErrors().join('|'));
  check('first start makes no request to any other host', P.blocked.length === 0, P.blocked.join());
  await P.close();
}

/* ---- 2. joined phone, no network at all ---- */
console.log('2. joined phone without network');
{
  const P = await realPhone();
  await joined({ cfg, room: ROOM })(P.page);
  const t0 = Date.now();
  await P.page.goto(URL0, { waitUntil: 'load' });
  await sleep(1500);
  check('joined phone starts straight into the game', !(await overlayOpen(P.page)) && (await visible(P.page, '#days')));
  check('SDK tried to reach Google (and was refused by the test)', P.blocked.some(h => /googleapis\.com$/.test(h)), P.blocked.join());
  // write through the same API the app uses (adapter -> real SDK), while the server cannot be reached
  const res = await P.page.evaluate(async (w) => {
    const db = await window.claude.use('db');
    const t0 = performance.now();
    await db.doc('settings/people').set({ a: 'Simon', b: 'Anna', reward: 'Pizza-Abend 🍕', goal: 80 });
    const tPeople = Math.round(performance.now() - t0);
    const mk = (id, title, who, days) => db.doc('tasks/' + id).set({ title, emoji: '🧺', who, days, pts: 1, order: 10, createdAt: 1 });
    await Promise.all([mk('t-eins', 'Eins', 'a', [0, 1, 2, 3, 4, 5, 6]), mk('t-zwei', 'Zwei', 'b', [0, 2, 4]), mk('t-drei', 'Drei', 'both', [1])]);
    return { tPeople, total: Math.round(performance.now() - t0) };
  }, W);
  check('offline write resolves after the 1.2 s wait (not hanging)', res.tPeople >= 1000 && res.tPeople < 2500, JSON.stringify(res));
  await sleep(500);
  const n = await tiles(P.page);
  check('data written offline shows up in the game (real SDK local view)', n === 7 + 3 + 1, 'tiles ' + n);
  check('names from the offline write are shown', /Simon/.test(await text(P.page, '#pcs')) && /Anna/.test(await text(P.page, '#pcs')), await text(P.page, '#pcs'));
  check('Offline notice only when the browser says so (here: browser is online, server unreachable)', !/Verbindung unterbrochen/.test(await text(P.page, '#notice')), await text(P.page, '#notice'));

  // tick a tile through the UI
  const key = W + '_t-eins_2';
  await tapSel(P.page, '.tile[data-key="' + key + '"]');
  await sleep(1500);
  const cls = await P.page.evaluate(k => document.querySelector('.tile[data-key="' + k + '"]').className, key);
  check('tapping a tile marks it done (offline)', /done/.test(cls), cls);

  // the server never confirms anything here: after ~20 s the person is told (real SDK: the write promise stays pending, as it does without a network)
  const stuck1 = await waitFor(async () => /Noch nicht gesendet/.test(await text(P.page, '#notice')), 26000);
  check('real SDK: changes that cannot reach the server are reported after ~20 s', !!stuck1, await text(P.page, '#notice'));
  check('…and that is not mistaken for "offline" (the browser says it is online)', !/Offline/.test(await text(P.page, '#notice')), await text(P.page, '#notice'));

  // reload: the real persistent cache (IndexedDB) must bring everything back, including the unsent tick
  await P.page.reload({ waitUntil: 'load' });
  await waitFor(async () => (await tiles(P.page)) > 5, 20000);
  const n2 = await tiles(P.page);
  check('after reload the data is still there (IndexedDB cache)', n2 === 11, 'tiles ' + n2);
  const clsOf = () => P.page.evaluate(k => { const e = document.querySelector('.tile[data-key="' + k + '"]'); return e && e.className; }, key);
  const tickBack = await waitFor(async () => /done/.test(String(await clsOf())), 8000);       // the tasks and the slots arrive in separate snapshots
  const cls2 = await clsOf();
  check('after reload the unsent tick is still there (persisted write queue)', !!tickBack, String(cls2));
  const stuck2 = await waitFor(async () => /Noch nicht gesendet/.test(await text(P.page, '#notice')), 26000);
  check('real SDK: after a restart the leftover unsent change is reported again (waitForPendingWrites)', !!stuck2, await text(P.page, '#notice'));
  check('no unexpected errors in the whole session', P.realErrors().length === 0, P.realErrors().join('|'));
  const idb = await P.page.evaluate(async () => (await indexedDB.databases()).map(d => d.name));
  check('Firestore keeps its cache in IndexedDB', idb.some(n => /firestore/.test(n)), idb.join());
  await P.page.setOfflineMode(true);
  check('browser offline: the Offline notice appears', !!(await waitFor(async () => /Offline/.test(await text(P.page, '#notice')), 3000)), await text(P.page, '#notice'));
  await P.page.setOfflineMode(false);
  check('browser online again: notice disappears', !!(await waitFor(async () => !/Offline/.test(await text(P.page, '#notice')), 3000)));
  console.log('   (took ' + Math.round((Date.now() - t0) / 1000) + ' s)');
  await P.close();
}

/* ---- 3. setup without network: what the user sees ---- */
console.log('3. setup and join without network (real SDK errors)');
{
  const P = await realPhone();
  await P.page.goto(URL0, { waitUntil: 'load' });
  await waitText(P.page, /Willkommen/);
  await tapLabel(P.page, 'Neu einrichten');
  for (let i = 0; i < 4; i++) await tapLabel(P.page, 'Weiter');
  await setValue(P.page, '#ws-cfg', CONFIG_TEXT('wochenspiel-test1'));
  await setValue(P.page, '#ws-a', 'Simon'); await setValue(P.page, '#ws-b', 'Anna');
  const t0 = Date.now();
  await tapLabel(P.page, 'Verbindung testen');
  await waitText(P.page, /Keine Antwort|Regeln|Datenbank/, 30000);
  const secs = (Date.now() - t0) / 1000;
  check('setup without network ends with an explanation after ~15 s', /Keine Antwort von Firebase/.test(await overlayText(P.page)) && secs > 8 && secs < 25, secs.toFixed(1) + ' s: ' + (await overlayText(P.page)).slice(-260));
  check('failed setup leaves nothing on the phone', (await P.page.evaluate(() => localStorage.getItem('ws.v1'))) === null);
  check('the button works again', await P.page.evaluate(() => !document.querySelector('#ws .ws-btn:last-of-type').disabled));
  await P.close();

  const Q = await realPhone();
  const link = C.inviteUrl(URL0, { cfg, room: ROOM, me: 'b' });
  const t1 = Date.now();
  await Q.page.goto(link, { waitUntil: 'load' });
  await waitText(Q.page, /Verbindung fehlgeschlagen/, 30000);
  const secs2 = (Date.now() - t1) / 1000;
  check('joining without network ends with an explanation', /Keine Antwort von Firebase/.test(await overlayText(Q.page)), secs2.toFixed(1) + ' s: ' + (await overlayText(Q.page)).slice(0, 200));
  console.log('   (join gave up after ' + secs2.toFixed(1) + ' s)');
  await Q.close();
}

/* ---- 4. the waste plan with the real SDK: the household's choice is kept in its cache ---- */
console.log('4. Müll with the real SDK');
{
  const P = await realPhone();
  await joined({ cfg, room: 'realsdkmuell2345' })(P.page);
  await P.page.goto(URL0, { waitUntil: 'load' });
  await sleep(1200);
  await tapSel(P.page, '#open-muell');
  check('the Müll screen shows its month with the real bundle', await visible(P.page, '#screen-muell') && (await P.page.evaluate(() => document.querySelectorAll('#mu-grid .mu-d[data-key]').length)) >= 28);
  await tapSel(P.page, '#mu-set');
  await setValue(P.page, '#mu-street', 'Haydngasse');
  await tapSel(P.page, '#mu-save');
  await sleep(1600);
  check('saving "Eure Tonnen" works offline with the real SDK', (await text(P.page, '#mu-cap')) === 'Haydngasse, Bereich 2' && !(await visible(P.page, '#mu-sheet')), await text(P.page, '#mu-cap'));
  await P.page.evaluate(() => localStorage.removeItem('wp2.muell'));              // only the SDK's own cache may bring it back
  await P.page.reload({ waitUntil: 'load' });
  await sleep(1500);
  await tapSel(P.page, '#open-muell');
  check('after a reload the choice comes back from the SDK cache (IndexedDB)', !!(await waitFor(async () => (await text(P.page, '#mu-cap')) === 'Haydngasse, Bereich 2', 8000)), await text(P.page, '#mu-cap'));
  check('no unexpected errors', P.realErrors().length === 0, P.realErrors().join('|'));
  await P.close();
}

console.log('\nSDK console output (unique):');
for (const l of [...new Set(logs)].slice(0, 12)) console.log('  ' + l);
await browser.close(); await server.close();
process.exitCode = done() ? 1 : 0;
