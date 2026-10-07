// The four screens (Woche, Einkauf, Wünsche, Müll) and the tab bar under them. The fifth tab, "Ich", opens the settings sheet;
// the game wires that one itself.
import { $ } from './dom.js';

const TABS = { week: 'tab-week', shop: 'open-shop', wish: 'open-wish', muell: 'open-muell' };
const ORDER = ['week', 'shop', 'wish', 'muell'];
const scrolls = { week: 0, shop: 0, wish: 0, muell: 0 };
let cur = 'week';

const reduced = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
export const current = () => cur;

export function go(name) {
  if (!TABS[name]) return;
  if (name === cur) {                                  // a second tap on the active tab brings the screen back to the top
    window.scrollTo({ top: 0, behavior: reduced() ? 'auto' : 'smooth' });
    return;
  }
  scrolls[cur] = window.scrollY;
  const prev = cur;
  cur = name;
  for (const k of ORDER) {
    const sec = $('#screen-' + k), tab = $('#' + TABS[k]);
    if (sec) sec.hidden = k !== name;
    if (tab) { if (k === name) tab.setAttribute('aria-current', 'page'); else tab.removeAttribute('aria-current'); }
  }
  const bar = $('#tabbar');
  if (bar) bar.style.setProperty('--i', String(ORDER.indexOf(name)));
  document.documentElement.dataset.screen = name;
  window.scrollTo(0, scrolls[name] || 0);
  window.dispatchEvent(new CustomEvent('ws:screen', { detail: { screen: name, from: prev } }));
}

function init() {
  for (const k of ORDER) {
    const tab = $('#' + TABS[k]);
    if (tab) tab.addEventListener('click', () => go(k));
  }
  document.documentElement.dataset.screen = cur;
}
init();

// The straw field of the heroes reaches to the top edge; when the page is pulled down there, the straw colour shows above it
// (and not the paper colour of the rest of the page).
const syncTop = () => document.documentElement.classList.toggle('at-top', window.scrollY <= 0);
window.addEventListener('scroll', syncTop, { passive: true });
syncTop();

// the number badges on the tabs (open items of the two lists)
export function setBadge(name, n) {
  const el = $('#n-' + name);
  if (!el) return;
  el.textContent = n > 99 ? '99+' : String(n);
  el.hidden = !n;
}
