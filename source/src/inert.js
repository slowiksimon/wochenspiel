// Whatever opens over the app (a sheet, the set-up screens) makes the page behind it inert: no focus from the keyboard,
// nothing read out by a screen reader. Several things can be open at once, so each one registers under its own name.
const holders = new Set();
function apply() {
  for (const id of ['app', 'tabbar']) {
    const el = document.getElementById(id);
    if (el) el.inert = holders.size > 0;
  }
}
export function lock(who) { holders.add(who); apply(); }
export function unlock(who) { holders.delete(who); apply(); }
