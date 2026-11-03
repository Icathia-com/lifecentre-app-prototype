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
  for (const s of stories) {
    if (!(s.expiresAt > now) || !Array.isArray(s.parts) || !s.parts.length) continue;
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
