// The profile page, opened from the avatar on Home, for everyone with the app, signed in or not. A wide banner, the photo in a
// circle over it, the name and the bio or verse; chips for verses read, devotions done, the streak and the birthday; Edit
// profile and Share my profile; for people who post stories, their live stories with view counts and an Add story tile. The
// gear opens the Account screen (sign-in, sign-out, bookings and the staff tools). Everything shown is kept on this phone.
import { h, fill, dateKey } from '../util.js';
import { ic } from '../ui.js';
import { data } from '../firebase.js';
import { onSession } from '../session.js';
import { onBookingSession } from '../booking-api.js';
import { load } from '../local.js';
import { PROFILE_KEY, cleanProfile, birthdayLabel, shareMessage, shareTargets, APP_URL } from '../profile.js';
import { DAILY_KEY, dailyStats } from '../daily.js';
import { safeMedia, groupByAuthor } from '../stories.js';
import { openStories } from './story-viewer.js';
import { avatarEl } from './story-row.js';

const GEAR = '<svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>';
const FLAME = '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12.5 1.5c.8 4.2 6.5 7 7.2 13.2.6 5.4-3.3 8.8-7.7 8.8S4 20.6 4.3 15.6c.3-4.1 3.2-6 4.3-9.2.6 2.4.4 4.1 2.1 5.5.6-5.2 1.1-7.6 1.8-10.4z"/></svg>';
const CAKE = '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 21V12a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9M2 21h20M4 15.5c1.3 1 2.7 1 4 0s2.7-1 4 0 2.7 1 4 0 2.7-1 4 0M12 10V7M12 4.5v.01"/></svg>';
const svg = (markup) => { const t = document.createElement('template'); t.innerHTML = markup; return t.content.firstElementChild; };

// The photo shown for this person: the one set on this phone, else the staff photo, else initials.
export function profileAvatar(profile, staff, size) {
  if (profile.photo) { const img = h('img', { class: 'pf-photo', src: profile.photo, alt: '' }); img.style.width = img.style.height = `${size}px`; return img; }
  const el = avatarEl({ photo: staff?.photo, name: profile.name || staff?.displayName || staff?.name || '', email: staff?.email || 'member' }, size);
  el.classList.add('pf-photo');
  return el;
}

// The share sheet's stand-in when the phone has none.
export function openShareSheet(message, opener) {
  const targets = shareTargets(message);
  const wrap = h('div', { class: 'sheet-wrap share-sheet' });
  const close = () => { wrap.remove(); try { opener?.focus?.({ preventScroll: true }); } catch { /* gone */ } };
  const copyLabel = h('span', {}, 'Copy link');
  const copy = h('button', { type: 'button', class: 'sh-item', onclick: async () => {
    let ok = false;
    try { await navigator.clipboard.writeText(message); ok = true; } catch {
      // Clipboard blocked: copy from a hidden field instead.
      const field = h('textarea', { 'aria-hidden': 'true', tabindex: '-1', readonly: '', style: 'position:fixed;opacity:0;left:-9999px' });
      field.value = message;
      document.body.append(field);
      field.select();
      try { ok = document.execCommand('copy'); } catch { /* not supported */ }
      field.remove();
    }
    copyLabel.textContent = ok ? 'Copied' : 'Could not copy';
    setTimeout(() => { copyLabel.textContent = 'Copy link'; }, 2000);
  } }, h('span', { class: 'sh-ic' }, ic('copy', 20, 2)), copyLabel);
  const item = (href, icon, label, cls) => h('a', { class: `sh-item ${cls}`, href, target: href.startsWith('mailto:') ? null : '_blank', rel: 'noopener' }, h('span', { class: 'sh-ic' }, ic(icon, 20, 2)), label);
  const dialog = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'sh-title' },
    h('div', { class: 'sheet-top' },
      h('h2', { id: 'sh-title' }, 'Share'),
      h('button', { type: 'button', class: 'round-btn sheet-x', 'aria-label': 'Close', onclick: close }, ic('close', 18, 2.2))),
    h('p', { class: 'sh-msg' }, message),
    h('div', { class: 'sh-list' },
      copy,
      item(targets.whatsapp, 'chat', 'WhatsApp', 'wa'),
      item(targets.telegram, 'nav', 'Telegram', 'tg'),
      item(targets.email, 'mail', 'Email', 'em')));
  wrap.append(h('button', { type: 'button', class: 'sheet-back', 'aria-label': 'Close', tabindex: '-1', onclick: close }), dialog);
  wrap.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
  document.querySelector('.app').append(wrap);
  copy.focus();
  return close;
}

// The phone's own share sheet with the invitation, or the list above.
export async function shareProfile(profile, opener) {
  const message = shareMessage(profile, APP_URL);
  if (navigator.share) {
    try { await navigator.share({ text: message }); return null; } catch (err) { if (err?.name === 'AbortError') return null; }
  }
  return openShareSheet(message, opener);
}

export function render(root) {
  const profile = cleanProfile(load(PROFILE_KEY, {}));
  let staff = null;
  let member = null;
  let mine = null; // the poster's live stories, once loaded
  let closeStories = null;
  let closeShare = null;
  let alive = true;
  const host = h('div', { class: 'pf' });
  root.append(host);

  function storiesSection() {
    const tile = h('a', { class: 'pf-tile pf-add', href: '#/stories/new' }, h('span', { class: 'pf-add-ic' }, ic('plus', 26, 2.4)), h('span', {}, 'Add story'));
    const thumbs = (mine ?? []).map((s) => {
      const src = safeMedia(s.type === 'video' ? '' : s.mediaUrl || s.bgImage);
      const look = s.type === 'video' && safeMedia(s.mediaUrl)
        ? h('video', { class: 'pf-thumb-media', src: `${safeMedia(s.mediaUrl)}#t=0.5`, muted: '', playsinline: '', preload: 'metadata', 'aria-hidden': 'true' })
        : src ? h('img', { class: 'pf-thumb-media', src, alt: '' }) : h('span', { class: 'pf-thumb-media pf-thumb-plain', 'aria-hidden': 'true' }, ic(s.type === 'audio' ? 'mic' : 'chat', 22, 2));
      if (!src && !(s.type === 'video')) look.style.background = `linear-gradient(160deg, ${s.colours?.[0] || '#1B1740'}, ${s.colours?.[1] || '#3558C8'})`;
      const views = s.views ?? 0;
      // Watching starts at this story and carries on through the others.
      const watch = () => {
        const group = groupByAuthor(mine)[0];
        if (!group) return;
        const k = Math.max(0, group.stories.findIndex((x) => x.id === s.id));
        closeStories?.();
        closeStories = openStories({ groups: [{ ...group, stories: [...group.stories.slice(k), ...group.stories.slice(0, k)] }], me: { email: staff.email }, onClose: () => { closeStories = null; } });
      };
      return h('button', { type: 'button', class: 'pf-tile pf-thumb', 'aria-label': `${{ photo: 'Photo', video: 'Video', audio: 'Voice', text: 'Text' }[s.type] ?? 'Story'} story, ${views} ${views === 1 ? 'view' : 'views'}`, onclick: watch },
        look, h('span', { class: 'pf-views', 'aria-hidden': 'true' }, ic('eye', 13, 2.2), String(views)));
    });
    return h('section', { class: 'pf-stories', 'aria-labelledby': 'pf-stories-h' },
      h('h2', { id: 'pf-stories-h' }, 'Your stories'),
      h('div', { class: 'pf-strip drag-x' }, tile, thumbs));
  }

  function draw() {
    const stats = dailyStats(load(DAILY_KEY, {}), dateKey());
    const name = profile.name || staff?.displayName || member?.name || staff?.name || '';
    const banner = h('div', { class: 'pf-banner' });
    if (profile.banner) banner.style.backgroundImage = `url("${profile.banner}")`;
    const chip = (icon, value, label, cls = '') => h('li', { class: `pf-chip ${cls}`.trim() }, icon, h('b', {}, value), h('span', {}, label));
    const birthday = birthdayLabel(profile.birthday);
    const shareBtn = h('button', { type: 'button', class: 'btn pf-share', onclick: async () => { closeShare?.(); closeShare = await shareProfile(profile, shareBtn); } }, ic('share', 16, 2), 'Share my profile');
    fill(host,
      h('div', { class: 'pf-cover' }, banner,
        h('div', { class: 'pf-top' },
          h('a', { class: 'round-btn', href: '#/', 'aria-label': 'Back to Home' }, ic('back', 20, 2.2)),
          h('a', { class: 'round-btn pf-gear', href: '#/account', 'aria-label': 'Settings' }, svg(GEAR)))),
      h('div', { class: 'pf-head' },
        profileAvatar(profile, staff, 104),
        h('h1', { id: 'page-title', tabindex: '-1', class: name ? null : 'pf-noname' }, name || 'Your profile'),
        profile.bio ? h('p', { class: 'pf-bio' }, profile.bio) : null),
      h('ul', { class: 'pf-chips', 'aria-label': 'Your days with the verse' },
        chip(ic('book', 18, 2), String(stats.versesRead), stats.versesRead === 1 ? 'verse read' : 'verses read'),
        chip(ic('check', 18, 2.4), String(stats.devotionsDone), stats.devotionsDone === 1 ? 'devotion' : 'devotions'),
        chip(svg(FLAME), String(stats.streak), 'day streak', 'flame'),
        birthday ? chip(svg(CAKE), birthday, 'birthday', 'cake') : null),
      h('div', { class: 'pf-actions' },
        h('a', { class: 'btn primary pf-edit', href: '#/profile/edit' }, ic('edit', 16, 2), 'Edit profile'),
        shareBtn),
      staff?.postStories ? storiesSection() : null);
  }

  let loading = '';
  async function loadMine() {
    if (!staff?.postStories || loading === staff.email) return;
    const who = staff.email;
    loading = who;
    try { const { value } = await data.getStories(); if (alive && staff?.email === who) { mine = value.filter((s) => s.author === who).sort((a, b) => b.createdAt - a.createdAt); draw(); } } catch { /* the tile still works */ }
    loading = '';
  }

  const stopStaff = onSession((s) => {
    const was = staff?.email;
    staff = s?.email ? s : null;
    if (staff?.email !== was) mine = null;
    draw();
    if (staff?.postStories && mine === null) loadMine();
  });
  const stopMember = onBookingSession((m) => { member = m; draw(); });
  return () => { alive = false; closeStories?.(); closeShare?.(); stopStaff(); stopMember(); };
}
