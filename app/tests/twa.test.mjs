// The Android app settings (android/twa-manifest.json) must agree with the web app, and no signing key may be in git.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const root = new URL('../../', import.meta.url);
const json = (path) => JSON.parse(readFileSync(new URL(path, root), 'utf8'));
const twa = json('android/twa-manifest.json');
const web = json('app/manifest.webmanifest');
const LIVE = 'https://icathia.com/lifecentre-app-prototype/app/';

describe('Android app settings', () => {
  it('open the live web app from its own folder, with the package name the church chose', () => {
    assert.equal(twa.packageId, 'sg.lifecentre.app');
    assert.equal(twa.host, 'icathia.com');
    assert.equal(twa.startUrl, '/lifecentre-app-prototype/app/');
    assert.equal(twa.fullScopeUrl, LIVE);
    assert.equal(twa.webManifestUrl, `${LIVE}manifest.webmanifest`);
  });
  it('match the web app name and colours, and use icons that exist', () => {
    assert.equal(twa.name, web.name);
    assert.equal(twa.launcherName, web.short_name);
    assert.equal(twa.themeColor, web.theme_color);
    assert.equal(twa.backgroundColor, web.background_color);
    for (const url of [twa.iconUrl, twa.maskableIconUrl]) {
      assert.ok(url.startsWith(LIVE), url);
      assert.ok(existsSync(new URL(`app/${url.slice(LIVE.length)}`, root)), `${url} exists in app/`);
    }
  });
  it('point the signing key at a file that is kept out of git, and the link file template has no real fingerprint yet', () => {
    assert.equal(twa.signingKey.path, './android.keystore');
    const tracked = execFileSync('git', ['ls-files', 'android'], { cwd: root, encoding: 'utf8' });
    assert.doesNotMatch(tracked, /\.(keystore|jks|p12|apk|aab)$/m);
    const links = json('android/assetlinks.template.json');
    assert.equal(links[0].target.package_name, twa.packageId);
    assert.match(links[0].target.sha256_cert_fingerprints[0], /^REPLACE_WITH/);
  });
});
