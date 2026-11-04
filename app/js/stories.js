// Stories: short photo, video, voice or text posts from the people allowed to post them, gone 24 hours after posting.
// The pure helpers live here; the screens are story-row.js (the circles on Home), story-viewer.js and story-post.js.
// A recording is kept as one file and watched in parts of up to 30 seconds, like Snapchat: the parts are only time ranges.
import { firstName } from './greeting.js';

export const DAY = 86400000;
export const PART_SECONDS = 30;
export const PART_LIMITS = { video: 6, audio: 10 }; // parts per recording: 3 minutes of video, 5 minutes of voice
export const STILL_SECONDS = { photo: 5, text: 6 }; // how long a photo or a text story stays up
export const MAX_TEXT = 300;
export const PALETTE = [['#1B1740', '#3558C8'], ['#2A1B6B', '#7A3FD6'], ['#FF6A3D', '#E5326B'], ['#0F766E', '#22B8A6'], ['#C2185B', '#4A148C'], ['#1E3A8A', '#3B82F6'], ['#14532D', '#4ADE80'], ['#F5B700', '#38B26B']];
export const RING = 'conic-gradient(#FF3D6E, #FFB400, #35D07F, #2D8CFF, #B14CFF, #FF3D6E)';

// Consecutive parts of `partSeconds`, the last one shorter, never more than `maxParts`: 75 seconds -> 0-30, 30-60, 60-75.
export function splitParts(duration, { partSeconds = PART_SECONDS, maxParts = Infinity } = {}) {
  const parts = [];
  const total = Math.max(0, Number(duration) || 0);
  for (let start = 0; start < total && parts.length < maxParts; start += partSeconds) parts.push({ start, end: Math.min(total, start + partSeconds) });
  return parts.length ? parts : [{ start: 0, end: 0 }];
}

// How long a recording of a type may run before it stops by itself.
export const maxSeconds = (type) => (PART_LIMITS[type] ?? 0) * PART_SECONDS;

// The parts of a story: a recording in 30-second parts (a longer file is shown up to the limit), a photo or text in one part.
export function partsFor(type, duration) {
  if (type === 'video' || type === 'audio') return splitParts(Math.min(duration, maxSeconds(type)), { maxParts: PART_LIMITS[type] });
  return [{ start: 0, end: STILL_SECONDS[type] ?? 5 }];
}

// What a story's duration field holds: the seconds that are shown.
export const shownSeconds = (type, duration) => partsFor(type, duration).at(-1).end;

// The people with live stories, newest first, each with their stories oldest first (the order they are watched in). The
// name and photo on the circle come from the person's newest story.
export function groupByAuthor(stories, now = Date.now()) {
  const groups = new Map();
  const soundParts = (parts) => Array.isArray(parts) && parts.length > 0 && parts.every((p) => p && Number.isFinite(p.start) && Number.isFinite(p.end) && p.end > p.start);
  for (const s of stories) {
    if (!(s.expiresAt > now) || !soundParts(s.parts)) continue; // a broken story never reaches the viewer
    const g = groups.get(s.author) ?? { author: s.author, name: s.authorName || s.author, photo: s.authorPhoto || '', stories: [], newest: 0 };
    g.stories.push(s);
    if (s.createdAt >= g.newest) { g.newest = s.createdAt; g.name = s.authorName || g.name; g.photo = s.authorPhoto || g.photo; }
    groups.set(s.author, g);
  }
  return [...groups.values()].map((g) => ({ ...g, stories: [...g.stories].sort((a, b) => a.createdAt - b.createdAt) })).sort((a, b) => b.newest - a.newest);
}

// Seen is remembered per person on the phone as the newest story time watched: { [author]: createdAt }.
export const seenAll = (group, seen) => (seen?.[group.author] ?? 0) >= group.newest;
export const markSeen = (seen, group) => ({ ...(seen ?? {}), [group.author]: Math.max(seen?.[group.author] ?? 0, group.newest) });

// Every part of every story of one person, in watching order.
export const flatten = (group) => group.stories.flatMap((story, si) => story.parts.map((part, pi) => ({ story, si, part, pi })));

export const circleLabel = (group) => firstName(group.name) || group.name;
export const timeAgo = (ms, now = Date.now()) => { const m = Math.max(1, Math.round((now - ms) / 60000)); return m < 60 ? `${m}m` : `${Math.round(m / 60)}h`; };
export const clock = (seconds) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

// Only https addresses from the database ever reach a src.
export const safeMedia = (u) => (typeof u === 'string' && /^https:\/\/\S+$/.test(u) ? u : '');

// ---- Posting (the camera, like Instagram): the shutter, the recording ring, the colours and the words on a story ----
export const MODES = ['story', 'voice', 'text'];
export const HOLD_MS = 250;  // a press on the shutter this long records instead of taking a photo
export const LOCK_PX = 70;   // sliding this far to the left while holding, onto the lock, keeps the recording going with no finger on the shutter
export const ZOOM_RANGE = { min: 1, max: 4 }; // digital zoom, where the camera cannot zoom itself

// What a plain tap on the shutter does. Text mode goes on to the preview; a recording that is running (locked, or hands-free)
// stops; the microphone, and the camera with hands-free on, start a recording that keeps going; otherwise it is a photo.
export function tapAction({ mode, recording, handsFree }) {
  if (mode === 'text') return 'next';
  if (recording) return 'stop';
  return mode === 'voice' || handsFree ? 'start' : 'photo';
}
// Letting go after a hold that was recording: a locked recording carries on, a held one stops.
export const releaseAction = ({ locked }) => (locked ? 'keep' : 'stop');
// The lock sits to the left of the shutter: the finger has slid LOCK_PX or more to the left of where it pressed.
export const lockReached = (x0, x) => x0 - x >= LOCK_PX;

// ---- Zoom and the camera ----
export const clampZoom = (z, range = ZOOM_RANGE) => Math.max(range.min, Math.min(range.max, Number.isFinite(z) ? z : range.min));
// A finger sliding up the screen from the shutter zooms in, down zooms out, like Instagram: 150 pixels up is about 2.7 times.
export const zoomFromSlide = (base, dy, range = ZOOM_RANGE) => clampZoom(base * Math.exp(-dy / 150), range);
// "1x", "0.5x", "2.3x": one decimal unless it is a whole number.
export const formatZoom = (z) => { const tenths = Math.round(z * 10) / 10; return `${Number.isInteger(tenths) ? Math.round(tenths) : tenths}x`; };

// The part of a camera picture sw by sh that fills a 9:16 story at a digital zoom: the middle, cropped to the shape, then
// shrunk by the zoom. The same crop is shown on screen, taken as a photo and recorded, so what is seen is what is posted.
export function cropRect(sw, sh, zoom = 1, aspect = 9 / 16) {
  const z = Math.max(1, Number.isFinite(zoom) ? zoom : 1);
  let width = sw;
  let height = sh;
  if (sw / sh > aspect) width = sh * aspect; else height = sw / aspect;
  width /= z;
  height /= z;
  return { x: (sw - width) / 2, y: (sh - height) / 2, width, height };
}

// What the camera is asked for: a portrait picture the shape of a story, about 1080 by 1920, from one side (or one named
// camera), with no microphone. The browser may never crop or scale to get that shape (resizeMode none): a cropped picture is
// a zoomed-in one. The app crops to the story shape itself, the same way on screen and in what is posted. zoom: true asks for
// the camera's own zoom where the phone has one.
export function cameraConstraints(facing, deviceId = null) {
  const video = { width: { ideal: 1080 }, height: { ideal: 1920 }, aspectRatio: { ideal: 9 / 16 }, frameRate: { ideal: 30 }, resizeMode: { exact: 'none' }, zoom: true };
  if (deviceId) video.deviceId = { exact: deviceId }; else video.facingMode = facing;
  return { video, audio: false };
}
const SIDE = { user: /front|user/i, environment: /back|rear|environment/i };
// The main camera on a side, never a telephoto or other special lens. iPhones name their lenses ("Back Camera", "Back Telephoto
// Camera", "Back Ultra Wide Camera"); Android numbers them ("camera2 0, facing back") and the lowest number on a side is the
// main lens. Null when the labels are not known (before the first permission) or no camera matches the side.
export function pickCamera(devices, facing) {
  const side = SIDE[facing] ?? SIDE.environment;
  const list = (devices || []).filter((d) => d.kind === 'videoinput' && side.test(d.label || ''));
  if (!list.length) return null;
  const plain = list.filter((d) => !/tele|zoom|ultra|wide|macro|depth|dual|triple/i.test(d.label));
  const pool = plain.length ? plain : list;
  const number = (d) => { const m = /camera2?\s*(\d+)/i.exec(d.label); return m ? Number(m[1]) : 999; };
  return [...pool].sort((a, b) => number(a) - number(b))[0].deviceId;
}
// A named ultra-wide camera on a side (iPhones name it; Android usually does not), or null.
export function ultraWideOf(devices, facing) {
  const side = SIDE[facing] ?? SIDE.environment;
  return (devices || []).find((d) => d.kind === 'videoinput' && side.test(d.label || '') && /ultra|0\.5/i.test(d.label) && !/tele/i.test(d.label))?.deviceId ?? null;
}

// The ring round the shutter while recording: how far round it has filled (0 to 1), and the marks between the parts (degrees).
export const ringFraction = (elapsed, limit) => Math.max(0, Math.min(1, limit > 0 ? elapsed / limit : 0));
export const ringMarks = (maxParts) => Array.from({ length: Math.max(0, maxParts - 1) }, (_, k) => ((k + 1) / maxParts) * 360);

// The background colours after the current pair, round and round the palette.
export function nextColours(current) {
  const at = PALETTE.findIndex(([a, b]) => a === current?.[0] && b === current?.[1]);
  return PALETTE[(at + 1) % PALETTE.length];
}

// The words of a story for screen readers and captions: every piece of text on it, top to bottom, within the limit.
export const layerWords = (layers) => layers.map((l) => String(l.text || '').trim()).filter(Boolean).join('\n').slice(0, MAX_TEXT);

// Breaks text into lines no wider than `maxWidth`, with `measure(text)` giving a width: words wrap, a word too long for a
// line is broken, and new lines in the text are kept. Used the same way on screen and when the picture is drawn.
export function wrapLines(text, maxWidth, measure) {
  const lines = [];
  for (const para of String(text ?? '').split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (measure(next) <= maxWidth) { line = next; continue; }
      if (line) lines.push(line);
      if (measure(word) <= maxWidth) { line = word; continue; }
      let piece = '';
      for (const ch of word) {
        if (piece && measure(piece + ch) > maxWidth) { lines.push(piece); piece = ''; }
        piece += ch;
      }
      line = piece;
    }
    lines.push(line);
  }
  return lines;
}
