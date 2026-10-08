// Helpers for the browser tests of the standalone app: Chromium 141, one isolated browser context per "phone".
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export { reporter, sleep, rect, longPressDrag, scrollToTile } from './lib.mjs';
import { sleep } from './lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const JSQR = fs.readFileSync(path.join(here, '../node_modules/jsqr/dist/jsQR.js'), 'utf8');

export const UA_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
export const UA_ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
export const NOW = new Date('2026-10-07T18:30:00+02:00').getTime();   // Wednesday, KW 41
export const W = '2026-10-05';
export const net = { api: null };          // origin of the fake Firebase API (set by the test runner)

export const CONFIG_TEXT = (project = 'wochenspiel-test1') => `// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyD-FAKEKEYFORTESTING0123456789abcd",
  authDomain: "${project}.firebaseapp.com",
  projectId: "${project}",
  storageBucket: "${project}.firebasestorage.app",
  messagingSenderId: "123456789012",
  appId: "1:123456789012:web:abcdef0123456789abcdef"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);`;

export async function launch() {
  return puppeteer.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium', headless: true, args: ['--no-sandbox', '--disable-gpu', '--font-render-hinting=none', '--disable-features=BackForwardCache'] });
}

// A "phone": its own browser context (own storage, own service worker), mobile viewport, German timezone, frozen clock.
export async function phone(browser, base, opts = {}) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: opts.width || 390, height: opts.height || 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.emulateTimezone('Europe/Vienna');
  if (opts.ua) await page.setUserAgent(opts.ua);
  if (opts.dark != null) await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: opts.dark ? 'dark' : 'light' }]);
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  if (opts.now !== false) {
    await page.evaluateOnNewDocument(now => {
      const RealDate = Date, offset = now - RealDate.now();
      window.Date = class extends RealDate { constructor(...a) { if (a.length) super(...a); else super(RealDate.now() + offset); } static now() { return RealDate.now() + offset; } };
    }, opts.now || NOW);
  }
  if (net.api) await page.evaluateOnNewDocument(api => { window.__FAKE_BASE = api; }, net.api);
  if (opts.pre) await page.evaluateOnNewDocument(opts.pre);
  const origin = new URL(base).origin;
  if (opts.clipboard !== false) await ctx.overridePermissions(origin, ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write']);
  return { ctx, page, errors, origin, close: () => ctx.close() };
}

// A really dead (or really slow) network for one phone. The browser's offline mode only fails the page's own requests and does
// not reach service workers; so, in addition, the test server drops (or never answers) every request that carries the phone's
// cookie. state: 'online' | 'offline' | 'hang' (never answers) | '503' (answers every page request with an error).
export async function netState(P, state) {
  await P.page.setOfflineMode(state === 'offline');
  const cookie = (name, on) => ({ name, value: on ? '1' : '0', domain: '127.0.0.1', path: '/' });
  await P.ctx.setCookie(cookie('ws_offline', state === 'offline'), cookie('ws_hang', state === 'hang'), cookie('ws_503', state === '503'));
}

export const visible = (page, sel) => page.evaluate(sel => { const e = document.querySelector(sel); if (!e || e.hidden) return false; const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; }, sel);
export const text = (page, sel) => page.evaluate(sel => { const e = document.querySelector(sel); return e ? e.innerText : ''; }, sel);
export const overlayText = page => page.evaluate(() => { const e = document.querySelector('#ws'); return e && !e.hidden ? e.innerText : ''; });
export const overlayOpen = page => page.evaluate(() => { const e = document.querySelector('#ws'); return !!e && !e.hidden; });

export async function waitFor(fn, ms = 6000, step = 60) {
  const t0 = Date.now();
  for (;;) {
    let v; try { v = await fn(); } catch (e) { v = false; }
    if (v) return v;
    if (Date.now() - t0 > ms) return false;
    await sleep(step);
  }
}
export const waitText = (page, re, ms = 6000) => waitFor(async () => re.test(await overlayText(page)), ms);

// tap an element by CSS selector (scrolls it to the middle of its scroll container first)
export async function tapSel(page, sel) {
  const r = await page.evaluate(sel => {
    const e = document.querySelector(sel); if (!e) return null;
    const y0 = e.getBoundingClientRect().top;
    e.scrollIntoView({ block: 'center' });
    const b = e.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, moved: Math.abs(b.top - y0) > 0.5 };
  }, sel);
  if (!r) throw new Error('tapSel: nothing for ' + sel);
  // The game ignores a touch that comes within 110 ms of a scroll (it only stops a fling, it is not a tap): after a scroll wait well beyond that.
  await sleep(r.moved ? 300 : 120);
  const t = await page.touchscreen.touchStart(r.x, r.y); await sleep(50); await t.end(); await sleep(200);
}
// The Nest game lists one day at a time. A day is picked in the week strip; these helpers do that (with a click, so nothing scrolls)
// before they look at, scroll to or tap a tile. A tile key is weekKey_taskId_day, the day is the last part.
export const dayOfKey = key => Number(String(key).split('_').pop());
export const showDay = (page, d) => page.evaluate(d => { const c = document.querySelector('#strip .dcell[data-day="' + d + '"]'); if (c && !c.classList.contains('is-sel')) c.click(); }, d);
// the game ignores taps until this week's ticks are in (a tap could overwrite one): a test waits for that, as a person would see it
export const weekReady = page => waitFor(() => page.evaluate(() => { const d = document.querySelector('#days'); return !!d && !d.classList.contains('is-loading'); }), 6000);
export async function tapTile(page, key) { await weekReady(page); await showDay(page, dayOfKey(key)); await tapSel(page, '.tile[data-key="' + key + '"]'); }
export async function scrollToKey(page, key) { await showDay(page, dayOfKey(key)); await page.evaluate(k => { const e = document.querySelector('.tile[data-key="' + k + '"]'); if (e) e.scrollIntoView({ block: 'center' }); }, key); await sleep(260); }
// every tile of the week: the day strip is walked through once and the selection is put back
export const allTiles = page => page.evaluate(() => {
  const cells = Array.from(document.querySelectorAll('#strip .dcell'));
  const orig = cells.findIndex(c => c.classList.contains('is-sel'));
  let n = 0;
  cells.forEach(c => { c.click(); n += document.querySelectorAll('#days .tile').length; });
  if (orig >= 0) cells[orig].click();
  return n;
});

// tap a button inside the overlay (or anywhere) by its visible label (prefix match)
export async function tapLabel(page, label, scope = '#ws') {
  const idx = await page.evaluate((label, scope) => {
    const root = document.querySelector(scope) || document;
    const els = Array.from(root.querySelectorAll('button, a')).filter(e => !e.hidden && e.getBoundingClientRect().width > 0);
    const lines = e => e.innerText.split('\n').map(l => l.trim()).filter(Boolean);
    let i = els.findIndex(e => (lines(e)[0] || '').startsWith(label));
    if (i < 0) i = els.findIndex(e => lines(e).some(l => l.startsWith(label)));
    if (i < 0) return -1;
    els[i].setAttribute('data-tap', '1');
    return i;
  }, label, scope);
  if (idx < 0) throw new Error('tapLabel: no button "' + label + '"');
  try { await tapSel(page, '[data-tap="1"]'); } finally { await page.evaluate(() => document.querySelectorAll('[data-tap]').forEach(e => e.removeAttribute('data-tap'))); }
}
export const buttons = (page, scope = '#ws') => page.evaluate(scope => Array.from((document.querySelector(scope) || document).querySelectorAll('button, a')).filter(e => !e.hidden && e.getBoundingClientRect().width > 0).map(e => e.innerText.trim().split('\n')[0]), scope);

export async function setValue(page, sel, value) {
  await page.$eval(sel, (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }, value);
}

// decode the QR code shown in the overlay, as a phone camera would see it: from a screenshot of the element
export async function decodeQr(page) {
  const el = await page.$('.ws-qr');
  if (!el) return null;
  await el.evaluate(e => e.scrollIntoView({ block: 'center' }));
  await sleep(150);
  const png = await el.screenshot({ type: 'png' });
  const b64 = Buffer.from(png).toString('base64');
  const probe = await page.evaluate(async b64 => {
    const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const x = c.getContext('2d'); x.drawImage(img, 0, 0);
    return { w: img.width, h: img.height, data: Array.from(x.getImageData(0, 0, img.width, img.height).data) };
  }, b64);
  const jsQR = new Function('module', 'exports', JSQR + '\nreturn module.exports;')({ exports: {} }, {});
  const out = jsQR(Uint8ClampedArray.from(probe.data), probe.w, probe.h);
  return out ? out.data : null;
}

export async function shot(page, file) { await page.screenshot({ path: path.join(here, 'shots', file) }); }
fs.mkdirSync(path.join(here, 'shots'), { recursive: true });
