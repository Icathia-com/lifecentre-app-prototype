// The "Add to Home Screen" pieces: the web app manifest, the icons, the page's links and the service worker's file list.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const APP = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1').replace(/%20/g, ' ');
const read = (file) => readFileSync(join(APP, file), 'utf8');
const manifest = JSON.parse(read('manifest.webmanifest'));
const pngSize = (file) => { const b = readFileSync(join(APP, file)); assert.equal(b.toString('latin1', 1, 4), 'PNG', `${file} is a PNG`); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };
const files = (dir, ext) => readdirSync(join(APP, dir), { recursive: true }).filter((f) => f.endsWith(ext)).map((f) => `${dir}/${f.replace(/\\/g, '/')}`).sort();

describe('web app manifest', () => {
  it('names the app, opens it standalone from its own folder, and sets the theme colour', () => {
    assert.equal(manifest.name, 'Life Centre');
    assert.ok(manifest.short_name.length <= 12);
    assert.equal(manifest.display, 'standalone');
    assert.equal(manifest.start_url, './');
    assert.equal(manifest.scope, './');
    assert.match(manifest.theme_color, /^#[0-9A-Fa-f]{6}$/);
    assert.match(manifest.background_color, /^#[0-9A-Fa-f]{6}$/);
    assert.match(read('index.html'), new RegExp(`<meta name="theme-color" content="${manifest.theme_color}">`));
  });
  it('lists real icons of the sizes it claims, including a maskable one', () => {
    for (const icon of manifest.icons) {
      const [w, h] = pngSize(icon.src);
      assert.equal(`${w}x${h}`, icon.sizes, icon.src);
    }
    assert.ok(manifest.icons.some((i) => i.sizes === '192x192' && i.purpose === 'any'));
    assert.ok(manifest.icons.some((i) => i.sizes === '512x512' && i.purpose === 'any'));
    assert.ok(manifest.icons.some((i) => i.sizes === '512x512' && i.purpose === 'maskable'));
  });
});

describe('the page', () => {
  const html = read('index.html');
  it('links the manifest, a favicon and a home screen icon that exist', () => {
    assert.match(html, /<link rel="manifest" href="manifest\.webmanifest">/);
    const favicon = html.match(/<link rel="icon"[^>]*href="([^"]+)"/)?.[1];
    const touch = html.match(/<link rel="apple-touch-icon" href="([^"]+)"/)?.[1];
    assert.deepEqual(pngSize(favicon), [32, 32]);
    assert.deepEqual(pngSize(touch), [180, 180]);
  });
});

describe('the service worker', () => {
  const source = read('sw.js');
  const shell = new Function(`return ${source.match(/const SHELL = (\[[\s\S]*?\]);/)[1]}`)();
  it('keeps every screen, style, script and icon the app needs, and each of them exists', () => {
    const needed = ['index.html', 'manifest.webmanifest', ...files('css', '.css'), ...files('js', '.js'), ...files('icons', '.png').filter((f) => f !== 'icons/icon-bethlehem-prism-white.png')]; // that one is only the source scripts/make-icons.mjs draws the others from
    for (const file of needed) assert.ok(shell.includes(file), `${file} is missing from SHELL in sw.js`);
    for (const file of shell) if (file !== './') assert.ok(statSync(join(APP, file)).isFile(), `${file} is in SHELL but does not exist`);
  });
  it('is only for code and fonts: it never mentions the database, sign-in, the booking system or video', () => {
    for (const word of ['firestore.googleapis', 'identitytoolkit', 'securetoken', 'script.google.com', 'youtube.com', 'youtube-nocookie', 'ytimg']) assert.ok(!source.includes(word), word);
    assert.match(source, /if \(request\.method !== 'GET'\) return;/);
  });
  it('only saves the Firebase code it was told about, not Firestore data', () => {
    const hosts = [...source.matchAll(/SHELL_HOSTS = \[([^\]]+)\]/g)][0][1];
    assert.ok(hosts.includes('gstatic\\.com\\/firebasejs'));
    assert.ok(!/googleapis\\\.com\\\/(?!\/)/.test(hosts.replace('fonts\\.googleapis', '')), 'no other googleapis host');
  });
});
