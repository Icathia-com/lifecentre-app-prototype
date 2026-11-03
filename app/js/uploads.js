// Uploads to the church's own file storage (a Cloudflare R2 bucket), through the upload Worker: it checks the signed-in Google
// account against the staff list and hands back a short-lived address to put one file at. Files are made smaller on the phone
// first, and anything over 60 MB is refused here before it is sent. Nothing secret lives in the app: the Worker holds the keys.
import { getAuthTools } from './firebase.js';

export const UPLOAD_API = 'https://lifecentre-uploads.lifecentre.workers.dev'; // the Worker's address, set when it is deployed
export const MAX_UPLOAD_BYTES = 60 * 1024 * 1024;
export const TOO_BIG = 'That file is over 60 MB. Please choose a smaller one.';

// Puts `blob` in the bucket under `kind/` (popups or stories) and resolves with its public address.
export async function uploadFile(blob, { kind, fetcher = fetch } = {}) {
  if (blob.size > MAX_UPLOAD_BYTES) throw new Error(TOO_BIG);
  const { auth } = await getAuthTools();
  const user = auth.currentUser;
  if (!user) throw new Error('Please sign in with Google first.');
  const token = await user.getIdToken();
  const signed = await fetcher(`${UPLOAD_API}/sign`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ kind, contentType: blob.type, size: blob.size }),
  });
  if (!signed.ok) throw new Error(await reason(signed));
  const { url, publicUrl } = await signed.json();
  const put = await fetcher(url, { method: 'PUT', headers: { 'Content-Type': blob.type }, body: blob });
  if (!put.ok) throw new Error('The upload did not finish. Please try again.');
  return publicUrl;
}

async function reason(res) {
  try { const j = await res.json(); if (j?.error) return j.error; } catch { /* not JSON */ }
  return res.status === 401 ? 'Please sign in with Google again.' : res.status === 403 ? 'This account is not allowed to upload.' : 'The upload could not start. Please try again.';
}

// The pop-up shape: 4:5, like a phone screen's top. A banner is cropped to it on the phone (position 0..1 slides the crop
// along the longer side) and saved as a JPEG of modest size.
export const BANNER = { width: 1080, height: 1350 };

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
