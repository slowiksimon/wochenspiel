#!/usr/bin/env python3
"""Reads the waste plan of Pfaffstätten (GVA Baden, "Abfuhrplan <Jahr>", 4 pages A5) and writes src/muell-data.js.

    python3 tools/muellplan.py Pfaffstaetten_2026_web.pdf src/muell-data.js

Needs pdfplumber and poppler (pdftotext). Pages 2 and 3 hold the year as a table (one column per month, one row per day:
weekday letter, day, codes such as "RM1, AT", "Bio", "GS"); page 4 the 3-weekly paper, the 1100-litre containers and the
streets of the two Restmüll areas. Everything is checked before anything is written: the weekday letter of every row, the
colour of every table cell (grey Restmüll, brown Bio, red paper, yellow sack) against its codes, the holidays (red text),
and every date list for order and plausible rhythm. A plan of another year may be laid out differently: then this script
stops with the problems it found instead of writing wrong dates.
"""
import sys, re, json, datetime as dt, subprocess, collections
import pdfplumber

MONTHS = ['JÄNNER', 'FEBRUAR', 'MÄRZ', 'APRIL', 'MAI', 'JUNI', 'JULI', 'AUGUST', 'SEPTEMBER', 'OKTOBER', 'NOVEMBER', 'DEZEMBER']
WEEKDAY = {'M': {0, 2}, 'D': {1, 3}, 'F': {4}, 'S': {5, 6}}        # the letters are ambiguous (Mo/Mi, Di/Do, Sa/So)
FILL = {'rm': [0.855, 0.855, 0.854], 'bio': [0.748, 0.53, 0.274], 'ap': [0.905, 0.202, 0.194], 'gs': [1.0, 0.931, 0.0]}
FULL = {'Hl. 3 Könige': 'Heilige Drei Könige', 'Christi Himmelf.': 'Christi Himmelfahrt', 'Mariä Himmelf.': 'Mariä Himmelfahrt', 'Mariä Empfäng.': 'Mariä Empfängnis'}
problems = []


def table(pdf, year):
    """pages 2 and 3: day -> labels, red text, filled cells"""
    cells, red, fills = {}, {}, collections.defaultdict(list)
    for pno in (1, 2):
        page = pdf.pages[pno]
        words = page.extract_words(extra_attrs=['non_stroking_color'])
        heads = [w for w in words if w['text'] in MONTHS and 55 < w['top'] < 80]
        if len(heads) != 6:
            sys.exit('page %d: expected 6 month headings, found %s' % (pno + 1, [w['text'] for w in heads]))
        top = max(w['top'] for w in heads) + 4
        foot = min([w['top'] for w in words if w['text'] == 'Abkürzungen:'] or [page.height])
        centers = sorted(((w['x0'] + w['x1']) / 2, MONTHS.index(w['text']) + 1) for w in heads)
        col = lambda x: min(centers, key=lambda c: abs(c[0] - x))[1]
        rows = collections.defaultdict(list)
        for w in words:
            if top < w['top'] < foot - 2:
                x = (w['x0'] + w['x1']) / 2 if len(w['text']) > 3 else w['x0'] + 2
                rows[(col(x), round(w['top']))].append(w)
        for (m, t), ws in sorted(rows.items()):
            ws.sort(key=lambda w: w['x0'])
            txt = [w['text'] for w in ws]
            if len(txt) < 2 or txt[0] not in WEEKDAY or not txt[1].isdigit():
                problems.append('page %d: row not understood: %s' % (pno + 1, txt)); continue
            d = dt.date(year, m, int(txt[1]))
            key = d.isoformat()
            if key in cells: problems.append('%s twice' % key)
            if d.weekday() not in WEEKDAY[txt[0]]: problems.append('%s: weekday letter %s does not fit' % (key, txt[0]))
            cells[key] = {'labels': txt[2:], 'top': t}
            c = ws[0].get('non_stroking_color')
            red[key] = bool(c and len(c) >= 3 and c[0] > 0.6 and c[1] < 0.4)
        for r in page.rects:
            f = r.get('non_stroking_color')
            if not r.get('fill') or f is None or not (top < r['top'] < foot): continue
            m = col((r['x0'] + r['x1']) / 2)
            for key, c in cells.items():
                if int(key[5:7]) == m and r['top'] - 2 <= c['top'] <= r['bottom']:
                    fills[key].append([round(v, 3) for v in f])
    n = (dt.date(year + 1, 1, 1) - dt.date(year, 1, 1)).days
    if len(cells) != n: problems.append('%d days found, the year has %d' % (len(cells), n))
    return cells, red, fills


def streams_of(cells, red, fills):
    s = {k: [] for k in ('rm1', 'rm2', 'at1', 'at2', 'bio', 'gt', 'gs', 'ap')}
    hol = {}
    for key in sorted(cells):
        d = dt.date.fromisoformat(key)
        toks = [t for t in re.split(r'[\s,]+', ' '.join(cells[key]['labels'])) if t]
        codes = [t for t in toks if t in ('RM1', 'RM2', 'RM1+2', 'AT', 'Bio', 'AP', 'GS', 'GT')]
        rest = [t for t in toks if t not in codes]
        if rest:
            name = ' '.join(rest)
            hol[key[5:]] = FULL.get(name, name)
            if not red[key]: problems.append('%s: holiday %r not printed red' % (key, name))
            if codes: problems.append('%s: pickup on a holiday' % key)
        elif red[key] and d.weekday() != 6: problems.append('%s: red without a name' % key)
        if d.weekday() == 6 and not red[key]: problems.append('%s: Sunday not red' % key)
        rm = 0
        for t in codes:
            if t == 'RM1': s['rm1'].append(key); rm = 1
            elif t == 'RM2': s['rm2'].append(key); rm = 2
            elif t == 'RM1+2': s['rm1'].append(key); s['rm2'].append(key); rm = 12
            elif t == 'AT':
                if rm in (1, 2): s['at%d' % rm].append(key)
                else: problems.append('%s: ash bin without its Restmüll area' % key)
            else: s[t.lower()].append(key)
        want = ({'rm'} if any(t.startswith('RM') for t in codes) else set()) | {t.lower() for t in codes if t in ('Bio', 'AP', 'GS')}
        have = {n for n, rgb in FILL.items() if rgb in fills.get(key, [])}
        if want != have: problems.append('%s: codes %s but coloured cells %s' % (key, codes, sorted(have)))
    return s, hol


def page4(path, year):
    txt = subprocess.run(['pdftotext', '-layout', '-f', '4', '-l', '4', path, '-'], capture_output=True, text=True, check=True).stdout
    lines = [l.strip() for l in txt.split('\n')]
    def block(a, b):
        out, on = [], False
        for l in lines:
            if re.search(a, l): on = True; continue
            if on and re.search(b, l): break
            if on and l: out.append(l)
        return out
    def dates(ls):
        return [dt.date(year, int(m), int(d)).isoformat() for d, m in re.findall(r'(\d{1,2})\.(\d{1,2})\.', ' '.join(ls))]
    def streets(ls):
        s = ''
        for l in ls:
            if s.endswith('-'): s = s + l if l[:1].isupper() else s[:-1] + l      # "Kaspar-" + "Gasse" keeps its hyphen, "Schleu-" + "se" not
            else: s = (s + ' ' + l) if s else l
        return [x.strip() for x in s.split(',') if x.strip()]
    return {
        'ap3': dates(block(r'ALTPAPIER 3-wöchig', r'1100-LITER')),
        'c4': dates(block(r'RESTMÜLLCONTAINER 4-wöchig', r'RESTMÜLLCONTAINER 2-wöchig')),
        'c2': dates(block(r'RESTMÜLLCONTAINER 2-wöchig', r'ABFUHRBEREICH 1')),
        'streets1': streets(block(r'ABFUHRBEREICH 1 \(RM1\)', r'ABFUHRBEREICH 2')),
        'streets2': streets(block(r'ABFUHRBEREICH 2 \(RM2\)', r'^$|Gerda|FCC|GmbH')),
    }


def check_rhythm(name, lst, step, slack):
    ds = [dt.date.fromisoformat(k) for k in lst]
    if not ds: problems.append('%s: no dates' % name); return
    if ds != sorted(set(ds)): problems.append('%s: not in order or repeated' % name)
    for a, b in zip(ds, ds[1:]):
        if abs((b - a).days - step) > slack: problems.append('%s: %s to %s is %d days (expected about %d)' % (name, a, b, (b - a).days, step))


def main():
    if len(sys.argv) != 3: sys.exit(__doc__)
    pdf_path, out = sys.argv[1], sys.argv[2]
    pdf = pdfplumber.open(pdf_path)
    head = ' '.join(w['text'] for w in pdf.pages[1].extract_words()[:80])
    m = re.search(r'ABFUHRPLAN (\d{4})', head)
    if not m: sys.exit('no "ABFUHRPLAN <year>" on page 2')
    year = int(m.group(1))
    cells, red, fills = table(pdf, year)
    s, hol = streams_of(cells, red, fills)
    p4 = page4(pdf_path, year)
    for k, step, slack in (('rm1', 28, 3), ('rm2', 28, 3), ('gs', 42, 3), ('ap', 63, 3), ('gt', 14, 2), ('ap3', 21, 2), ('c4', 28, 0), ('c2', 14, 0)):
        check_rhythm(k, s.get(k) or p4.get(k), step, slack)
    bio = [dt.date.fromisoformat(k) for k in s['bio']]
    if any(not 4 <= (b - a).days <= 15 for a, b in zip(bio, bio[1:])): problems.append('bio: a gap outside 1 to 2 weeks')
    if not set(s['at1']) <= set(s['rm1']) or not set(s['at2']) <= set(s['rm2']): problems.append('ash bin dates without Restmüll')
    if len(p4['streets1']) < 20 or len(p4['streets2']) < 3 or set(p4['streets1']) & set(p4['streets2']): problems.append('street lists look wrong')
    if problems:
        print('NOT written, %d problems:' % len(problems)); print('\n'.join('  ' + p for p in problems)); sys.exit(1)

    md = lambda lst: [k[5:] for k in lst]
    def arr(lst, per=12):
        rows = [', '.join("'" + x + "'" for x in lst[i:i + per]) for i in range(0, len(lst), per)]
        return '[\n    ' + ',\n    '.join(rows) + '\n  ]' if len(rows) > 1 else '[' + (rows[0] if rows else '') + ']'
    def sarr(lst):
        return '[\n    ' + ',\n    '.join(', '.join("'" + x + "'" for x in lst[i:i + 6]) for i in range(0, len(lst), 6)) + '\n  ]'
    js = f"""// Abfuhrplan {year} für Pfaffstätten (GVA Baden, „Amtliche Mitteilung“), Seiten 2 bis 4.
// Every list holds the pickup days as "MM-DD". Taken from the PDF by tools/muellplan.py and checked there: the weekday
// letter of every row, the colour of every table cell, and the rhythm of every kind of bin (each break in a rhythm lies
// on a public holiday). Dates that break a rhythm without a holiday (3-weekly paper on two Tuesdays) are kept as printed.
export const PLAN = {{
  year: {year},
  town: 'Pfaffstätten',
  source: 'Abfuhrplan {year} des GVA Baden',
  // Restmüll, area 1 and area 2 (a day can hold both); the ash bin goes with the Restmüll of its area in the heating months
  rm1: {arr(md(s['rm1']))},
  rm2: {arr(md(s['rm2']))},
  at1: {arr(md(s['at1']))},
  at2: {arr(md(s['at2']))},
  bio: {arr(md(s['bio']))},
  gt: {arr(md(s['gt']))},
  gs: {arr(md(s['gs']))},
  ap: {arr(md(s['ap']))},
  // housing estates and rented bins: paper every 3 weeks; 1100-litre Restmüll containers every 4 or every 2 weeks
  ap3: {arr(md(p4['ap3']))},
  c4: {arr(md(p4['c4']))},
  c2: {arr(md(p4['c2']))},
  holidays: {{
    {(',' + chr(10) + '    ').join("'" + k + "': '" + v + "'" for k, v in sorted(hol.items()))}
  }},
  // the streets of the two Restmüll areas, as the plan lists them
  streets1: {sarr(p4['streets1'])},
  streets2: {sarr(p4['streets2'])}
}};
"""
    open(out, 'w', encoding='utf-8').write(js)
    print('written %s: %d pickup days, %d holidays, %d + %d streets' % (out, len({k for v in s.values() for k in v}), len(hol), len(p4['streets1']), len(p4['streets2'])))


if __name__ == '__main__':
    main()
