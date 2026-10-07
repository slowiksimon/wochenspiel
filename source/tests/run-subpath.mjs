// The app as GitHub Pages serves it: under /wochenspiel/ instead of the site root. Everything must use relative paths.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { netState, launch, phone, reporter, sleep, text, overlayText, overlayOpen, waitFor, waitText, tapLabel, setValue, net, CONFIG_TEXT } from './e2e-lib.mjs';
import { startServer } from './fake-server.mjs';
import * as C from '../src/codec.js';
const here = path.dirname(fileURLToPath(import.meta.url));
const server = await startServer({ dir: path.resolve(here, '../dist-fake'), prefix: '/wochenspiel' });
net.api = server.apiUrl;
const { check, done } = reporter();
const browser = await launch();
const URL0 = server.url;                       // http://127.0.0.1:PORT/wochenspiel/
const tiles = p => p.evaluate(() => document.querySelectorAll('#days .tile').length);

const A = await phone(browser, URL0);
await A.page.goto(URL0, { waitUntil: 'load' });
await waitText(A.page, /Willkommen/);
const assets = await A.page.evaluate(async () => {
  const out = {};
  const man = document.querySelector('link[rel="manifest"]').href;
  out.manifestUrl = man;
  const m = await fetch(man).then(r => r.json());
  out.start = new URL(m.start_url, man).href; out.scope = new URL(m.scope, man).href; out.hasId = 'id' in m;
  out.icons = await Promise.all(m.icons.map(i => fetch(new URL(i.src, man)).then(r => r.status)));
  out.touch = await fetch(document.querySelector('link[rel="apple-touch-icon"]').href).then(r => r.status);
  const reg = await navigator.serviceWorker.ready;
  out.swScope = reg.scope;
  return out;
});
check('manifest, icons and apple-touch-icon load under the sub-path', assets.manifestUrl === URL0 + 'manifest.json' && assets.icons.every(s => s === 200) && assets.touch === 200, JSON.stringify(assets));
check('start_url and scope stay inside the sub-path', assets.start === URL0 && assets.scope === URL0, assets.start + ' ' + assets.scope);
check('service worker scope is the sub-path', assets.swScope === URL0, assets.swScope);
check('the manifest has no "id" (a relative one would be shared by every repository on the same github.io address)', assets.hasId === false);
const cacheNames = await A.page.evaluate(() => caches.keys());
check('the cache is named after the sub-path, so another copy of the app on the same address never shares it', cacheNames.length === 1 && cacheNames[0].startsWith('wochenspiel:/wochenspiel/:'), cacheNames.join());

await tapLabel(A.page, 'Neu einrichten');
for (let i = 0; i < 4; i++) await tapLabel(A.page, 'Weiter');
await setValue(A.page, '#ws-cfg', CONFIG_TEXT()); await setValue(A.page, '#ws-a', 'Simon'); await setValue(A.page, '#ws-b', 'Anna');
await tapLabel(A.page, 'Verbindung testen');
await waitText(A.page, /Geschafft/, 10000);
const link = await A.page.evaluate(() => document.querySelector('#ws input[readonly]').value);
check('invite link points into the sub-path', link.startsWith(URL0 + '#j='), link.slice(0, 80));
await tapLabel(A.page, 'Weiter');
await sleep(400);
check('game runs under the sub-path', (await tiles(A.page)) > 3);

const B = await phone(browser, URL0);
await B.page.goto(link, { waitUntil: 'load' });
await waitFor(async () => !(await overlayOpen(B.page)) && (await tiles(B.page)) > 3, 8000);
check('second phone joins from the sub-path link', (await tiles(B.page)) > 3);
await B.page.evaluate(() => navigator.serviceWorker.ready);
await netState(B, 'offline');
await B.page.reload({ waitUntil: 'load' });
await waitFor(async () => (await tiles(B.page)) > 3, 8000);
check('offline reload works under the sub-path', (await tiles(B.page)) > 3 && !(await overlayOpen(B.page)));
await netState(B, 'online');
const unexpected = e => !/ERR_INTERNET_DISCONNECTED/.test(e);
check('no errors', A.errors.filter(unexpected).length === 0 && B.errors.filter(unexpected).length === 0, A.errors.concat(B.errors).filter(unexpected).join('|'));
await browser.close(); await server.close();
process.exitCode = done() ? 1 : 0;
