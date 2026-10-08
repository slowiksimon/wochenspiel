// Browser test of the cleaning overview ("Putzen") with two phones on the fake Firebase.   node tests/run-putz.mjs
// The clock is frozen on Wednesday 7 October 2026, 18:30 (Vienna).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, phone, sleep, waitFor, tapSel, setValue, visible, text, net, reporter, UA_IPHONE, W, NOW } from './e2e-lib.mjs';
import { startServer } from './fake-server.mjs';
import { starterTasks } from '../src/seed.js';
import * as Pz from '../src/putz-core.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const server = await startServer({ dir: path.resolve(here, '../dist-fake') });
net.api = server.apiUrl;
const { check, done } = reporter();
const browser = await launch();
const PROJECT = 'wochenspiel-test1', ROOM = 'testroomputzroom1';
const CFG = { projectId: PROJECT, apiKey: 'AIzaSyD-FAKEKEYFORTESTING0123456789abcd', authDomain: PROJECT + '.firebaseapp.com', appId: '1:123456789012:web:abcdef0123456789abcdef' };
const put = (p, d) => server.put(PROJECT, 'rooms/' + ROOM + '/' + p, d);
put('settings/people', { a: 'Simon', b: 'Anna', aId: 'uid-simon-0001', bId: 'uid-anna-0002', reward: 'Pizza', goal: 80 });
for (const t of starterTasks(W, NOW)) put('tasks/' + t.id, t.data);
const DAY = 864e5;
const docs = () => { const d = server.dump(PROJECT), o = {}; for (const k of Object.keys(d)) { const m = k.match(/^rooms\/[^/]+\/settings\/(putz.*)$/); if (m) o[m[1]] = d[k]; } return o; };
const doneDoc = id => docs()['putz-d-' + id];

async function open(uid, me, opts = {}) {
  const P = await phone(browser, server.url, Object.assign({ ua: UA_IPHONE }, opts));
  await P.page.evaluateOnNewDocument((conn, uid, me) => {
    try { localStorage.setItem('ws.v1', JSON.stringify(conn)); localStorage.setItem('ws.uid', uid); localStorage.setItem('wp2.me', me); localStorage.setItem('wp2.hint', '1'); localStorage.setItem('ws.install', '1'); } catch (e) { /* ignore */ }
  }, { v: 1, cfg: CFG, room: ROOM }, uid, me);
  await P.page.goto(server.url, { waitUntil: 'load' });
  await waitFor(() => P.page.evaluate(() => document.querySelectorAll('#days .tile').length > 0), 8000);
  await sleep(300);
  return P;
}
const goPutz = async P => { await tapSel(P.page, '#open-putz'); await waitFor(() => visible(P.page, '#screen-putz'), 3000); await sleep(200); };
const flat = s => String(s || '').replace(/\s+/g, ' ').trim();
const ftext = async (page, sel) => flat(await text(page, sel));
const attr = (page, sel, n) => page.evaluate((s, n) => { const e = document.querySelector(s); return e ? e.getAttribute(n) : null; }, sel, n);
const chipSel = (room, job) => '#pz-list [data-key="' + room + '-' + job + '"]';
const chip = (page, room, job) => page.evaluate(s => { const c = document.querySelector(s); return c ? { cls: c.className, text: c.innerText.replace(/\s+/g, ' ').trim(), fill: c.style.getPropertyValue('--fill'), label: c.getAttribute('aria-label'), who: (c.querySelector('.dot') || { className: '' }).className } : null; }, chipSel(room, job));
const roomNames = page => page.evaluate(() => Array.from(document.querySelectorAll('#pz-list .pz-rooms')).map(u => u.getAttribute('aria-label') + ':' + Array.from(u.querySelectorAll('.pz-rname')).map(n => n.textContent).join(',')));
const junk = page => page.evaluate(() => { const m = document.body.innerText.match(/\b(null|undefined|NaN|\[object)/g); return m ? m.join(',') : ''; });
const tapRoom = async (page, room) => { await tapSel(page, '#pz-list [data-room="' + room + '"] .pz-rhead'); await waitFor(() => visible(page, '#pz-sheet'), 3000); };
const jobBox = (job, sel) => '#pz-sheet .pz-job[data-job="' + job + '"] ' + sel;

/* ======================================================================================================== */
console.log('1. the tab and the rooms');
const A = await open('uid-simon-0001', 'a'), a = A.page;
check('six tabs: Woche, Einkauf, Wünsche, Putzen, Müll, Ich', (await a.evaluate(() => Array.from(document.querySelectorAll('#tabbar .tab')).map(t => t.querySelector('span').textContent).join())) === 'Woche,Einkauf,Wünsche,Putzen,Müll,Ich');
await goPutz(A);
check('"Putzen" shows its screen, the egg sits behind the fourth tab', await visible(a, '#screen-putz') && !(await visible(a, '#screen-week')) && (await attr(a, '#open-putz', 'aria-current')) === 'page' && (await a.evaluate(() => document.querySelector('#tabbar').style.getPropertyValue('--i'))) === '3');
check('all rooms, by floor, in the order they were listed', (await roomNames(a)).join(' | ') === 'Obergeschoss:Schlafzimmer,Spielzimmer,Kinderzimmer,Bad,Stiege | Erdgeschoss:Wohnzimmer,Büro,Küche,Büro 2,Klo,Vorraum,Abstellraum | Keller:Keller', (await roomNames(a)).join(' | '));
check('every room shows its jobs; at the start they are "noch nie"', (await a.evaluate(() => document.querySelectorAll('#pz-list .pz-chip').length)) === 45 && (await a.evaluate(() => document.querySelectorAll('#pz-list .pz-chip.is-nie').length)) === 45 && (await chip(a, 'kueche', 'putzen')).text === 'Putzen noch nie');
check('the header invites to start, nothing is due, no number on the tab', /^Wann war was\?/.test(await ftext(a, '#pz-next')) && (await text(a, '#pz-cap')) === 'Noch nichts eingetragen' && !(await visible(a, '#n-putz')));
check('looking does not write anything (the rooms are only stored once they are changed)', Object.keys(docs()).length === 0, Object.keys(docs()).join());

console.log('2. ticking off');
const B = await open('uid-anna-0002', 'b'), b = B.page;
await goPutz(B);
await tapSel(a, chipSel('kueche', 'saugen'));
check('one tap: done today, by this phone', await waitFor(() => { const d = doneDoc('kueche-saugen'); return d && d.by === 'a' && Math.abs(d.at - NOW) < 600e3 && d.h.length === 0; }, 4000), JSON.stringify(doneDoc('kueche-saugen')));
const c1 = await chip(a, 'kueche', 'saugen');
check('…the job is full of straw and says "heute", with the dot of the person', /is-ok/.test(c1.cls) && c1.fill === '1.000' && c1.text === 'Saugen heute' && /who-a/.test(c1.who), JSON.stringify(c1));
check('…a message says what was done, with "Rückgängig"', /Küche: Saugen erledigt/.test(await text(a, '#toast')) && /Rückgängig/.test(await text(a, '#toast')));
check('…the other phone sees it at once', await waitFor(async () => ((await chip(b, 'kueche', 'saugen')) || {}).text === 'Saugen heute', 4000));
await tapSel(a, '#toast button');
check('"Rückgängig" takes it back', await waitFor(() => !doneDoc('kueche-saugen'), 4000) && await waitFor(async () => (await chip(a, 'kueche', 'saugen')).text === 'Saugen noch nie', 3000));

put('settings/putz-d-kueche-wischen', { at: NOW - 10 * DAY, by: 'b', h: [] });
put('settings/putz-d-bad-putzen', { at: NOW - 7 * DAY, by: 'a', h: [] });
put('settings/putz-d-wohn-saugen', { at: NOW - 6 * DAY, by: 'b', h: [] });
put('settings/putz-d-keller-saugen', { at: NOW - 3 * DAY, by: 'b', h: [] });
await waitFor(async () => /is-ueber/.test(((await chip(a, 'kueche', 'wischen')) || {}).cls), 4000);
check('overdue: the job turns dark', /is-ueber/.test((await chip(a, 'kueche', 'wischen')).cls) && (await chip(a, 'kueche', 'wischen')).text === 'Wischen vor 10 T.');
check('…due today: outlined; due tomorrow: little straw left', /is-heute/.test((await chip(a, 'bad', 'putzen')).cls) && /is-bald/.test((await chip(a, 'wohn', 'saugen')).cls) && Number((await chip(a, 'wohn', 'saugen')).fill) > 0.1 && Number((await chip(a, 'wohn', 'saugen')).fill) < 0.2);
check('…the label says it all for a screen reader', (await chip(a, 'kueche', 'wischen')).label === 'Küche: Boden wischen, zuletzt vor 10 Tagen von Anna, seit 3 Tagen fällig. Antippen: heute erledigt', (await chip(a, 'kueche', 'wischen')).label);
check('the header shows the most urgent job', (await ftext(a, '#pz-next')) === 'Küche Wischen, seit 3 Tagen fällig Zuletzt vor 10 Tagen, Anna Erledigt und 1 weitere' && (await text(a, '#pz-cap')) === '2 fällig', await ftext(a, '#pz-next'));
check('…the tab counts what is due, the floors and rooms say where', (await text(a, '#n-putz')) === '2' && (await attr(a, '#open-putz', 'aria-label')) === 'Putzen, 2 fällig' && (await ftext(a, '#pz-list [data-room="kueche"] .pz-rstate')) === '1 fällig' && /Erdgeschoss 1 fällig/.test(flat(await a.evaluate(() => Array.from(document.querySelectorAll('.pz-floor')).map(h => h.innerText).join(' | ')))) && (await ftext(a, '#pz-list [data-room="wohn"] .pz-rstate')) === 'Saugen morgen');
await tapSel(a, '#pz-top-done');
check('"Erledigt" in the header ticks that job off and keeps the earlier time', await waitFor(() => { const d = doneDoc('kueche-wischen'); return d && d.by === 'a' && d.at > NOW - 600e3 && d.h.length === 1 && d.h[0].by === 'b' && d.h[0].at === NOW - 10 * DAY; }, 4000), JSON.stringify(doneDoc('kueche-wischen')));
check('…then the next one is on top', await waitFor(async () => /^Bad Putzen, heute fällig/.test(await ftext(a, '#pz-next')), 3000) && (await text(a, '#n-putz')) === '1', await ftext(a, '#pz-next'));
await tapSel(a, chipSel('bad', 'putzen'));
check('with nothing due the header says what comes next', await waitFor(async () => /^Alles sauber Als Nächstes Wohnzimmer: Saugen, morgen fällig/.test(await ftext(a, '#pz-next')), 3000) && !(await visible(a, '#n-putz')) && (await text(a, '#pz-cap')) === 'Alles erledigt', await ftext(a, '#pz-next'));

console.log('3. a room\'s sheet');
put('settings/putz-d-kueche-putzen', { at: NOW - 2 * DAY, by: 'b', h: [] });
await waitFor(async () => (await chip(a, 'kueche', 'putzen')).text.endsWith('vor 2 T.'), 3000);
await tapRoom(a, 'kueche');
check('tapping a room opens its sheet: name, floor, jobs with rhythm and last time', (await a.$eval('#pz-name', e => e.value)) === 'Küche' && (await attr(a, '#pz-floor [data-floor="eg"]', 'aria-checked')) === 'true' && (await a.evaluate(() => Array.from(document.querySelectorAll('#pz-sheet .pz-job')).map(j => j.dataset.job + ':' + j.querySelector('select').value).join())) === 'saugen:7,wischen:7,putzen:7,fenster:90' && /Zuletzt Mi, 7\. Okt\., heute, Simon/.test(await text(a, jobBox('wischen', '.pz-jlast'))) && /Noch nie erledigt/.test(await text(a, jobBox('fenster', '.pz-jlast'))), await text(a, jobBox('wischen', '.pz-jlast')));
check('…"Putzen" says what it means here, and the page behind is inert', /Herd, Arbeitsfläche, Spüle/.test(await text(a, jobBox('putzen', '.pz-jt'))) && await a.evaluate(() => document.getElementById('app').inert));
await a.select(jobBox('wischen', 'select'), '3');
await tapSel(a, jobBox('fenster', '[data-q="gestern"]'));
check('"Gestern" enters yesterday (saved with the sheet)', /Neu: Di, 6\. Okt\./.test(await text(a, jobBox('fenster', '.pz-jlast'))) && !doneDoc('kueche-fenster'));
await a.$eval(jobBox('saugen', '.pz-dinput'), e => { e.value = '2026-10-03'; e.dispatchEvent(new Event('change', { bubbles: true })); });
check('…and the date field any earlier day', /Neu: Sa, 3\. Okt\./.test(await text(a, jobBox('saugen', '.pz-jlast'))));
await tapSel(a, '#pz-addjobs [data-add="staub"]');
await tapSel(a, '#pz-addjobs [data-add="own"]');
const ownKey = await a.evaluate(() => { const j = Array.from(document.querySelectorAll('#pz-sheet .pz-job')).pop(); return j.dataset.job; });
await tapSel(a, '#pz-save');
check('an own job needs a name', await visible(a, '#pz-sheet') && /eigenen Arbeit einen Namen/.test(await text(a, '#pz-sheet .err')));
await setValue(a, jobBox(ownKey, '.pz-jname'), 'Kühlschrank');
await a.select(jobBox(ownKey, 'select'), '30');
await tapSel(a, jobBox('putzen', '.pz-jdel'));
check('jobs can be added (usual ones and own ones) and removed', (await a.evaluate(() => Array.from(document.querySelectorAll('#pz-sheet .pz-job')).map(j => j.dataset.job).join())) === 'saugen,wischen,fenster,staub,' + ownKey);
await tapSel(a, '#pz-save');
check('saving stores all rooms once, with the changes of this one', await waitFor(() => { const d = docs().putz; return d && d.v === 1 && d.rooms.length === 13 && JSON.stringify(d.rooms.find(r => r.id === 'kueche').j) === JSON.stringify([{ k: 'saugen', e: 7 }, { k: 'wischen', e: 3 }, { k: 'fenster', e: 90 }, { k: 'staub', e: 14 }, { k: ownKey, n: 'Kühlschrank', e: 30 }]); }, 4000), JSON.stringify((docs().putz || {}).rooms && docs().putz.rooms.find(r => r.id === 'kueche')));
check('…and the dates: yesterday at noon, the 3rd at noon, by this phone, the earlier time kept', (() => { const f = doneDoc('kueche-fenster'), s = doneDoc('kueche-saugen'); return f && f.by === 'a' && new Date(f.at).getDate() === 6 && new Date(f.at).getHours() === 12 && s && new Date(s.at).getDate() === 3 && s.h.length === 0; })(), JSON.stringify([doneDoc('kueche-fenster'), doneDoc('kueche-saugen')]));
check('…the removed job loses its record; the sheet closes with "Gespeichert"', await waitFor(() => !doneDoc('kueche-putzen'), 3000) && !(await visible(a, '#pz-sheet')) && /Gespeichert/.test(await text(a, '#toast')));
check('…the overview follows: new jobs, "Saugen" now 4 days ago, the 3-day rhythm makes "Wischen" due later', await waitFor(async () => !!(await chip(a, 'kueche', ownKey)), 3000) && (await chip(a, 'kueche', ownKey)).text === 'Kühlschrank noch nie' && (await chip(a, 'kueche', 'saugen')).text.endsWith('vor 4 T.') && !(await chip(a, 'kueche', 'putzen')) && (await chip(a, 'kueche', 'staub')).text === 'Staub noch nie');
check('the other phone has the same room', await waitFor(async () => !!(await chip(b, 'kueche', ownKey)), 4000) && !(await chip(b, 'kueche', 'putzen')));

console.log('4. new rooms, deleting, closing');
await tapSel(a, '#pz-add');
check('"+" opens an empty sheet with two jobs to start with', await visible(a, '#pz-sheet') && (await a.$eval('#pz-name', e => e.value)) === '' && (await a.evaluate(() => Array.from(document.querySelectorAll('#pz-sheet .pz-job')).map(j => j.dataset.job).join())) === 'saugen,wischen' && (await a.evaluate(() => document.activeElement && document.activeElement.id)) === 'pz-name');
await tapSel(a, '#pz-save');
check('a room needs a name', await visible(a, '#pz-sheet') && /Gib dem Raum einen Namen/.test(await text(a, '#pz-sheet .err')));
await setValue(a, '#pz-name', 'Gästezimmer');
await tapSel(a, '#pz-floor [data-floor="og"]');
await tapSel(a, '#pz-save');
check('the new room is stored and appears on its floor', await waitFor(() => { const d = docs().putz; return d && d.rooms.length === 14 && d.rooms[13].n === 'Gästezimmer' && d.rooms[13].f === 'og'; }, 4000) && await waitFor(async () => (await roomNames(a))[0] === 'Obergeschoss:Schlafzimmer,Spielzimmer,Kinderzimmer,Bad,Stiege,Gästezimmer', 3000) && /„Gästezimmer“ angelegt/.test(await text(a, '#toast')));
await tapRoom(a, 'buero2');
await tapSel(a, '#pz-del');
check('deleting asks first', await visible(a, '#pz-sheet') && /Wirklich löschen/.test(await text(a, '#pz-del')));
await sleep(450);
await tapSel(a, '#pz-del');
check('…then the room is gone, here and in the data', await waitFor(() => !docs().putz.rooms.some(r => r.id === 'buero2'), 4000) && !(await roomNames(a)).join().includes('Büro 2') && /„Büro 2“ gelöscht/.test(await text(a, '#toast')));
await tapSel(a, '#toast button');
check('…and "Rückgängig" brings it back in its place', await waitFor(async () => (await roomNames(a))[1] === 'Erdgeschoss:Wohnzimmer,Büro,Küche,Büro 2,Klo,Vorraum,Abstellraum', 4000), (await roomNames(a)).join(' | '));
await tapRoom(b, 'stiege');
await b.goBack(); await sleep(400);
check('the back button closes the sheet and stays on the screen', !(await visible(b, '#pz-sheet')) && await visible(b, '#screen-putz') && !(await b.evaluate(() => document.getElementById('app').inert)));
await tapRoom(b, 'stiege');
await setValue(b, '#pz-name', 'Stiegenhaus');
await tapSel(b, '#pz-cancel');
check('"Abbrechen" changes nothing', !(await visible(b, '#pz-sheet')) && !docs().putz.rooms.some(r => r.n === 'Stiegenhaus'));

console.log('5. broken data, other days');
put('settings/putz', { v: 1, rooms: [{ id: 'kueche', n: '<img src=x onerror=alert(1)>', f: 'eg', j: [{ k: 'saugen', e: 7 }] }, { id: '../x', n: 'bad', j: [] }, 'nonsense'] });
put('settings/putz-d-kueche-saugen', { at: 'heute', by: 'evil' });
check('broken shared data is shown as text only, broken parts dropped', await waitFor(async () => (await roomNames(a)).join() === 'Erdgeschoss:<img src=x onerror=alert(1)>', 4000) && (await a.evaluate(() => !document.querySelector('#screen-putz img'))) && (await chip(a, 'kueche', 'saugen')).text === 'Saugen noch nie', (await roomNames(a)).join());
put('settings/putz', { rooms: 'kaputt' });
check('a document that is no list of rooms gives the usual rooms', await waitFor(async () => (await roomNames(a)).length === 3, 4000));
check('no page errors and no raw values on either phone', A.errors.length === 0 && B.errors.length === 0 && (await junk(a)) === '' && (await junk(b)) === '', A.errors.concat(B.errors).join(' | '));
await A.close(); await B.close();
{
  put('settings/putz-d-kueche-saugen', { at: NOW, by: 'a', h: [] });
  const P = await open('uid-simon-0001', 'a', { now: NOW + 8 * DAY }), p = P.page;
  await goPutz(P);
  check('eight days later the weekly job is overdue (and shows "vor 8 T.")', /is-ueber/.test((await chip(p, 'kueche', 'saugen')).cls) && (await chip(p, 'kueche', 'saugen')).text === 'Saugen vor 8 T.' && (await chip(p, 'keller', 'saugen')).text === 'Saugen vor 11 T.');
  await P.close();
}
{
  const P = await open('uid-simon-0001', 'a', { width: 320, height: 640, dark: true }), p = P.page;
  await goPutz(P);
  const fit = await p.evaluate(() => {
    const out = [], vw = document.documentElement.clientWidth;
    if (document.documentElement.scrollWidth > vw) out.push('page scrolls sideways');
    for (const e of document.querySelectorAll('#screen-putz .pz-chip, #screen-putz .pz-rhead, #pz-add, #tabbar .tab')) { const r = e.getBoundingClientRect(); if (r.right > vw + 0.5 || r.left < -0.5) out.push(e.className); }
    for (const c of document.querySelectorAll('#screen-putz .pz-chip b')) if (c.scrollWidth > c.clientWidth + 1) out.push('cut: ' + c.textContent);
    return out;
  });
  check('320 px wide, dark: nothing sticks out, no job name is cut', fit.length === 0, fit.join(', '));
  await tapRoom(p, 'kueche');
  const fit2 = await p.evaluate(() => { const vw = document.documentElement.clientWidth; return Array.from(document.querySelectorAll('#pz-sheet .pz-job, #pz-sheet select, #pz-sheet .pz-qbtn')).filter(e => e.getBoundingClientRect().right > vw + 0.5).length; });
  check('…and the sheet fits too', fit2 === 0, String(fit2));
  check('no page errors', P.errors.length === 0, P.errors.join(' | '));
  await P.close();
}

await browser.close(); await server.close();
process.exitCode = done() ? 1 : 0;
