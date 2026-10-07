// Unit tests for the pure helpers (src/codec.js, src/seed.js, src/lists-core.js, src/muell-core.js). Run: node tests/unit.mjs
import * as C from '../src/codec.js';
import { starterTasks } from '../src/seed.js';
import { reporter } from './lib.mjs';
const { check, done } = reporter();

/* ---- Firebase config parsing: every format the console is known to show ---- */
const KEY = 'AIzaSyD-FAKEKEYFORTESTING0123456789abcd';
const NPM = `// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "${KEY}",
  authDomain: "wochenspiel-ab12c.firebaseapp.com",
  projectId: "wochenspiel-ab12c",
  storageBucket: "wochenspiel-ab12c.firebasestorage.app",
  messagingSenderId: "123456789012",
  appId: "1:123456789012:web:abcdef0123456789abcdef",
  measurementId: "G-ABCDE12345"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);`;
let r = C.parseFirebaseConfig(NPM);
check('npm snippet (with comments, imports, measurementId)', r.ok && r.cfg.projectId === 'wochenspiel-ab12c' && r.cfg.apiKey === KEY && r.cfg.appId.startsWith('1:123') && r.cfg.measurementId === 'G-ABCDE12345', JSON.stringify(r));
const CDN = `<script type="module">
  // Import the functions you need from the SDKs you need
  import { initializeApp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js";
  const firebaseConfig = {
    apiKey: "${KEY}", // the key
    authDomain: "wochenspiel-ab12c.firebaseapp.com",
    projectId: "wochenspiel-ab12c",
    appId: "1:123456789012:web:abcdef0123456789abcdef"
  };
  const app = initializeApp(firebaseConfig);
</script>`;
r = C.parseFirebaseConfig(CDN);
check('CDN snippet (https:// URLs and trailing comments do not confuse it)', r.ok && r.cfg.projectId === 'wochenspiel-ab12c' && r.cfg.apiKey === KEY, JSON.stringify(r));
r = C.parseFirebaseConfig(`{"apiKey":"${KEY}","authDomain":"x-y-z-1.firebaseapp.com","projectId":"x-y-z-1","appId":"1:2:web:3"}`);
check('plain JSON', r.ok && r.cfg.projectId === 'x-y-z-1', JSON.stringify(r));
r = C.parseFirebaseConfig(`const firebaseConfig = {\r\n  apiKey: '${KEY}',\r\n  projectId: 'my-proj-1',\r\n};`);
check('single quotes, Windows line breaks, trailing comma', r.ok && r.cfg.projectId === 'my-proj-1', JSON.stringify(r));
r = C.parseFirebaseConfig(`apiKey: "${KEY}"\nprojectId: "MY-PROJ-1"`);
check('project id is lower-cased', r.ok && r.cfg.projectId === 'my-proj-1');
r = C.parseFirebaseConfig('   ');
check('empty input', !r.ok && r.error === 'empty');
r = C.parseFirebaseConfig(`apiKey: "${KEY}"`);
check('no projectId', !r.ok && r.error === 'no-project');
r = C.parseFirebaseConfig(`projectId: "wochenspiel-ab12c"`);
check('no apiKey', !r.ok && r.error === 'no-key');
r = C.parseFirebaseConfig(`apiKey: "short"\nprojectId: "wochenspiel-ab12c"`);
check('apiKey too short', !r.ok && r.error === 'bad-key');
r = C.parseFirebaseConfig(`apiKey: "${KEY}"\nprojectId: "Ab"`);
check('project id too short', !r.ok && r.error === 'bad-project');
r = C.parseFirebaseConfig(`apiKey: "${KEY}"\nprojectId: "my project"`);
check('project id with a space', !r.ok && r.error === 'bad-project');
r = C.parseFirebaseConfig(`projectId: "wochenspiel-ab12c", apiKey: "${KEY}", evil: "x", __proto__: "y"`);
check('unknown keys are ignored (nothing leaks into the config)', r.ok && Object.keys(r.cfg).sort().join() === 'apiKey,projectId', JSON.stringify(r));

/* ---- invite codec ---- */
const cfg = r.cfg; cfg.appId = '1:123456789012:web:abcdef0123456789abcdef';
const room = C.makeRoomCode();
const url = C.inviteUrl('https://anna.github.io/wochenspiel/?x=1#old', { cfg, room, me: 'b' });
check('invite URL starts at the app address, old query/hash removed', url.startsWith('https://anna.github.io/wochenspiel/#j='), url);
check('invite URL is URL-safe', /^[A-Za-z0-9:/._#=-]+$/.test(url), url);
const back = C.extractInvite(url);
check('invite round trip', back && back.room === room && back.cfg.projectId === cfg.projectId && back.cfg.apiKey === cfg.apiKey && back.cfg.appId === cfg.appId && back.me === 'b', JSON.stringify(back));
check('authDomain defaults to <project>.firebaseapp.com', back.cfg.authDomain === 'wochenspiel-ab12c.firebaseapp.com' || back.cfg.authDomain === cfg.projectId + '.firebaseapp.com');
check('invite without "me"', C.extractInvite(C.inviteUrl('https://x.test/', { cfg, room })).me === null);
check('custom authDomain survives', C.extractInvite(C.inviteUrl('https://x.test/', { cfg: Object.assign({}, cfg, { authDomain: 'login.example.org' }), room })).cfg.authDomain === 'login.example.org');
const payload = url.split('#j=')[1];
check('extract: bare code', C.extractInvite(payload) && C.extractInvite(payload).room === room);
check('extract: "j=…"', C.extractInvite('j=' + payload).room === room);
check('extract: "#j=…"', C.extractInvite('#j=' + payload).room === room);
check('extract: link inside a sentence', C.extractInvite('Hi 👋 hier der Link: ' + url + ' bis später!').room === room);
check('extract: link broken over two lines (mail program)', (C.extractInvite(url.slice(0, 80) + '\n' + url.slice(80)) || {}).room === room);
check('extract: link broken over three lines with indentation', (C.extractInvite(url.slice(0, 70) + '\n  ' + url.slice(70, 120) + '\r\n  ' + url.slice(120)) || {}).room === room);
check('extract: broken link followed by more text', (C.extractInvite('Schau mal: ' + url.slice(0, 80) + '\n' + url.slice(80) + '\nLG Simon, bis später') || {}).room === room);
check('extract: link followed by punctuation and words', (C.extractInvite('(' + url + '), viel Spaß!') || {}).room === room);
check('extract: bare code broken over lines', (C.extractInvite(payload.slice(0, 50) + '\n' + payload.slice(50)) || {}).room === room);
check('extract: link as query (?j=)', C.extractInvite('https://x.test/?j=' + payload).room === room);
check('extract: garbage', C.extractInvite('hallo welt') === null && C.extractInvite('') === null && C.extractInvite(null) === null && C.extractInvite('#j=%%%') === null);
check('extract: tampered payload is refused', C.extractInvite('#j=' + payload.slice(0, -5) + 'AAAAA') === null);
check('extract: cut-off payload is refused', C.extractInvite('#j=' + payload.slice(0, 60)) === null);
const evil = btoa(JSON.stringify({ v: 1, p: 'x<script>', r: room })).replace(/=+$/, '');
check('decode refuses an invalid project id', C.decodeInvite(evil) === null);
const evil2 = btoa(JSON.stringify({ v: 1, p: 'good-proj-1', r: 'short' })).replace(/=+$/, '');
check('decode refuses a short room code', C.decodeInvite(evil2) === null);
const evil3 = btoa(JSON.stringify({ v: 2, p: 'good-proj-1', r: room })).replace(/=+$/, '');
check('decode refuses another version', C.decodeInvite(evil3) === null);
const evil4 = btoa(JSON.stringify({ v: 1, p: 'good-proj-1', r: room, k: 'bad key!!', a: 'x'.repeat(500) })).replace(/=+$/, '');
const d4 = C.decodeInvite(evil4);
check('decode drops a malformed key and an oversized appId', d4 && !d4.cfg.apiKey && !d4.cfg.appId, JSON.stringify(d4));
const umlaut = C.extractInvite(C.inviteUrl('https://x.test/', { cfg: Object.assign({}, cfg, { authDomain: 'dömäne.example' }), room }));
check('non-ASCII text survives the encoding', umlaut && umlaut.cfg.authDomain === 'dömäne.example');
check('typical invite link is short enough for a scannable QR (< 300 chars)', url.length < 300, String(url.length));

/* ---- ids ---- */
const seen = new Set();
let okAlpha = true;
for (let i = 0; i < 2000; i++) { const c = C.makeRoomCode(); seen.add(c); if (!/^[abcdefghjkmnpqrstuvwxyz23456789]{16}$/.test(c)) okAlpha = false; }
check('room codes: 16 chars, only unambiguous symbols', okAlpha);
check('room codes: no repeats in 2000 draws', seen.size === 2000, String(seen.size));
check('room codes: every symbol shows up (no modulo gap)', new Set([...seen].join('')).size === 31);
check('uid format', /^d_[abcdefghjkmnpqrstuvwxyz23456789]{12}$/.test(C.makeUid()) && C.makeUid() !== C.makeUid());
check('isRoom', C.isRoom(room) && !C.isRoom('abc') && !C.isRoom('ABCDEFGHJKMNPQRS') && !C.isRoom('a/b/cdefghjkmnpqrs'));
check('shortRoom shows the last 4 symbols, upper case', C.shortRoom('abcdefghjkmnpqrs') === '····PQRS', C.shortRoom('abcdefghjkmnpqrs'));

/* ---- week key (Monday of the local week) ---- */
const wk = (y, m, d) => C.mondayKey(new Date(y, m - 1, d, 12));
check('Monday stays Monday', wk(2026, 10, 5) === '2026-10-05');
check('Wednesday → Monday', wk(2026, 10, 7) === '2026-10-05');
check('Sunday → the Monday before', wk(2026, 10, 11) === '2026-10-05');
check('year boundary', wk(2027, 1, 1) === '2026-12-28');
check('across the autumn clock change', wk(2026, 10, 26) === '2026-10-26' && wk(2026, 10, 25) === '2026-10-19');
check('across the spring clock change', wk(2026, 3, 29) === '2026-03-23' && wk(2026, 3, 30) === '2026-03-30');
check('leap day', wk(2028, 2, 29) === '2028-02-28');

/* ---- rules text ---- */
check('rules text: version 2, rooms path, minimum code length, three collections', /rules_version = '2'/.test(C.FIRESTORE_RULES) && /match \/rooms\/\{room\}\/\{coll\}\/\{id\}/.test(C.FIRESTORE_RULES) && /room\.size\(\) >= 16/.test(C.FIRESTORE_RULES) && /\['tasks', 'slots', 'settings'\]/.test(C.FIRESTORE_RULES));
check('rules text: no wildcard that opens everything', !/allow read, write: if true/.test(C.FIRESTORE_RULES) && !/match \/\{document=\*\*\}/.test(C.FIRESTORE_RULES));

/* ---- starter plan ---- */
const t = starterTasks('2026-10-05', 1);
check('starter plan: 19 unique ids', t.length === 19 && new Set(t.map(x => x.id)).size === 19);
check('starter plan: valid fields', t.every(x => typeof x.data.title === 'string' && x.data.title && ['a', 'b', 'both'].includes(x.data.who) && Array.isArray(x.data.days) && x.data.days.length > 0 && x.data.days.every(d => d >= 0 && d <= 6) && [1, 2, 3].includes(x.data.pts) && typeof x.data.order === 'number' && typeof x.data.emoji === 'string'));
check('starter plan: ids are valid Firestore document ids', t.every(x => /^[a-z0-9-]+$/.test(x.id) && !x.id.startsWith('__')));
check('starter plan: no undefined values anywhere', JSON.stringify(t).indexOf('undefined') < 0 && t.every(x => Object.values(x.data).every(v => v !== undefined)));
check('starter plan: exactly one one-off task, tied to the week', t.filter(x => x.data.once).length === 1 && t.find(x => x.data.once).data.once === '2026-10-05');

/* ---- shopping list and wish list (pure part) ---- */
const L = await import('../src/lists-core.js');
const dd = (id, o) => ({ id, data: () => o });
check('shop: cleaned fields, whitespace collapsed, long titles cut', (() => { const x = L.cleanShop('shop-1', { t: '  Milch \n  3,5% ', by: 'a', at: 5, done: true, doneAt: 9 }); const y = L.cleanShop('shop-2', { t: 'x'.repeat(200) }); return x.t === 'Milch 3,5%' && x.by === 'a' && x.done && x.doneAt === 9 && y.t.length === 60 && y.done === false && y.by === null; })());
check('shop: junk refused (no title, wrong prefix, not an object)', L.cleanShop('shop-1', { t: '   ' }) === null && L.cleanShop('wish-1', { t: 'a' }) === null && L.cleanShop('shop-1', null) === null && L.cleanShop('shop-1', 'x') === null && L.cleanShop('shop-1', { t: 5 }) === null);
check('wish: defaults and validation', (() => { const w = L.cleanWish('wish-1', { t: 'Sofa', price: 1299.999, prio: 7, note: 'a\n\n\n b', by: 'x' }); return w.price === 1300 && w.prio === 2 && w.note === 'a\nb' && w.by === null && w.got === false; })());
check('wish: bad prices dropped', L.cleanWish('wish-1', { t: 'a', price: -1 }).price === null && L.cleanWish('wish-1', { t: 'a', price: '5' }).price === null && L.cleanWish('wish-1', { t: 'a', price: 1e12 }).price === null && L.cleanWish('wish-1', { t: 'a', price: 0 }).price === 0);
const parsed = L.parseItems([
  dd('shop-a', { t: 'Brot', at: 1 }), dd('shop-b', { t: 'Eier', at: 3 }), dd('shop-c', { t: 'Käse', at: 2, done: true, doneAt: 10 }), dd('shop-d', { t: 'Wein', at: 4, done: true, doneAt: 20 }),
  dd('wish-a', { t: 'Sofa', at: 1, prio: 3 }), dd('wish-b', { t: 'Bett', at: 2, prio: 1 }), dd('wish-c', { t: 'Tisch', at: 3, prio: 1 }), dd('wish-d', { t: 'Auto', at: 4, got: true, gotAt: 5 }),
  dd('tasks', { x: 1 }), dd('people', { aId: 'u' }), dd('shop-bad', { t: '' }), { id: 'shop-e', data() { throw new Error('x'); } }, null,
]);
check('parse: other settings docs and broken docs are ignored', parsed.shop.length === 4 && parsed.wish.length === 4);
check('shop order: open newest first, then ticked by tick time', parsed.shop.map(x => x.t).join() === 'Eier,Brot,Wein,Käse', parsed.shop.map(x => x.t).join());
check('wish order: open by priority then newest, got last', parsed.wish.map(x => x.t).join() === 'Tisch,Bett,Sofa,Auto', parsed.wish.map(x => x.t).join());
check('parse: empty / missing input', L.parseItems().shop.length === 0 && L.parseItems([]).wish.length === 0);
const pp = s => L.parsePrice(s);
check('price: plain and german formats', pp('1299').value === 1299 && pp('1.299').value === 1299 && pp('12,5').value === 12.5 && pp('12.5').value === 12.5 && pp('1.299,50').value === 1299.5 && pp('1.200 €').value === 1200 && pp(' 49,99 EUR ').value === 49.99 && pp('0').value === 0);
check('price: empty means no price', pp('').ok && pp('').value === null && pp('  ').value === null && pp(null).value === null && pp(undefined).value === null);
check('price: nonsense refused', !pp('abc').ok && !pp('1,299.5').ok && !pp('12,345').ok && !pp('-5').ok && !pp('1..2').ok && !pp('1e5').ok && !pp('999999999').ok && !pp('1,2,3').ok);
check('price: "1.299" is a thousand, "1,299" is refused', pp('1.299').value === 1299 && !pp('1,299').ok);
check('eur format', L.fmtEur(1299) === '1.299 €' && L.fmtEur(12.5) === '12,50 €' && L.fmtEur(0) === '0 €', L.fmtEur(1299) + '|' + L.fmtEur(12.5));
check('price back into the field', L.priceText(12.5) === '12,5' && L.priceText(null) === '' && L.priceText(1299) === '1299');
check('wish totals: only open wishes count, unpriced are counted separately', (() => { const t = L.wishTotals([{ got: false, price: 10.1 }, { got: false, price: 20.2 }, { got: false, price: null }, { got: true, price: 999 }]); return t.n === 3 && t.priced === 2 && t.total === 30.3; })());
check('linkify: links found, trailing punctuation left out, others untouched', (() => { const s = L.linkify('Siehe https://a.de/x?y=1, und www.b.de oder ftp://c.de (https://d.de/q).'); const links = s.filter(x => x.href).map(x => x.href); return links.join() === 'https://a.de/x?y=1,https://d.de/q' && s.map(x => x.text).join('') === 'Siehe https://a.de/x?y=1, und www.b.de oder ftp://c.de (https://d.de/q).'; })());
check('linkify: javascript: and data: never become links', L.linkify('javascript:alert(1) data:text/html,x').every(x => !x.href));
check('pasted list: lines, bullets, numbers and check boxes are stripped', (() => { const r = L.parseList('Einkaufsliste\n- Milch\n* 2 Brote\n• Äpfel\n1. Käse\n2) Eier\n[ ] Butter\n☐ Salz\n✓ Mehl\n\n   \n---\nMilch\n'); return r.items.join('|') === 'Einkaufsliste|Milch|2 Brote|Äpfel|Käse|Eier|Butter|Salz|Mehl' && r.cut === 0; })(), L.parseList('x').items.join());
check('pasted list: windows line breaks, semicolons, long lines, nothing', L.parseList('a1\r\nb2;c3').items.join() === 'a1,b2,c3' && L.parseList('x'.repeat(200)).items[0].length === 60 && L.parseList('').items.length === 0 && L.parseList(null).items.length === 0 && L.parseList('\n\n--\n').items.length === 0);
check('pasted list: limited to 100 items', (() => { const r = L.parseList(Array.from({ length: 130 }, (_, i) => 'Ding ' + i).join('\n')); return r.items.length === 100 && r.cut === 30; })());
check('ids: prefixed and unique', L.newId('shop-').startsWith('shop-') && L.newId('wish-').startsWith('wish-') && new Set(Array.from({ length: 50 }, () => L.newId('shop-'))).size === 50);
check('norm: case and spaces', L.norm('  Milch  ') === 'milch' && L.norm('MILCH') === L.norm('milch') && L.norm('Äpfel') === 'äpfel');

/* ---- waste plan (pure part): the data taken from the PDF, and the plan of one household ---- */
process.env.TZ = 'Europe/Vienna';                 // the dates are local dates; Vienna also has the October change of time
const Mu = await import('../src/muell-core.js');
const P = Mu.PLAN;
const at = (md, h = 9, mi = 0) => new Date(2026, Number(md.slice(0, 2)) - 1, Number(md.slice(3)), h, mi);
const wdOf = md => Mu.wd(at(md));
const lists = ['rm1', 'rm2', 'at1', 'at2', 'bio', 'gt', 'gs', 'ap', 'ap3', 'c4', 'c2'];
check('plan: every list is sorted, without repeats, and only real days of 2026', lists.every(k => P[k].every((md, i) => /^\d\d-\d\d$/.test(md) && Mu.keyOf(at(md)) === '2026-' + md && (i === 0 || P[k][i - 1] < md))));
check('plan: as many dates as the PDF has', lists.map(k => P[k].length).join() === '13,13,6,6,40,26,9,6,17,13,26', lists.map(k => P[k].length).join());
const onlyOn = (k, day, except) => P[k].every(md => wdOf(md) === day || (except || []).includes(md));
check('plan: Restmüll area 1 on Mondays (Whit Monday moves it to Thursday 28 May)', onlyOn('rm1', 0, ['05-28']) && wdOf('05-28') === 3);
check('plan: Restmüll area 2, yellow sack: Thursdays', onlyOn('rm2', 3) && onlyOn('gs', 3));
check('plan: Bio on Mondays, after the holidays on Wednesday 27 May and Tuesday 27 October', onlyOn('bio', 0, ['05-27', '10-27']) && wdOf('05-27') === 2 && wdOf('10-27') === 1);
check('plan: yellow bin on Mondays (Easter Monday moves it to Tuesday)', onlyOn('gt', 0, ['04-07']));
check('plan: paper on Thursdays (Corpus Christi moves it to Friday 5 June)', onlyOn('ap', 3, ['06-05']) && wdOf('06-05') === 4);
check('plan: containers on Wednesdays, 3-weekly paper on Mondays (three Tuesdays as printed)', onlyOn('c4', 2) && onlyOn('c2', 2) && onlyOn('ap3', 0, ['04-07', '06-09', '09-01']));
check('plan: the ash bin only comes with the Restmüll of its area', P.at1.every(md => P.rm1.includes(md)) && P.at2.every(md => P.rm2.includes(md)));
const gapsOf = k => P[k].slice(1).map((md, i) => Mu.daysBetween(at(P[k][i]), at(md)));
check('plan: the rhythms (4 weeks, 2 weeks, 6 weeks, 9 weeks)', gapsOf('rm2').every(g => g === 28) && gapsOf('rm1').join() === '28,28,28,28,31,25,28,28,28,28,28,28' && gapsOf('gs').every(g => g === 42) && gapsOf('gt').every(g => g === 14 || g === 13 || g === 15) && gapsOf('ap').join() === '63,64,62,63,63' && gapsOf('c4').every(g => g === 28) && gapsOf('c2').every(g => g === 14));
check('plan: nothing on a Sunday or a public holiday', lists.every(k => P[k].every(md => wdOf(md) !== 6 && !P.holidays[md])));
check('plan: 16 public holidays, written out', Object.keys(P.holidays).length === 16 && P.holidays['10-26'] === 'Nationalfeiertag' && P.holidays['01-06'] === 'Heilige Drei Könige' && P.holidays['12-08'] === 'Mariä Empfängnis');
check('plan: 52 + 9 streets, none twice', P.streets1.length === 52 && P.streets2.length === 9 && new Set(P.streets1.concat(P.streets2)).size === 61);

check('streets: typed the way people type', Mu.findStreets('haydn')[0].name === 'Haydngasse' && Mu.findStreets('haydn')[0].area === 2 && Mu.findStreets('tuerken')[0].name === 'Türkengasse' && Mu.findStreets('TÜRK')[0].name === 'Türkengasse' && Mu.findStreets('einoed').map(s => s.name).join() === 'Einöde,Einödstraße');
check('streets: house numbers and "Str." do not matter', Mu.findStreets('Hauptstr. 12a')[0].name === 'Hauptstraße' && Mu.findStreets('wiener strasse 3')[0].name === 'Wiener Straße' && Mu.findStreets('haupt').map(s => s.name).join() === 'Hauptplatz,Hauptstraße');
check('streets: a match at the start of a word comes first', Mu.findStreets('dolp')[0].name === 'Dr. Josef Dolp-Straße' && Mu.findStreets('gasse', 3).length === 3 && Mu.findStreets('steinfeld').map(s => s.name).join() === 'Steinfeldgasse,Am Steinfeld');
check('streets: too short or unknown finds nothing', Mu.findStreets('x').length === 0 && Mu.findStreets('').length === 0 && Mu.findStreets(null).length === 0 && Mu.findStreets('Mondgasse').length === 0 && Mu.findStreets('12').length === 0);
check('streets: the area of a street', Mu.streetArea('Wiener Straße') === 1 && Mu.streetArea('wiener strasse') === 1 && Mu.streetArea('Einöde') === 2 && Mu.streetArea('Einöd') === 0 && Mu.streetArea('') === 0 && Mu.streetArea(null) === 0);

const D = Mu.cleanSettings(null);
check('settings: nothing stored means both areas and the usual bins', D.area === 0 && D.street === '' && D.have.rest && D.have.bio && D.have.gt && D.have.gs && D.have.ap && !D.have.asche && !D.have.ap3 && !D.have.c4 && !D.have.c2);
check('settings: a street of the plan sets its area and is written as in the plan', (() => { const s = Mu.cleanSettings({ street: 'haydngasse' }); return s.area === 2 && s.street === 'Haydngasse'; })());
check('settings: a street that does not fit the chosen area is dropped, the area stays', (() => { const s = Mu.cleanSettings({ area: 1, street: 'Haydngasse' }); return s.area === 1 && s.street === ''; })());
check('settings: junk from the shared document is ignored', (() => { const s = Mu.cleanSettings({ area: '1', street: 5, have: { rest: 'yes', bio: false, evil: true } }); return s.area === 0 && s.street === '' && s.have.rest === true && s.have.bio === false && !('evil' in s.have); })() && Mu.cleanSettings('x').area === 0 && Mu.cleanSettings({ have: null }).have.rest === true);
check('settings: the document written, and comparing two choices', (() => { const s = Mu.cleanSettings({ area: 2, street: 'Haydngasse' }); const d = Mu.settingsDoc(s); return d.v === 1 && d.area === 2 && d.street === 'Haydngasse' && d.have.rest === true && typeof d.at === 'number' && Mu.sameSettings(Mu.cleanSettings(d), s) && !Mu.sameSettings(s, D); })());

const day = (map, key) => (map.get(key) || []).map(Mu.label).join(',');
const S0 = Mu.schedule(null), S1 = Mu.schedule({ area: 1 }), S2 = Mu.schedule({ area: 2, have: { asche: true } });
check('schedule without an area: both Restmüll areas, each with its number', day(S0, '2026-10-12') === 'Restmüll Bereich 1,Biotonne' && day(S0, '2026-10-15') === 'Restmüll Bereich 2' && day(S0, '2026-10-08') === 'Altpapier', day(S0, '2026-10-12'));
check('schedule: on 28 May both areas share one day: one plain "Restmüll"', day(S0, '2026-05-28') === 'Restmüll,Gelber Sack' && day(S1, '2026-05-28') === 'Restmüll,Gelber Sack' && day(S2, '2026-05-28') === 'Restmüll,Gelber Sack', day(S0, '2026-05-28'));
check('schedule for area 1: its Restmüll only', day(S1, '2026-10-12') === 'Restmüll,Biotonne' && day(S1, '2026-10-15') === '' && day(S1, '2026-01-05') === 'Restmüll,Biotonne');
check('schedule for area 2 with an ash bin: in the heating months together with the Restmüll', day(S2, '2026-11-12') === 'Restmüll,Aschentonne,Gelber Sack' && day(S2, '2026-10-15') === 'Restmüll' && day(S2, '2026-11-09') === 'Biotonne', day(S2, '2026-11-12'));
check('schedule: bins switched off are left out', day(Mu.schedule({ area: 1, have: { gt: false, bio: false } }), '2026-10-19') === '' && day(Mu.schedule({ area: 1, have: { gt: false } }), '2026-10-19') === 'Biotonne');
check('schedule: housing estate collections, two container rhythms on one day show once', day(Mu.schedule({ area: 1, have: { ap3: true } }), '2026-10-12') === 'Restmüll,Biotonne,Altpapier' && day(Mu.schedule({ have: { c4: true, c2: true } }), '2026-01-14') === 'Container' && day(Mu.schedule({ have: { c2: true } }), '2026-01-28') === 'Container');
check('schedule: nothing chosen, nothing shown', Mu.schedule({ have: Object.fromEntries(Mu.KINDS.map(k => [k.id, false])) }).size === 0);

const first = (map, now) => { const u = Mu.upcoming(map, now, 1)[0]; return u ? u.key + ' ' + u.events.map(Mu.label).join(',') : 'none'; };
check('next pickup: Wednesday evening, paper tomorrow', first(S1, at('10-07', 18, 30)) === '2026-10-08 Altpapier');
check('next pickup: on the day itself until noon, then the one after', first(S1, at('10-08', 9)) === '2026-10-08 Altpapier' && first(S1, at('10-08', 11, 59)) === '2026-10-08 Altpapier' && first(S1, at('10-08', 12)) === '2026-10-12 Restmüll,Biotonne');
check('next pickups: as many as asked, in order', (() => { const u = Mu.upcoming(S1, at('10-07', 18, 30), 4); return u.map(x => x.key.slice(5)).join() === '10-08,10-12,10-19,10-27'; })());
check('next pickup: none after the end of the plan, the first of the plan before it', first(S1, at('12-29')) === 'none' && first(S1, new Date(2027, 0, 4, 8)) === 'none' && first(S1, new Date(2025, 11, 30, 8)) === '2026-01-05 Restmüll,Biotonne');
check('when: Heute, Morgen, a weekday in the coming week, else the date', Mu.whenText(at('10-07'), at('10-07', 8)) === 'Heute' && Mu.whenText(at('10-08'), at('10-07', 18, 30)) === 'Morgen' && Mu.whenText(at('10-12'), at('10-07', 18, 30)) === 'Montag' && Mu.whenText(at('10-19'), at('10-07', 18, 30)) === '19. Oktober');
check('in how many days, also across the change of time on 25 October', Mu.inDays(at('10-08'), at('10-07', 23, 59)) === 'morgen' && Mu.inDays(at('10-12'), at('10-07', 18)) === 'in 5 Tagen' && Mu.inDays(at('10-26', 0, 0), at('10-24', 23, 30)) === 'in 2 Tagen' && Mu.inDays(at('11-02'), at('10-19')) === 'in 14 Tagen');
check('long date', Mu.longDate(at('10-08')) === 'Donnerstag, 8. Oktober' && Mu.longDate(at('03-01')) === 'Sonntag, 1. März');
check('holidays by day key, only for the year of the plan', Mu.holiday('2026-10-26') === 'Nationalfeiertag' && Mu.holiday('2026-10-27') === '' && Mu.holiday('2027-10-26') === '');
const mc = (y, m) => { const c = Mu.monthCells(y, m); return c.findIndex(Boolean) + '/' + c.filter(Boolean).length + '/' + c.length; };
check('month view: Monday first, blanks before the 1st and after the last day', mc(2026, 9) === '3/31/35' && mc(2026, 1) === '6/28/35' && mc(2026, 5) === '0/30/35' && mc(2026, 7) === '5/31/42', [mc(2026, 9), mc(2026, 1), mc(2026, 5), mc(2026, 7)].join(' '));
check('month range: the months of the plan, and the current month when it lies after it', (() => { const a = Mu.monthRange(at('10-07')), b = Mu.monthRange(new Date(2027, 1, 3)); return a.lo === 2026 * 12 && a.hi === 2026 * 12 + 11 && b.lo === 2026 * 12 && b.hi === 2027 * 12 + 1; })());

process.exitCode = done() ? 1 : 0;
