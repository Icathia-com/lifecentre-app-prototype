// The upload Worker. One job: POST /upload?kind=<popups|stories|avatars>&size=<bytes>, with the file as the body, from a
// signed-in staff member (a Firebase ID token from the app). The Worker checks the token against Google's public keys, checks
// the caller's own entry on the staff list in Firestore (with the caller's own token, so the security rules apply), and
// writes the file into the church's storage bucket through its binding. It answers with the file's public address.
// Files over 60 MB, unknown file types and people without the right permission are refused.
// There are no secrets: the bucket is reached through the binding in wrangler.toml, and expired story records are removed by
// the church's hourly Apps Script job (apps-script/Votd.js). The code has no dependencies: it uses the Worker's own crypto and fetch.

export const MAX_BYTES = 60 * 1024 * 1024;
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
export const TOO_BIG = 'That file is over 60 MB. Please choose a smaller one.';

export default {
  fetch: (request, env) => handle(request, env, { fetch: globalThis.fetch.bind(globalThis), now: () => Date.now(), random: () => crypto.randomUUID() }),
};

// ---- Requests ----

export async function handle(request, env, io) {
  const url = new URL(request.url);
  const cors = corsHeaders(request.headers.get('Origin'), env);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (request.method === 'GET' && url.pathname === '/') return new Response('ok', { headers: cors });
  if (request.method === 'POST' && url.pathname === '/upload') {
    try {
      const body = await upload(request, env, io);
      return json(200, body, cors);
    } catch (err) {
      const status = err.status ?? 500;
      if (status === 500) console.error('upload failed:', err?.message || err);
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

// Checks who is asking and what they send, then puts the file in the bucket. Resolves with { key, publicUrl, bytes }.
export async function upload(request, env, io) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token) throw refuse(401, 'Please sign in with Google first.');
  const claims = await verifyFirebaseToken(token, env.FIREBASE_PROJECT_ID, io).catch((err) => { throw err.status ? err : refuse(401, 'Please sign in with Google again.'); });
  const url = new URL(request.url);
  const kind = url.searchParams.get('kind') || '';
  const size = Number(url.searchParams.get('size'));
  // A recording's type may carry codec details; the plain type is what is kept. Own properties only: no "constructor".
  const contentType = String(request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  if (!Object.hasOwn(KINDS, kind)) throw refuse(400, 'Unknown upload kind.');
  if (!Object.hasOwn(TYPES, contentType)) throw refuse(415, 'That type of file cannot be uploaded.');
  if (!Number.isInteger(size) || size <= 0) throw refuse(400, 'Bad file size.');
  if (size > MAX_BYTES) throw refuse(413, TOO_BIG);
  const declared = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(declared) && declared > MAX_BYTES) throw refuse(413, TOO_BIG); // refused before the body is read
  const entry = await staffEntry(claims.email, token, env, io);
  if (!entry) throw refuse(403, 'This account is not on the staff list.');
  if (!KINDS[kind](entry)) throw refuse(403, 'This account is not allowed to upload that.');

  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.length > MAX_BYTES) throw refuse(413, TOO_BIG);
  if (!bytes.length) throw refuse(400, 'The file is empty.');
  if (bytes.length !== size) throw refuse(400, 'The file did not arrive whole. Please try again.');
  const d = new Date(io.now());
  const key = `${kind}/${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${io.random()}.${TYPES[contentType]}`;
  if (!env.UPLOADS?.put) throw refuse(500, 'no bucket');
  await env.UPLOADS.put(key, bytes, { httpMetadata: { contentType } });
  return { key, publicUrl: `${String(env.PUBLIC_BASE_URL).replace(/\/$/, '')}/${key}`, bytes: bytes.length };
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
  let res;
  try { res = await io.fetch(JWKS_URL); } catch { throw refuse(503, 'Please try again in a moment.'); }
  if (!res.ok) throw refuse(503, 'Please try again in a moment.'); // Google's keys could not be fetched: not the person's fault
  const { keys } = await res.json();
  const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get('Cache-Control') || '')?.[1] || 3600);
  jwksCache = { keys, until: io.now() + maxAge * 1000 };
  return keys;
}

export const resetKeyCache = () => { jwksCache = { keys: null, until: 0 }; };

// ---- Bytes ----

const bytesOf = (binary) => Uint8Array.from(binary, (c) => c.charCodeAt(0));
const utf8 = (bytes) => new TextDecoder().decode(bytes);
export const b64urlDecode = (s) => bytesOf(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(s.length + ((4 - (s.length % 4)) % 4), '=')));
export const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
