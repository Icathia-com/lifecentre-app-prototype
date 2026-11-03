// The upload Worker, run in Node with the fetches and the bucket faked: tokens, permissions, limits, what lands in the bucket, CORS.
import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import worker, { handle, verifyFirebaseToken, resetKeyCache, b64url, MAX_BYTES, TOO_BIG } from '../uploads/src/index.js';

const PROJECT = 'lifecentre-app';
const NOW = Date.parse('2026-11-03T06:00:00Z');
const baseEnv = { FIREBASE_PROJECT_ID: PROJECT, BUCKET_NAME: 'lifecentre-uploads', PUBLIC_BASE_URL: 'https://pub-test.r2.dev/', ALLOWED_ORIGINS: 'https://icathia.com,http://localhost:8000' };

// A Google-style signing key, made fresh for the test run, and tokens signed with it.
let keyPair; let jwk;
before(async () => {
  keyPair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  jwk = { ...(await crypto.subtle.exportKey('jwk', keyPair.publicKey)), kid: 'k1', use: 'sig', alg: 'RS256' };
  delete jwk.key_ops; delete jwk.ext;
});
const enc = (o) => b64url(new TextEncoder().encode(JSON.stringify(o)));
async function token(claims = {}, { kid = 'k1', key } = {}) {
  const now = Math.floor(NOW / 1000);
  const body = { aud: PROJECT, iss: `https://securetoken.google.com/${PROJECT}`, sub: 'uid1', email: 'staff@lifecentre.sg', email_verified: true, iat: now - 60, exp: now + 3000, ...claims };
  const signingInput = `${enc({ alg: 'RS256', kid, typ: 'JWT' })}.${enc(body)}`;
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key ?? keyPair.privateKey, new TextEncoder().encode(signingInput));
  return `${signingInput}.${b64url(new Uint8Array(sig))}`;
}

// Fakes Google's keys and the staff list; records every call.
function fakeIo({ staff = {}, keys } = {}) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).includes('/service_accounts/v1/jwk/')) return new Response(JSON.stringify({ keys: keys ?? [jwk] }), { headers: { 'Cache-Control': 'max-age=3600' } });
    const m = /documents\/staff\/([^?]+)$/.exec(String(url));
    if (m) {
      const entry = staff[decodeURIComponent(m[1])];
      if (!entry) return new Response('{}', { status: 404 });
      const fields = { role: { stringValue: entry.role } };
      if (entry.postStories) fields.postStories = { booleanValue: true };
      return new Response(JSON.stringify({ fields }));
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  return { fetch, now: () => NOW, random: () => 'uuid-1', calls };
}
// A fake bucket binding: remembers what was put.
function fakeBucket() {
  const objects = [];
  return { objects, put: async (key, value, options) => { objects.push({ key, bytes: value.length, contentType: options?.httpMetadata?.contentType }); return { key, size: value.length }; } };
}
const envWith = (bucket) => ({ ...baseEnv, UPLOADS: bucket });
// An upload request: the file as the body, the kind and size in the query, the type in the header.
const post = ({ kind = 'popups', contentType = 'image/jpeg', size, body, auth, origin = 'https://icathia.com', query } = {}) => {
  const bytes = body ?? new Uint8Array(size ?? 1000);
  const q = query ?? `kind=${encodeURIComponent(kind)}&size=${size ?? bytes.length}`;
  return new Request(`https://w.test/upload?${q}`, { method: 'POST', headers: { 'Content-Type': contentType, Origin: origin, ...(auth ? { Authorization: `Bearer ${auth}` } : {}) }, body: bytes });
};

beforeEach(resetKeyCache);

describe('checking the sign-in', () => {
  it('accepts a token signed with the published key for this project', async () => {
    const claims = await verifyFirebaseToken(await token(), PROJECT, fakeIo());
    assert.equal(claims.email, 'staff@lifecentre.sg');
  });
  it('refuses a token for another project, an expired one, an unverified email, an unknown key and a forged signature', async () => {
    const io = fakeIo();
    await assert.rejects(verifyFirebaseToken(await token({ aud: 'other-app' }), PROJECT, io), /wrong project/);
    await assert.rejects(verifyFirebaseToken(await token({ iss: 'https://securetoken.google.com/other' }), PROJECT, io), /wrong project/);
    await assert.rejects(verifyFirebaseToken(await token({ exp: Math.floor(NOW / 1000) - 1 }), PROJECT, io), /expired/);
    await assert.rejects(verifyFirebaseToken(await token({ email_verified: false }), PROJECT, io), /verified/);
    await assert.rejects(verifyFirebaseToken(await token({}, { kid: 'k9' }), PROJECT, io), /unknown key/);
    const other = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
    await assert.rejects(verifyFirebaseToken(await token({}, { key: other.privateKey }), PROJECT, io), /bad signature/);
    await assert.rejects(verifyFirebaseToken('abc', PROJECT, io), /not a token/);
  });
});

describe('POST /upload', () => {
  it('puts a staff member\'s pop-up banner in the bucket under popups/, with its type, and answers with a public address', async () => {
    const io = fakeIo({ staff: { 'staff@lifecentre.sg': { role: 'staff' } } });
    const bucket = fakeBucket();
    const res = await handle(post({ kind: 'popups', contentType: 'image/jpeg', size: 240000, auth: await token() }), envWith(bucket), io);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://icathia.com');
    assert.deepEqual(await res.json(), { key: 'popups/2026/11/uuid-1.jpg', publicUrl: 'https://pub-test.r2.dev/popups/2026/11/uuid-1.jpg', bytes: 240000 });
    assert.deepEqual(bucket.objects, [{ key: 'popups/2026/11/uuid-1.jpg', bytes: 240000, contentType: 'image/jpeg' }]);
    // the staff list was read with the caller's own token
    const staffCall = io.calls.find((c) => c.url.includes('/documents/staff/'));
    assert.match(staffCall.url, /staff\/staff%40lifecentre\.sg$/);
    assert.match(staffCall.init.headers.Authorization, /^Bearer ey/);
  });
  it('lets admins, and people with "Can post stories", upload stories; plain staff cannot; anyone on the list uploads a profile photo', async () => {
    const io = fakeIo({ staff: { 'staff@lifecentre.sg': { role: 'staff' }, 'admin@lifecentre.sg': { role: 'admin' }, 'leader@lifecentre.sg': { role: 'leader', postStories: true } } });
    const bucket = fakeBucket();
    const ask = async (email) => (await handle(post({ kind: 'stories', contentType: 'video/mp4', size: 5000, auth: await token({ email }) }), envWith(bucket), io)).status;
    assert.equal(await ask('admin@lifecentre.sg'), 200);
    assert.equal(await ask('leader@lifecentre.sg'), 200);
    assert.equal(await ask('staff@lifecentre.sg'), 403);
    const leaderPopup = await handle(post({ kind: 'popups', size: 1000, auth: await token({ email: 'leader@lifecentre.sg' }) }), envWith(bucket), io);
    assert.equal(leaderPopup.status, 403, 'a leader cannot upload pop-up banners');
    const avatar = await handle(post({ kind: 'avatars', size: 1000, auth: await token({ email: 'staff@lifecentre.sg' }) }), envWith(bucket), io);
    assert.equal(avatar.status, 200);
    assert.deepEqual(bucket.objects.map((o) => o.key.split('/')[0]), ['stories', 'stories', 'avatars'], 'nothing refused reached the bucket');
  });
  it('keeps a recording whose type carries codec details under the plain type', async () => {
    const io = fakeIo({ staff: { 'admin@lifecentre.sg': { role: 'admin' } } });
    const bucket = fakeBucket();
    const res = await handle(post({ kind: 'stories', contentType: 'video/webm;codecs=vp9,opus', size: 5000, auth: await token({ email: 'admin@lifecentre.sg' }) }), envWith(bucket), io);
    assert.equal(res.status, 200);
    assert.match((await res.json()).key, /\.webm$/);
    const voice = await handle(post({ kind: 'stories', contentType: 'audio/webm;codecs=opus', size: 5000, auth: await token({ email: 'admin@lifecentre.sg' }) }), envWith(bucket), io);
    assert.match((await voice.json()).key, /\.weba$/);
    assert.deepEqual(bucket.objects.map((o) => o.contentType), ['video/webm', 'audio/webm']);
  });
  it('is not fooled by names from the prototype chain, and reports a keys outage as a retry, not a sign-in problem', async () => {
    const io = fakeIo({ staff: { 'leader@lifecentre.sg': { role: 'leader' } } });
    const bucket = fakeBucket();
    const leader = await token({ email: 'leader@lifecentre.sg' });
    for (const kind of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      assert.equal((await handle(post({ kind, contentType: 'video/mp4', size: 10, auth: leader }), envWith(bucket), io)).status, 400, kind);
    }
    assert.equal((await handle(post({ kind: 'avatars', contentType: 'constructor', size: 10, auth: leader }), envWith(bucket), io)).status, 415);
    resetKeyCache();
    const down = { ...io, fetch: async (url, init) => (String(url).includes('/jwk/') ? new Response('nope', { status: 502 }) : io.fetch(url, init)) };
    const res = await handle(post({ kind: 'avatars', size: 10, auth: leader }), envWith(bucket), down);
    assert.deepEqual([res.status, (await res.json()).error], [503, 'Please try again in a moment.']);
    assert.deepEqual(bucket.objects, []);
  });
  it('refuses no sign-in, a bad token, someone not on the staff list, files over 60 MB, a short or empty file, unknown types and unknown kinds', async () => {
    const io = fakeIo({ staff: { 'staff@lifecentre.sg': { role: 'staff' } } });
    const bucket = fakeBucket();
    const status = async (opts) => (await handle(post(opts), envWith(bucket), io)).status;
    assert.equal(await status({ size: 1 }), 401);
    assert.equal(await status({ size: 1, auth: 'not.a.token' }), 401);
    assert.equal(await status({ size: 1, auth: await token({ email: 'visitor@example.com' }) }), 403);
    assert.equal(await status({ size: MAX_BYTES + 1, body: new Uint8Array(0), auth: await token() }), 413, 'refused from the stated size, before anything is read');
    assert.equal(await status({ size: MAX_BYTES, body: new Uint8Array(MAX_BYTES), auth: await token() }), 200, 'exactly 60 MB is fine');
    assert.equal(await status({ contentType: 'application/zip', size: 1, auth: await token() }), 415);
    assert.equal(await status({ kind: 'backups', size: 1, auth: await token() }), 400);
    assert.equal(await status({ query: 'kind=popups&size=-4', body: new Uint8Array(4), auth: await token() }), 400);
    assert.equal(await status({ query: 'kind=popups', body: new Uint8Array(4), auth: await token() }), 400, 'the size must be stated');
    assert.equal(await status({ size: 10, body: new Uint8Array(6), auth: await token() }), 400, 'a file that did not arrive whole');
    assert.equal(await status({ size: 1, body: new Uint8Array(0), auth: await token() }), 400, 'an empty file');
    const r = await handle(post({ size: MAX_BYTES + 1, body: new Uint8Array(0), auth: await token() }), envWith(bucket), io);
    assert.deepEqual(await r.json(), { error: TOO_BIG });
    assert.equal(bucket.objects.length, 1, 'only the 60 MB file reached the bucket');
  });
  it('answers CORS preflights for the app, gives other sites nothing, and has no schedule', async () => {
    const pre = await handle(new Request('https://w.test/upload', { method: 'OPTIONS', headers: { Origin: 'https://icathia.com' } }), envWith(fakeBucket()), fakeIo());
    assert.equal(pre.status, 204);
    assert.equal(pre.headers.get('Access-Control-Allow-Headers'), 'Authorization, Content-Type');
    const other = await handle(post({ origin: 'https://evil.example' }), envWith(fakeBucket()), fakeIo());
    assert.equal(other.headers.get('Access-Control-Allow-Origin'), null);
    assert.equal((await handle(new Request('https://w.test/nothing'), envWith(fakeBucket()), fakeIo())).status, 404);
    assert.equal((await handle(new Request('https://w.test/sign', { method: 'POST' }), envWith(fakeBucket()), fakeIo())).status, 404, 'signed addresses are gone');
    assert.equal(await (await handle(new Request('https://w.test/'), envWith(fakeBucket()), fakeIo())).text(), 'ok');
    assert.equal(typeof worker.fetch, 'function');
    assert.equal(worker.scheduled, undefined, 'the clean-up lives in the Apps Script job now');
  });
});
