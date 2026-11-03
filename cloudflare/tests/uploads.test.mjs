// The upload Worker, run in Node with the fetches faked: tokens, permissions, limits, the signed address, CORS, and the clean-up.
import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import worker, { handle, presignPut, verifyFirebaseToken, deleteExpiredStories, resetKeyCache, b64url, MAX_BYTES } from '../uploads/src/index.js';

const PROJECT = 'lifecentre-app';
const NOW = Date.parse('2026-11-03T06:00:00Z');
const env = {
  FIREBASE_PROJECT_ID: PROJECT, CF_ACCOUNT_ID: 'acct123', BUCKET_NAME: 'lifecentre-uploads', PUBLIC_BASE_URL: 'https://pub-test.r2.dev/',
  ALLOWED_ORIGINS: 'https://icathia.com,http://localhost:8000', R2_ACCESS_KEY_ID: 'r2id', R2_SECRET_ACCESS_KEY: 'r2secret',
};

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
const post = (body, { auth, origin = 'https://icathia.com' } = {}) => new Request('https://w.test/sign', {
  method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, ...(auth ? { Authorization: `Bearer ${auth}` } : {}) }, body: JSON.stringify(body),
});

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

describe('POST /sign', () => {
  it('gives a staff member a signed address for a pop-up banner, under popups/ in the bucket, with a public address to show it from', async () => {
    const io = fakeIo({ staff: { 'staff@lifecentre.sg': { role: 'staff' } } });
    const res = await handle(post({ kind: 'popups', contentType: 'image/jpeg', size: 240000 }, { auth: await token() }), env, io);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://icathia.com');
    const body = await res.json();
    assert.equal(body.key, 'popups/2026/11/uuid-1.jpg');
    assert.equal(body.publicUrl, 'https://pub-test.r2.dev/popups/2026/11/uuid-1.jpg');
    const u = new URL(body.url);
    assert.equal(u.host, 'acct123.r2.cloudflarestorage.com');
    assert.equal(u.pathname, '/lifecentre-uploads/popups/2026/11/uuid-1.jpg');
    assert.equal(u.searchParams.get('X-Amz-Expires'), '600');
    assert.equal(u.searchParams.get('X-Amz-SignedHeaders'), 'content-length;content-type;host');
    assert.equal(u.searchParams.get('X-Amz-Credential'), 'r2id/20261103/auto/s3/aws4_request');
    assert.match(u.searchParams.get('X-Amz-Signature'), /^[0-9a-f]{64}$/);
    assert.equal(body.maxBytes, MAX_BYTES);
    // the staff list was read with the caller's own token
    const staffCall = io.calls.find((c) => c.url.includes('/documents/staff/'));
    assert.match(staffCall.url, /staff\/staff%40lifecentre\.sg$/);
    assert.match(staffCall.init.headers.Authorization, /^Bearer ey/);
  });
  it('lets admins, and people with "Can post stories", upload stories; plain staff cannot', async () => {
    const io = fakeIo({ staff: { 'staff@lifecentre.sg': { role: 'staff' }, 'admin@lifecentre.sg': { role: 'admin' }, 'leader@lifecentre.sg': { role: 'leader', postStories: true } } });
    const ask = async (email) => (await handle(post({ kind: 'stories', contentType: 'video/mp4', size: 5000000 }, { auth: await token({ email }) }), env, io)).status;
    assert.equal(await ask('admin@lifecentre.sg'), 200);
    assert.equal(await ask('leader@lifecentre.sg'), 200);
    assert.equal(await ask('staff@lifecentre.sg'), 403);
    const leaderPopup = await handle(post({ kind: 'popups', contentType: 'image/jpeg', size: 1000 }, { auth: await token({ email: 'leader@lifecentre.sg' }) }), env, io);
    assert.equal(leaderPopup.status, 403, 'a leader cannot upload pop-up banners');
  });
  it('refuses no sign-in, a bad token, someone not on the staff list, files over 60 MB, unknown types and unknown kinds', async () => {
    const io = fakeIo({ staff: { 'staff@lifecentre.sg': { role: 'staff' } } });
    const status = async (body, auth) => (await handle(post(body, auth === undefined ? {} : { auth }), env, io)).status;
    assert.equal(await status({ kind: 'popups', contentType: 'image/jpeg', size: 1 }), 401);
    assert.equal(await status({ kind: 'popups', contentType: 'image/jpeg', size: 1 }, 'not.a.token'), 401);
    assert.equal(await status({ kind: 'popups', contentType: 'image/jpeg', size: 1 }, await token({ email: 'visitor@example.com' })), 403);
    assert.equal(await status({ kind: 'popups', contentType: 'image/jpeg', size: MAX_BYTES + 1 }, await token()), 413);
    assert.equal(await status({ kind: 'popups', contentType: 'image/jpeg', size: MAX_BYTES }, await token()), 200);
    assert.equal(await status({ kind: 'popups', contentType: 'application/zip', size: 1 }, await token()), 415);
    assert.equal(await status({ kind: 'backups', contentType: 'image/jpeg', size: 1 }, await token()), 400);
    assert.equal(await status({ kind: 'popups', contentType: 'image/jpeg', size: -4 }, await token()), 400);
    const r = await handle(post({ kind: 'popups', contentType: 'image/jpeg', size: MAX_BYTES + 1 }, { auth: await token() }), env, io);
    assert.deepEqual(await r.json(), { error: 'That file is over 60 MB. Please choose a smaller one.' });
  });
  it('answers CORS preflights for the app, and gives other sites nothing', async () => {
    const pre = await handle(new Request('https://w.test/sign', { method: 'OPTIONS', headers: { Origin: 'https://icathia.com' } }), env, fakeIo());
    assert.equal(pre.status, 204);
    assert.equal(pre.headers.get('Access-Control-Allow-Headers'), 'Authorization, Content-Type');
    const other = await handle(post({}, { origin: 'https://evil.example' }), env, fakeIo());
    assert.equal(other.headers.get('Access-Control-Allow-Origin'), null);
    assert.equal((await handle(new Request('https://w.test/nothing'), env, fakeIo())).status, 404);
    assert.equal(await (await handle(new Request('https://w.test/'), env, fakeIo())).text(), 'ok');
  });
});

describe('the signed address', () => {
  it('matches the published Signature Version 4 example', async () => {
    // From the AWS documentation, "Authenticating Requests: Using Query Parameters": a GET for test.txt in examplebucket,
    // keys AKIAIOSFODNN7EXAMPLE / wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY, 24 May 2013 00:00:00 UTC, valid for a day.
    const url = await presignPut({
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', host: 'examplebucket.s3.amazonaws.com', path: '/test.txt',
      region: 'us-east-1', expires: 86400, now: Date.parse('2013-05-24T00:00:00Z'), method: 'GET',
    });
    assert.equal(url, 'https://examplebucket.s3.amazonaws.com/test.txt?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404');
  });
  it('encodes the file path and binds the file type and size into the signature', async () => {
    const base = { accessKeyId: 'a', secretAccessKey: 'b', host: 'x.r2.cloudflarestorage.com', path: '/bucket/stories/2026/11/a b(1).mp4', region: 'auto', expires: 600, now: NOW };
    const one = await presignPut({ ...base, headers: { 'content-type': 'video/mp4', 'content-length': '10' } });
    const two = await presignPut({ ...base, headers: { 'content-type': 'video/mp4', 'content-length': '11' } });
    assert.match(one, /\/bucket\/stories\/2026\/11\/a%20b%281%29\.mp4\?/);
    assert.notEqual(new URL(one).searchParams.get('X-Amz-Signature'), new URL(two).searchParams.get('X-Amz-Signature'));
  });
});

describe('the nightly clean-up', () => {
  it('asks Firestore for stories whose expiresAt has passed and deletes them, with a token from the service account', async () => {
    const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
    const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
    const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...pkcs8)).replace(/(.{64})/g, '$1\n')}\n-----END PRIVATE KEY-----\n`;
    const account = { client_email: 'cleaner@lifecentre-app.iam.gserviceaccount.com', private_key: pem, token_uri: 'https://oauth2.googleapis.com/token' };
    const calls = [];
    const io = {
      now: () => NOW,
      fetch: async (url, init) => {
        calls.push({ url: String(url), body: init?.body ? (init.headers['Content-Type'] === 'application/json' ? JSON.parse(init.body) : init.body) : null, auth: init?.headers?.Authorization });
        if (String(url).endsWith('/token')) return new Response(JSON.stringify({ access_token: 'tok-1' }));
        if (String(url).endsWith(':runQuery')) return new Response(JSON.stringify(calls.filter((c) => c.url.endsWith(':runQuery')).length === 1 ? [{ document: { name: 'projects/p/databases/(default)/documents/stories/old1' } }, { document: { name: 'projects/p/databases/(default)/documents/stories/old2' } }] : [{ readTime: 'x' }]));
        if (String(url).endsWith(':commit')) return new Response('{}');
        throw new Error(`unexpected ${url}`);
      },
    };
    const result = await deleteExpiredStories({ ...env, FIREBASE_SERVICE_ACCOUNT: JSON.stringify(account) }, io);
    assert.deepEqual(result, { deleted: 2 });
    const tokenCall = calls.find((c) => c.url.endsWith('/token'));
    assert.match(tokenCall.body, /^grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=ey/);
    const [, claims] = /assertion=([^&]+)/.exec(tokenCall.body)[1].split('.');
    const decoded = JSON.parse(Buffer.from(claims, 'base64url').toString());
    assert.equal(decoded.iss, account.client_email);
    assert.equal(decoded.scope, 'https://www.googleapis.com/auth/datastore');
    const q = calls.find((c) => c.url.endsWith(':runQuery'));
    assert.equal(q.auth, 'Bearer tok-1');
    assert.deepEqual(q.body.structuredQuery.from, [{ collectionId: 'stories' }]);
    assert.deepEqual(q.body.structuredQuery.where.fieldFilter, { field: { fieldPath: 'expiresAt' }, op: 'LESS_THAN', value: { timestampValue: '2026-11-03T06:00:00.000Z' } });
    const commit = calls.find((c) => c.url.endsWith(':commit'));
    assert.deepEqual(commit.body.writes.map((w) => w.delete), ['projects/p/databases/(default)/documents/stories/old1', 'projects/p/databases/(default)/documents/stories/old2']);
  });
  it('does nothing, and says so, when the service account is not set', async () => {
    assert.deepEqual(await deleteExpiredStories(env, { now: () => NOW, fetch: async () => { throw new Error('no'); } }), { deleted: 0 });
  });
  it('is what the Worker runs on its schedule', () => {
    assert.equal(typeof worker.scheduled, 'function');
    assert.equal(typeof worker.fetch, 'function');
  });
});
