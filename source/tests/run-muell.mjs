// Browser test of the waste plan ("Müll") with two phones on the fake Firebase.   node tests/run-muell.mjs
// The clock is frozen on Wednesday 7 October 2026, 18:30 (Vienna): the next pickup is the paper on Thursday 8 October.
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
const PROJECT = 'wochenspiel-test1', ROOM = 'testroomtestroom1';
const CFG = { projectId: PROJECT, apiKey: 'AIzaSyD-FAKEKEYFORTESTING0123456789abcd', authDomain: PROJECT + '.firebaseapp.com', appId: '1:123456789012:web:abcdef0123456789abcdef' };
const put = (p, d) => server.put(PROJECT, 'rooms/' + ROOM + '/' + p, d);
put('settings/people', { a: 'Simon', b: 'Anna', aId: 'uid-simon-0001', bId: 'uid-anna-0002', reward: 'Pizza', goal: 80 });
for (const t of starterTasks(W, NOW)) put('tasks/' + t.id, t.data);
const muDoc = () => server.dump(PROJECT)['rooms/' + ROOM + '/settings/muell'];

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
const goMuell = async P => { await tapSel(P.page, '#open-muell'); await waitFor(() => visible(P.page, '#screen-muell'), 3000); await sleep(200); };
const cell = (page, key) => page.evaluate(k => {
  const c = document.querySelector('#mu-grid [data-key="' + k + '"]');
  return c ? { label: c.getAttribute('aria-label'), bins: Array.from(c.querySelectorAll('.bin')).map(b => b.getAttribute('class').match(/k-(\w+)/)[1]).join(','), cls: c.className, pressed: c.getAttribute('aria-pressed'), current: c.getAttribute('aria-current') } : null;
}, key);
const binsOf = async (page, key) => ((await cell(page, key)) || {}).bins;
const flat = s => String(s || '').replace(/\s+/g, ' ').trim();
const ftext = async (page, sel) => flat(await text(page, sel));
const attr = (page, sel, n) => page.evaluate((s, n) => { const e = document.querySelector(s); return e ? e.getAttribute(n) : null; }, sel, n);
const junk = page => page.evaluate(() => { const m = document.body.innerText.match(/\b(null|undefined|NaN|\[object)/g); return m ? m.join(',') : ''; });

/* ======================================================================================================== */
console.log('1. the tab and the screen');
const A = await open('uid-simon-0001', 'a'), a = A.page;
check('five tabs, in this order: Woche, Einkauf, Wünsche, Müll, Ich', (await a.evaluate(() => Array.from(document.querySelectorAll('#tabbar .tab')).map(t => t.querySelector('span').textContent).join())) === 'Woche,Einkauf,Wünsche,Müll,Ich');
check('the Müll tab carries a dot: paper goes out tomorrow', await visible(a, '#d-muell') && (await attr(a, '#open-muell', 'aria-label')) === 'Müll, morgen: Altpapier', await attr(a, '#open-muell', 'aria-label'));
await goMuell(A);
check('"Müll" shows its screen, hides the week, the egg sits behind the fourth tab', await visible(a, '#screen-muell') && !(await visible(a, '#screen-week')) && (await attr(a, '#open-muell', 'aria-current')) === 'page' && (await a.evaluate(() => document.querySelector('#tabbar').style.getPropertyValue('--i'))) === '3');
check('…and the dot is not shown on the active tab', (await a.evaluate(() => getComputedStyle(document.querySelector('#d-muell')).display)) === 'none');
const hero = await ftext(a, '#mu-next');
check('the header says what goes out next: tomorrow, Thursday 8 October, paper', /^Morgen Donnerstag, 8\. Oktober Altpapier Bis 6 Uhr früh rausstellen$/.test(hero), hero);
check('without a street the caption names the plan, and a prompt asks for the street', (await text(a, '#mu-cap')) === 'Abfuhrplan 2026' && await visible(a, '#mu-pick'));

console.log('2. the month');
check('the month view starts with this month', (await ftext(a, '#mu-mtitle')) === 'Oktober 2026' && (await a.evaluate(() => document.querySelectorAll('#mu-grid .mu-d[data-key]').length)) === 31 && (await a.evaluate(() => Array.from(document.querySelector('#mu-grid').children).findIndex(c => c.dataset.key))) === 3);
const c7 = await cell(a, '2026-10-07'), c5 = await cell(a, '2026-10-05');
check('today is marked, earlier days are faded', c7.current === 'date' && /is-today/.test(c7.cls) && /is-past/.test(c5.cls) && !/is-past/.test(c7.cls));
check('without an area both Restmüll areas show: Monday 12 (area 1, with Bio), Thursday 15 (area 2)', (await binsOf(a, '2026-10-12')) === 'rest,bio' && (await binsOf(a, '2026-10-15')) === 'rest' && /Montag, 12\. Oktober: Restmüll Bereich 1, Biotonne/.test((await cell(a, '2026-10-12')).label), (await cell(a, '2026-10-12')).label);
const c26 = await cell(a, '2026-10-26'), c27 = await cell(a, '2026-10-27');
check('the national holiday is named and has no pickup; Bio moves to Tuesday 27', /Nationalfeiertag: keine Abholung/.test(c26.label) && /is-off/.test(c26.cls) && c27.bins === 'bio', c26.label);
check('the legend under the month names the bins of this month', (await ftext(a, '#mu-foot')) === 'Restmüll Bereich 1 Restmüll Bereich 2 Biotonne Gelbe Tonne Gelber Sack Altpapier', await ftext(a, '#mu-foot'));
await tapSel(a, '#mu-grid [data-key="2026-10-12"]');
check('tapping a day circles it and says what goes out', (await cell(a, '2026-10-12')).pressed === 'true' && /is-sel/.test((await cell(a, '2026-10-12')).cls) && (await ftext(a, '#mu-foot')) === 'Montag, 12. Oktober in 5 Tagen Restmüll Bereich 1 Biotonne', await ftext(a, '#mu-foot'));
check('…the circle is drawn (visible)', await a.evaluate(() => { const r = document.querySelector('#mu-grid [data-key="2026-10-12"] .mu-ring'); return !!r && getComputedStyle(r).display === 'block' && r.getBoundingClientRect().width > 30; }));
await tapSel(a, '#mu-grid [data-key="2026-10-26"]');
check('a holiday: named, "Keine Abholung"', (await ftext(a, '#mu-foot')) === 'Montag, 26. Oktober Nationalfeiertag, in 19 Tagen Keine Abholung' && (await cell(a, '2026-10-12')).pressed === 'false', await ftext(a, '#mu-foot'));
await tapSel(a, '#mu-grid [data-key="2026-10-26"]');
check('tapping the same day again shows the legend again', /^Restmüll Bereich 1/.test(await ftext(a, '#mu-foot')) && (await cell(a, '2026-10-26')).pressed === 'false');
await tapSel(a, '#mu-fwd');
check('next month: November, with the "Heute" button back to October', (await ftext(a, '#mu-mtitle')) === 'November 2026' && await visible(a, '#mu-today') && (await binsOf(a, '2026-11-12')) === 'rest,gs' && /Allerheiligen/.test((await cell(a, '2026-11-01')).label));
await tapSel(a, '#mu-prev'); await tapSel(a, '#mu-prev');
check('back two months: September', (await ftext(a, '#mu-mtitle')) === 'September 2026' && (await binsOf(a, '2026-09-14')) === 'rest,bio');
await tapSel(a, '#mu-today');
check('"Heute" brings October back', (await ftext(a, '#mu-mtitle')) === 'Oktober 2026' && !(await visible(a, '#mu-today')));
for (let i = 0; i < 12; i++) await a.evaluate(() => document.querySelector('#mu-prev').click());
check('the plan starts in January: no month before it', (await ftext(a, '#mu-mtitle')) === 'Jänner 2026' && (await a.evaluate(() => document.querySelector('#mu-prev').disabled)) && (await binsOf(a, '2026-01-05')) === 'rest,bio' && /Neujahr/.test((await cell(a, '2026-01-01')).label));
for (let i = 0; i < 14; i++) await a.evaluate(() => document.querySelector('#mu-fwd').click());
check('…and ends in December', (await ftext(a, '#mu-mtitle')) === 'Dezember 2026' && (await a.evaluate(() => document.querySelector('#mu-fwd').disabled)) && /Christtag/.test((await cell(a, '2026-12-25')).label));
await tapSel(a, '#mu-today');
const soon = await a.evaluate(() => Array.from(document.querySelectorAll('#mu-soon .mu-row')).map(r => r.dataset.key.slice(5) + ' ' + r.querySelector('.mu-names').textContent));
check('"Weitere Termine": the five pickups after the next one', soon.join('|') === '10-12 Restmüll Bereich 1, Biotonne|10-15 Restmüll Bereich 2|10-19 Biotonne, Gelbe Tonne|10-27 Biotonne|11-02 Gelbe Tonne', soon.join('|'));
const row1 = await a.evaluate(() => { const r = document.querySelector('#mu-soon .mu-row'); return { tile: r.querySelector('.mu-tile').innerText.replace(/\s+/g, ' '), rel: r.querySelector('.mu-rel').textContent, sr: r.querySelector('.sr').textContent, bins: r.querySelectorAll('.bin').length }; });
check('…each with its date, weekday, how far away it is, and the bins', row1.tile === '12 Okt.' && row1.rel === 'Montag, in 5 Tagen' && row1.sr === 'Montag, 12. Oktober, in 5 Tagen: ' && row1.bins === 2, JSON.stringify(row1));
check('the screen has the "Gut zu wissen" card with the 6 o\'clock rule and the recycling centre', /bis 6 Uhr früh/.test(await text(a, '#mu-info')) && /Lederhasgasse 11/.test(await text(a, '#mu-info')) && (await attr(a, '#mu-info a', 'href')) === 'https://www.gvabaden.at');

console.log('3. "Eure Tonnen"');
await tapSel(a, '#mu-pick');
check('"Straße wählen" opens the sheet with the cursor in the street field', await visible(a, '#mu-sheet') && (await a.evaluate(() => document.activeElement && document.activeElement.id)) === 'mu-street');
check('…and the page behind it is inert', await a.evaluate(() => document.getElementById('app').inert && document.getElementById('tabbar').inert));
await setValue(a, '#mu-street', 'haydn');
check('typing finds the street with its area', flat(await text(a, '#mu-sug')) === 'Haydngasse Bereich 2', await text(a, '#mu-sug'));
await tapSel(a, '#mu-sug [data-street="Haydngasse"]');
check('picking it sets area 2 and says so', (await attr(a, '#mu-area [data-area="2"]', 'aria-checked')) === 'true' && (await a.$eval('#mu-street', e => e.value)) === 'Haydngasse' && /Haydngasse gehört zu Bereich 2/.test(await text(a, '#mu-area-note')) && !(await visible(a, '#mu-sug')));
check('the usual bins are ticked, the ash bin and the housing estate ones are not', (await a.evaluate(() => Array.from(document.querySelectorAll('#mu-sheet .mu-tg')).map(b => b.dataset.kind + ':' + b.getAttribute('aria-checked')).join())) === 'rest:true,asche:false,bio:true,gt:true,gs:true,ap:true,ap3:false,c4:false,c2:false');
await tapSel(a, '#mu-sheet .mu-tg[data-kind="gt"]');
check('a bin is switched off with one tap', (await attr(a, '#mu-sheet .mu-tg[data-kind="gt"]', 'aria-checked')) === 'false');
await tapSel(a, '#mu-save');
check('saving closes the sheet and says so', !(await visible(a, '#mu-sheet')) && /Gespeichert/.test(await text(a, '#toast')) && !(await a.evaluate(() => document.getElementById('app').inert)));
check('the choice is written to settings/muell, for both phones', await waitFor(() => { const d = muDoc(); return d && d.area === 2 && d.street === 'Haydngasse' && d.have.gt === false && d.have.rest === true && d.v === 1; }, 4000), JSON.stringify(muDoc()));
check('the screen follows: caption with street and area, no prompt', (await text(a, '#mu-cap')) === 'Haydngasse, Bereich 2' && !(await visible(a, '#mu-pick')));
check('…area 2 only: Thursday 15 Restmüll, Monday 12 only Bio, Monday 19 no yellow bin', (await binsOf(a, '2026-10-15')) === 'rest' && (await binsOf(a, '2026-10-12')) === 'bio' && (await binsOf(a, '2026-10-19')) === 'bio');
check('…plain "Restmüll" without the area number', /Donnerstag, 15\. Oktober: Restmüll$/.test((await cell(a, '2026-10-15')).label) && (await ftext(a, '#mu-foot')) === 'Restmüll Biotonne Gelber Sack Altpapier', await ftext(a, '#mu-foot'));

console.log('4. the other phone');
const B = await open('uid-anna-0002', 'b'), b = B.page;
await goMuell(B);
check('phone B shows the same choice', (await text(b, '#mu-cap')) === 'Haydngasse, Bereich 2' && (await binsOf(b, '2026-10-12')) === 'bio' && (await binsOf(b, '2026-10-15')) === 'rest');
await tapSel(b, '#mu-set');
check('B opens "Eure Tonnen" from the header: the stored street is filled in', await visible(b, '#mu-sheet') && (await b.$eval('#mu-street', e => e.value)) === 'Haydngasse' && (await attr(b, '#mu-area [data-area="2"]', 'aria-checked')) === 'true' && (await b.evaluate(() => document.activeElement && document.activeElement.id)) === 'mu-cancel');
await tapSel(b, '#mu-sheet .mu-tg[data-kind="gt"]');
await tapSel(b, '#mu-sheet .mu-tg[data-kind="asche"]');
await tapSel(b, '#mu-save');
check('B switches the yellow bin back on and adds the ash bin: A sees it live', await waitFor(async () => (await binsOf(a, '2026-10-19')) === 'bio,gt', 5000), await binsOf(a, '2026-10-19'));
await a.evaluate(() => document.querySelector('#mu-fwd').click());
check('…the ash bin comes with the Restmüll of area 2 in November', (await binsOf(a, '2026-11-12')) === 'rest,asche,gs' && /Restmüll, Aschentonne, Gelber Sack/.test((await cell(a, '2026-11-12')).label), (await cell(a, '2026-11-12')).label);
await a.evaluate(() => document.querySelector('#mu-today').click());

console.log('5. closing the sheet, errors');
await tapSel(b, '#mu-set');
await b.goBack(); await sleep(400);
check('the back button closes the sheet and stays on the Müll screen', !(await visible(b, '#mu-sheet')) && await visible(b, '#screen-muell') && !(await b.evaluate(() => document.getElementById('app').inert)));
await tapSel(b, '#mu-set');
await b.keyboard.press('Escape'); await sleep(200);
check('Escape closes it too', !(await visible(b, '#mu-sheet')));
await tapSel(b, '#mu-set');
for (const k of ['rest', 'asche', 'bio', 'gt', 'gs', 'ap']) await b.evaluate(k => { const e = document.querySelector('#mu-sheet .mu-tg[data-kind="' + k + '"]'); if (e.getAttribute('aria-checked') === 'true') e.click(); }, k);
await tapSel(b, '#mu-save');
check('saving with no bin at all is refused with a message', await visible(b, '#mu-sheet') && /mindestens eine Tonne/.test(await text(b, '#mu-sheet .err')));
await tapSel(b, '#mu-cancel');
check('"Abbrechen" changes nothing', !(await visible(b, '#mu-sheet')) && muDoc().have.rest === true && muDoc().have.asche === true);
await tapSel(b, '#mu-set');
await tapSel(b, '#mu-area [data-area="1"]');
check('choosing the other area by hand empties the street that does not belong to it', (await b.$eval('#mu-street', e => e.value)) === '' && /Bereich 1 gewählt/.test(await text(b, '#mu-area-note')));
await setValue(b, '#mu-street', 'wiener str');
await b.focus('#mu-street'); await b.keyboard.press('Enter'); await sleep(200);
check('Enter in the street field takes the first match', (await b.$eval('#mu-street', e => e.value)) === 'Wiener Straße' && (await attr(b, '#mu-area [data-area="1"]', 'aria-checked')) === 'true');
await tapSel(b, '#mu-save');
check('area 1 is stored with its street; A follows', await waitFor(() => { const d = muDoc(); return d.area === 1 && d.street === 'Wiener Straße'; }, 4000) && await waitFor(async () => (await text(a, '#mu-cap')) === 'Wiener Straße, Bereich 1' && (await binsOf(a, '2026-10-12')) === 'rest,bio', 4000));

put('settings/muell', { area: 'x', street: '<img src=x onerror=alert(1)>', have: { rest: 'no', bio: 7 } });
check('a broken document falls back to the plain plan, nothing of it gets into the page', await waitFor(async () => (await text(a, '#mu-cap')) === 'Abfuhrplan 2026', 4000) && (await a.evaluate(() => !document.querySelector('#screen-muell img'))) && (await binsOf(a, '2026-10-12')) === 'rest,bio');
put('settings/muell', { v: 1, area: 1, street: 'Hauptstraße', have: { rest: true, bio: true, gt: true, gs: true, ap: true } });
await waitFor(async () => (await text(a, '#mu-cap')) === 'Hauptstraße, Bereich 1', 4000);
check('no page errors and no raw values on either phone', A.errors.length === 0 && B.errors.length === 0 && (await junk(a)) === '' && (await junk(b)) === '', A.errors.concat(B.errors).join(' | '));
await tapSel(a, '#tab-week');
check('the week is still there behind its tab', await visible(a, '#screen-week') && !(await visible(a, '#screen-muell')));
await A.close(); await B.close();

console.log('6. other days and times');
const at = iso => new Date(iso).getTime();
{
  const P = await open('uid-simon-0001', 'a', { now: at('2026-10-08T12:30:00+02:00') }), p = P.page;
  await goMuell(P);
  check('Thursday after noon: today\'s pickup is over, next is Monday', /^Montag 12\. Oktober, in 4 Tagen Restmüll Biotonne/.test(await ftext(p, '#mu-next')) && !(await visible(p, '#d-muell')), await ftext(p, '#mu-next'));
  await P.close();
}
{
  const P = await open('uid-simon-0001', 'a', { now: at('2026-10-12T07:10:00+02:00') }), p = P.page;
  await goMuell(P);
  check('Monday morning: "Heute"', /^Heute Montag, 12\. Oktober Restmüll Biotonne/.test(await ftext(p, '#mu-next')), await ftext(p, '#mu-next'));
  await tapSel(p, '#tab-week');
  check('…and the dot on the tab says so', await visible(p, '#d-muell') && (await attr(p, '#open-muell', 'aria-label')) === 'Müll, heute: Restmüll, Biotonne');
  await P.close();
}
{
  const P = await open('uid-simon-0001', 'a', { now: at('2026-10-07T23:59:50+02:00') }), p = P.page;
  await goMuell(P);
  const before = await ftext(p, '#mu-next');
  check('just before midnight the paper is "Morgen" …', /^Morgen/.test(before), before);
  check('… and after midnight "Heute", without reopening the app', await waitFor(async () => /^Heute Donnerstag, 8\. Oktober Altpapier/.test(await ftext(p, '#mu-next')), 16000), await ftext(p, '#mu-next'));
  await P.close();
}
{
  const P = await open('uid-simon-0001', 'a', { now: at('2026-12-29T10:00:00+01:00') }), p = P.page;
  await goMuell(P);
  check('end of December: the plan is over and the 2027 plan is missing', (await ftext(p, '#mu-next')) === 'Plan zu Ende Der Abfuhrplan 2027 ist noch nicht in der App.' && (await ftext(p, '#mu-mtitle')) === 'Dezember 2026' && !(await visible(p, '#mu-soon .mu-row')));
  await P.close();
}
{
  const P = await open('uid-simon-0001', 'a', { now: at('2027-01-05T10:00:00+01:00') }), p = P.page;
  await goMuell(P);
  check('January 2027 ("Jänner", as in Austria): an empty month that says why, December 2026 one tap back', (await ftext(p, '#mu-mtitle')) === 'Jänner 2027' && /Für 2027 ist noch kein Plan in der App/.test(await text(p, '#mu-foot')) && !(await p.evaluate(() => document.querySelector('#mu-prev').disabled)) && (await p.evaluate(() => document.querySelector('#mu-fwd').disabled)));
  check('no page errors at the edges of the plan', P.errors.length === 0, P.errors.join(' | '));
  await P.close();
}
{
  const P = await open('uid-simon-0001', 'a', { width: 320, height: 640, dark: true }), p = P.page;
  await goMuell(P);
  const fit = await p.evaluate(() => {
    const out = [];
    const vw = document.documentElement.clientWidth;
    if (document.documentElement.scrollWidth > vw) out.push('page scrolls sideways');
    for (const e of document.querySelectorAll('#screen-muell .mu-d[data-key], #screen-muell .mu-chip, #mu-mtitle, #mu-set, #tabbar .tab')) { const r = e.getBoundingClientRect(); if (r.right > vw + 0.5 || r.left < -0.5) out.push(e.id || e.className); }
    return out;
  });
  check('320 px wide, dark: nothing sticks out', fit.length === 0, fit.join(', '));
  await P.close();
}

await browser.close(); await server.close();
process.exitCode = done() ? 1 : 0;
