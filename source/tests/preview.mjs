// Screenshots of the real app for the visual check (fake Firebase, frozen clock: Wednesday 7 Oct 2026, week 41).
//   node tests/preview.mjs [scenario ...]          env: WIDTH=390 HEIGHT=844 DARK=1 TAG=x
// scenarios: week scrolled drag dragzone shop wish editor settings who wishsheet import empty muell muellsheet
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, phone, sleep, tapSel, setValue, net, NOW, W, UA_IPHONE } from './e2e-lib.mjs';
import { longPressDrag } from './lib.mjs';
import { startServer } from './fake-server.mjs';
import { starterTasks } from '../src/seed.js';
const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(here, 'shots');

const WIDTH = Number(process.env.WIDTH || 390), HEIGHT = Number(process.env.HEIGHT || 844), DARK = process.env.DARK === '1';
const TAG = process.env.TAG || (DARK ? 'dark' : 'light') + '-' + WIDTH;
const wanted = process.argv.slice(2);
const want = n => !wanted.length || wanted.includes(n);

const PROJECT = 'wochenspiel-test1', ROOM = 'testroomtestroom1', UID = 'uid-simon-0001';
const CFG = { projectId: PROJECT, apiKey: 'AIzaSyD-FAKEKEYFORTESTING0123456789abcd', authDomain: PROJECT + '.firebaseapp.com', appId: '1:123456789012:web:abcdef0123456789abcdef' };

const server = await startServer({ dir: path.resolve(here, '../dist-fake') });
net.api = server.apiUrl;
const browser = await launch();

function seed(empty, noIds) {
  const put = (p, d) => server.put(PROJECT, 'rooms/' + ROOM + '/' + p, d);
  put('settings/people', Object.assign({ a: 'Simon', b: 'Anna', reward: process.env.REWARD || 'Pizza-Abend 🍕', goal: Number(process.env.GOAL || 80) }, noIds ? {} : { aId: UID }));
  if (empty) return;
  for (const t of starterTasks(W, NOW)) put('tasks/' + t.id, t.data);
  const done = (task, day, by, extra = {}) => put('slots/' + W + '_' + task + '_' + day, Object.assign({ week: W, task, day, done: true, by, at: NOW - 3600e3 }, extra));
  done('kita-bringen-a', 0, 'a'); done('haustier', 0, 'b'); done('abholen-b', 0, 'b'); done('kochen-a', 0, 'a'); done('geschirr', 0, 'b'); done('bett-b', 0, 'b');
  done('kita-bringen-b', 1, 'b'); done('haustier', 1, 'a'); done('abholen-a', 1, 'a'); done('kochen-b', 1, 'b'); done('bett-a', 1, 'a');
  done('kita-bringen-a', 2, 'a'); done('haustier', 2, 'b');
  if (process.env.ALLDONE) for (const t of starterTasks(W, NOW)) for (const d of t.data.days) done(t.id, d, 'a');
  const now = Date.now();
  const li = (id, d) => put('settings/' + id, d);
  li('shop-a1', { t: 'Eier (10er)', by: 'b', at: now - 5000, done: false });
  li('shop-a2', { t: 'Vollkornbrot', by: 'b', at: now - 4000, done: false });
  li('shop-a3', { t: 'Milch', by: 'a', at: now - 3000, done: false });
  li('shop-a4', { t: 'Zucchini', by: 'a', at: now - 2500, done: false });
  li('shop-a5', { t: 'Feta', by: 'b', at: now - 2000, done: false });
  li('shop-a6', { t: 'Butter', by: 'a', at: now - 1500, done: true, doneAt: now - 1000 });
  li('shop-a7', { t: 'Äpfel', by: 'a', at: now - 1400, done: true, doneAt: now - 900 });
  li('wish-b1', { t: 'Neue Waschmaschine', price: 649, prio: 1, by: 'a', at: now - 9000, got: false, note: 'Die alte tropft. Angebot: https://www.example.com/waschmaschine' });
  li('wish-b2', { t: 'Urlaub in Portugal', price: 2400, prio: 2, by: 'b', at: now - 8000, got: false });
  li('wish-b3', { t: 'Sofa aus Leder', price: 1299.5, prio: 3, by: 'b', at: now - 7000, got: false });
  li('wish-b4', { t: 'Wandfarbe fürs Kinderzimmer', prio: 2, by: 'a', at: now - 6000, got: false });
  li('wish-b5', { t: 'Fahrradanhänger', price: 320, prio: 1, by: 'a', at: now - 20000, got: true, gotAt: now - 1000 });
}

async function open(empty, noIds) {
  server.reset();
  seed(empty, noIds);
  const P = await phone(browser, server.url, { dark: DARK, ua: UA_IPHONE, width: WIDTH, height: HEIGHT });
  await P.page.evaluateOnNewDocument((conn, uid, noMe) => {
    try { localStorage.setItem('ws.v1', JSON.stringify(conn)); localStorage.setItem('ws.uid', uid); if (!noMe) localStorage.setItem('wp2.me', 'a'); localStorage.setItem('wp2.hint', '1'); localStorage.setItem('ws.install', '1'); } catch (e) { /* ignore */ }
  }, { v: 1, cfg: CFG, room: ROOM }, UID, !!noIds);
  await P.page.goto(server.url, { waitUntil: 'load' });
  await P.page.evaluate(() => document.fonts.ready);
  await sleep(1500);
  return P;
}
const shot = (P, name) => P.page.screenshot({ path: path.join(OUT, 'pv-' + TAG + '-' + name + '.png') });
const report = (P, name) => console.log(name.padEnd(12), P.errors.length ? P.errors : 'no errors');

if (want('week') || want('scrolled') || want('drag') || want('dragzone') || want('editor') || want('settings')) {
  const P = await open(false);
  const p = P.page;
  if (want('week')) { await shot(P, 'week'); report(P, 'week'); }
  if (want('scrolled')) { await p.evaluate(() => window.scrollTo(0, 330)); await sleep(500); await shot(P, 'scrolled'); await p.evaluate(() => window.scrollTo(0, 0)); await sleep(300); report(P, 'scrolled'); }
  if (want('drag')) {
    const from = await p.evaluate(() => { const t = document.querySelector('.tile:not(.done):not(.skip)'); const r = t.getBoundingClientRect(); return { x: r.left + 90, y: r.top + r.height / 2 }; });
    const to = await p.evaluate(() => { const c = document.querySelector('#strip .dcell[data-day="3"]'); const r = c.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + 38 }; });
    const t = await longPressDrag(p, from, to, { release: false, endHold: 700 });
    await shot(P, 'drag');
    await t.end(); await sleep(400);
    report(P, 'drag');
  }
  if (want('dragzone')) {
    const from = await p.evaluate(() => { const t = document.querySelector('.tile:not(.done):not(.skip)'); const r = t.getBoundingClientRect(); return { x: r.left + 90, y: r.top + r.height / 2 }; });
    const to = await p.evaluate(() => { const c = document.querySelector('#dock .zone[data-drop="skip"]'); const r = c.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + 20 }; });
    const t = await longPressDrag(p, from, to, { release: false, endHold: 700 });
    await shot(P, 'dragzone');
    const t2 = t; await t2.end(); await sleep(300);
    report(P, 'dragzone');
  }
  if (want('editor')) { await tapSel(p, '#add-top'); await sleep(500); await shot(P, 'editor'); await tapSel(p, '#modal .cancel'); await sleep(300); report(P, 'editor'); }
  if (want('settings')) { await tapSel(p, '#open-settings'); await sleep(500); await shot(P, 'settings'); await p.evaluate(() => document.querySelector('#modal .modal-body').scrollTo(0, 9999)); await sleep(300); await shot(P, 'settings2'); await tapSel(p, '#modal .cancel'); await sleep(300); report(P, 'settings'); }
  await P.close();
}
if (want('who')) {
  const P = await open(false, true);
  await shot(P, 'who'); report(P, 'who');
  await P.close();
}
if (want('shop') || want('wish') || want('wishsheet') || want('import')) {
  const P = await open(false);
  const p = P.page;
  if (want('shop')) { await tapSel(p, '#open-shop'); await sleep(600); await shot(P, 'shop'); }
  if (want('import')) { await tapSel(p, '#open-shop'); await sleep(400); await tapSel(p, '#li-import'); await setValue(p, '#imp-t', 'Einkaufsliste für Samstag\n- 2 Zucchini\n- Feta\n1. Olivenöl\n[ ] Brot'); await sleep(300); await shot(P, 'import'); await tapSel(p, '#imp-cancel'); await sleep(300); }
  if (want('wish')) { await tapSel(p, '#open-wish'); await sleep(600); await shot(P, 'wish'); await p.evaluate(() => window.scrollTo(0, 400)); await sleep(300); await shot(P, 'wish2'); }
  if (want('wishsheet')) { await tapSel(p, '#open-wish'); await sleep(400); await p.evaluate(() => window.scrollTo(0, 0)); await tapSel(p, '#li-new-wish'); await sleep(500); await shot(P, 'wishsheet'); }
  report(P, 'lists');
  await P.close();
}
if (want('empty')) {
  const P = await open(true);
  await shot(P, 'empty'); report(P, 'empty');
  await tapSel(P.page, '#open-shop'); await sleep(500); await shot(P, 'empty-shop');
  await tapSel(P.page, '#open-wish'); await sleep(500); await shot(P, 'empty-wish');
  await P.close();
}
if (want('muell') || want('muellsheet')) {
  const P = await open(false);
  const p = P.page;
  if (process.env.MUELL) server.put(PROJECT, 'rooms/' + ROOM + '/settings/muell', JSON.parse(process.env.MUELL));
  await sleep(400);
  await tapSel(p, '#open-muell'); await sleep(700);
  if (want('muell')) {
    await shot(P, 'muell');
    await p.evaluate(() => window.scrollTo(0, document.querySelector('#mu-cal').getBoundingClientRect().top + window.scrollY - 60)); await sleep(300);
    await tapSel(p, '#mu-grid [data-key="' + (process.env.PICK || '2026-10-12') + '"]'); await sleep(1000);
    await shot(P, 'muell2');
    await p.evaluate(() => document.querySelector('#mu-remind').scrollIntoView({ block: 'center' })); await sleep(300);
    await shot(P, 'muell-remind');
    await p.evaluate(() => window.scrollTo(0, 99999)); await sleep(300);
    await shot(P, 'muell3');
  }
  if (want('muellsheet')) {
    await p.evaluate(() => window.scrollTo(0, 0)); await sleep(200);
    await tapSel(p, '#mu-set'); await sleep(500);
    await setValue(p, '#mu-street', process.env.STREET || 'haupt'); await sleep(300);
    await shot(P, 'muellsheet');
    await p.evaluate(() => document.querySelector('#mu-sheet .modal-body').scrollTo(0, 9999)); await sleep(300);
    await shot(P, 'muellsheet2');
  }
  report(P, 'muell');
  await P.close();
}
await browser.close(); await server.close();
