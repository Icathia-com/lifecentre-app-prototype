import { data } from '../firebase.js';
import { h, formatDay, safeUrl } from '../util.js';

function card(a) {
  const url = safeUrl(a.linkUrl);
  const link = url ? h('a', { class: 'link', href: url, target: '_blank', rel: 'noopener' }, `${a.linkLabel || 'Open link'} ›`) : null;
  const sample = a.sample ? h('span', { class: 'badge' }, 'Sample') : null;
  const when = formatDay(a.publishedAt, { weekday: 'short', day: 'numeric', month: 'short' });

  if (a.pinned) {
    return h('article', { class: 'pinned' },
      h('span', {}, h('span', { class: 'tag' }, 'PINNED')),
      h('h2', {}, a.title),
      a.body ? h('p', {}, a.body) : null,
      h('span', { class: 'when' }, when),
      sample,
      link);
  }
  return h('article', { class: 'card announcement' },
    h('span', { class: 'when' }, when),
    h('h2', {}, a.title),
    a.body ? h('p', {}, a.body) : null,
    sample,
    link);
}

export function render(root) {
  const feed = h('div', { class: 'stack', 'aria-busy': 'true' });
  const note = h('p', { class: 'note', role: 'status', hidden: '' });
  root.append(
    h('header', { class: 'screen-head' }, h('h1', { id: 'page-title', tabindex: '-1' }, 'Announcements')),
    feed,
    note);

  data.getAnnouncements().then(({ value, source }) => {
    feed.replaceChildren(...(value.length ? value.map(card) : [h('p', { class: 'note' }, 'No announcements yet.')]));
    feed.removeAttribute('aria-busy');
    note.hidden = source === 'live';
    if (source !== 'live') note.textContent = source === 'cache' ? "You're offline. Showing what was saved on this phone." : "You're offline. Showing sample content.";
  });
}
