// Shrinks a chosen photo to a small JPEG (as a data URL) so it can be kept inside the event itself.
// There is no file storage yet, and the security rules accept at most 140,000 characters.
const MAX_CHARS = 120000;

export async function resizeToJpeg(file, { max = 640 } = {}) {
  const bitmap = await createImageBitmap(file);
  let size = max;
  for (let attempt = 0; attempt < 6; attempt++) {
    const scale = Math.min(1, size / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.72, 0.55, 0.4]) {
      const url = canvas.toDataURL('image/jpeg', quality);
      if (url.length <= MAX_CHARS) return url;
    }
    size = Math.round(size * 0.75);
  }
  throw new Error('That photo is too large to use.');
}
