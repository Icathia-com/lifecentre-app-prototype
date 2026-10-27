// The Events tab: "Upcoming" (the pinned conference, then events grouped by day) and "Discover" (popular this week,
// browse by location, ministries to follow). Layout follows design/Events.dc.html.
import { data } from '../firebase.js';
import { onSession } from '../session.js';
import { h, dateKey, addDays, dayStart, formatDay, enableDragScroll } from '../util.js';
import { SITES, SITE_IDS, TYPES, MINISTRIES, siteName, siteVenue, weeklyCount, initials } from '../sites.js';
import { load, save, toggleInList, FOLLOW_MINISTRIES, EVENTS_VIEW } from '../local.js';
import { ic, coverEl, hostDot, eventTime, eventPlace, dayHeading, groupByDay, metaLine, eventHref } from '../ui.js';

const WINDOW_DAYS = 180;

function pinnedCard(ev) {
  const where = [siteVenue(ev.location, ev.place), ev.location !== 'other' && ev.place ? ev.place : null].filter(Boolean).join(' · ');
  return h('a', { class: 'feature', href: eventHref(ev) },
    h('span', { class: 'deco y', 'aria-hidden': 'true' }), h('span', { class: 'deco r', 'aria-hidden': 'true' }), h('span', { class: 'deco g', 'aria-hidden': 'true' }),
    h('span', { class: 'feature-top' }, h('span', { class: 'tag' }, 'PINNED'), h('span', { class: 'when' }, formatDay(ev.start, { day: 'numeric', month: 'short', year: 'numeric' }))),
    h('span', { class: 'feature-title' }, ev.title),
    h('span', { class: 'feature-where' }, where),
    ev.sample ? h('span', { class: 'badge' }, 'Sample') : null,
    h('span', { class: 'feature-go' }, ev.registerUrl ? 'Register' : 'Details', ic('right', 16, 2.2)));
}

function eventRow(ev) {
  return h('a', { class: 'ev-row', href: eventHref(ev) },
    coverEl(ev, { height: 72, radius: 16, fontSize: 11, width: '72px' }),
    h('span', { class: 'ev-text' },
      h('span', { class: 'ev-host' }, hostDot(ev), h('span', { class: 'ellipsis' }, ev.host || 'Life Centre')),
      h('span', { class: 'ev-title clamp2' }, ev.title),
      metaLine(ev)));
}

export function render(root) {
  const today = dateKey();
  let view = load(EVENTS_VIEW, 'up') === 'disc' ? 'disc' : 'up';
  let loc = 'all';
  let query = '';
  let events = [];
  let pinned = null;
  let loaded = false;
  let locOpen = false;
  let searchOpen = false;

  const panel = h('div', { id: 'events-panel', role: 'tabpanel', class: 'stack' });
  const upTab = h('button', { type: 'button', role: 'tab', id: 'tab-up', 'aria-controls': 'events-panel', onclick: () => setView('up') }, 'Upcoming');
  const discTab = h('button', { type: 'button', role: 'tab', id: 'tab-disc', 'aria-controls': 'events-panel', onclick: () => setView('disc') }, 'Discover');
  const search = h('input', { type: 'search', 'aria-label': 'Search events', placeholder: 'Search events', oninput: (e) => { query = e.target.value.trim().toLowerCase(); if (view !== 'up') setView('up'); else draw(); } });
  const searchRow = h('div', { class: 'search-row', hidden: '' }, search);
  const searchBtn = h('button', { type: 'button', class: 'round-btn', 'aria-label': 'Search events', 'aria-expanded': 'false', onclick: () => {
    searchOpen = !searchOpen;
    searchRow.hidden = !searchOpen;
    searchBtn.setAttribute('aria-expanded', String(searchOpen));
    if (searchOpen) search.focus(); else { search.value = ''; query = ''; draw(); }
  } }, ic('search', 20));
  const note = h('p', { class: 'note', role: 'status', hidden: '' });
  const fab = h('a', { class: 'fab-pill', href: '#/events/new', hidden: '' }, ic('plus', 18, 2.2), 'Event');
  document.querySelector('.app').append(fab);

  root.append(
    h('header', { class: 'ev-head' }, h('h1', { id: 'page-title', tabindex: '-1' }, 'Events'), searchBtn),
    searchRow,
    h('div', { class: 'seg', role: 'tablist', 'aria-label': 'Events view' }, upTab, discTab),
    panel,
    note);

  function setView(next) {
    view = next;
    save(EVENTS_VIEW, view);
    locOpen = false;
    draw();
  }

  const matches = (ev) => !query || [ev.title, ev.host, eventPlace(ev), TYPES[ev.type]].some((s) => String(s || '').toLowerCase().includes(query));

  function upcoming() {
    const section = h('div', { class: 'stack' });
    if (pinned && !query) section.append(pinnedCard(pinned));

    const locMenu = h('div', { class: 'menu', role: 'menu', hidden: locOpen ? null : '' },
      ['all', ...SITE_IDS].map((id) => h('button', {
        type: 'button', role: 'menuitem', class: id === loc ? 'on' : null,
        onclick: () => { loc = id; locOpen = false; draw(); },
      }, id === 'all' ? 'All locations' : SITES[id].name)));
    const locBtn = h('button', { type: 'button', class: 'pill-btn', 'aria-haspopup': 'menu', 'aria-expanded': String(locOpen), onclick: () => { locOpen = !locOpen; draw(); } },
      loc === 'all' ? 'All locations' : SITES[loc].name, ic('down', 16, 2.2));

    const shown = events.filter((ev) => ev.id !== pinned?.id && (loc === 'all' || ev.location === loc) && matches(ev));
    section.append(h('div', { class: 'sec-head' },
      h('div', { class: 'sec-title' }, h('span', {}, query ? 'Results' : 'Coming up'), shown.some((e) => e.sample) ? h('small', {}, 'Sample events') : null),
      h('div', { class: 'menu-wrap' }, locBtn, locMenu)));

    const groups = groupByDay(shown);
    if (!groups.length) {
      section.append(h('div', { class: 'card' }, h('p', { class: 'muted' }, loaded
        ? (query ? 'No events match your search.' : `Nothing coming up at ${loc === 'all' ? 'any location' : SITES[loc].name}.`)
        : 'Loading…')));
    }
    for (const g of groups) {
      const [a, b] = dayHeading(g.key, today);
      section.append(h('div', { class: 'day-group' },
        h('h2', { class: 'day-head' }, h('b', {}, a), ' / ', h('span', {}, b)),
        h('div', { class: 'card rows' }, g.events.map(eventRow))));
    }
    return section;
  }

  function discover() {
    const week = events.filter((ev) => ev.start < dayStart(addDays(today, 7)) && (ev.end ?? ev.start) >= Date.now())
      .sort((a, b) => (b.going ?? 0) - (a.going ?? 0) || a.start - b.start);
    const ranked = week.some((e) => e.going);
    const scroller = h('div', { class: 'h-scroll drag-x' }, week.map((ev) => h('a', { class: 'pop-card', href: eventHref(ev) },
      coverEl(ev, { height: 112, radius: 18, fontSize: 15 }),
      h('span', { class: 'pop-title clamp2' }, ev.title),
      h('span', { class: 'pop-when' }, `${dayHeading(dateKey(ev.start), today)[0]}, ${eventTime(ev)} · ${eventPlace(ev)}`))));
    enableDragScroll(scroller, 'x');

    const follows = load(FOLLOW_MINISTRIES, []);
    return h('div', { class: 'stack' },
      h('div', { class: 'sec-head' },
        h('div', { class: 'sec-title' }, h('span', {}, ranked ? 'Popular this week' : 'This week'), week.some((e) => e.sample) ? h('small', {}, 'Sample events') : null),
        h('button', { type: 'button', class: 'text-btn', onclick: () => setView('up') }, 'View all', ic('right', 14, 2.2))),
      week.length ? scroller : h('div', { class: 'card' }, h('p', { class: 'muted' }, loaded ? 'Nothing on this week.' : 'Loading…')),

      h('h2', { class: 'sec-title big-title' }, 'Browse by location'),
      h('div', { class: 'site-grid' }, SITE_IDS.map((id) => {
        const s = SITES[id];
        const n = weeklyCount(s);
        const ne = events.filter((e) => e.location === id && e.id !== pinned?.id).length;
        const first = Object.values(s.weekly)[0][0];
        const hero = h('span', { class: 'site-hero' }, h('span', { class: 'site-ic', 'aria-hidden': 'true' }, ic('site', 18)), h('span', { class: 'site-name' }, s.name));
        hero.style.backgroundImage = `linear-gradient(135deg, ${s.grad[0]}, ${s.grad[1]})`;
        return h('a', { class: 'site-card', href: `#/events/location/${id}` }, hero,
          h('span', { class: 'site-info' },
            h('span', { class: 'site-count' }, `${n} weekly ${n === 1 ? 'gathering' : 'gatherings'} · ${ne} ${ne === 1 ? 'event' : 'events'}`),
            h('span', { class: 'site-next' }, `${first.when}, ${first.time}`)));
      })),

      h('h2', { class: 'sec-title big-title' }, 'Ministries to follow'),
      h('div', { class: 'card rows' }, MINISTRIES.map((m) => {
        const on = follows.includes(m.id);
        const av = h('span', { class: 'dot-av big', 'aria-hidden': 'true' }, initials(m.name));
        av.style.backgroundImage = `linear-gradient(135deg, ${m.grad[0]}, ${m.grad[1]})`;
        return h('div', { class: 'min-row' }, av,
          h('span', { class: 'min-text' }, h('b', {}, m.name), h('span', { class: 'muted' }, m.line)),
          h('button', {
            type: 'button', class: `follow-btn${on ? ' on' : ''}`, 'aria-pressed': String(on), 'aria-label': `${on ? 'Following' : 'Follow'} ${m.name}`,
            onclick: () => { toggleInList(FOLLOW_MINISTRIES, m.id); draw(); },
          }, on ? 'Following' : 'Follow'));
      })));
  }

  function draw() {
    upTab.setAttribute('aria-selected', String(view === 'up'));
    discTab.setAttribute('aria-selected', String(view === 'disc'));
    panel.setAttribute('aria-labelledby', view === 'up' ? 'tab-up' : 'tab-disc');
    panel.replaceChildren(view === 'up' ? upcoming() : discover());
  }
  draw();

  const onPointer = (e) => { if (locOpen && !e.target.closest('.menu-wrap')) { locOpen = false; draw(); } };
  const onKey = (e) => { if (e.key === 'Escape' && locOpen) { locOpen = false; draw(); } };
  document.addEventListener('pointerdown', onPointer);
  document.addEventListener('keydown', onKey);
  const stopSession = onSession((session) => { fab.hidden = !['admin', 'staff'].includes(session?.role); });

  const from = dayStart(today);
  data.getEvents({ from, to: dayStart(addDays(today, WINDOW_DAYS)), key: 'events-upcoming' }).then(({ value, source }) => {
    events = value;
    loaded = true;
    if (source !== 'live') { note.hidden = false; note.textContent = source === 'cache' ? "You're offline. Showing what was saved on this phone." : "You're offline. Showing sample content."; }
    draw();
  });
  data.getPinnedEvent().then(({ value }) => { pinned = value; draw(); });

  return () => {
    fab.remove();
    stopSession();
    document.removeEventListener('pointerdown', onPointer);
    document.removeEventListener('keydown', onKey);
  };
}
