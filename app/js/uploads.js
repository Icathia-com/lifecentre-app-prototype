// Uploads to the church's own file storage (a Cloudflare R2 bucket), through the upload Worker: the file goes to the Worker
// with the signed-in Google account's token, the Worker checks the account against the staff list and puts the file in the
// bucket, and answers with the file's public address. Files are made smaller on the phone first, and anything over 60 MB is
// refused here before it is sent. Nothing secret lives in the app, and the Worker holds no keys either.
import { getAuthTools } from './firebase.js';

export const UPLOAD_API = 'https://lifecentre-uploads.lifecentre-app-prototype.workers.dev'; // the Worker's address (deployed 3 Nov 2026)
export const MAX_UPLOAD_BYTES = 60 * 1024 * 1024;
export const TOO_BIG = 'That file is over 60 MB. Please choose a smaller one.';

// Puts `blob` in the bucket under `kind/` (popups, stories or avatars) and resolves with its public address.
// A recording's type can carry codec details ("video/webm;codecs=vp9,opus"): the plain type is what is sent.
export const plainType = (type) => String(type || '').split(';')[0].trim().toLowerCase();
const UNREACHABLE = 'The upload service could not be reached. Please try again later.';

export async function uploadFile(blob, { kind, fetcher = fetch } = {}) {
  if (blob.size > MAX_UPLOAD_BYTES) throw new Error(TOO_BIG);
  const { auth } = await getAuthTools();
  const user = auth.currentUser;
  if (!user) throw new Error('Please sign in with Google first.');
  const token = await user.getIdToken();
  const contentType = plainType(blob.type);
  let res;
  try {
    res = await fetcher(`${UPLOAD_API}/upload?kind=${encodeURIComponent(kind)}&size=${blob.size}`, {
      method: 'POST', headers: { 'Content-Type': contentType, Authorization: `Bearer ${token}` }, body: blob,
    });
  } catch { throw new Error(UNREACHABLE); }
  if (!res.ok) throw new Error(await reason(res));
  const { publicUrl } = await res.json();
  if (typeof publicUrl !== 'string' || !publicUrl.startsWith('https://')) throw new Error('The upload did not finish. Please try again.');
  return publicUrl;
}

async function reason(res) {
  try { const j = await res.json(); if (j?.error) return j.error; } catch { /* not JSON */ }
  return res.status === 401 ? 'Please sign in with Google again.' : res.status === 403 ? 'This account is not allowed to upload.' : 'The upload could not start. Please try again.';
}

// The pop-up shape: 4:5, like a phone screen's top. A banner is cropped to it on the phone (position 0..1 slides the crop
// along the longer side) and saved as a JPEG of modest size.
export const BANNER = { width: 1080, height: 1350 };

// A photo made smaller on the phone: no side longer than `max` pixels, as a JPEG. Used for story photos (1080) and profile
// photos (256).
export async function shrinkPhoto(file, { max = 1080, quality = 0.85 } = {}) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('That picture could not be used.'))), 'image/jpeg', quality));
}

export async function cropToBanner(file, { position = 0.5, quality = 0.85, width = BANNER.width, height = BANNER.height } = {}) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.max(width / bitmap.width, height / bitmap.height); // cover the whole banner
  const sw = Math.min(bitmap.width, width / scale);
  const sh = Math.min(bitmap.height, height / scale);
  const sx = (bitmap.width - sw) * position;
  const sy = (bitmap.height - sh) * position;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').drawImage(bitmap, sx, sy, sw, sh, 0, 0, width, height);
  bitmap.close?.();
  const blob = await new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('That picture could not be used.'))), 'image/jpeg', quality));
  return blob;
}
