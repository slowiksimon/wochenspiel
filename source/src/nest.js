// The drawing material of the "Nest" design: the nest line (from the app icon), the hand-drawn loops that serve as
// check boxes and day circles, the egg behind the active tab, and the icon sprite.

/* ---------- the nest: one closed line that makes four organic turns ---------- */
export const NEST_D = 'M 169.6 439.3 C 156.9 601.3 272.1 745.3 432.9 768.4 C 593.7 791.4 744.8 685.7 778.1 526.6 C 811.5 367.6 715.5 210.1 559 166.7 C 433.5 163.1 319.8 240.2 276.6 358 C 233.4 475.8 270.3 608.1 368.3 686.5 C 466.2 765 603.4 772 708.9 704 C 814.4 636.1 864.7 508.3 833.8 386.7 C 755.7 239.7 573.9 182.8 426 259.1 C 278 335.3 218.9 516.4 293.4 665.2 C 367.8 814.1 548.2 875.4 697.9 802.8 C 793.9 724.5 830.5 594.4 789.4 477.5 C 748.4 360.7 638.5 282.1 514.6 281 C 390.7 279.9 279.5 356.6 236.4 472.8 C 193.3 588.9 227.7 719.6 322.3 799.5 C 435.4 856.4 572 836.6 664.3 750 C 756.7 663.4 785.3 528.4 735.9 411.8 C 686.5 295.3 569.6 221.9 443.2 228 C 316.7 234.1 207.5 318.5 169.6 439.3 Z';
export const NEST_VB = '150 148 712 704';
// the visual centre of the nest inside that box (the line is not centred in its box): where the big number sits
export const NEST_CX = (528.6 - 150) / 712, NEST_CY = (514.6 - 148) / 704;

/* ---------- hand-drawn loops (a pen that does a bit more than one turn) ---------- */
const loopPts = (cx, cy, R, dR, startDeg, turns, n = 46, wob = 0.14) => {
  const p = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n, a = startDeg * Math.PI / 180 + u * turns * 2 * Math.PI, r = R + dR * u + wob * Math.sin(u * 9.4 + 0.7);
    p.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return p;
};
const ptsD = p => 'M' + p.map(q => q[0].toFixed(1) + ' ' + q[1].toFixed(1)).join('L');
const polyLen = p => p.slice(1).reduce((s, q, i) => s + Math.hypot(q[0] - p[i][0], q[1] - p[i][1]), 0);
export const LOOP_D = ptsD(loopPts(14, 14, 10.3, 1.2, -118, 1.07));                 // check box, 28 x 28
const dayPts = loopPts(23, 23, 18.6, 2.3, -118, 1.07, 64, 0.26);                       // circle around a day, 46 x 46
export const DAY = { d: ptsD(dayPts), len: Math.ceil(polyLen(dayPts)) + 4 };
const hotPts = loopPts(26, 26, 20.4, 2.4, -128, 1.08, 64, 0.3);                        // circle around the day a task is about to land on, 52 x 52
export const HOT = { d: ptsD(hotPts), len: Math.ceil(polyLen(hotPts)) + 4 };

/* ---------- the egg behind the active tab ---------- */
const f = n => +n.toFixed(1);
export const eggD = (w, h) => 'M' + w / 2 + ' 0C' + f(w * 0.86) + ' 0 ' + w + ' ' + f(h * 0.34) + ' ' + w + ' ' + f(h * 0.6) + 'C' + w + ' ' + f(h * 0.83) + ' ' + f(w * 0.78) + ' ' + h + ' ' + w / 2 + ' ' + h + 'C' + f(w * 0.22) + ' ' + h + ' 0 ' + f(h * 0.83) + ' 0 ' + f(h * 0.6) + 'C0 ' + f(h * 0.34) + ' ' + f(w * 0.14) + ' 0 ' + w / 2 + ' 0Z';

/* ---------- markup helpers ---------- */
// the nest as a drawing; `lit` adds the line that grows with the week's progress (dash length 0..1000 via pathLength)
export const nestSvg = (cls, lit) => '<svg class="nest-svg' + (cls ? ' ' + cls : '') + '" viewBox="' + NEST_VB + '" aria-hidden="true" focusable="false"><path class="ghost" d="' + NEST_D + '"/>' + (lit ? '<path class="lit" pathLength="1000" d="' + NEST_D + '"/>' : '') + '</svg>';
// the app icon (also used on the welcome screen): the nest line on straw
export const iconSvg = cls => '<svg class="' + (cls || 'app-icon') + '" viewBox="24 24 976 976" aria-hidden="true" focusable="false"><rect x="24" y="24" width="976" height="976" rx="224" fill="#F3C860"/><g transform="translate(512 512) scale(1.06) translate(-506 -500)"><path d="' + NEST_D + '" fill="none" stroke="#2A211B" stroke-width="25" stroke-linecap="round" stroke-linejoin="round"/></g></svg>';

export const SPRITE = '<svg id="nest-sprite" width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><defs>'
  + '<symbol id="i-week" viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="15" rx="3"/><path d="M4 10h16M8.5 3v3.5M15.5 3v3.5"/><path d="m9.2 15 2 2 3.6-3.8"/></symbol>'
  + '<symbol id="i-cart" viewBox="0 0 24 24"><path d="M3 4.5h2.4l2 9.6a1.6 1.6 0 0 0 1.6 1.3h7.4a1.6 1.6 0 0 0 1.55-1.2L19.8 8H6"/><circle cx="9.5" cy="19" r="1.3"/><circle cx="16.5" cy="19" r="1.3"/></symbol>'
  + '<symbol id="i-sparkle" viewBox="0 0 24 24"><path d="M11 3.5c.7 4.4 2.9 6.6 7.3 7.3-4.4.7-6.6 2.9-7.3 7.3-.7-4.4-2.9-6.6-7.3-7.3 4.4-.7 6.6-2.9 7.3-7.3z"/><path d="M19 15.5v4M17 17.5h4"/></symbol>'
  + '<symbol id="i-bin" viewBox="0 0 24 24"><path d="M4.3 7.4h15.4"/><path d="M5.4 7.4c.1-1.7 1.1-2.7 2.8-2.7h7.6c1.7 0 2.7 1 2.8 2.7"/><path d="m6.3 7.4 1.1 10a1.6 1.6 0 0 0 1.6 1.4h6a1.6 1.6 0 0 0 1.6-1.4l1.1-10"/><path d="M10 11v4.3M14 11v4.3"/><circle cx="9" cy="20.7" r="1.1"/><circle cx="15" cy="20.7" r="1.1"/></symbol>'
  + '<symbol id="i-user" viewBox="0 0 24 24"><circle cx="12" cy="8.5" r="3.5"/><path d="M5 20c.7-3.7 3.4-5.5 7-5.5s6.3 1.8 7 5.5"/></symbol>'
  + '<symbol id="i-check" viewBox="0 0 24 24"><path d="m5.5 12.5 4.2 4.2 8.8-9.2"/></symbol>'
  + '<symbol id="i-plus" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></symbol>'
  + '<symbol id="i-paste" viewBox="0 0 24 24"><rect x="5" y="5" width="14" height="15.5" rx="3"/><path d="M9 5V3.8a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1V5"/><path d="M8.5 11.5h7M8.5 15h4.5"/></symbol>'
  + '<symbol id="i-trash" viewBox="0 0 24 24"><path d="M4.5 7h15M10 7V4.8h4V7M6.8 7l.8 12.2h8.8L17.2 7M10.4 11v5.2M13.6 11v5.2"/></symbol>'
  + '<symbol id="i-link" viewBox="0 0 24 24"><path d="M10 14a3.8 3.8 0 0 0 5.4 0l3-3a3.8 3.8 0 0 0-5.4-5.4l-.9.9"/><path d="M14 10a3.8 3.8 0 0 0-5.4 0l-3 3a3.8 3.8 0 0 0 5.4 5.4l.9-.9"/></symbol>'
  + '<symbol id="i-prev" viewBox="0 0 24 24"><path d="M14.5 6l-6 6 6 6"/></symbol>'
  + '<symbol id="i-next" viewBox="0 0 24 24"><path d="M9.5 6l6 6-6 6"/></symbol>'
  + '<symbol id="i-x" viewBox="0 0 24 24"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/></symbol>'
  + '<symbol id="i-palm" viewBox="0 0 24 24"><path d="M11.4 21.2c.1-4.3.8-7.6 2.3-10.7"/><path d="M13.7 10.5C12.2 6.9 8.9 5.3 4.8 6.2"/><path d="M13.7 10.5C10.9 9.4 7.5 10.2 5.4 12.8"/><path d="M13.7 10.5c.6-3.5-.2-5.8-2-7.3"/><path d="M13.7 10.5c1.8-4 5.1-4.9 7.6-3.1"/><path d="M13.7 10.5c2.6-.8 5.7.3 7 3"/><path d="M8 21.2h8.2"/></symbol>'
  + '<symbol id="i-loop" viewBox="0 0 28 28"><path d="' + LOOP_D + '"/></symbol>'
  + '<symbol id="i-coin" viewBox="0 0 14 14"><circle cx="7" cy="7" r="6.2" fill="#E3A72F" stroke="#B67C12" stroke-width="1.1"/><circle cx="7" cy="7" r="3.1" fill="none" stroke="#B67C12" stroke-width=".9" opacity=".55"/></symbol>'
  + '</defs></svg>';

// the sprite goes into the page as soon as this module is loaded, so every later icon finds its symbol
if (typeof document !== 'undefined' && document.body && !document.getElementById('nest-sprite')) document.body.insertAdjacentHTML('afterbegin', SPRITE);
