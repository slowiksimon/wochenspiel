// The calendar files behind "Im Kalender abonnieren" (build.mjs writes them into kalender/). Every pickup day of the plan is
// an all-day event on its day, with an alert at 19:00 the evening before. The phone's calendar fetches the file itself and
// refreshes it, so a new year's plan reaches every phone that has subscribed without anybody doing anything.
// Format: iCalendar (RFC 5545): CRLF line ends, lines folded at 75 octets, commas and semicolons in texts escaped.
import { PLAN, KIND, CAL_BITS, CAL_EXTRA, ALERT_HOUR, calName, schedule, label } from './muell-core.js';

const TRIGGER = '-PT' + (24 - ALERT_HOUR) + 'H';               // the events begin at midnight: 5 hours before is 19:00 the day before
const enc = new TextEncoder();

export const escText = t => String(t).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
// a line longer than 75 octets goes on in lines that start with a space; a UTF-8 character is never cut
export function foldLine(line) {
  const out = [];
  let cur = '', n = 0;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    if (n + b > (out.length ? 74 : 75)) { out.push(cur); cur = ''; n = 0; }
    cur += ch; n += b;
  }
  out.push(cur);
  return out.join('\r\n ');
}
const ymd = key => key.replace(/-/g, '');
const nextDay = key => { const [y, m, d] = key.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1, d + 1)); return t.toISOString().slice(0, 10).replace(/-/g, ''); };

// one calendar: its name, the events (day key -> list of bins), a stable id for the UIDs
export function icsText({ name, desc, events, id, plan = PLAN }) {
  const stamp = (plan.year - 1) + '1201T000000Z';              // fixed, so an unchanged plan gives an unchanged file
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Slowik//Muellkalender//DE', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'X-WR-CALNAME:' + escText(name), 'X-WR-CALDESC:' + escText(desc), 'X-WR-TIMEZONE:Europe/Vienna',
    'REFRESH-INTERVAL;VALUE=DURATION:P1D', 'X-PUBLISHED-TTL:P1D'];
  for (const [key, list] of [...events].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const what = 'Müll: ' + list.map(label).join(', ');
    L.push('BEGIN:VEVENT', 'UID:' + ymd(key) + '-' + id + '@slowik-muell', 'DTSTAMP:' + stamp,
      'DTSTART;VALUE=DATE:' + ymd(key), 'DTEND;VALUE=DATE:' + nextDay(key),
      'SUMMARY:' + escText(what), 'TRANSP:TRANSPARENT',
      'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + escText(what), 'TRIGGER:' + TRIGGER, 'END:VALARM',
      'END:VEVENT');
  }
  L.push('END:VCALENDAR');
  return L.map(foldLine).join('\r\n') + '\r\n';
}

// every calendar file: name -> text
export function allCalendars(plan = PLAN) {
  const files = new Map();
  const desc = (what) => 'Abholtermine aus dem ' + plan.source + ' (' + plan.town + what + '). Hinweis am Vorabend um ' + ALERT_HOUR + ' Uhr. Tonnen und Säcke bis 6 Uhr früh vor dem Haus bereitstellen.';
  for (const area of [1, 2]) {
    for (let code = 1; code < 1 << CAL_BITS.length; code++) {
      const have = Object.fromEntries(Object.keys(KIND).map(k => [k, false]));
      CAL_BITS.forEach((k, i) => { have[k] = !!(code & (1 << i)); });
      const n = calName(area, code);
      const placed = have.rest || have.asche;
      files.set(n, icsText({ name: 'Müllabfuhr', desc: desc(placed ? ', Bereich ' + area : ''), events: schedule({ area, have }, plan), id: n.slice(6), plan }));
    }
  }
  for (const k of CAL_EXTRA) {
    const have = Object.fromEntries(Object.keys(KIND).map(x => [x, x === k]));
    const n = 'muell-' + k;
    files.set(n, icsText({ name: 'Müllabfuhr: ' + KIND[k].sheet, desc: desc(''), events: schedule({ area: 1, have }, plan), id: k, plan }));
  }
  return files;
}
