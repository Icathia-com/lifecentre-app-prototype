import { data } from '../firebase.js';
import {
  h, dateKey, addDays, dayStart, formatDay, formatTimeRange, googleCalendarUrl, icsDataUrl, enableDragScroll,
} from '../util.js';

const DAYS = 14;
const sampleBadge = (item) => (item.sample ? h('span', { class: 'badge' }, 'Sample') : null);

function verseCard(verse) {
  return h('section', { class: 'card verse', 'aria-labelledby': 'verse-h' },
    h('div', { class: 'card-row' },
      h('h2', { id: 'verse-h', class: 'label' }, 'Verse of the day'),
      h('span', { class: 'chip' }, verse.translation)),
    h('blockquote', {}, `“${verse.text}”`),
    h('cite', {}, verse.reference),
    sampleBadge(verse));
}

function banner(pinned) {
  return h('a', { class: 'pinned', href: '#/announcements' },
    h('span', {}, h('span', { class: 'tag' }, 'PINNED')),
    h('h2', {}, pinned.title),
    pinned.body ? h('p', {}, pinned.body) : null,
    sampleBadge(pinned),
    h('span', { class: 'more' }, 'Read more ›'));
}

function eventItem(ev) {
  return h('li', { class: 'event' },
    h('span', { class: 'time' }, formatTimeRange(ev.start, ev.end)),
    h('h3', {}, ev.title),
    ev.location ? h('p', { class: 'muted' }, ev.location) : null,
    sampleBadge(ev),
    h('p', { class: 'add' },
      h('span', { class: 'muted' }, 'Add to my calendar'),
      h('a', { href: googleCalendarUrl(ev), target: '_blank', rel: 'noopener' }, 'Google Calendar'),
      h('a', { href: icsDataUrl(ev), download: `${ev.title}.ics` }, 'Apple / Outlook')));
}

export function render(root) {
  const today = dateKey();
  const keys = Array.from({ length: DAYS }, (_, i) => addDays(today, i));

  const verseBox = h('div', { 'aria-busy': 'true' });
  const bannerBox = h('div');
  const strip = h('div', { class: 'strip drag-x', role: 'group', 'aria-label': 'Days' });
  const list = h('ul', { class: 'events', 'aria-live': 'polite' });
  const note = h('p', { class: 'note', role: 'status', hidden: '' });
  root.append(
    h('header', { class: 'screen-head' },
      h('p', { class: 'eyebrow' }, formatDay(Date.now(), { weekday: 'long', day: 'numeric', month: 'long' })),
      h('h1', { id: 'page-title', tabindex: '-1' }, 'Life Centre')),
    verseBox,
    bannerBox,
    h('section', { class: 'card', 'aria-labelledby': 'cal-h' }, h('h2', { id: 'cal-h', class: 'label' }, 'Church calendar'), strip, list),
    note);
  enableDragScroll(strip, 'x');

  let byDay = {};
  let selected = today;
  let loaded = false;

  // The day buttons are built once and updated in place, so keyboard focus stays where it is.
  const buttons = keys.map((key) => {
    const summary = h('span', { class: 'sr' });
    const button = h('button', { type: 'button', class: 'day', onclick: () => { selected = key; paint(); } },
      h('span', { class: 'dow' }, formatDay(dayStart(key), { weekday: 'short' })), ' ',
      h('span', { class: 'num' }, formatDay(dayStart(key), { day: 'numeric' })),
      h('span', { class: 'dot', 'aria-hidden': 'true' }),
      summary);
    return { key, button, summary };
  });
  strip.append(...buttons.map((b) => b.button));

  function paint() {
    for (const { key, button, summary } of buttons) {
      const count = (byDay[key] || []).length;
      button.classList.toggle('has-events', count > 0);
      button.setAttribute('aria-pressed', String(key === selected));
      summary.textContent = `, ${count ? `${count} event${count > 1 ? 's' : ''}` : 'no events'}`;
    }
    const events = byDay[selected] || [];
    list.replaceChildren(...(events.length ? events.map(eventItem) : loaded ? [h('li', { class: 'muted' }, 'Nothing scheduled')] : []));
  }
  paint();

  const offline = (sources) => {
    const states = sources.filter((s) => s !== 'live');
    note.hidden = states.length === 0;
    if (states.length) note.textContent = states.includes('fallback') ? "You're offline. Showing sample content." : "You're offline. Showing what was saved on this phone.";
  };
  const sources = {};
  const noteSource = (name, source) => { sources[name] = source; offline(Object.values(sources)); };

  data.getVerse(today).then(({ value, source }) => {
    verseBox.replaceChildren(verseCard(value));
    verseBox.removeAttribute('aria-busy');
    noteSource('verse', source === 'fallback' ? 'live' : source); // a backup verse is real content, not sample
  });
  data.getAnnouncements().then(({ value, source }) => {
    const pinned = value.find((a) => a.pinned);
    bannerBox.replaceChildren(...(pinned ? [banner(pinned)] : []));
    noteSource('announcements', source);
  });
  data.getEvents({ from: dayStart(today), to: dayStart(addDays(today, DAYS)) }).then(({ value, source }) => {
    byDay = {};
    loaded = true;
    for (const ev of value) (byDay[dateKey(ev.start)] ||= []).push(ev);
    paint();
    noteSource('events', source);
  });
}
