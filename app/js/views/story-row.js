// The row of story circles at the top of Home: one per person with a live story, newest first. A bright ring until all of
// their stories have been watched on this phone, grey after that. Someone signed in who may post gets their own circle
// first, with a + to post. The row is hidden when nobody has a story (and the viewer is not a poster).
import { h, enableDragScroll } from '../util.js';
import { initials } from '../sites.js';
import { circleLabel, seenAll, safeMedia } from '../stories.js';

const hue = (email) => [...String(email)].reduce((n, c) => n + c.charCodeAt(0), 0) % 360;

// A round picture: the person's photo, or their initials on a colour of their own.
export function avatarEl({ photo, name, email }, size = 54) {
  const src = safeMedia(photo);
  // The initials are drawn by CSS from data-initials, so a button around the avatar is named by its label alone.
  const el = src ? h('img', { class: 'st-av', src, alt: '' }) : h('span', { class: 'st-av', 'data-initials': initials(name || email || 'Life Centre'), 'aria-hidden': 'true' });
  el.style.width = `${size}px`; el.style.height = `${size}px`;
  if (!src) { const hh = hue(email || name || ''); el.style.background = `linear-gradient(135deg, hsl(${hh} 70% 52%), hsl(${(hh + 40) % 360} 65% 36%))`; el.style.fontSize = `${Math.round(size * 0.3)}px`; }
  return el;
}

export function createStoriesRow({ onOpen, onPost }) {
  const row = h('div', { class: 'st-row drag-x', role: 'group', 'aria-label': 'Stories' });
  const strip = h('section', { class: 'st-strip', 'aria-label': 'Stories', hidden: '' }, row);
  enableDragScroll(row, 'x');

  function circle(group, index, { seen, own }) {
    const watched = seenAll(group, seen);
    const button = h('button', {
      type: 'button', class: `st-ring${watched ? ' seen' : ''}`,
      'aria-label': `${own ? 'Your stories' : `Stories from ${group.name}`}, ${group.stories.length} ${group.stories.length === 1 ? 'story' : 'stories'}${watched ? ', watched' : ', new'}`,
      onclick: () => onOpen(index),
    }, avatarEl(group));
    return h('div', { class: 'st-circle' }, button,
      own ? h('a', { class: 'st-plus', href: '#/stories/new', 'aria-label': 'Add to your story', onclick: (e) => { if (onPost) { e.preventDefault(); onPost(); } } }) : null,
      h('span', { class: 'st-label', 'aria-hidden': 'true' }, own ? 'Your story' : circleLabel(group)));
  }

  // A poster with no live story: a circle of their own that goes straight to posting.
  function postCircle(me) {
    return h('div', { class: 'st-circle' },
      h('a', { class: 'st-ring empty', href: '#/stories/new', 'aria-label': 'Post a story', onclick: (e) => { if (onPost) { e.preventDefault(); onPost(); } } }, avatarEl({ photo: me.photo, name: me.name, email: me.email })),
      h('span', { class: 'st-plus', 'aria-hidden': 'true' }),
      h('span', { class: 'st-label', 'aria-hidden': 'true' }, 'Your story'));
  }

  // groups: from groupByAuthor; seen: { [author]: createdAt }; me: { email, canPost, name, photo } or null.
  // Drawn again only when something changed, so a tap never lands on a circle that was just replaced.
  let drawn = '';
  function update({ groups, seen, me }) {
    const key = JSON.stringify([groups.map((g) => [g.author, g.name, g.photo, g.newest, g.stories.length, seenAll(g, seen)]), me]);
    if (key === drawn) return;
    drawn = key;
    const mine = me?.canPost ? groups.findIndex((g) => g.author === me.email) : -1;
    const ordered = mine > 0 ? [groups[mine], ...groups.filter((_, i) => i !== mine)] : groups;
    const circles = ordered.map((g) => circle(g, groups.indexOf(g), { seen, own: me?.canPost && g.author === me.email }));
    if (me?.canPost && mine < 0) circles.unshift(postCircle(me));
    row.replaceChildren(...circles);
    strip.hidden = circles.length === 0;
  }

  return { el: strip, update };
}
