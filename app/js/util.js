// Small shared helpers: DOM builder, Singapore-time dates, calendar links, mouse drag scrolling.

export const TZ = 'Asia/Singapore';
const SG_OFFSET = '+08:00'; // Singapore has no daylight saving

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  // Links are not dragged around by the browser: pressing the mouse on one and moving scrolls instead.
  if (tag === 'a') el.setAttribute('draggable', 'false');
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}

// Replaces a parent's children, skipping empty entries (the DOM's own replaceChildren would print "null").
export const fill = (parent, ...nodes) => parent.replaceChildren(...nodes.flat().filter((n) => n != null && n !== false));

// Builds an element from fixed markup (used for the icons, never for data from the database).
export function icon(markup) {
  const t = document.createElement('template');
  t.innerHTML = markup.trim();
  return t.content.firstElementChild;
}

// Only https links from the database are ever put into an href.
export const safeUrl = (u) => (typeof u === 'string' && /^https:\/\/\S+$/.test(u) ? u : null);

// ---- Dates: all in Singapore time, whatever the device's time zone is ----

const parts = (opts, ms) =>
  Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, ...opts }).formatToParts(ms).map((p) => [p.type, p.value]));

export function dateKey(ms = Date.now()) {
  const p = parts({ year: 'numeric', month: '2-digit', day: '2-digit' }, ms);
  return `${p.year}-${p.month}-${p.day}`;
}

export function addDays(key, n) {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export const dayStart = (key) => Date.parse(`${key}T00:00:00${SG_OFFSET}`);

export const formatDay = (ms, opts = { weekday: 'short', day: 'numeric', month: 'short' }, locale = 'en-GB') =>
  new Intl.DateTimeFormat(locale, { timeZone: TZ, ...opts }).format(ms);

// Minutes since midnight in Singapore, and "7:30 PM" style labels for them (as in the calendar's time column).
export function minutesOfDay(ms) {
  const p = parts({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }, ms);
  return Number(p.hour) * 60 + Number(p.minute);
}
export function formatClock(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

export const formatTime = (ms) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: 'numeric', minute: '2-digit', hour12: true })
    .format(ms).replace(/\s/g, '').toLowerCase();

export const formatTimeRange = (start, end) => (end ? `${formatTime(start)} – ${formatTime(end)}` : formatTime(start));

// <input type="datetime-local"> values ("2026-10-30T19:30") are read as Singapore time.
export const sgInputToMs = (value) => Date.parse(`${value.length === 16 ? `${value}:00` : value}${SG_OFFSET}`);

export function msToSgInput(ms) {
  const p = parts({ year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }, ms);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

// ---- "Add to my calendar" ----

const stamp = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const endOf = (ev) => ev.end ?? ev.start + 3600000;

export function googleCalendarUrl(ev) {
  const q = new URLSearchParams({ action: 'TEMPLATE', text: ev.title, dates: `${stamp(ev.start)}/${stamp(endOf(ev))}` });
  if (ev.location) q.set('location', ev.location);
  if (ev.description) q.set('details', ev.description);
  return `https://calendar.google.com/calendar/render?${q}`;
}

const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/[,;]/g, '\\$&').replace(/\r?\n/g, '\\n');

export function icsText(ev, now = Date.now()) {
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Life Centre//App//EN', 'BEGIN:VEVENT',
    `UID:${ev.id}@lifecentre.sg`, `DTSTAMP:${stamp(now)}`, `DTSTART:${stamp(ev.start)}`, `DTEND:${stamp(endOf(ev))}`,
    `SUMMARY:${esc(ev.title)}`,
    ev.location && `LOCATION:${esc(ev.location)}`,
    ev.description && `DESCRIPTION:${esc(ev.description)}`,
    'END:VEVENT', 'END:VCALENDAR',
  ].filter(Boolean).join('\r\n') + '\r\n';
}

export const icsDataUrl = (ev) => `data:text/calendar;charset=utf-8,${encodeURIComponent(icsText(ev))}`;

// ---- Mouse drag scrolling (touch and trackpad already scroll natively) ----

const FORM_FIELDS = 'input, textarea, select, [contenteditable]';

export function enableDragScroll(el, axis = 'y') {
  const prop = axis === 'x' ? 'scrollLeft' : 'scrollTop';
  const coord = axis === 'x' ? 'clientX' : 'clientY';
  let active = false, dragging = false, pointer = 0, startPos = 0, startScroll = 0;

  el.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0 || e.target.closest(FORM_FIELDS)) return;
    if (axis === 'y' && e.target.closest('.drag-x')) return; // a horizontal strip handles its own drag
    active = true; dragging = false; pointer = e.pointerId; startPos = e[coord]; startScroll = el[prop];
  });
  el.addEventListener('pointermove', (e) => {
    if (!active || e.pointerId !== pointer) return;
    const delta = e[coord] - startPos;
    if (!dragging && Math.abs(delta) > 4) {
      dragging = true;
      el.setPointerCapture(pointer);
      el.classList.add('is-dragging');
    }
    if (dragging) el[prop] = startScroll - delta;
  });
  const stop = () => {
    if (!active) return;
    active = false;
    if (!dragging) return;
    dragging = false;
    el.classList.remove('is-dragging');
    const swallow = (e) => e.stopPropagation();
    el.addEventListener('click', swallow, { capture: true, once: true });
    setTimeout(() => el.removeEventListener('click', swallow, { capture: true }), 0);
  };
  el.addEventListener('pointerup', stop);
  el.addEventListener('pointercancel', stop);
}
