// "Share event poster": draws the event onto a 1080x1350 image (its cover, name, when and where) that can be shared or saved.
import { coverOf } from './ui.js';
import { siteVenue } from './sites.js';
import { formatDay, formatClock, minutesOfDay } from './util.js';

const W = 1080;
const H = 1350;
const FONT = "Manrope, 'Segoe UI', system-ui, sans-serif";

const loadImage = (src) => new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = reject; img.src = src; });

// Breaks text into lines no wider than `max` pixels (using the font already set on the context).
function wrap(c, text, max) {
  const lines = [];
  let line = '';
  for (const word of String(text).split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (c.measureText(next).width > max && line) { lines.push(line); line = word; } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

export async function makePoster(ev) {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const c = canvas.getContext('2d');
  const cover = coverOf(ev);

  if (cover.photo) {
    const img = await loadImage(cover.photo);
    const scale = Math.max(W / img.width, H / img.height);
    c.drawImage(img, (W - img.width * scale) / 2, (H - img.height * scale) / 2, img.width * scale, img.height * scale);
    const shade = c.createLinearGradient(0, H * 0.35, 0, H);
    shade.addColorStop(0, 'rgba(0,0,0,0)');
    shade.addColorStop(1, 'rgba(0,0,0,0.78)');
    c.fillStyle = shade;
    c.fillRect(0, 0, W, H);
  } else {
    const g = c.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, cover.from);
    g.addColorStop(1, cover.to);
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);
  }

  c.fillStyle = '#fff';
  c.textBaseline = 'alphabetic';
  c.font = `700 34px ${FONT}`;
  c.fillText('LIFE CENTRE', 80, 120);

  // The cover words, large.
  c.font = `800 150px ${FONT}`;
  const words = String(cover.label || ev.title).split('\n');
  words.forEach((w, i) => c.fillText(w, 80, 760 + i * 150));

  // Title, then when and where.
  c.font = `700 64px ${FONT}`;
  const titleTop = 760 + words.length * 150 + 30;
  const lines = wrap(c, ev.title, W - 160).slice(0, 3);
  lines.forEach((l, i) => c.fillText(l, 80, titleTop + i * 76));

  c.font = `500 40px ${FONT}`;
  const when = `${formatDay(ev.start, { weekday: 'long', day: 'numeric', month: 'long' })} · ${formatClock(minutesOfDay(ev.start))}`;
  const y = titleTop + lines.length * 76 + 40;
  c.fillText(when, 80, y);
  c.fillText(siteVenue(ev.location, ev.place), 80, y + 56);

  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}
