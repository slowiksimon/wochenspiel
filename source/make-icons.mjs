// Renders assets/icon.svg to the PNG sizes the app needs. Each size is rendered at 4x with the headless Chromium of the tests and
// scaled down with ImageMagick (Lanczos), which gives clean edges. All icons are full-bleed squares without transparency: the phone
// applies its own mask (rounded square on iOS, circle or squircle on Android); the artwork stays inside the maskable safe zone.
import puppeteer from 'puppeteer-core';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const svg = fs.readFileSync(path.join(here, 'assets/icon.svg'), 'utf8');
const browser = await puppeteer.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium', headless: true, args: ['--no-sandbox', '--disable-gpu'] });
const out = path.join(here, 'assets');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'icons-'));
for (const [name, size] of [['icon-512.png', 512], ['icon-maskable-512.png', 512], ['icon-192.png', 192], ['apple-touch-icon.png', 180]]) {
  const page = await browser.newPage();
  await page.setViewport({ width: size, height: size, deviceScaleFactor: 4 });
  await page.setContent('<!doctype html><body style="margin:0;background:#F0C25A"><img style="display:block" width="' + size + '" height="' + size + '" src="data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64') + '"></body>');
  await page.evaluate(() => Promise.all(Array.from(document.images).map(i => i.decode())));
  const big = path.join(tmp, name);
  await page.screenshot({ path: big, type: 'png', clip: { x: 0, y: 0, width: size, height: size } });
  await page.close();
  execFileSync('convert', [big, '-filter', 'Lanczos', '-resize', size + 'x' + size, '-alpha', 'off', '-strip', '-define', 'png:compression-level=9', 'PNG24:' + path.join(out, name)]);
}
await browser.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log(fs.readdirSync(out).map(f => f + ' ' + fs.statSync(path.join(out, f)).size).join('\n'));
