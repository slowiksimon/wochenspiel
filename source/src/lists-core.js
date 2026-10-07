// Shopping list and wish list: the pure part (no DOM), so it can be tested on its own.
//
// Where the items live: the household's `settings` collection, ONE document per item, with ids "shop-…" and "wish-…".
// The security rules every household has published only allow the collections tasks, slots and settings, so this needs
// no change in Firebase. One document per item also means two phones can add or tick things at the same moment without
// overwriting each other (a single shared list document would lose one of two simultaneous changes).

export const SHOP = 'shop-';
export const WISH = 'wish-';
export const PRIOS = [{ n: 1, label: 'Wichtig' }, { n: 2, label: 'Normal' }, { n: 3, label: 'Irgendwann' }];
export const MAX_TITLE = 60, MAX_NOTE = 200, MAX_PRICE = 99999999;

// shared data is untrusted (anyone with the invite link can write it): everything is checked on the way in
const line = (v, n) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '');
const para = (v, n) => (typeof v === 'string' ? v.replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim().slice(0, n) : '');
const stamp = v => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);
const who = v => (v === 'a' || v === 'b' ? v : null);

export function cleanShop(id, d) {
  if (typeof id !== 'string' || !id.startsWith(SHOP) || !d || typeof d !== 'object') return null;
  const t = line(d.t, MAX_TITLE);
  if (!t) return null;
  return { id, t, by: who(d.by), at: stamp(d.at), done: d.done === true, doneAt: stamp(d.doneAt) };
}

export function cleanWish(id, d) {
  if (typeof id !== 'string' || !id.startsWith(WISH) || !d || typeof d !== 'object') return null;
  const t = line(d.t, MAX_TITLE);
  if (!t) return null;
  const price = typeof d.price === 'number' && Number.isFinite(d.price) && d.price >= 0 && d.price <= MAX_PRICE ? Math.round(d.price * 100) / 100 : null;
  const prio = d.prio === 1 || d.prio === 2 || d.prio === 3 ? d.prio : 2;
  return { id, t, price, note: para(d.note, MAX_NOTE), prio, by: who(d.by), at: stamp(d.at), got: d.got === true, gotAt: stamp(d.gotAt) };
}

// newest first: what was just typed in stands right under the input field
const byTime = (x, y) => y.at - x.at || (x.id < y.id ? 1 : -1);

// the documents of the settings collection in, the two lists out (each in the order it is shown)
export function parseItems(docs) {
  const shop = [], wish = [];
  for (const d of docs || []) {
    if (!d || typeof d.id !== 'string') continue;
    let data; try { data = d.data(); } catch (e) { data = null; }
    if (d.id.startsWith(SHOP)) { const it = cleanShop(d.id, data); if (it) shop.push(it); }
    else if (d.id.startsWith(WISH)) { const it = cleanWish(d.id, data); if (it) wish.push(it); }
  }
  shop.sort((x, y) => (x.done - y.done) || (x.done ? y.doneAt - x.doneAt || byTime(x, y) : byTime(x, y)));
  wish.sort((x, y) => (x.got - y.got) || (x.got ? y.gotAt - x.gotAt || byTime(x, y) : x.prio - y.prio || byTime(x, y)));
  return { shop, wish };
}

export const newId = kind => kind + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
export const norm = s => String(s || '').toLocaleLowerCase('de').replace(/\s+/g, ' ').trim();

/* ---------- prices ---------- */
// "1.299", "1.299,50", "1299", "12,5", "12.5", "1.200 €" -> a number; "" -> no price; anything else is refused
// (a dot before exactly three digits is a thousands mark, a comma is the decimal mark, as people write it here)
export function parsePrice(input) {
  const s = String(input == null ? '' : input).replace(/€|eur(o)?|\s/gi, '');
  if (!s) return { ok: true, value: null };
  let v;
  if (s.includes(',')) {
    if (!/^(\d{1,3}(\.\d{3})+|\d+)(,\d{1,2})?$/.test(s)) return { ok: false };
    v = Number(s.replace(/\./g, '').replace(',', '.'));
  } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) v = Number(s.replace(/\./g, ''));
  else if (/^\d+(\.\d{1,2})?$/.test(s)) v = Number(s);
  else return { ok: false };
  if (!Number.isFinite(v) || v < 0 || v > MAX_PRICE) return { ok: false };
  return { ok: true, value: Math.round(v * 100) / 100 };
}
const nf0 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const fmtEur = v => (Number.isInteger(v) ? nf0 : nf2).format(v) + ' €';
// the price as it is typed into the field again
export const priceText = v => (v == null ? '' : String(v).replace('.', ','));

// open wishes: how many, how many of them have a price, and what those cost together
export function wishTotals(wish) {
  let n = 0, priced = 0, total = 0;
  for (const w of wish) if (!w.got) { n++; if (w.price != null) { priced++; total = Math.round((total + w.price) * 100) / 100; } }
  return { n, priced, total };
}

/* ---------- links inside a note ---------- */
// splits a text into plain pieces and http(s) links (the rest is never turned into a link)
export function linkify(text) {
  const out = [];
  const re = /https?:\/\/[^\s<>"']+/gi;
  let last = 0, m;
  while ((m = re.exec(text))) {
    let url = m[0], end = m.index + url.length;
    // punctuation that ends the sentence is not part of the link; a ")" is, when the link has the "(" that belongs to it
    for (;;) {
      const c = url[url.length - 1];
      const open = c === ')' && (url.match(/\(/g) || []).length >= (url.match(/\)/g) || []).length;
      if (!c || !'.,;:!?)]'.includes(c) || open) break;
      url = url.slice(0, -1); end--;
    }
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    try { new URL(url); out.push({ text: url, href: url }); } catch (e) { out.push({ text: url }); }
    last = end; re.lastIndex = end;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

/* ---------- pasted lists ---------- */
export const MAX_IMPORT = 100;
// A pasted text (a message, a recipe, a web page) -> one title per line. Bullets, numbers and check boxes in front of a line are
// dropped, so are empty lines and repeats. Everything is cut to the length of a title.
export function parseList(text) {
  const out = [], seen = new Set();
  const lines = String(text == null ? '' : text).split(/\r\n|[\n\r\v\f]|;/);
  for (let raw of lines) {
    let s = raw.replace(/\s+/g, ' ').trim();
    for (let i = 0; i < 3; i++) s = s.replace(/^(?:[-*•·▪▫◦‣⁃–—+>]|\d{1,2}\s*[.)]|\[[ xX✓✔]?\]|[☐☑☒✓✔□■▢])\s*/u, '');
    s = s.trim().slice(0, MAX_TITLE).trim();
    if (!s || !/[\p{L}\p{N}]/u.test(s)) continue;
    const k = norm(s);
    if (seen.has(k)) continue;
    seen.add(k); out.push(s);
  }
  return { items: out.slice(0, MAX_IMPORT), cut: Math.max(0, out.length - MAX_IMPORT) };
}
