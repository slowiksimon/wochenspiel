// Small helpers shared by the test scripts (touch gestures, check counting).

export const sleep = ms => new Promise(r => setTimeout(r, ms));

export const rect = (page, sel) => page.evaluate(sel => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height, top: r.top, bottom: r.bottom }; }, sel);

export async function scrollToTile(page, key) {
  await page.evaluate(key => { document.querySelector('.tile[data-key="' + key + '"]').scrollIntoView({ block: 'center' }); }, key);
  await sleep(260);
}

export async function longPressDrag(page, from, to, { hold = 420, steps = 14, endHold = 120, release = true } = {}) {
  const t = await page.touchscreen.touchStart(from.x, from.y);
  await sleep(hold);
  for (let i = 1; i <= steps; i++) { await t.move(from.x + (to.x - from.x) * i / steps, from.y + (to.y - from.y) * i / steps); await sleep(16); }
  await sleep(endHold);
  if (release) await t.end();
  return t;
}

export function reporter() {
  const results = [];
  const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log((ok ? '  ok  ' : ' FAIL ') + name + (ok || !detail ? '' : '  -> ' + detail)); };
  const done = () => { const f = results.filter(r => !r.ok); console.log(`\n${results.length - f.length}/${results.length} checks passed`); return f.length; };
  return { check, done };
}
