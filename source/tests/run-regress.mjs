// Regression checks for things the review of the Nest rebuild found (fake Firebase, frozen clock: Wednesday 7 Oct 2026, week 41).
//   node build.mjs && FAKE=1 node build.mjs && node tests/run-regress.mjs
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { netState, launch, phone, reporter, sleep, rect, longPressDrag, waitFor, tapSel, tapLabel, tapTile, showDay, net, NOW, W, UA_IPHONE } from './e2e-lib.mjs';
import { startServer } from './fake-server.mjs';
import { starterTasks } from '../src/seed.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = 'wochenspiel-test1', ROOM = 'testroomtestroom1', UID = 'uid-simon-0001';
const CFG = { projectId: PROJECT, apiKey: 'AIzaSyD-FAKEKEYFORTESTING0123456789abcd', authDomain: PROJECT + '.firebaseapp.com', appId: '1:123456789012:web:abcdef0123456789abcdef' };
const server = await startServer({ dir: path.resolve(here, '../dist-fake') });
net.api = server.apiUrl;
const { check, done } = reporter();
const browser = await launch();
const slotOf = key => server.dump(PROJECT)['rooms/' + ROOM + '/slots/' + key];
const W2 = '2026-10-12';

async function open() {
  server.reset();
  const put = (p, d) => server.put(PROJECT, 'rooms/' + ROOM + '/' + p, d);
  put('settings/people', { a: 'Simon', b: 'Anna', reward: 'Pizza-Abend', goal: 80, aId: UID });
  for (const t of starterTasks(W, NOW)) put('tasks/' + t.id, t.data);
  const P = await phone(browser, server.url, { ua: UA_IPHONE });
  await P.page.evaluateOnNewDocument((conn, uid) => {
    try { localStorage.setItem('ws.v1', JSON.stringify(conn)); localStorage.setItem('ws.uid', uid); localStorage.setItem('wp2.me', 'a'); localStorage.setItem('wp2.hint', '1'); localStorage.setItem('ws.install', '1'); } catch (e) { /* ignore */ }
  }, { v: 1, cfg: CFG, room: ROOM }, UID);
  await P.page.goto(server.url, { waitUntil: 'load' });
  await P.page.evaluate(() => document.fonts.ready);
  await waitFor(() => P.page.evaluate(() => !document.querySelector('#days').classList.contains('is-loading') && document.querySelectorAll('#days .tile').length > 0), 6000);
  await sleep(600);
  return P;
}
const classOf = (page, key) => page.evaluate(k => { const t = document.querySelector('.tile[data-key="' + k + '"]'); return t ? t.className : null; }, key);

console.log('1. "Rückgängig" after the week was changed writes into the week the task belongs to');
{
  const P = await open(); const a = P.page;
  const key = W + '_kita-bringen-a_2';
  await tapTile(a, key);
  await waitFor(() => { const s = slotOf(key); return s && s.done === true; }, 4000);
  const from = await rect(a, '.tile[data-key="' + key + '"]');
  const to = await rect(a, '#strip .dcell[data-day="3"]');
  await longPressDrag(a, from, to);
  check('a ticked task is carried to Thursday', !!(await waitFor(() => { const s = slotOf(key); return s && s.to === 3 && s.done === true; }, 5000)), JSON.stringify(slotOf(key)));
  await a.evaluate(() => document.querySelector('#next').click());
  await sleep(300);
  check('the next week is shown and the "Rückgängig" button is still there', /Woche 42/.test(await a.evaluate(() => document.querySelector('#kw').textContent)) && /Rückgängig/.test(await a.evaluate(() => document.querySelector('#toast').innerText)));
  await tapLabel(a, 'Rückgängig', '#toast');
  const back = await waitFor(() => { const s = slotOf(key); return s && s.to === undefined; }, 5000);
  const s = slotOf(key);
  check('undo restores the task for the week it was changed in (to is gone, still ticked)', !!back && s.done === true && s.by === 'a', JSON.stringify(s));
  check('…and the document still says it belongs to week 41, not to the week that is shown', s && s.week === W && s.week !== W2, JSON.stringify(s));
  check('…and no document for week 42 appeared', !Object.keys(server.dump(PROJECT)).some(p => p.includes('/slots/' + W2 + '_')));
  check('no page errors', P.errors.length === 0, P.errors.join('|'));
  await P.close();
}

console.log('2. a tap while this week\'s ticks are still loading is ignored');
{
  const P = await open(); const a = P.page;
  await netState(P, 'offline');                                  // the next weeks have never been loaded: nothing arrives for a moment
  await a.evaluate(() => { document.querySelector('#next').click(); });
  await a.evaluate(() => { document.querySelector('#next').click(); });
  const key = W2.replace('12', '19') + '_kita-bringen-a_2';       // week 43
  await sleep(100);
  const loading = await a.evaluate(() => document.querySelector('#days').classList.contains('is-loading'));
  await tapSel(a, '.tile[data-key="' + key + '"]');
  check('while loading the list is marked as loading', loading);
  check('the tap did not tick the task', !/done/.test(String(await classOf(a, key))), String(await classOf(a, key)));
  const ready = await waitFor(() => a.evaluate(() => !document.querySelector('#days').classList.contains('is-loading')), 4000);
  check('after a moment the week is ready (what the phone has is shown)', !!ready);
  await tapSel(a, '.tile[data-key="' + key + '"]');
  check('a tap now ticks the task', !!(await waitFor(async () => /done/.test(String(await classOf(a, key))), 3000)), String(await classOf(a, key)));
  await P.close();
}

console.log('3. the click that follows a long press does not hit the editor that has just opened');
{
  const P = await open(); const a = P.page;
  await showDay(a, 2);
  const key = W + '_haustier_2';
  const r = await rect(a, '.tile[data-key="' + key + '"]');
  const t = await a.touchscreen.touchStart(r.x, r.y);
  await sleep(480);                                               // long enough to lift the task
  await t.end();
  const opened = await waitFor(() => a.evaluate(() => !document.querySelector('#modal').hidden), 3000);
  check('a long press without moving opens the editor', !!opened);
  const swallowed = await a.evaluate((x, y) => {
    const el = document.elementFromPoint(x, y) || document.body;
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y });
    el.dispatchEvent(ev);
    return ev.defaultPrevented;
  }, r.x, r.y);
  check('a click on the spot where the finger was is dropped', swallowed);
  const far = await a.evaluate(() => { const ev = new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }); document.body.dispatchEvent(ev); return ev.defaultPrevented; });
  check('a click somewhere else is not touched', far === false);
  await sleep(750);
  const late = await a.evaluate((x, y) => { const ev = new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y }); document.body.dispatchEvent(ev); return ev.defaultPrevented; }, r.x, r.y);
  check('after a moment clicks at that spot work again', late === false);
  await P.close();
}

console.log('4. while a sheet is open, the page behind it is out of reach');
{
  const P = await open(); const a = P.page;
  await tapSel(a, '#open-settings');
  await sleep(300);
  const st = await a.evaluate(() => ({ app: document.querySelector('#app').inert, bar: document.querySelector('#tabbar').inert, focus: document.activeElement && document.activeElement.closest('#modal') ? 'in-sheet' : String(document.activeElement && document.activeElement.id) }));
  check('settings sheet: page and tab bar are inert, focus is in the sheet', st.app && st.bar && st.focus === 'in-sheet', JSON.stringify(st));
  await a.keyboard.press('Escape');
  await sleep(250);
  const after = await a.evaluate(() => ({ app: document.querySelector('#app').inert, bar: document.querySelector('#tabbar').inert }));
  check('closing it makes them reachable again', !after.app && !after.bar, JSON.stringify(after));
  await P.close();
}

await browser.close();
await server.close();
process.exit(done() ? 1 : 0);
