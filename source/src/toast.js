// The one message bar above the tab bar. It is used by the game and by the lists.
import { h } from './dom.js';

let timer = 0;
// what a screen reader says: one polite line in the hidden live region (the message bar itself is not a live region)
export function announce(msg) {
  const l = document.getElementById('live');
  if (!l) return;
  l.textContent = '';
  setTimeout(() => { l.textContent = msg; }, 30);
}
export function hideToast() {
  clearTimeout(timer);
  const t = document.getElementById('toast');
  if (t) { t.hidden = true; t.replaceChildren(); }
}
// opts.undo: a function; the message then gets a "Rückgängig" button and stays a little longer
export function toast(msg, opts) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.hidden = true;
  const undo = opts && opts.undo;
  t.replaceChildren(...[h('span', { text: msg }), undo ? h('button', { type: 'button', text: 'Rückgängig', onclick: () => { hideToast(); undo(); } }) : null].filter(Boolean));
  t.hidden = false;
  announce(msg);
  clearTimeout(timer);
  timer = setTimeout(hideToast, undo ? 6000 : 3800);
}
