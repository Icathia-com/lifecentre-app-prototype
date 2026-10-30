// The Bible platform's app key lives only in the Apps Script project (a Script Property). This fails if the header name, or anything
// shaped like the key, turns up in any other file, and if the platform's name turns up in the app itself.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1').replace(/%20/g, ' ');
const SKIP = new Set(['node_modules', '.git', 'apps-script']); // the Apps Script folder is where the key is read
const SKIP_FILES = /\.(png|jpe?g|webp|ico|woff2?|zip|apk|aab|keystore|jks)$|firestore-debug\.log$|\.patch$/i;

const HEADER = new RegExp(['X-YVP', 'App-Key'].join('-'), 'i');
// A long token assigned to, or quoted next to, something called an app key, YVP or the platform's name.
const KEY_SHAPED = /(?:app[-_ ]?key|yv_app_key|yvp|youversion)[^\n]{0,40}[:=]\s*['"]?[A-Za-z0-9_-]{24,}/i;
const PROPERTY_VALUE = /YV_APP_KEY['"]?\s*[,:=]\s*['"][^'"\s]{8,}['"]/;

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const path = join(dir, name);
    const st = statSync(path);
    if (st.isDirectory()) yield* walk(path);
    else if (st.size < 2_000_000 && !SKIP_FILES.test(name)) yield path;
  }
}
const rel = (p) => relative(ROOT, p).split(sep).join('/');

describe('the Bible platform key', () => {
  it('is not in any file outside the Apps Script folder', () => {
    const hits = [];
    for (const file of walk(ROOT)) {
      if (rel(file) === 'app/tests/secrets.test.mjs') continue; // this file describes the patterns
      const text = readFileSync(file, 'utf8');
      for (const [label, re] of [['header name', HEADER], ['key-shaped value', KEY_SHAPED], ['property value', PROPERTY_VALUE]]) {
        if (re.test(text)) hits.push(`${rel(file)}: ${label}`);
      }
    }
    assert.deepEqual(hits, []);
  });
  it('would be caught if it were there', () => {
    assert.ok(HEADER.test(`headers: { '${['X-YVP', 'App-Key'].join('-')}': key }`));
    assert.ok(KEY_SHAPED.test("const youversionKey = 'aB3dE5gH7jK9mN1pQ3sT5vW7yZ'"));
    assert.ok(KEY_SHAPED.test('app_key=aB3dE5gH7jK9mN1pQ3sT5vW7yZ12'));
    assert.ok(PROPERTY_VALUE.test("setProperty('YV_APP_KEY', 'abcdef123456')"));
    assert.ok(!KEY_SHAPED.test('const appKeyName = "shortname"'));
    assert.ok(!PROPERTY_VALUE.test("getProperty('YV_APP_KEY')"));
  });
});

describe('the app', () => {
  it('shows no YouVersion name or logo', () => {
    const hits = [];
    for (const file of walk(join(ROOT, 'app'))) {
      if (rel(file).startsWith('app/tests/')) continue;
      if (/youversion|you\s*version|bible\.com/i.test(readFileSync(file, 'utf8'))) hits.push(rel(file));
    }
    assert.deepEqual(hits, []);
  });
});
