// Browser test of the cleaning overview ("Putzen") with two phones on the fake Firebase.   node tests/run-putz.mjs
// The clock is frozen on Wednesday 7 October 2026, 18:30 (Vienna).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, phone, sleep, waitFor, tapSel, setValue, visible, text, net, reporter, UA_IPHONE, W, NOW } from './e2e-lib.mjs';
import { startServer } from './fake-server.mjs';
import { starterTasks } from '../src/seed.js';

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
// on top: the floors (the one shown marked with *) and the plan of the floor shown ([big room] then the rows beside it)
const floorsText = page => page.evaluate(() => Array.from(document.querySelectorAll('#pz-floors .pz-fbtn')).map(b => (b.getAttribute('aria-checked') === 'true' ? '*' : '') + b.innerText.replace(/\s+/g, ' ').trim()).join(' | '));
const goFloor = async (page, f) => {
  await tapSel(page, '#pz-floors [data-floor="' + f + '"]');
  await waitFor(() => page.evaluate(f => { const b = document.querySelector('#pz-floors [data-floor="' + f + '"]'); return !!b && b.getAttribute('aria-checked') === 'true'; }, f), 2000);
  await sleep(120);
};
const planText = page => page.evaluate(() => {
  const p = document.querySelector('#pz-plan'), nm = b => b.querySelector('b').textContent.replace(/­/g, '');
  const big = p.querySelector(':scope > .pz-hr.is-big');
  return (big ? '[' + nm(big) + '] ' : '') + Array.from(p.querySelectorAll('.pz-prow')).map(r => Array.from(r.children).map(nm).join(',')).join(' | ');
});
const proom = (page, id) => page.evaluate(id => { const b = document.querySelector('#pz-plan .pz-hr[data-room="' + id + '"]'); return b ? { cls: b.className, text: b.innerText.replace(/­/g, '').replace(/\s+/g, ' ').trim(), fill: b.style.getPropertyValue('--fill'), label: b.getAttribute('aria-label') } : null; }, id);
const inView = (page, sel) => page.evaluate(s => { const e = document.querySelector(s); if (!e) return false; const r = e.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }, sel);
const chips = (page, sel = '') => page.evaluate(s => document.querySelectorAll('#pz-list .pz-chip' + s).length, sel);

/* ======================================================================================================== */
console.log('1. the tab, the floors and the rooms');
const A = await open('uid-simon-0001', 'a'), a = A.page;
check('six tabs: Woche, Einkauf, Wünsche, Putzen, Müll, Ich', (await a.evaluate(() => Array.from(document.querySelectorAll('#tabbar .tab')).map(t => t.querySelector('span').textContent).join())) === 'Woche,Einkauf,Wünsche,Putzen,Müll,Ich');
await goPutz(A);
check('"Putzen" shows its screen, the egg sits behind the fourth tab', await visible(a, '#screen-putz') && !(await visible(a, '#screen-week')) && (await attr(a, '#open-putz', 'aria-current')) === 'page' && (await a.evaluate(() => document.querySelector('#tabbar').style.getPropertyValue('--i'))) === '3');
check('on top the floors OG, EG, Keller; first the upper floor is shown', (await floorsText(a)) === '*OG | EG | Keller' && (await attr(a, '#pz-floors [data-floor="og"]', 'aria-label')) === 'Obergeschoss', await floorsText(a));
check('…its plan: the bedroom as the big room on the left, the others beside it in even rows', (await planText(a)) === '[Schlafzimmer] Spielzimmer,Kinderzimmer | Bad,Stiege' && (await attr(a, '#pz-plan', 'aria-label')) === 'Räume im Obergeschoss', await planText(a));
check('…below, the rooms of that floor with their jobs, all "noch nie" at the start', (await roomNames(a)).join(' | ') === 'Obergeschoss:Schlafzimmer,Spielzimmer,Kinderzimmer,Bad,Stiege' && (await chips(a)) === 20 && (await chips(a, '.is-nie')) === 20, (await roomNames(a)).join(' | '));
check('…every room of the plan says "noch nie"', (await a.evaluate(() => document.querySelectorAll('#pz-plan .pz-hr.is-nie').length)) === 5 && (await proom(a, 'schlaf')).text === 'Schlafzimmer noch nie' && (await proom(a, 'schlaf')).label === 'Schlafzimmer, noch nie erledigt. Antippen: zu den Arbeiten', JSON.stringify(await proom(a, 'schlaf')));
check('the header invites to start, nothing is due, no number on the tab', /^Wann war was\?/.test(await ftext(a, '#pz-next')) && (await text(a, '#pz-cap')) === 'Noch nichts eingetragen' && !(await visible(a, '#n-putz')));
await goFloor(a, 'kg');
check('"Keller": the cellar on its own', (await planText(a)) === 'Keller' && (await roomNames(a)).join() === 'Keller:Keller' && (await chips(a)) === 2, await planText(a));
await goFloor(a, 'eg');
check('"EG": the living room big, the others in three rows, and the rooms of the ground floor', (await planText(a)) === '[Wohnzimmer] Büro,Küche | Büro 2,Klo | Vorraum,Abstellraum' && (await roomNames(a)).join() === 'Erdgeschoss:Wohnzimmer,Büro,Küche,Büro 2,Klo,Vorraum,Abstellraum' && (await chips(a)) === 23 && (await chip(a, 'kueche', 'putzen')).text === 'Putzen noch nie', await planText(a));
check('…this phone keeps the floor it shows', (await a.evaluate(() => localStorage.getItem('wp2.putz.floor'))) === 'eg' && (await floorsText(a)) === 'OG | *EG | Keller');
check('looking does not write anything (the rooms are only stored once they are changed)', Object.keys(docs()).length === 0, Object.keys(docs()).join());

console.log('2. ticking off');
const B = await open('uid-anna-0002', 'b'), b = B.page;
await goPutz(B);
check('the other phone starts on its own floor (the upper one)', (await floorsText(b)) === '*OG | EG | Keller');
await goFloor(b, 'eg');
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
check('…due tomorrow: little straw left', /is-bald/.test((await chip(a, 'wohn', 'saugen')).cls) && Number((await chip(a, 'wohn', 'saugen')).fill) > 0.1 && Number((await chip(a, 'wohn', 'saugen')).fill) < 0.2);
check('…the label says it all for a screen reader', (await chip(a, 'kueche', 'wischen')).label === 'Küche: Boden wischen, zuletzt vor 10 Tagen von Anna, seit 3 Tagen fällig. Antippen: heute erledigt', (await chip(a, 'kueche', 'wischen')).label);
check('the header shows the most urgent job', (await ftext(a, '#pz-next')) === 'Küche: Wischen seit 3 Tagen fällig Erledigt' && (await text(a, '#pz-cap')) === '2 fällig', await ftext(a, '#pz-next'));
check('…the tab and the floors count what is due, the list says where', (await text(a, '#n-putz')) === '2' && (await attr(a, '#open-putz', 'aria-label')) === 'Putzen, 2 fällig' && (await floorsText(a)) === 'OG 1 | *EG 1 | Keller' && (await attr(a, '#pz-floors [data-floor="og"]', 'aria-label')) === 'Obergeschoss, 1 fällig' && (await ftext(a, '#pz-list [data-room="kueche"] .pz-rstate')) === '1 fällig' && (await ftext(a, '#pz-list .pz-floor')) === 'Erdgeschoss 1 fällig' && (await ftext(a, '#pz-list [data-room="wohn"] .pz-rstate')) === 'Saugen morgen', await floorsText(a));
{
  const k = await proom(a, 'kueche'), w = await proom(a, 'wohn'), bu = await proom(a, 'buero');
  check('the plan: overdue is dark and names the job, due tomorrow almost empty, never recorded stays as it was',
    /is-ueber/.test(k.cls) && k.text === 'Küche Wischen' && k.fill === '0.000' && /is-bald/.test(w.cls) && /is-big/.test(w.cls) && w.text === 'Wohnzimmer morgen' && w.fill === (1 / 7).toFixed(3) && /is-nie/.test(bu.cls) && bu.text === 'Büro noch nie', JSON.stringify([k, w, bu]));
  check('…the labels for a screen reader', k.label === 'Küche, Wischen fällig. Antippen: zu den Arbeiten' && w.label === 'Wohnzimmer, wieder fällig morgen. Antippen: zu den Arbeiten', k.label + ' / ' + w.label);
}
await goFloor(a, 'og');
check('upstairs: due today is dim, the bath names its job; the most urgent job above says it is downstairs', /is-heute/.test((await proom(a, 'bad')).cls) && (await proom(a, 'bad')).text === 'Bad Putzen' && /is-heute/.test((await chip(a, 'bad', 'putzen')).cls) && (await ftext(a, '#pz-next')) === 'Küche: Wischen seit 3 Tagen fällig, im Erdgeschoss Erledigt', await ftext(a, '#pz-next'));
await goFloor(a, 'kg');
check('…the cellar, done three days ago with a monthly rhythm: nearly full and "sauber"', /is-ok/.test((await proom(a, 'keller')).cls) && (await proom(a, 'keller')).text === 'Keller sauber' && (await proom(a, 'keller')).fill === (27 / 30).toFixed(3), JSON.stringify(await proom(a, 'keller')));
await goFloor(a, 'eg');
await a.evaluate(() => { window.scrollTo(0, 0); document.querySelector('#pz-plan .pz-hr[data-room="kueche"]').__same = 1; });
await tapSel(a, '#pz-plan .pz-hr[data-room="kueche"]');
{
  const lit = await a.evaluate(() => document.querySelector('#pz-list [data-room="kueche"]').classList.contains('is-flash') && document.activeElement === document.querySelector('#pz-list [data-room="kueche"] .pz-rhead'));
  check('a tap on a room in the plan brings its jobs into view, lit up, with the focus on the room', lit && await waitFor(() => inView(a, '#pz-list [data-room="kueche"]'), 4000) && (await a.evaluate(() => window.scrollY)) > 250);
}
await a.evaluate(() => window.scrollTo(0, 0)); await sleep(150);
await tapSel(a, '#pz-top-done');
check('"Erledigt" in the header ticks that job off and keeps the earlier time', await waitFor(() => { const d = doneDoc('kueche-wischen'); return d && d.by === 'a' && d.at > NOW - 600e3 && d.h.length === 1 && d.h[0].by === 'b' && d.h[0].at === NOW - 10 * DAY; }, 4000), JSON.stringify(doneDoc('kueche-wischen')));
check('…then the next one is on top, with its floor', await waitFor(async () => /^Bad: Putzen heute fällig, im Obergeschoss/.test(await ftext(a, '#pz-next')), 3000) && (await text(a, '#n-putz')) === '1' && (await floorsText(a)) === 'OG 1 | *EG | Keller', await ftext(a, '#pz-next'));
check('…and the kitchen in the plan fills up with light (the same field, not a new one)', await waitFor(async () => /is-ok/.test(((await proom(a, 'kueche')) || {}).cls), 3000) && (await proom(a, 'kueche')).text === 'Küche sauber' && (await proom(a, 'kueche')).fill === '1.000' && await a.evaluate(() => document.querySelector('#pz-plan .pz-hr[data-room="kueche"]').__same === 1), JSON.stringify(await proom(a, 'kueche')));
await goFloor(a, 'og');
await tapSel(a, chipSel('bad', 'putzen'));
check('with nothing due the header says what comes next', await waitFor(async () => /^Alles sauber Als Nächstes Wohnzimmer: Saugen, morgen fällig/.test(await ftext(a, '#pz-next')), 3000) && !(await visible(a, '#n-putz')) && (await text(a, '#pz-cap')) === 'Alles erledigt' && (await floorsText(a)) === '*OG | EG | Keller', await ftext(a, '#pz-next'));
await goFloor(a, 'eg');

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
check('"+" opens an empty sheet with two jobs to start with, on the floor shown', await visible(a, '#pz-sheet') && (await a.$eval('#pz-name', e => e.value)) === '' && (await a.evaluate(() => Array.from(document.querySelectorAll('#pz-sheet .pz-job')).map(j => j.dataset.job).join())) === 'saugen,wischen' && (await attr(a, '#pz-floor [data-floor="eg"]', 'aria-checked')) === 'true' && (await a.evaluate(() => document.activeElement && document.activeElement.id)) === 'pz-name');
await tapSel(a, '#pz-save');
check('a room needs a name', await visible(a, '#pz-sheet') && /Gib dem Raum einen Namen/.test(await text(a, '#pz-sheet .err')));
await setValue(a, '#pz-name', 'Gästezimmer');
await tapSel(a, '#pz-floor [data-floor="og"]');
await tapSel(a, '#pz-save');
check('the new room is stored, and its floor is shown with it', await waitFor(() => { const d = docs().putz; return d && d.rooms.length === 14 && d.rooms[13].n === 'Gästezimmer' && d.rooms[13].f === 'og'; }, 4000) && await waitFor(async () => (await roomNames(a))[0] === 'Obergeschoss:Schlafzimmer,Spielzimmer,Kinderzimmer,Bad,Stiege,Gästezimmer', 3000) && (await floorsText(a)) === '*OG | EG | Keller' && /„Gästezimmer“ angelegt/.test(await text(a, '#toast')));
check('…and in the plan, beside the bedroom', (await planText(a)) === '[Schlafzimmer] Spielzimmer,Kinderzimmer | Bad,Stiege | Gästezimmer' && /is-nie/.test((await proom(a, docs().putz.rooms[13].id)).cls), await planText(a));
await goFloor(a, 'eg');
await tapRoom(a, 'buero2');
await tapSel(a, '#pz-del');
check('deleting asks first', await visible(a, '#pz-sheet') && /Wirklich löschen/.test(await text(a, '#pz-del')));
await sleep(450);
await tapSel(a, '#pz-del');
check('…then the room is gone, here, in the plan and in the data', await waitFor(() => !docs().putz.rooms.some(r => r.id === 'buero2'), 4000) && !(await roomNames(a)).join().includes('Büro 2') && await waitFor(async () => (await planText(a)) === '[Wohnzimmer] Büro,Küche | Klo,Vorraum | Abstellraum', 3000) && /„Büro 2“ gelöscht/.test(await text(a, '#toast')), await planText(a));
await tapSel(a, '#toast button');
check('…and "Rückgängig" brings it back in its place', await waitFor(async () => (await roomNames(a))[0] === 'Erdgeschoss:Wohnzimmer,Büro,Küche,Büro 2,Klo,Vorraum,Abstellraum', 4000) && (await planText(a)) === '[Wohnzimmer] Büro,Küche | Büro 2,Klo | Vorraum,Abstellraum', (await roomNames(a)).join(' | '));
await goFloor(b, 'og');
await tapRoom(b, 'stiege');
await b.goBack(); await sleep(400);
check('the back button closes the sheet and stays on the screen', !(await visible(b, '#pz-sheet')) && await visible(b, '#screen-putz') && !(await b.evaluate(() => document.getElementById('app').inert)));
await tapRoom(b, 'stiege');
await setValue(b, '#pz-name', 'Stiegenhaus');
await tapSel(b, '#pz-cancel');
check('"Abbrechen" changes nothing', !(await visible(b, '#pz-sheet')) && !docs().putz.rooms.some(r => r.n === 'Stiegenhaus'));
await tapRoom(b, 'stiege');
await tapSel(b, '#pz-floor [data-floor="eg"]');
await tapSel(b, '#pz-save');
check('a room moved to another floor takes the view along', await waitFor(async () => (await floorsText(b)) === 'OG | *EG | Keller' && (await roomNames(b))[0] === 'Erdgeschoss:Stiege,Wohnzimmer,Büro,Küche,Büro 2,Klo,Vorraum,Abstellraum', 4000) && docs().putz.rooms.find(r => r.id === 'stiege').f === 'eg' && (await planText(b)) === '[Wohnzimmer] Stiege,Büro | Küche,Büro 2 | Klo,Vorraum | Abstellraum', await floorsText(b) + ' / ' + (await roomNames(b)).join() + ' / ' + await planText(b));
await tapRoom(b, 'stiege');
await tapSel(b, '#pz-floor [data-floor="og"]');
await tapSel(b, '#pz-save');
await waitFor(async () => (await floorsText(b)) === '*OG | EG | Keller', 4000);

console.log('5. broken data, other days');
put('settings/putz', { v: 1, rooms: [{ id: 'kueche', n: '<img src=x onerror=alert(1)>', f: 'eg', j: [{ k: 'saugen', e: 7 }] }, { id: '../x', n: 'bad', j: [] }, 'nonsense'] });
put('settings/putz-d-kueche-saugen', { at: 'heute', by: 'evil' });
check('broken shared data is shown as text only, broken parts dropped', await waitFor(async () => (await roomNames(a)).join() === 'Erdgeschoss:<img src=x onerror=alert(1)>', 4000) && (await planText(a)) === '<img src=x onerror=alert(1)>' && (await a.evaluate(() => !document.querySelector('#screen-putz img'))) && (await chip(a, 'kueche', 'saugen')).text === 'Saugen noch nie', (await roomNames(a)).join());
check('…with only one floor there is nothing to switch', !(await visible(a, '#pz-floors')) && (await roomNames(b)).join() === 'Erdgeschoss:<img src=x onerror=alert(1)>', (await roomNames(b)).join());
put('settings/putz', { rooms: 'kaputt' });
check('a document that is no list of rooms gives the usual rooms (each phone still on its floor)', await waitFor(async () => (await floorsText(a)) === 'OG | *EG | Keller', 4000) && (await roomNames(a)).join().startsWith('Erdgeschoss:Wohnzimmer') && await waitFor(async () => (await floorsText(b)) === '*OG | EG | Keller', 3000), await floorsText(a) + ' / ' + await floorsText(b));
await a.setViewport({ width: 768, height: 1000, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
check('a wide screen has three rooms a row beside the big one', await waitFor(async () => (await planText(a)) === '[Wohnzimmer] Büro,Küche,Büro 2 | Klo,Vorraum,Abstellraum', 3000), await planText(a));
await a.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
check('…and a phone two again', await waitFor(async () => (await planText(a)) === '[Wohnzimmer] Büro,Küche | Büro 2,Klo | Vorraum,Abstellraum', 3000), await planText(a));
check('no page errors and no raw values on either phone', A.errors.length === 0 && B.errors.length === 0 && (await junk(a)) === '' && (await junk(b)) === '', A.errors.concat(B.errors).join(' | '));
await A.close(); await B.close();
{
  put('settings/putz-d-kueche-saugen', { at: NOW, by: 'a', h: [] });
  const P = await open('uid-simon-0001', 'a', { now: NOW + 8 * DAY }), p = P.page;
  await goPutz(P);
  await goFloor(p, 'eg');
  const k = await chip(p, 'kueche', 'saugen');
  await goFloor(p, 'kg');
  check('eight days later the weekly job is overdue (and shows "vor 8 T.")', /is-ueber/.test(k.cls) && k.text === 'Saugen vor 8 T.' && (await chip(p, 'keller', 'saugen')).text === 'Saugen vor 11 T.');
  await P.close();
}
{
  const P = await open('uid-simon-0001', 'a', { width: 320, height: 640, dark: true }), p = P.page;
  await goPutz(P);
  const fit = () => p.evaluate(() => {
    const out = [], vw = document.documentElement.clientWidth;
    if (document.documentElement.scrollWidth > vw) out.push('page scrolls sideways');
    for (const e of document.querySelectorAll('#screen-putz .pz-chip, #screen-putz .pz-rhead, #pz-add, #tabbar .tab, #pz-floors .pz-fbtn, #pz-plan .pz-hr, #pz-top-done')) { const r = e.getBoundingClientRect(); if (r.right > vw + 0.5 || r.left < -0.5) out.push(e.className); }
    for (const c of document.querySelectorAll('#screen-putz .pz-chip b, #pz-plan .pz-hr b, #pz-floors .pz-fbtn')) if (c.scrollWidth > c.clientWidth + 1) out.push('cut: ' + c.textContent);
    return out;
  });
  const og = await fit();
  await goFloor(p, 'eg');
  const eg = await fit();
  check('320 px wide, dark: nothing sticks out, no job or room name is cut (upstairs and downstairs)', og.length === 0 && eg.length === 0, og.concat(eg).join(', '));
  await tapRoom(p, 'kueche');
  const fit2 = await p.evaluate(() => { const vw = document.documentElement.clientWidth; return Array.from(document.querySelectorAll('#pz-sheet .pz-job, #pz-sheet select, #pz-sheet .pz-qbtn')).filter(e => e.getBoundingClientRect().right > vw + 0.5).length; });
  check('…and the sheet fits too', fit2 === 0, String(fit2));
  check('no page errors', P.errors.length === 0, P.errors.join(' | '));
  await P.close();
}

await browser.close(); await server.close();
process.exitCode = done() ? 1 : 0;
