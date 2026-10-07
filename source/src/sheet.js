// The sheets that slide over the app from the list screens and the waste plan (wish editor, "paste a list", "Eure Tonnen").
// One at a time. The phone's back button closes the sheet first; while it is open, the page behind it is inert.
import { h } from './dom.js';
import { lock, unlock } from './inert.js';

let sheetEl = null, pushed = false, opener = null;

export const sheetOpen = () => !!sheetEl;

export function openSheet(el, from) {
  if (sheetEl) sheetEl.remove();
  else {
    opener = from || document.activeElement;
    try { history.pushState({ wsSheet: 1 }, '', location.href); pushed = true; } catch (e) { pushed = false; }
  }
  sheetEl = el;
  lock('sheet');
  document.documentElement.classList.add('sheet-open');
  document.body.append(el);
}

export function closeSheet(quiet, fromPop) {
  if (!sheetEl) return;
  sheetEl.remove(); sheetEl = null;
  unlock('sheet');
  document.documentElement.classList.remove('sheet-open');
  const wasPushed = pushed; pushed = false;
  if (wasPushed && !fromPop) { try { history.back(); } catch (e) { /* ignore */ } }
  const o = opener; opener = null;
  if (!quiet && o && o.isConnected) { try { o.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
}

window.addEventListener('popstate', () => { if (sheetEl) { pushed = false; closeSheet(false, true); } });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && sheetEl) closeSheet(); });

// the straw bar on top of a sheet: cancel on the left, the title, the main action on the right
export const sheetBar = (cancel, title, save) => h('div', { class: 'modal-bar straw' }, cancel, h('h3', { text: title }), save || h('span'));
