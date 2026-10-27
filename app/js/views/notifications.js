// Notifications, opened from the Home bell (design/Notifications.dc.html).
// Activity: church notices (the old Announcements) and new events at the places and ministries you follow.
// Settings: on/off switches kept on this phone. Nothing is pushed to the phone yet.
import { data } from '../firebase.js';
import { onSession, isOnStaffList } from '../session.js';
import { h, dateKey, addDays, dayStart, formatDay, formatClock, minutesOfDay, safeUrl } from '../util.js';
import { MINISTRIES, CHURCH, siteName } from '../sites.js';
import { load, save, notifSettings, NOTIF_SETTINGS, NOTIF_READ, FOLLOW_MINISTRIES, FOLLOW_SITES } from '../local.js';
import { ic, longDate, eventTime, eventHref } from '../ui.js';

const KIND = { notice: ['megaphone', '#E5322D'], event: ['ticket', '#2F6BFF'] };
const DAY = 86400000;

const SECTIONS = [
  { label: 'Events you’re going to', rows: [['rem', 'Reminders'], ['chg', 'Changes and cancellations']] },
  { label: 'Places and ministries you follow', rows: [['newev', 'New events']] },
  { label: 'From the church', rows: [['notice', 'Church notices'], ['story', 'Stories and devotions'], ['verse', 'Verse of the day']] },
];

// "9:00 AM" today, "Mon" this week, "12 Oct" before that.
function timeLabel(ms, now = Date.now()) {
  const days = Math.round((dayStart(dateKey(now)) - dayStart(dateKey(ms))) / DAY);
  if (days <= 0) return formatClock(minutesOfDay(ms));
  if (days < 7) return formatDay(ms, { weekday: 'short' });
  return formatDay(ms, { day: 'numeric', month: 'short' });
}

function groupLabel(ms, now = Date.now()) {
  const days = Math.round((dayStart(dateKey(now)) - dayStart(dateKey(ms))) / DAY);
  return days <= 0 ? 'Today' : days < 7 ? 'This week' : 'Earlier';
}

export function render(root) {
  let view = 'act';
  let notices = [];
  let events = [];
  let session = null;
  let loaded = 0;
  let source = 'live';
  const body = h('div', { class: 'stack' });
  const markAll = h('button', { type: 'button', class: 'mark-all', onclick: () => { save(NOTIF_READ, [...new Set([...load(NOTIF_READ, []), ...items().map((i) => i.id)])]); draw(); } }, 'Mark all read');
  const actTab = h('button', { type: 'button', role: 'tab', id: 'tab-act', 'aria-controls': 'notif-panel', onclick: () => { view = 'act'; draw(); } }, 'Activity');
  const setTab = h('button', { type: 'button', role: 'tab', id: 'tab-set', 'aria-controls': 'notif-panel', onclick: () => { view = 'set'; draw(); } }, 'Settings');

  root.append(
    h('a', { class: 'round-btn back-top', href: '#/', 'aria-label': 'Back to Home' }, ic('back', 20, 2.2)),
    h('header', { class: 'nf-head' }, h('h1', { id: 'page-title', tabindex: '-1' }, 'Notifications'), markAll),
    h('div', { class: 'seg', role: 'tablist', 'aria-label': 'Notifications view' }, actTab, setTab),
    body);

  // What shows in Activity, newest first, respecting the switches in Settings.
  function items() {
    const settings = notifSettings();
    const list = [];
    if (settings.notice) {
      for (const n of notices) {
        list.push({ id: `notice:${n.id}`, kind: 'notice', at: n.publishedAt, title: n.title, body: `${n.body ? `${n.body} ` : ''}From ${CHURCH.name}.`, href: safeUrl(n.linkUrl), sample: n.sample });
      }
    }
    if (settings.newev) {
      const sites = load(FOLLOW_SITES, []);
      const types = MINISTRIES.filter((m) => load(FOLLOW_MINISTRIES, []).includes(m.id));
      const week = Date.now() - 7 * DAY;
      for (const ev of events) {
        if (!ev.createdAt || ev.createdAt < week || ev.createdAt > Date.now()) continue;
        const ministry = types.find((m) => m.type === ev.type);
        if (!ministry && !sites.includes(ev.location)) continue;
        list.push({
          id: `event:${ev.id}`, kind: 'event', at: ev.createdAt, title: `New at ${siteName(ev.location, ev.place)}: ${ev.title}`,
          body: `${longDate(ev.start)}, ${eventTime(ev)}. You follow ${ministry ? ministry.name : siteName(ev.location)}.`, href: eventHref(ev), sample: ev.sample,
        });
      }
    }
    return list.sort((a, b) => b.at - a.at);
  }

  function activity() {
    const read = new Set(load(NOTIF_READ, []));
    const list = items();
    markAll.hidden = !list.some((i) => !read.has(i.id));
    if (!list.length) return h('div', { class: 'card' }, h('p', { class: 'muted' }, loaded < 2 ? 'Loading…' : 'Nothing new.'));
    const groups = [];
    for (const item of list) {
      const label = groupLabel(item.at);
      if (groups.at(-1)?.label !== label) groups.push({ label, items: [] });
      groups.at(-1).items.push(item);
    }
    return h('div', { class: 'stack' }, groups.map((g) => h('section', { class: 'nf-group', 'aria-label': g.label },
      h('h2', { class: 'day-head' }, g.label),
      h('div', { class: 'card rows' }, g.items.map((i) => {
        const [icn, colour] = KIND[i.kind];
        const circle = h('span', { class: 'nf-ic', 'aria-hidden': 'true' }, ic(icn, 20));
        circle.style.background = colour;
        const content = [circle,
          h('span', { class: 'nf-text' }, h('b', {}, i.title), h('span', { class: 'muted' }, i.body), i.sample ? h('span', { class: 'badge' }, 'Sample') : null),
          h('span', { class: 'nf-meta' }, h('small', {}, timeLabel(i.at)), h('span', { class: `unread${read.has(i.id) ? ' off' : ''}`, role: 'img', 'aria-label': read.has(i.id) ? 'Read' : 'Unread' }))];
        const markRead = () => save(NOTIF_READ, [...new Set([...load(NOTIF_READ, []), i.id])]);
        return i.href
          ? h('a', { class: 'nf-row', href: i.href, target: i.href.startsWith('#') ? null : '_blank', rel: i.href.startsWith('#') ? null : 'noopener', onclick: markRead }, content)
          : h('div', { class: 'nf-row' }, content);
      })))));
  }

  function settings() {
    const t = notifSettings();
    const sections = [...SECTIONS, ...(isOnStaffList(session) ? [{ label: 'Staff', rows: [['book', 'Booking requests']] }] : [])];
    return h('div', { class: 'stack' }, sections.map((s) => h('section', { class: 'nf-group', 'aria-label': s.label },
      h('h2', { class: 'cr-section' }, s.label.toUpperCase()),
      h('div', { class: 'card rows' }, s.rows.map(([key, label]) => h('div', { class: 'cr-row top-sep' },
        h('span', { class: 'cr-label' }, label),
        h('button', {
          type: 'button', role: 'switch', class: 'cr-switch', 'aria-checked': String(!!t[key]), 'aria-label': label,
          onclick: () => { save(NOTIF_SETTINGS, { ...notifSettings(), [key]: !t[key] }); draw(); },
        }, h('span', { class: 'knob' }))))))));
  }

  function draw() {
    actTab.setAttribute('aria-selected', String(view === 'act'));
    setTab.setAttribute('aria-selected', String(view === 'set'));
    body.setAttribute('role', 'tabpanel');
    body.id = 'notif-panel';
    body.setAttribute('aria-labelledby', view === 'act' ? 'tab-act' : 'tab-set');
    markAll.hidden = view !== 'act';
    body.replaceChildren(view === 'act' ? activity() : settings());
    if (view === 'act' && source !== 'live') body.append(h('p', { class: 'note', role: 'status' }, source === 'cache' ? "You're offline. Showing what was saved on this phone." : "You're offline. Showing sample content."));
  }
  draw();

  const stop = onSession((next) => { session = next; if (view === 'set') draw(); });
  const today = dateKey();
  data.getAnnouncements().then(({ value, source: s }) => { notices = value; loaded++; if (s !== 'live') source = s; draw(); });
  data.getEvents({ from: dayStart(today), to: dayStart(addDays(today, 180)), key: 'events-upcoming' }).then(({ value, source: s }) => { events = value; loaded++; if (s !== 'live') source = s; draw(); });
  return stop;
}
