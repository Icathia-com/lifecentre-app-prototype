// The upload Worker. Two jobs:
//  1. POST /sign: a signed-in staff member (a Firebase ID token from the app) asks for a short-lived address to upload one file
//     to the church's storage bucket. The Worker checks the token against Google's public keys, checks the caller's own entry on
//     the staff list in Firestore (with the caller's own token, so the rules apply), and signs an S3-style PUT address for the
//     bucket. Files over 60 MB, unknown file types and people without the right permission are refused.
//  2. Once a night (cron): delete story records in Firestore whose expiresAt has passed. The bucket's own lifecycle rule removes
//     the story files two days after upload.
// Secrets come from Cloudflare (wrangler secret put): R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, FIREBASE_SERVICE_ACCOUNT.
// Everything else is in wrangler.toml. The code has no dependencies: it uses the Worker's own crypto and fetch.

export const MAX_BYTES = 60 * 1024 * 1024;
export const URL_SECONDS = 600; // a signed upload address is good for ten minutes
export const TYPES = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov',
  'audio/webm': 'weba', 'audio/mp4': 'm4a', 'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'audio/wav': 'wav',
};
// Who may upload what. A kind is the folder in the bucket.
export const KINDS = {
  popups: (entry) => ['admin', 'staff'].includes(entry.role),
  stories: (entry) => entry.role === 'admin' || entry.postStories === true,
  avatars: (entry) => ['admin', 'staff', 'leader'].includes(entry.role), // a profile photo: anyone on the staff list
};
const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

export default {
  fetch: (request, env) => handle(request, env, { fetch: globalThis.fetch.bind(globalThis), now: () => Date.now(), random: () => crypto.randomUUID() }),
  scheduled: (event, env, ctx) => ctx.waitUntil(deleteExpiredStories(env, { fetch: globalThis.fetch.bind(globalThis), now: () => Date.now() })),
};

// ---- Requests ----

export async function handle(request, env, io) {
  const url = new URL(request.url);
  const cors = corsHeaders(request.headers.get('Origin'), env);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (request.method === 'GET' && url.pathname === '/') return new Response('ok', { headers: cors });
  if (request.method === 'POST' && url.pathname === '/sign') {
    try {
      const body = await sign(request, env, io);
      return json(200, body, cors);
    } catch (err) {
      const status = err.status ?? 500;
      return json(status, { error: status === 500 ? 'Something went wrong.' : err.message }, cors);
    }
  }
  return json(404, { error: 'Not found.' }, cors);
}

const json = (status, body, headers) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const refuse = (status, message) => Object.assign(new Error(message), { status });

export function corsHeaders(origin, env) {
  const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!origin || !allowed.includes(origin)) return {};
  return { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Max-Age': '600', Vary: 'Origin' };
}

export async function sign(request, env, io) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token) throw refuse(401, 'Please sign in with Google first.');
  const claims = await verifyFirebaseToken(token, env.FIREBASE_PROJECT_ID, io).catch(() => { throw refuse(401, 'Please sign in with Google again.'); });
  let body;
  try { body = await request.json(); } catch { throw refuse(400, 'Bad request.'); }
  const { kind, contentType, size } = body || {};
  if (!KINDS[kind]) throw refuse(400, 'Unknown upload kind.');
  if (!TYPES[contentType]) throw refuse(415, 'That type of file cannot be uploaded.');
  if (!Number.isInteger(size) || size <= 0) throw refuse(400, 'Bad file size.');
  if (size > MAX_BYTES) throw refuse(413, 'That file is over 60 MB. Please choose a smaller one.');
  const entry = await staffEntry(claims.email, token, env, io);
  if (!entry) throw refuse(403, 'This account is not on the staff list.');
  if (!KINDS[kind](entry)) throw refuse(403, 'This account is not allowed to upload that.');

  const now = io.now();
  const d = new Date(now);
  const key = `${kind}/${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${io.random()}.${TYPES[contentType]}`;
  const url = await presignPut({
    accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    host: `${env.CF_ACCOUNT_ID}.r2.cloudflarestorage.com`, path: `/${env.BUCKET_NAME}/${key}`, region: 'auto',
    headers: { 'content-type': contentType, 'content-length': String(size) }, expires: URL_SECONDS, now,
  });
  return { url, key, publicUrl: `${String(env.PUBLIC_BASE_URL).replace(/\/$/, '')}/${key}`, expiresIn: URL_SECONDS, maxBytes: MAX_BYTES };
}

// The caller's own staff entry, read with the caller's own token (the security rules let anyone read their own entry).
export async function staffEntry(email, token, env, io) {
  const id = encodeURIComponent(String(email || '').toLowerCase());
  const res = await io.fetch(`https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/staff/${id}`, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 404 || res.status === 403) return null;
  if (!res.ok) throw refuse(502, 'The staff list could not be checked.');
  const docu = await res.json();
  const f = docu.fields || {};
  return { role: f.role?.stringValue ?? null, approvePopups: f.approvePopups?.booleanValue === true, postStories: f.postStories?.booleanValue === true };
}

// ---- Firebase ID tokens: RS256, signed by Google, checked against Google's published keys ----

let jwksCache = { keys: null, until: 0 };

export async function verifyFirebaseToken(token, projectId, io) {
  const [h, p, s] = token.split('.');
  if (!h || !p || !s) throw new Error('not a token');
  const header = JSON.parse(utf8(b64urlDecode(h)));
  const claims = JSON.parse(utf8(b64urlDecode(p)));
  if (header.alg !== 'RS256' || !header.kid) throw new Error('bad header');
  const now = Math.floor(io.now() / 1000);
  if (claims.aud !== projectId || claims.iss !== `https://securetoken.google.com/${projectId}`) throw new Error('wrong project');
  if (typeof claims.exp !== 'number' || claims.exp <= now) throw new Error('expired');
  if (typeof claims.iat !== 'number' || claims.iat > now + 300) throw new Error('not yet valid');
  if (!claims.sub || !claims.email) throw new Error('no account');
  if (claims.email_verified !== true) throw new Error('email not verified');
  const jwk = (await googleKeys(io)).find((k) => k.kid === header.kid);
  if (!jwk) throw new Error('unknown key');
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlDecode(s), new TextEncoder().encode(`${h}.${p}`));
  if (!ok) throw new Error('bad signature');
  return claims;
}

async function googleKeys(io) {
  if (jwksCache.keys && jwksCache.until > io.now()) return jwksCache.keys;
  const res = await io.fetch(JWKS_URL);
  if (!res.ok) throw new Error('keys unavailable');
  const { keys } = await res.json();
  const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get('Cache-Control') || '')?.[1] || 3600);
  jwksCache = { keys, until: io.now() + maxAge * 1000 };
  return keys;
}

export const resetKeyCache = () => { jwksCache = { keys: null, until: 0 }; };

// ---- S3-style signed addresses (AWS Signature Version 4, query parameters), which R2 accepts ----

export async function presignPut({ accessKeyId, secretAccessKey, host, path, region, headers = {}, expires, now, method = 'PUT' }) {
  const d = new Date(now);
  const amzDate = d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const dateStamp = amzDate.slice(0, 8);
  const scope = `${dateStamp}/${region}/s3/aws4_request`;
  const signedHeaders = { host, ...Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v).trim()])) };
  const names = Object.keys(signedHeaders).sort();
  const query = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256', 'X-Amz-Credential': `${accessKeyId}/${scope}`, 'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expires), 'X-Amz-SignedHeaders': names.join(';'),
  };
  const canonicalQuery = Object.keys(query).sort().map((k) => `${rfc3986(k)}=${rfc3986(query[k])}`).join('&');
  const canonicalPath = path.split('/').map(rfc3986).join('/');
  const canonicalRequest = [method, canonicalPath, canonicalQuery, ...names.map((n) => `${n}:${signedHeaders[n]}`), '', names.join(';'), 'UNSIGNED-PAYLOAD'].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, hex(await sha256(canonicalRequest))].join('\n');
  let key = await hmac(new TextEncoder().encode(`AWS4${secretAccessKey}`), dateStamp);
  for (const part of [region, 's3', 'aws4_request']) key = await hmac(key, part);
  const signature = hex(await hmac(key, stringToSign));
  return `https://${host}${canonicalPath}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

const rfc3986 = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const sha256 = (text) => crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
async function hmac(keyBytes, text) {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text));
}
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

// ---- The nightly clean-up: story records whose time is up ----

export async function deleteExpiredStories(env, io, { batch = 500 } = {}) {
  if (!env.FIREBASE_SERVICE_ACCOUNT) { console.warn('clean-up: FIREBASE_SERVICE_ACCOUNT is not set'); return { deleted: 0 }; }
  const account = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);
  const accessToken = await serviceAccountToken(account, io);
  const base = `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;
  const headers = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' };
  const nowIso = new Date(io.now()).toISOString();
  let deleted = 0;
  for (let round = 0; round < 20; round++) { // at most 10,000 a night, in batches
    const res = await io.fetch(`${base}:runQuery`, {
      method: 'POST', headers,
      body: JSON.stringify({ structuredQuery: {
        from: [{ collectionId: 'stories' }],
        where: { fieldFilter: { field: { fieldPath: 'expiresAt' }, op: 'LESS_THAN', value: { timestampValue: nowIso } } },
        select: { fields: [{ fieldPath: '__name__' }] }, limit: batch,
      } }),
    });
    if (!res.ok) throw new Error(`clean-up query failed: ${res.status}`);
    const names = (await res.json()).map((row) => row.document?.name).filter(Boolean);
    if (!names.length) break;
    const commit = await io.fetch(`${base}:commit`, { method: 'POST', headers, body: JSON.stringify({ writes: names.map((name) => ({ delete: name })) }) });
    if (!commit.ok) throw new Error(`clean-up delete failed: ${commit.status}`);
    deleted += names.length;
    if (names.length < batch) break;
  }
  console.log(`clean-up: ${deleted} expired stor${deleted === 1 ? 'y' : 'ies'} removed`);
  return { deleted };
}

// An access token for the service account, by signing a JWT with its private key.
export async function serviceAccountToken(account, io) {
  const iat = Math.floor(io.now() / 1000);
  const header = b64url(new TextEncoder().encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const claims = b64url(new TextEncoder().encode(JSON.stringify({ iss: account.client_email, scope: 'https://www.googleapis.com/auth/datastore', aud: account.token_uri || 'https://oauth2.googleapis.com/token', iat, exp: iat + 3600 })));
  const pem = String(account.private_key).replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '');
  const key = await crypto.subtle.importKey('pkcs8', bytesOf(atob(pem)), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${header}.${claims}`));
  const assertion = `${header}.${claims}.${b64url(new Uint8Array(signature))}`;
  const res = await io.fetch(account.token_uri || 'https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${assertion}`,
  });
  if (!res.ok) throw new Error(`token request failed: ${res.status}`);
  return (await res.json()).access_token;
}

// ---- Bytes ----

const bytesOf = (binary) => Uint8Array.from(binary, (c) => c.charCodeAt(0));
const utf8 = (bytes) => new TextDecoder().decode(bytes);
export const b64urlDecode = (s) => bytesOf(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(s.length + ((4 - (s.length % 4)) % 4), '=')));
export const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
