// Makes the app icons in app/icons/: node scripts/make-icons.mjs
// If app/icons/icon-bethlehem-prism-white.png exists (the church's white icon), it is drawn in the middle of the app's blue-to-indigo
// background. If it does not, a white "LC" monogram stands in. Run it again after adding the file, then commit the new icons.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const DIR = new URL('../app/icons/', import.meta.url);
const SOURCE = new URL('icon-bethlehem-prism-white.png', DIR);
const EDGE = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe', process.env.BROWSER_PATH].find((p) => p && existsSync(p));
if (!EDGE) throw new Error('No Edge or Chrome found: set BROWSER_PATH');
mkdirSync(DIR, { recursive: true });

const OUTPUTS = [['icon-192.png', 192], ['icon-512.png', 512], ['icon-maskable-512.png', 512], ['apple-touch-icon.png', 180], ['favicon-32.png', 32]];
const source = existsSync(SOURCE) ? `data:image/png;base64,${readFileSync(SOURCE).toString('base64')}` : null;

const browser = await puppeteer.launch({ executablePath: EDGE, headless: true });
const page = await browser.newPage();
for (const [file, size] of OUTPUTS) {
  await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
  // The picture takes about half the width, well inside the circle a phone may crop a maskable icon to.
  await page.setContent(`<body style="margin:0"><div style="width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#5B7B9F 0%,#3558C8 55%,#1B1740 100%);overflow:hidden">${
    source
      ? `<img src="${source}" style="width:${Math.round(size * 0.56)}px;height:${Math.round(size * 0.56)}px;object-fit:contain">`
      : `<span style="font:800 ${Math.round(size * 0.42)}px 'Segoe UI',Arial,sans-serif;letter-spacing:-0.05em;color:#fff">LC</span>`}</div></body>`);
  if (source) await page.evaluate(() => Promise.all([...document.images].map((i) => i.decode())));
  writeFileSync(new URL(file, DIR), await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: size, height: size } }));
  console.log('wrote', file);
}
await browser.close();
