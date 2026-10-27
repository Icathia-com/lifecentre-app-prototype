import { data } from '../firebase.js';
import { onSession } from '../session.js';
import {
  h, icon, safeUrl, dateKey, addDays, dayStart, formatDay, formatClock, minutesOfDay, enableDragScroll,
} from '../util.js';
import { siteVenue } from '../sites.js';
import { ic, eventHref } from '../ui.js';

const DAYS = 15;     // yesterday, today and the next 13 days
const TODAY = 1;     // today's column, so today opens in the middle of the three visible days
const ROW = 64;      // height of a row of event tiles
const NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const STATUS = { done: 'Done ✓', next: 'Up next', later: 'Later' };

const PLUS = '<svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';
const BOOK = '<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>';

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
  const keys = Array.from({ length: DAYS }, (_, i) => addDays(today, i - TODAY));
  const dayMs = keys.map(dayStart);
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  let events = [];
  let slots = [];            // distinct start times, as minutes since midnight
  let at = new Map();        // "dayIndex|minutes" -> events starting then
  let rails = [];            // the time labels, one per slot
  let cells = [];            // the cells of each slot, one per day
  let loaded = false;
  let nextId = null;

  const verseBox = h('div', { 'aria-busy': 'true' });
  const bannerBox = h('div');
  const month = h('h2', { id: 'cal-h', class: 'month' });
  const todayNumber = formatDay(Date.now(), { day: 'numeric' });
  const badge = h('button', { type: 'button', class: 'today-badge', 'aria-label': `${todayNumber}, jump to today`, onclick: () => scrollToDay(TODAY - 1) }, todayNumber);
  const weekbar = h('div', { class: 'weekbar', role: 'group', 'aria-label': 'This week' });
  const rail = h('div', { class: 'rail' });
  const days = h('div', { class: 'days drag-x', role: 'group', 'aria-label': 'Church calendar days' });
  const empty = h('p', { class: 'muted', hidden: '', style: 'padding: 0 20px 12px' }, 'Nothing scheduled');
  const menu = h('div', { class: 'fab-menu', id: 'fab-menu', hidden: '' }, h('a', { href: '#/booking' }, icon(BOOK), 'Facilities Booking Request'));
  const fab = h('button', { type: 'button', class: 'fab', 'aria-label': 'Add', 'aria-expanded': 'false', 'aria-controls': 'fab-menu', onclick: () => setMenu(menu.hidden) }, icon(PLUS));
  const note = h('p', { class: 'note', role: 'status', hidden: '' });

  // The profile menu: a small "Contact us" link for everyone.
  const profileMenu = h('div', { class: 'profile-menu', id: 'profile-menu', hidden: '' }, h('a', { href: '#/contact' }, 'Contact us'));
  const avatar = h('button', { type: 'button', class: 'avatar', 'aria-label': 'Profile menu', 'aria-expanded': 'false', 'aria-controls': 'profile-menu', onclick: () => setProfile(profileMenu.hidden) });
  const setProfile = (open) => { profileMenu.hidden = !open; avatar.setAttribute('aria-expanded', String(open)); };
  const stopSession = onSession((session) => avatar.replaceChildren(session?.email ? session.email[0].toUpperCase() : icon(PERSON)));

  root.append(
    h('header', { class: 'greeting' },
      h('div', { class: 'top-row' }, h('a', { class: 'round-btn', href: '#/notifications', 'aria-label': 'Notifications' }, ic('bell', 20)), avatar, profileMenu),
      h('div', { class: 'lines' },
        h('p', { class: 'hello' }, 'Hello'),
        h('h1', { id: 'page-title', tabindex: '-1' }, 'Today'),
        h('p', { class: 'date' }, formatDay(Date.now(), { weekday: 'short', month: 'short', day: 'numeric' }, 'en-US')))),
    verseBox,
    bannerBox,
    h('section', { class: 'glass cal', 'aria-labelledby': 'cal-h' },
      h('div', { class: 'cal-head' }, month, badge),
      weekbar,
      h('div', { class: 'board' }, rail, days),
      empty,
      h('div', { class: 'fab-row' }, menu, fab)),
    note);
  enableDragScroll(days, 'x');

  const stateOf = (ev) => ((ev.end ?? ev.start + 3600000) <= Date.now() ? 'done' : ev.id === nextId ? 'next' : 'later');
  const colWidth = () => days.clientWidth / 3 || 100;
  const firstColumn = () => Math.max(0, Math.min(DAYS - 3, Math.round(days.scrollLeft / colWidth())));

  function scrollToDay(i) {
    days.scrollTo({ left: Math.max(0, Math.min(DAYS - 3, i)) * colWidth(), behavior: reduceMotion ? 'auto' : 'smooth' });
  }

  function setMenu(open) {
    menu.hidden = !open;
    fab.setAttribute('aria-expanded', String(open));
  }

  // Rows only take up room when something is on them in the three visible days; the month, badge and week bar follow the scroll.
  function layout() {
    const f = firstColumn();
    slots.forEach((m, s) => {
      let any = false;
      let most = 0;
      for (let i = f; i < f + 3; i++) {
        const n = (at.get(`${i}|${m}`) || []).length;
        if (n) any = true;
        most = Math.max(most, n);
      }
      const height = !any ? 0 : most >= 3 ? ROW + 32 : ROW;
      rails[s].style.height = `${height}px`;
      for (const cell of cells[s]) cell.style.height = `${height}px`;
    });

    const center = keys[f + 1];
    const year = formatDay(dayStart(center), { year: 'numeric' });
    month.textContent = formatDay(dayStart(center), { month: 'long' }) + (year !== formatDay(Date.now(), { year: 'numeric' }) ? ` ${year}` : '');
    badge.classList.toggle('on', TODAY >= f && TODAY <= f + 2);

    const monday = addDays(center, -((new Date(`${center}T00:00:00Z`).getUTCDay() + 6) % 7));
    weekbar.replaceChildren(...NAMES.map((name, j) => {
      const key = addDays(monday, j);
      const index = keys.indexOf(key);
      const visible = index >= f && index <= f + 2;
      return h('button', {
        type: 'button', class: visible ? 'in' : null, 'aria-label': formatDay(dayStart(key), { weekday: 'short', day: 'numeric', month: 'long' }),
        onclick: () => scrollToDay(index >= 0 ? index - 1 : key < keys[0] ? 0 : DAYS),
      }, name);
    }));
  }

  function buildBoard() {
    const keep = days.scrollLeft;
    at = new Map();
    const seen = new Set();
    for (const ev of events) {
      const i = keys.indexOf(dateKey(ev.start));
      if (i < 0) continue;
      const m = minutesOfDay(ev.start);
      seen.add(m);
      if (!at.has(`${i}|${m}`)) at.set(`${i}|${m}`, []);
      at.get(`${i}|${m}`).push(ev);
    }
    slots = [...seen].sort((a, b) => a - b);
    nextId = events.filter((e) => (e.end ?? e.start + 3600000) > Date.now()).sort((a, b) => a.start - b.start)[0]?.id ?? null;

    rails = slots.map((m) => h('div', { class: 'rail-row' }, h('span', {}, formatClock(m))));
    rail.replaceChildren(...rails);
    cells = slots.map(() => []);

    days.replaceChildren(...keys.map((key, i) => {
      const list = events.filter((e) => dateKey(e.start) === key);
      const finished = list.filter((e) => stateOf(e) === 'done').length;
      const isToday = i === TODAY;
      const head = h('button', { type: 'button', class: `col-head${isToday ? ' today' : ''}`, onclick: () => scrollToDay(i - 1) },
        h('span', { class: 'dow' }, formatDay(dayMs[i], { weekday: 'short' })),
        h('span', { class: 'ring-box' },
          h('span', { class: 'ring', style: `--c:${isToday ? '#E59A00' : '#2E9E5B'};--deg:${list.length ? Math.round((finished / list.length) * 360) : 0}deg` }),
          h('span', { class: 'num' }, formatDay(dayMs[i], { day: 'numeric' }))),
        h('span', { class: 'sr' }, `, ${list.length ? `${list.length} event${list.length > 1 ? 's' : ''}` : 'no events'}`));
      return h('div', { class: 'col' }, head, ...slots.map((m, s) => {
        const cell = h('div', { class: 'cell' }, ...(at.get(`${i}|${m}`) || []).map((ev) => {
          const state = stateOf(ev);
          return h('a', { class: `tile ${state}`, href: eventHref(ev), 'data-id': ev.id },
            h('span', { class: 't' }, ev.title),
            h('span', { class: 's' }, STATUS[state]),
            h('span', { class: 'sr' }, `, ${formatClock(m)}`));
        }));
        cells[s].push(cell);
        return cell;
      }));
    }));
    empty.hidden = !(loaded && events.length === 0);
    days.scrollLeft = keep;
    layout();
  }
  buildBoard();

  let queued = false;
  days.addEventListener('scroll', () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; layout(); });
  });
  const onKey = (e) => {
    if (e.key !== 'Escape') return;
    if (!menu.hidden) { setMenu(false); fab.focus(); }
    if (!profileMenu.hidden) { setProfile(false); avatar.focus(); }
  };
  const onPointer = (e) => {
    if (!menu.hidden && !e.target.closest('.fab-row')) setMenu(false);
    if (!profileMenu.hidden && !e.target.closest('.top-row')) setProfile(false);
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
  data.getEvents({ from: dayMs[0], to: dayStart(addDays(keys[0], DAYS)) }).then(({ value, source }) => {
    events = value;
    loaded = true;
    buildBoard();
    noteSource('events', source);
  });

  return () => {
    stopSession();
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('pointerdown', onPointer);
  };
}
