import { data } from '../firebase.js';
import { onSession } from '../session.js';
import {
  h, icon, safeUrl, dateKey, addDays, dayStart, formatDay, formatClock, enableDragScroll,
} from '../util.js';
import { siteVenue } from '../sites.js';
import { ic, eventHref } from '../ui.js';
import { loadTasks, loadDailyTicks, itemsFor, progress, EVENT_WINDOW } from '../planner.js';
import { myBookings } from '../my-bookings.js';
import { openTaskSheet } from '../task-sheet.js';

const COLW = 100;    // every day column is 100px wide, so a wider screen simply shows more days
const TOTAL = 553;   // 26 weeks back and the year ahead, drawn only a few columns at a time
const TIDX = 182;    // today's column
const MARGIN = 10;   // columns kept drawn each side of the ones on screen
const ROW = 64;      // height of a row of cards
const LINE = 32;     // height of a row that only has slim daily lines
const NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const STATUS = { done: 'Done ✓', next: 'Up next', later: 'Later', missed: 'Missed' };

const PLUS = '<svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';
const BOOK = '<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>';
const TASK = '<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 12l3 3 5-6"/></svg>';

const PERSON = '<svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/></svg>';

const sampleBadge = (item) => (item.sample ? h('span', { class: 'badge' }, 'Sample') : null);

function verseCard(verse) {
  return h('section', { class: 'soft', 'aria-labelledby': 'verse-h' },
    h('div', { class: 'verse-card' },
      h('div', { class: 'verse-top' }, h('h2', { id: 'verse-h' }, 'Verse of the day'), h('span', { class: 'chip' }, verse.translation)),
      h('blockquote', {}, `“${verse.text}”`),
      h('cite', {}, `${verse.reference} · ${verse.translation}`),
      sampleBadge(verse)));
}

// The pinned event (the conference), shown as the "Coming up" banner.
function banner(ev) {
  const url = safeUrl(ev.registerUrl);
  const where = [siteVenue(ev.location, ev.place), ev.location !== 'other' && ev.place ? ev.place : null].filter(Boolean).join(' · ');
  return h('div', { class: 'banner' },
    h('span', { class: 'dot y', 'aria-hidden': 'true' }), h('span', { class: 'dot r', 'aria-hidden': 'true' }), h('span', { class: 'dot g', 'aria-hidden': 'true' }),
    h('p', { class: 'kicker' }, 'Coming up'),
    h('h2', {}, h('a', { href: eventHref(ev) }, ev.title)),
    h('p', { class: 'sub' }, `${formatDay(ev.start, { day: 'numeric', month: 'short', year: 'numeric' })} · ${where}`),
    sampleBadge(ev),
    h('a', { class: 'pill', href: url || eventHref(ev), target: url ? '_blank' : null, rel: url ? 'noopener' : null }, url ? 'Register' : 'Details'));
}

export function render(root) {
  const today = dateKey();
  const keys = Array.from({ length: TOTAL }, (_, i) => addDays(today, i - TIDX));
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

  let events = [];
  let bookings = [];
  let tasks = loadTasks();
  let ticks = loadDailyTicks();
  let first = TIDX - 1;      // the first column on screen
  let built = null;          // { ws, we } the columns that are drawn
  let byIndex = new Map();   // column index -> that day's items
  let slots = [];            // distinct start times, as minutes since midnight
  let at = new Map();        // "index|minutes" -> items starting then
  let rails = [];            // the time labels, one per slot
  let cells = [];            // the cells of each slot, one per drawn column
  let closeSheet = null;
  let alive = true;

  const verseBox = h('div', { 'aria-busy': 'true' });
  const bannerBox = h('div');
  const month = h('span', { id: 'cal-h', class: 'month' });
  const monthButton = h('button', { type: 'button', class: 'month-btn', 'aria-expanded': 'false', 'aria-controls': 'months', 'aria-label': 'Choose a month', onclick: () => setMonths(monthMenu.hidden) }, month, ic('down', 16, 2.2));
  const todayNumber = formatDay(Date.now(), { day: 'numeric' });
  const badge = h('button', { type: 'button', class: 'today-badge', 'aria-label': `${todayNumber}, jump to today`, onclick: () => { setMonths(false); jumpTo(TIDX - Math.floor(visible() / 2)); } }, todayNumber);
  const monthMenu = h('div', { class: 'month-menu', id: 'months', role: 'group', 'aria-label': 'Choose a month', hidden: '' });
  const weekbar = h('div', { class: 'weekbar', role: 'group', 'aria-label': 'This week' });
  const rail = h('div', { class: 'rail' });
  const days = h('div', { class: 'days drag-x', role: 'group', 'aria-label': 'Your days. Drag or swipe sideways for other days.' });
  const menu = h('div', { class: 'fab-menu', id: 'fab-menu', hidden: '' },
    h('button', { type: 'button', class: 'fab-item', onclick: () => { setMenu(false); addTask(); } }, icon(TASK), 'Add a task'),
    h('a', { href: '#/booking' }, icon(BOOK), 'Facilities Booking Request'));
  const fab = h('button', { type: 'button', class: 'fab', 'aria-label': 'Add', 'aria-expanded': 'false', 'aria-controls': 'fab-menu', onclick: () => setMenu(menu.hidden) }, icon(PLUS));
  const note = h('p', { class: 'note', role: 'status', hidden: '' });

  // The profile menu: a small "Contact us" link for everyone.
  const profileMenu = h('div', { class: 'profile-menu', id: 'profile-menu', hidden: '' }, h('a', { href: '#/contact' }, 'Contact us'));
  const avatar = h('button', { type: 'button', class: 'avatar', 'aria-label': 'Profile menu', 'aria-expanded': 'false', 'aria-controls': 'profile-menu', onclick: () => setProfile(profileMenu.hidden) });
  const setProfile = (open) => { profileMenu.hidden = !open; avatar.setAttribute('aria-expanded', String(open)); };
  const stopSession = onSession((session) => avatar.replaceChildren(session?.email ? session.email[0].toUpperCase() : icon(PERSON)));

  const calEl = h('section', { class: 'glass cal', 'aria-labelledby': 'cal-h' },
    h('div', { class: 'cal-head' }, h('h2', { class: 'month-h' }, monthButton), badge),
    monthMenu,
    weekbar,
    h('div', { class: 'board' }, rail, days),
    h('div', { class: 'fab-row' }, menu, fab));

  root.append(
    h('header', { class: 'greeting' },
      h('div', { class: 'top-row' }, h('a', { class: 'round-btn', href: '#/notifications', 'aria-label': 'Notifications' }, ic('bell', 20)), avatar, profileMenu),
      h('div', { class: 'lines' },
        h('p', { class: 'hello' }, 'Hello'),
        h('h1', { id: 'page-title', tabindex: '-1' }, 'Today'),
        h('p', { class: 'date' }, formatDay(Date.now(), { weekday: 'short', month: 'short', day: 'numeric' }, 'en-US')))),
    verseBox,
    bannerBox,
    calEl,
    note);
  enableDragScroll(days, 'x');

  const visible = () => Math.max(1, Math.round(days.clientWidth / COLW) || 3);
  const firstColumn = () => clamp(Math.round(days.scrollLeft / COLW), 0, TOTAL - 1);

  function scrollToDay(i, smooth = true) {
    days.scrollTo({ left: clamp(i, 0, TOTAL - visible()) * COLW, behavior: smooth && !reduceMotion ? 'smooth' : 'auto' });
  }
  const jumpTo = (i) => scrollToDay(i);

  function setMenu(open) {
    menu.hidden = !open;
    fab.setAttribute('aria-expanded', String(open));
  }
  function setMonths(open) {
    if (open) drawMonths();
    monthMenu.hidden = !open;
    calEl.classList.toggle('months-open', open);
    monthButton.setAttribute('aria-expanded', String(open));
  }

  function addTask() {
    closeSheet?.();
    const center = keys[clamp(first + Math.floor(visible() / 2), 0, TOTAL - 1)];
    closeSheet = openTaskSheet({ date: center, onChange: (next) => { tasks = next; buildBoard(true); } });
  }

  // Six months back and a year ahead, three to a row.
  function drawMonths() {
    const center = keys[clamp(first + Math.floor(visible() / 2), 0, TOTAL - 1)];
    const [cy, cm] = center.split('-').map(Number);
    const [ty, tm] = today.split('-').map(Number);
    const buttons = [];
    for (let k = -6; k <= 12; k++) {
      const y = ty + Math.floor((tm - 1 + k) / 12);
      const m = ((tm - 1 + k) % 12 + 12) % 12;
      const key = `${y}-${String(m + 1).padStart(2, '0')}-01`;
      const idx = clamp(Math.round((Date.parse(`${key}T00:00:00Z`) - Date.parse(`${keys[0]}T00:00:00Z`)) / 86400000), 0, TOTAL - 1);
      const on = cy === y && cm === m + 1;
      const name = formatDay(dayStart(key), { month: 'short' });
      buttons.push(h('button', {
        type: 'button', class: `month-pick${on ? ' on' : ''}`, 'aria-pressed': String(on), 'aria-label': formatDay(dayStart(key), { month: 'long', year: 'numeric' }),
        onclick: () => { setMonths(false); monthButton.focus(); jumpTo(idx); },
      }, y !== ty ? `${name} ’${String(y).slice(2)}` : name));
    }
    monthMenu.replaceChildren(...buttons);
  }

  // Rows only take up room when something is on them in the days on screen; the month, badge and week bar follow the scroll.
  function layout() {
    const f = clamp(firstColumn(), 0, TOTAL - 1);
    const v = visible();
    first = f;
    slots.forEach((m, s) => {
      let any = false;
      let most = 0;
      let card = false;
      for (let i = f; i < f + v; i++) {
        const list = at.get(`${i}|${m}`) || [];
        if (list.length) any = true;
        if (list.some((it) => it.kind !== 'daily')) card = true;
        most = Math.max(most, list.length);
      }
      const height = !any ? 0 : most >= 3 ? ROW + LINE : most === 2 || card ? ROW : LINE;
      rails[s].style.height = `${height}px`;
      for (const cell of cells[s]) cell.style.height = `${height}px`;
    });

    const mid = clamp(f + Math.floor(v / 2), 0, TOTAL - 1);
    const center = keys[mid];
    const year = formatDay(dayStart(center), { year: 'numeric' });
    month.textContent = formatDay(dayStart(center), { month: 'long' }) + (year !== formatDay(Date.now(), { year: 'numeric' }) ? ` ${year}` : '');
    monthButton.setAttribute('aria-label', `${month.textContent}, choose a month`);
    const todayShown = TIDX >= f && TIDX < f + v;
    badge.classList.toggle('on', todayShown);

    const monday = addDays(center, -((new Date(`${center}T00:00:00Z`).getUTCDay() + 6) % 7));
    weekbar.replaceChildren(...NAMES.map((name, j) => {
      const key = addDays(monday, j);
      const index = keys.indexOf(key);
      const visibleDay = index >= f && index < f + v;
      return h('button', {
        type: 'button', class: visibleDay ? 'in' : null, disabled: index < 0 ? '' : null,
        'aria-label': formatDay(dayStart(key), { weekday: 'short', day: 'numeric', month: 'long' }),
        onclick: () => jumpTo(index - Math.floor(v / 2)),
      }, name);
    }));

    // Draw more columns when the edge of the drawn ones gets close.
    if (!built || (f - MARGIN / 2 < built.ws && built.ws > 0) || (f + v + MARGIN / 2 > built.we && built.we < TOTAL - 1)) buildBoard();
  }

  // A block for one item: a slim line (the daily items), a card, or one row of a stack.
  function block(it, i, variant) {
    const href = it.kind === 'event' ? eventHref(it.event) : `#/day/${keys[i]}`;
    const cls = `tile ${it.state} ${variant}`;
    const status = variant === 'card' ? h('span', { class: 's' }, STATUS[it.state]) : h('span', { class: 's' }, it.state === 'done' ? '✓' : '');
    return h('a', { class: cls, href, 'data-id': it.ref },
      h('span', { class: 't' }, it.title),
      status,
      h('span', { class: 'sr' }, `, ${variant === 'card' ? '' : `${STATUS[it.state]}, `}${formatClock(it.min)}`));
  }

  function buildBoard(keepWindow = false) {
    const keep = days.scrollLeft;
    const v = visible();
    const f = clamp(firstColumn(), 0, TOTAL - 1);
    const ws = keepWindow && built ? built.ws : clamp(f - MARGIN, 0, TOTAL - 1);
    const we = keepWindow && built ? built.we : clamp(f + v + MARGIN, 0, TOTAL - 1);
    built = { ws, we };
    byIndex = new Map();
    at = new Map();
    const seen = new Set();
    for (let i = ws; i <= we; i++) {
      const items = itemsFor(keys[i], { events, bookings, tasks, ticks });
      byIndex.set(i, items);
      for (const it of items) {
        seen.add(it.min);
        const k = `${i}|${it.min}`;
        if (!at.has(k)) at.set(k, []);
        at.get(k).push(it);
      }
    }
    slots = [...seen].sort((a, b) => a - b);
    rails = slots.map((m) => h('div', { class: 'rail-row' }, h('span', {}, formatClock(m))));
    rail.replaceChildren(...rails);
    cells = slots.map(() => []);

    const columns = [];
    for (let i = ws; i <= we; i++) {
      const { done, total } = progress(byIndex.get(i));
      const isToday = i === TIDX;
      const head = h('a', { class: `col-head${isToday ? ' today' : ''}`, href: `#/day/${keys[i]}` },
        h('span', { class: 'dow' }, formatDay(dayStart(keys[i]), { weekday: 'short' })),
        h('span', { class: 'ring-box' },
          h('span', { class: 'ring', style: `--c:${isToday ? '#E59A00' : '#2E9E5B'};--deg:${Math.round((done / total) * 360)}deg` }),
          h('span', { class: 'num' }, formatDay(dayStart(keys[i]), { day: 'numeric' }))),
        h('span', { class: 'sr' }, `, ${done} of ${total} done`));
      columns.push(h('div', { class: 'col' }, head, ...slots.map((m, s) => {
        const list = at.get(`${i}|${m}`) || [];
        let kids;
        if (list.length === 1) kids = [block(list[0], i, list[0].kind === 'daily' ? 'line' : 'card')];
        else {
          const shown = list.length > 3 ? list.slice(0, 2) : list;
          kids = shown.map((it) => block(it, i, 'stack'));
          if (list.length > 3) kids.push(h('a', { class: 'tile more', href: `#/day/${keys[i]}` }, `+${list.length - 2} more`));
        }
        const cell = h('div', { class: 'cell' }, ...kids);
        cells[s].push(cell);
        return cell;
      })));
    }
    days.replaceChildren(h('div', { class: 'sp', style: `flex-basis:${ws * COLW}px` }), ...columns, h('div', { class: 'sp', style: `flex-basis:${(TOTAL - 1 - we) * COLW}px` }));
    if (Math.abs(days.scrollLeft - keep) > 0.5) days.scrollLeft = keep; // the total width is the same, so this only runs if the browser moved it (setting it would stop a smooth scroll)
    layout();
  }
  buildBoard();
  requestAnimationFrame(() => scrollToDay(TIDX - Math.floor(visible() / 2), false));

  // One day at a time: once scrolling stops, settle on the nearest day.
  let timer = null;
  const settle = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (days.classList.contains('is-dragging')) return;
      const target = clamp(Math.round(days.scrollLeft / COLW), 0, TOTAL - visible()) * COLW;
      if (Math.abs(days.scrollLeft - target) > 1) days.scrollTo({ left: target, behavior: reduceMotion ? 'auto' : 'smooth' });
    }, 140);
  };
  let queued = false;
  days.addEventListener('scroll', () => {
    settle();
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; if (alive) layout(); });
  });
  days.addEventListener('pointerup', settle);
  days.addEventListener('pointercancel', settle);
  const onKey = (e) => {
    if (e.key !== 'Escape') return;
    if (!menu.hidden) { setMenu(false); fab.focus(); }
    if (!profileMenu.hidden) { setProfile(false); avatar.focus(); }
    if (!monthMenu.hidden) { setMonths(false); monthButton.focus(); }
  };
  const onPointer = (e) => {
    if (!menu.hidden && !e.target.closest('.fab-row')) setMenu(false);
    if (!profileMenu.hidden && !e.target.closest('.top-row')) setProfile(false);
    if (!monthMenu.hidden && !e.target.closest('.month-menu, .month-btn')) setMonths(false);
  };
  document.addEventListener('keydown', onKey);
  document.addEventListener('pointerdown', onPointer);

  const sources = {};
  const noteSource = (name, source) => {
    sources[name] = source;
    const states = Object.values(sources).filter((s) => s !== 'live');
    note.hidden = states.length === 0;
    if (states.length) note.textContent = states.includes('fallback') ? "You're offline. Showing sample content." : "You're offline. Showing what was saved on this phone.";
  };

  data.getVerse(today).then(({ value, source }) => {
    verseBox.replaceChildren(verseCard(value));
    verseBox.removeAttribute('aria-busy');
    noteSource('verse', source === 'fallback' ? 'live' : source); // a backup verse is real content, not sample
  });
  data.getPinnedEvent().then(({ value, source }) => {
    bannerBox.replaceChildren(...(value ? [banner(value)] : []));
    noteSource('pinned', source);
  });
  data.getEvents({ from: dayStart(addDays(today, -EVENT_WINDOW.before)), to: dayStart(addDays(today, EVENT_WINDOW.after)), key: 'events' }).then(({ value, source }) => {
    if (!alive) return;
    events = value;
    buildBoard();
    noteSource('events', source);
  });
  // The signed-in member's own room bookings (nobody else's) join their calendar.
  myBookings().then((list) => { if (alive && list.length) { bookings = list; buildBoard(); } });

  return () => {
    alive = false;
    clearTimeout(timer);
    closeSheet?.();
    stopSession();
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('pointerdown', onPointer);
  };
}
