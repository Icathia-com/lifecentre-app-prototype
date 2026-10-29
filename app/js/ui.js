// Shared pieces for the Events screens: icons, event covers, grouping events by day.
import { h, icon, dateKey, addDays, dayStart, formatDay, formatClock, minutesOfDay } from './util.js';
import { siteName, initials } from './sites.js';

const PATHS = {
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  pin: '<path d="M12 21s-6-5.2-6-10a6 6 0 0 1 12 0c0 4.8-6 10-6 10z"/><circle cx="12" cy="11" r="2.2"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  right: '<path d="M9 6l6 6-6 6"/>',
  back: '<path d="M15 6l-6 6 6 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  ticket: '<path d="M4 6h16a1 1 0 0 1 1 1v3a2 2 0 0 0 0 4v3a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-3a2 2 0 0 0 0-4V7a1 1 0 0 1 1-1z"/><path d="M14.5 6.5v2M14.5 11v2M14.5 15.5v2"/>',
  site: '<path d="M4 21V9l8-5 8 5v12"/><path d="M9 21v-6h6v6"/><path d="M12 4v-1"/>',
  bell: '<path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8"/><path d="M10.3 21a2 2 0 0 0 3.4 0"/>',
  nav: '<path d="M3 11l18-8-8 18-2-8z"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
  dots: '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>',
  edit: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  link: '<path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="1.5"/><path d="M4 18l5-5 4 4 3-3 4 4"/>',
  qr: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14v3M14 20h3M20 20h1"/>',
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>',
  chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  palette: '<circle cx="12" cy="12" r="9"/><circle cx="8" cy="10.5" r="1"/><circle cx="12" cy="7.5" r="1"/><circle cx="16" cy="10.5" r="1"/><path d="M12 21c-1.4 0-2-.9-2-1.8 0-1.4 1-2.2 2-2.2h2a3 3 0 0 0 3-3"/>',
  doc: '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  dollar: '<path d="M12 3v18M16 7.5C15.5 6 14 5 12 5 9.5 5 8 6.2 8 8s1.5 2.5 4 3 4 1.2 4 3-1.5 3-4 3c-2 0-3.5-1-4-2.5"/>',
  tag: '<path d="M3 12V5a2 2 0 0 1 2-2h7l9 9-9 9z"/><circle cx="8" cy="8" r="1.4"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
  cap: '<path d="M5 4h14M12 20V8M7 13l5-5 5 5"/>',
  updown: '<path d="M8 9l4-4 4 4M8 15l4 4 4-4"/>',
  timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2M9 2h6"/>',
  play: '<circle cx="12" cy="12" r="9"/><path d="M10 8.5l5.5 3.5-5.5 3.5z"/>',
  megaphone: '<path d="M3 10v4a1 1 0 0 0 1 1h2.4L16.5 19.5V4.5L6.4 9H4a1 1 0 0 0-1 1z"/><path d="M7.6 15.6l1.3 4.1a1 1 0 0 0 .95.7h1.1a1 1 0 0 0 .95-1.3L10.9 17.6"/><path d="M19.6 8.4l2-1.1M19.8 12h2.4M19.6 15.6l2 1.1"/>',
  check: '<path d="M5 12l5 5 9-10"/>',
  mic: '<path d="M12 3a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3"/>',
  verse: '<path d="M4 5a2 2 0 0 1 2-2h6v18H6a2 2 0 0 1-2-2zM12 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6"/>',
  heart: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
  group: '<path d="M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 20c0-3.5 3-6 6-6s6 2.5 6 6M17 10a2.4 2.4 0 1 0 0-4.8M15 14.5c3 0 6 1.5 6 5"/>',
  cross: '<path d="M12 3v18M7.5 8h9"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>',
  shield: '<path d="M12 3l8 3v6c0 4.5-3.2 8-8 9-4.8-1-8-4.5-8-9V6z"/><path d="M12 8v5M12 16.5v.01"/>',
  sound: '<path d="M4 10v4h4l5 4V6L8 10z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/>',
  mute: '<path d="M4 10v4h4l5 4V6L8 10z"/><path d="M17 9l5 6M22 9l-5 6"/>',
};

export function ic(name, size = 18, stroke = 2) {
  return icon(`<svg aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round">${PATHS[name]}</svg>`);
}

// ---- Covers: two colours and a label, or a small photo. Values from the database are checked before they reach CSS. ----

const COLOUR = /^#[0-9A-Fa-f]{6}$/;
const PHOTO = /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/;
export const safeColour = (c, fallback) => (COLOUR.test(c) ? c : fallback);
export const safePhoto = (p) => (typeof p === 'string' && p.length <= 140000 && PHOTO.test(p) ? p : null);

export function coverOf(ev) {
  const c = ev.cover || {};
  return { from: safeColour(c.from, '#1B1740'), to: safeColour(c.to, '#3558C8'), label: typeof c.label === 'string' ? c.label : '', photo: safePhoto(c.photo) };
}

// A cover tile: `height` px tall, `radius` px corners, label text `fontSize` px. Width is 100% unless given.
export function coverEl(ev, { height, radius, fontSize, width = '100%' }) {
  const c = coverOf(ev);
  const el = h('span', { class: 'cover' }, c.label);
  el.style.cssText = `width:${width};height:${height}px;border-radius:${radius}px;padding:${Math.round(height / 9)}px;font-size:${fontSize}px`;
  if (c.photo) { el.style.backgroundImage = `url("${c.photo}")`; el.classList.add('photo'); }
  else el.style.backgroundImage = `linear-gradient(135deg, ${c.from} 0%, ${c.to} 100%)`;
  return el;
}

// The little round avatar with a host's initials, coloured like the event cover.
export function hostDot(ev, size = 20, fontSize = 8.5) {
  const c = coverOf(ev);
  const el = h('span', { class: 'dot-av', 'aria-hidden': 'true' }, initials(ev.host || 'Life Centre'));
  el.style.cssText = `width:${size}px;height:${size}px;font-size:${fontSize}px;background:linear-gradient(135deg, ${c.from}, ${c.to})`;
  return el;
}

// ---- Dates ----

export const eventTime = (ev) => formatClock(minutesOfDay(ev.start));
export const eventPlace = (ev) => siteName(ev.location, ev.place);

// "Tomorrow" / "Today" / "17 October", with the weekday: ["Tomorrow", "Friday"].
export function dayHeading(key, today = dateKey()) {
  const diff = Math.round((Date.parse(`${key}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
  const ms = dayStart(key);
  return [diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : formatDay(ms, { day: 'numeric', month: 'long' }), formatDay(ms, { weekday: 'long' })];
}

// "Saturday, 17 October", as the design writes it
export const longDate = (ms) => `${formatDay(ms, { weekday: 'long' })}, ${formatDay(ms, { day: 'numeric', month: 'long' })}`;

// [{ key: '2026-10-17', events: [...] }, ...] in date order.
export function groupByDay(events) {
  const groups = [];
  for (const ev of [...events].sort((a, b) => a.start - b.start)) {
    const key = dateKey(ev.start);
    const last = groups[groups.length - 1];
    if (last?.key === key) last.events.push(ev);
    else groups.push({ key, events: [ev] });
  }
  return groups;
}

// The line under an event title: "8:00 PM · Yishun" as two icon + text pieces.
export function metaLine(ev) {
  return h('span', { class: 'meta-line' },
    h('span', {}, ic('clock', 13), eventTime(ev)),
    h('span', {}, ic('pin', 13), eventPlace(ev)));
}

export const eventHref = (ev) => `#/events/${encodeURIComponent(ev.id)}`;
