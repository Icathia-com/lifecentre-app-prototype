// The words and drawings laid over a story in the editor (the overlay). Positions and sizes are kept as shares of a 9:16
// stage, so the very same drawing routine paints the screen while editing and the full-size picture that is posted: what
// you see is what goes up. Nothing here touches the DOM when it loads, so the pure parts are tested in Node.
import { wrapLines } from './stories.js';

export const STAGE = { width: 1080, height: 1920 };
export const FONT = 'Manrope, system-ui, -apple-system, sans-serif';
export const PEN_COLOURS = [['#FFFFFF', 'White'], ['#000000', 'Black'], ['#FF3D6E', 'Pink'], ['#FFB400', 'Yellow'], ['#35D07F', 'Green'], ['#2D8CFF', 'Blue'], ['#B14CFF', 'Purple'], ['#FF8A65', 'Orange']];
export const TEXT_SIZE = 0.085; // a new piece of text: its letter height as a share of the stage width
export const PEN_WIDTH = 0.012; // a pen stroke's width, the same way
export const MIN_SIZE = 0.03;
export const MAX_SIZE = 0.3;

export const emptyOverlay = () => ({ strokes: [], layers: [] });
export const isEmpty = (o) => !o || (o.strokes.length === 0 && o.layers.length === 0);
export const clampSize = (s) => Math.max(MIN_SIZE, Math.min(MAX_SIZE, Number(s) || TEXT_SIZE));
let nextId = 1;
export const newLayer = (text, { x = 0.5, y = 0.5, size = TEXT_SIZE, colour = '#FFFFFF' } = {}) => ({ id: `t${nextId++}`, text, x, y, size, colour });

// Draws the overlay on a canvas context W by H pixels wide and high. Returns each piece of text's box in those pixels, in
// drawing order (the last one is on top), for finding which piece a tap landed on.
export function drawOverlay(ctx, W, H, overlay) {
  const boxes = [];
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const s of overlay.strokes) {
    if (!s.points.length) continue;
    ctx.strokeStyle = s.colour;
    ctx.lineWidth = Math.max(1, s.width * W);
    ctx.beginPath();
    const [x0, y0] = s.points[0];
    ctx.moveTo(x0 * W, y0 * H);
    if (s.points.length === 1) ctx.lineTo(x0 * W + 0.1, y0 * H); // a dot
    for (const [x, y] of s.points.slice(1)) ctx.lineTo(x * W, y * H);
    ctx.stroke();
  }
  for (const l of overlay.layers) {
    const px = l.size * W;
    ctx.font = `700 ${px}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const measure = (t) => ctx.measureText(t).width;
    const lines = wrapLines(l.text, W * 0.86, measure);
    const lh = px * 1.2;
    const height = lh * lines.length;
    const width = Math.max(px * 0.6, ...lines.map(measure));
    const cx = l.x * W;
    const cy = l.y * H;
    ctx.fillStyle = l.colour;
    ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
    ctx.shadowBlur = px * 0.25;
    ctx.shadowOffsetY = px * 0.05;
    lines.forEach((t, i) => ctx.fillText(t, cx, cy - height / 2 + lh * (i + 0.5)));
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    boxes.push({ id: l.id, left: cx - width / 2 - px * 0.3, top: cy - height / 2 - px * 0.2, width: width + px * 0.6, height: height + px * 0.4 });
  }
  ctx.restore();
  return boxes;
}

// The piece of text under a point: the one drawn last (on top) wins.
export const hitLayer = (boxes, x, y) => [...boxes].reverse().find((b) => x >= b.left && x <= b.left + b.width && y >= b.top && y <= b.top + b.height)?.id ?? null;

// Where a picture sw by sh sits in a W by H stage: `contain` shows all of it (bars at the sides or top), `cover` fills the stage.
export function fitBox(sw, sh, W, H, fit = 'contain') {
  const s = fit === 'cover' ? Math.max(W / sw, H / sh) : Math.min(W / sw, H / sh);
  const width = sw * s;
  const height = sh * s;
  return { x: (W - width) / 2, y: (H - height) / 2, width, height };
}

const sizeOf = (el) => ({ w: el.naturalWidth || el.videoWidth || el.width || 1, h: el.naturalHeight || el.videoHeight || el.height || 1 });
const toBlob = (canvas, type, quality) => new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('The picture could not be made.'))), type, quality));
async function fontsReady(px) {
  try { await Promise.race([document.fonts?.load?.(`700 ${px}px Manrope`), new Promise((r) => setTimeout(r, 1500))]); } catch { /* the fallback font then */ }
}
export const paintBackground = (ctx, W, H, colours) => {
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, colours[0]);
  g.addColorStop(1, colours[1]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
};

// The finished picture of a story as a JPEG: the colours, the photo or video frame if there is one, and the overlay.
export async function composite({ media = null, fit = 'contain', colours, overlay, width = STAGE.width, height = STAGE.height, quality = 0.86 }) {
  await fontsReady(Math.round(TEXT_SIZE * width));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  paintBackground(ctx, width, height, colours);
  if (media) { const { w, h } = sizeOf(media); const b = fitBox(w, h, width, height, fit); ctx.drawImage(media, b.x, b.y, b.width, b.height); }
  drawOverlay(ctx, width, height, overlay);
  return toBlob(canvas, 'image/jpeg', quality);
}

// The overlay on its own, see-through, as a PNG to lay over a video.
export async function overlayImage(overlay, { width = STAGE.width, height = STAGE.height } = {}) {
  await fontsReady(Math.round(TEXT_SIZE * width));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  drawOverlay(canvas.getContext('2d'), width, height, overlay);
  return toBlob(canvas, 'image/png');
}
