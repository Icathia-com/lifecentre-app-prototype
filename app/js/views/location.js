// One location's page: address, Directions, Follow, and everything on there grouped by type (design/Events-Location.dc.html).
// Weekly gatherings come from sites.js (the times published on lifecentre.sg); events come from Firestore.
import { data } from '../firebase.js';
import { h, dateKey, addDays, dayStart } from '../util.js';
import { SITES, SITE_IDS, TYPES, TYPE_IDS, initials } from '../sites.js';
import { load, toggleInList, FOLLOW_SITES } from '../local.js';
import { ic, coverEl, eventTime, eventHref, longDate } from '../ui.js';

// The design's avatar colours, darkened just enough for the white initials to be readable (4.5:1).
const PALETTE = ['#D32A25', '#2459E6', '#2E7D5B', '#B4472A', '#6B4FA8', '#9A6200'];

function weeklyRow(item, i) {
  const av = h('span', { class: 'dot-av loc-av', 'aria-hidden': 'true' }, initials(item.person));
  av.style.background = PALETTE[i % PALETTE.length];
  return h('div', { class: 'loc-row' }, av,
    h('span', { class: 'min-text' }, h('b', {}, item.name), h('span', { class: 'muted' }, `${item.person} · ${item.role}`)),
    h('span', { class: 'when-col' }, h('small', {}, item.when), h('b', {}, item.time)));
}

function eventItem(ev) {
  return h('a', { class: 'loc-row', href: eventHref(ev) },
    coverEl(ev, { height: 60, radius: 14, fontSize: 9.5, width: '60px' }),
    h('span', { class: 'ev-text' },
      h('span', { class: 'ev-title clamp2' }, ev.title),
      h('span', { class: 'meta-line' }, h('span', {}, ic('clock', 13), `${longDate(ev.start)}, ${eventTime(ev)}`))));
}

export function render(root, params) {
  const siteId = SITES[params.id] ? params.id : 'yishun';
  const site = SITES[siteId];
  const today = dateKey();
  let type = 'all';
  let events = [];

  const followBtn = h('button', { type: 'button', class: 'follow-pill', onclick: () => { toggleInList(FOLLOW_SITES, siteId); drawFollow(); } });
  const sections = h('div', { class: 'stack' });
  const typeChips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Type' });
  const footer = h('p', { class: 'foot' });

  const hero = h('section', { class: 'loc-hero', 'aria-labelledby': 'page-title' },
    h('span', { class: 'kicker' }, 'LIFE CENTRE @'),
    h('h1', { id: 'page-title', tabindex: '-1' }, site.name),
    h('span', { class: 'addr' }, site.address),
    h('a', { class: 'dir-btn', href: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(site.address)}`, target: '_blank', rel: 'noopener' }, ic('nav', 15, 2.2), 'Directions'));
  hero.style.backgroundImage = `linear-gradient(135deg, ${site.grad[0]}, ${site.grad[1]})`;

  root.append(
    h('div', { class: 'loc-top' },
      h('a', { class: 'round-btn', href: '#/events', 'aria-label': 'Back to Events' }, ic('back', 20, 2.2)),
      followBtn),
    hero,
    h('div', { class: 'chips h-scroll-chips', role: 'group', 'aria-label': 'Location' },
      SITE_IDS.map((id) => h('a', { class: `chip${id === siteId ? ' on' : ''}`, href: `#/events/location/${id}`, 'aria-current': id === siteId ? 'true' : null }, SITES[id].name))),
    typeChips,
    sections,
    footer);

  function drawFollow() {
    const on = load(FOLLOW_SITES, []).includes(siteId);
    followBtn.replaceChildren(ic('bell', 16), on ? 'Following' : 'Follow');
    followBtn.setAttribute('aria-pressed', String(on));
    followBtn.setAttribute('aria-label', `${on ? 'Following' : 'Follow'} ${site.name}`);
    followBtn.classList.toggle('on', on);
  }
  drawFollow();

  function draw() {
    const mine = events.filter((e) => e.location === siteId);
    const groups = TYPE_IDS.map((k) => {
      const weekly = (site.weekly[k] ?? []).map(weeklyRow);
      const items = mine.filter((e) => e.type === k).sort((a, b) => a.start - b.start).map(eventItem);
      return { key: k, items: [...weekly, ...items] };
    }).filter((g) => g.items.length);

    typeChips.replaceChildren(...[{ id: 'all', label: 'All' }, ...groups.map((g) => ({ id: g.key, label: TYPES[g.key] }))].map((t) =>
      h('button', { type: 'button', class: `chip${t.id === type ? ' on' : ''}`, 'aria-pressed': String(t.id === type), onclick: () => { type = t.id; draw(); } }, t.label)));
    if (type !== 'all' && !groups.some((g) => g.key === type)) type = 'all';

    sections.replaceChildren(...groups.filter((g) => type === 'all' || g.key === type).map((g) => h('section', { class: 'loc-group', 'aria-label': TYPES[g.key] },
      h('div', { class: 'loc-group-head' }, h('h2', {}, TYPES[g.key]), h('span', {}, `${g.items.length} ${g.items.length === 1 ? 'item' : 'items'}`)),
      h('div', { class: 'card rows' }, g.items))));
    footer.textContent = `Weekly times from lifecentre.sg.${mine.some((e) => e.sample) ? ' Events are sample.' : ''}`;
  }
  draw();

  Promise.all([
    data.getEvents({ from: dayStart(today), to: dayStart(addDays(today, 180)), key: 'events-upcoming' }),
    data.getPinnedEvent(),
  ]).then(([{ value }, pinned]) => {
    events = pinned.value && !value.some((e) => e.id === pinned.value.id) ? [...value, pinned.value] : value;
    draw();
  });
}
