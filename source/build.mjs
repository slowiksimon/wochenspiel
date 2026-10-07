// Builds the installable web app (index.html + service worker + manifest + icons) into dist/.
//   node build.mjs            production bundle with the real Firebase SDK
//   FAKE=1 node build.mjs     test bundle (dist-fake/) where Firebase is replaced by tests/fake-*.js
//   NOMIN=1 node build.mjs    unminified, for debugging
import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { nestSvg, eggD, DAY, HOT } from './src/nest.js';
import { allCalendars } from './src/muell-ics.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(here, 'src');
const FAKE = process.env.FAKE === '1';
const MIN = process.env.NOMIN !== '1';
const OUT = path.join(here, FAKE ? 'dist-fake' : 'dist');
const read = f => fs.readFileSync(f, 'utf8');
const b64 = f => fs.readFileSync(f).toString('base64');

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

/* 1. the whole app (shell, lists, game) with Firebase and the QR code in one script */
const bundle = await esbuild.build({
  entryPoints: [path.join(SRC, 'entry.js')], bundle: true, minify: MIN, format: 'iife', target: ['es2020'], platform: 'browser',
  write: false, legalComments: 'none', logLevel: 'error', define: { 'process.env.NODE_ENV': '"production"' },
  alias: FAKE ? { 'firebase/app': path.join(here, 'tests/fake-app.js'), 'firebase/firestore': path.join(here, 'tests/fake-firestore.js') } : {}
});
const appJs = bundle.outputFiles[0].text;

/* 2. styles and markup. The lengths of the hand-drawn circles are measured from their paths (see nest.js). */
const fill = t => t.replaceAll('__TL3__', String(DAY.len + 3)).replaceAll('__TL__', String(DAY.len)).replaceAll('__HL3__', String(HOT.len + 3)).replaceAll('__HL__', String(HOT.len));
const css = (await esbuild.transform(fill(['style.css', 'shell.css', 'lists.css', 'muell.css'].map(f => read(path.join(SRC, f))).join('\n')), { minify: MIN, loader: 'css' })).code;
const body = read(path.join(SRC, 'body.html')).replace('__NEST__', nestSvg('', true)).replace('__EGG__', eggD(52, 62));

/* 3. the font, embedded so the app works offline and never calls a font server (Gabarito, variable weight, SIL Open Font License) */
const fontCss = `@font-face{font-family:"Gabarito";font-style:normal;font-weight:400 900;font-display:swap;src:url(data:font/woff2;base64,${b64(path.join(here, 'assets/gabarito-latin-wght-normal.woff2'))}) format("woff2")}`;

/* 4. assemble */
const safe = js => js.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');
const template = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Slowik</title>
<meta name="description" content="Gemeinsame Aufgaben als Spiel: abhaken, verschieben, Münzen sammeln.">
<meta name="ws-build" content="__BUILD__">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#F0C25A" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#241C16" media="(prefers-color-scheme: dark)">
<link rel="manifest" href="manifest.json">
<link rel="icon" type="image/png" sizes="192x192" href="icon-192.png">
<link rel="apple-touch-icon" href="apple-touch-icon.png">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Slowik">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<style>
${fontCss}
${css}
</style>
</head>
<body>
${body}
<script>${safe(appJs)}</script>
</body>
</html>
`;

/* 5. manifest, icons, service worker. The hash of everything that makes up the app is the build id: it is shown in the
      settings, marks the page for the service worker, and names the cache, so an update replaces the old copy.
      (No manifest "id": a relative id would resolve to the site root and be shared by every repository on a github.io address.) */
const manifest = {
  name: 'Slowik', short_name: 'Slowik', description: 'Gemeinsame Aufgaben als Spiel: abhaken, verschieben, Münzen sammeln.',
  lang: 'de', start_url: './', scope: './', display: 'standalone', orientation: 'portrait', background_color: '#F7F3EA', theme_color: '#F0C25A',
  icons: [
    { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
  ]
};
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
for (const f of ['icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png']) fs.copyFileSync(path.join(here, 'assets', f), path.join(OUT, f));
const iconHash = ['icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png'].map(f => fs.readFileSync(path.join(here, 'assets', f)));
const version = crypto.createHash('sha256').update(template).update(JSON.stringify(manifest)).update(Buffer.concat(iconHash)).digest('hex').slice(0, 10);
const html = template.replace('__BUILD__', version);
fs.writeFileSync(path.join(OUT, 'index.html'), html);
fs.writeFileSync(path.join(OUT, 'sw.js'), read(path.join(here, 'src/sw.js')).replace('__VERSION__', version));

/* 6. the waste calendars to subscribe to (see src/muell-ics.js): one file per Restmüll area and set of bins */
fs.mkdirSync(path.join(OUT, 'kalender'));
const cals = allCalendars();
for (const [name, text] of cals) fs.writeFileSync(path.join(OUT, 'kalender', name + '.ics'), text);

const size = fs.statSync(path.join(OUT, 'index.html')).size;
console.log((FAKE ? 'dist-fake' : 'dist') + ': index.html ' + Math.round(size / 1024) + ' KB, version ' + version + ', ' + cals.size + ' calendars');
