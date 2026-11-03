// The full-screen story viewer. One person's stories play part after part (a recording is one file, watched in 30-second
// parts, so there is no gap and no repeated or skipped second between parts), with a progress bar per part across the top.
// Tap the right side for the next part and the left for the one before, hold to pause, swipe left or right (or drag with a
// mouse) for the next or previous person, swipe down to close. The keyboard works too. At the end of a person's stories the
// next person's begin; after the last person the viewer closes. Sound is on for video and voice.
import { h } from '../util.js';
import { ic } from '../ui.js';
import { data } from '../firebase.js';
import { load, save, STORIES_SEEN, STORIES_COUNTED } from '../local.js';
import { flatten, markSeen, timeAgo, safeMedia, PALETTE } from '../stories.js';
import { avatarEl } from './story-row.js';

const HOLD_MS = 220;    // a press this long pauses
const SWIPE_X = 60;     // sideways: change person
const SWIPE_DOWN = 70;  // downwards: close

export function openStories({ groups, startIndex = 0, me = null, onClose, host = document.querySelector('.app') ?? document.body, now = Date.now }) {
  if (!groups.length) return () => {};
  let g = Math.max(0, Math.min(groups.length - 1, startIndex));
  let flat = flatten(groups[g]);
  let i = 0;
  let paused = false;
  let closed = false;
  let mountedId = null;
  let el = null;          // the <video> or <audio> on screen
  let stillStart = 0;     // for a photo or text: when its time started running
  let stillDone = 0;      // and how much of it had run before a pause
  let raf = 0;
  let press = null;       // { x, y, t, id, moved, held, timer }
  let seen = load(STORIES_SEEN, {});
  const counted = new Set(load(STORIES_COUNTED, []));
  const opener = document.activeElement;

  const bars = h('div', { class: 'st-bars', 'aria-hidden': 'true' });
  const media = h('div', { class: 'st-media' });
  const caption = h('p', { class: 'st-text', hidden: '' });
  const nameEl = h('b', {});
  const timeEl = h('small', {});
  const views = h('span', { class: 'st-views', hidden: '' });
  const who = h('div', { class: 'st-who' });
  const closeBtn = h('button', { type: 'button', class: 'st-x', 'aria-label': 'Close', onclick: () => end() }, ic('close', 22, 2.4));
  const live = h('p', { class: 'sr', role: 'status' });
  // Buttons for the keyboard and screen readers (the touch gestures do the same)
  const prevBtn = h('button', { type: 'button', class: 'sr', onclick: () => step(-1) }, 'Previous part');
  const nextBtn = h('button', { type: 'button', class: 'sr', onclick: () => step(1) }, 'Next part');
  const prevPerson = h('button', { type: 'button', class: 'sr', onclick: () => changePerson(-1) }, 'Previous person');
  const nextPerson = h('button', { type: 'button', class: 'sr', onclick: () => changePerson(1) }, 'Next person');
  const pauseBtn = h('button', { type: 'button', class: 'sr', onclick: () => (paused ? resume() : pause()) }, 'Pause');
  const stage = h('div', { class: 'st-stage', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Stories', tabindex: '-1' },
    media, h('div', { class: 'st-shade top', 'aria-hidden': 'true' }), h('div', { class: 'st-shade bottom', 'aria-hidden': 'true' }),
    bars, h('div', { class: 'st-head' }, who, views, closeBtn), caption,
    h('div', { class: 'st-keys' }, prevBtn, nextBtn, prevPerson, nextPerson, pauseBtn), live);
  const layer = h('div', { class: 'st-layer' }, stage);

  const current = () => flat[i];
  const partLength = (p) => Math.max(0.1, p.end - p.start);
  let playToken = 0; // which part's playback set-up is the latest one

  // A recording made on a phone carries no length, so the browser cannot jump about in it until it has worked the length
  // out: asking for the very end once makes it do that. Resolves when the file can be seeked.
  function whenSeekable(media) {
    return new Promise((resolve) => {
      const finite = () => Number.isFinite(media.duration);
      if (media.readyState >= 1 && finite()) { resolve(); return; }
      media.addEventListener('loadedmetadata', () => {
        if (finite()) { resolve(); return; }
        const fixed = () => { media.removeEventListener('timeupdate', fixed); media.currentTime = 0; resolve(); };
        media.addEventListener('timeupdate', fixed);
        media.currentTime = 1e101;
      }, { once: true });
    });
  }
  // Captions for a video: its text, or who it is from, for the whole of it.
  const captionsFor = (story) => `data:text/vtt,${encodeURIComponent(`WEBVTT\n\n00:00:00.000 --> 00:59:59.000\n${story.text || `Video story from ${story.authorName || ''}`}`)}`;

  function paintBars(fraction) {
    bars.replaceChildren(...flat.map((_, k) => {
      const fill = h('span', { class: 'st-bar-fill' });
      fill.style.width = k < i ? '100%' : k === i ? `${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}%` : '0%';
      return h('span', { class: 'st-bar' }, fill);
    }));
  }
  const paintFraction = (fraction) => { const fills = bars.children; if (fills[i]) fills[i].firstChild.style.width = `${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}%`; };

  function stopMedia() {
    cancelAnimationFrame(raf);
    if (el) { try { el.pause(); } catch { /* not started */ } el.onended = null; el.ontimeupdate = null; }
  }

  function mount(story) {
    stopMedia();
    el = null;
    mountedId = story.id;
    const [a, b] = Array.isArray(story.colours) && story.colours.length === 2 ? story.colours : PALETTE[0];
    media.style.background = `linear-gradient(160deg, ${a}, ${b})`;
    const bgImage = safeMedia(story.bgImage);
    const kids = [];
    if (story.type === 'video') {
      el = h('video', { class: 'st-video', src: safeMedia(story.mediaUrl), playsinline: '', 'webkit-playsinline': '', preload: 'auto' },
        h('track', { kind: 'captions', srclang: 'en', label: 'Captions', src: captionsFor(story) }));
      kids.push(el);
    } else if (story.type === 'audio') {
      el = h('audio', { src: safeMedia(story.mediaUrl), preload: 'auto' });
      kids.push(bgImage ? h('img', { class: 'st-photo', src: bgImage, alt: '' }) : null, h('div', { class: 'st-voice', 'aria-hidden': 'true' }, ic('mic', 44, 1.8), h('span', {}, 'Voice')), el);
    } else if (story.type === 'photo') kids.push(h('img', { class: 'st-photo', src: safeMedia(story.mediaUrl), alt: story.text || '' }));
    else kids.push(h('div', { class: 'st-textstory' }, story.text || ''));
    media.replaceChildren(...kids.filter(Boolean));
    caption.textContent = story.type === 'text' ? '' : (story.text || '');
    caption.hidden = !caption.textContent;
    if (el) { el.muted = false; el.volume = 1; el.ready = whenSeekable(el); }
  }

  function show() {
    const cur = current();
    if (!cur) { end(); return; }
    const { story, part } = cur;
    const group = groups[g];
    if (story.id !== mountedId) mount(story);
    else stopMedia();
    who.replaceChildren(avatarEl(group, 34), nameEl, timeEl);
    nameEl.textContent = group.name;
    timeEl.textContent = timeAgo(story.createdAt, now());
    const own = me?.email && story.author === me.email;
    views.hidden = !own;
    views.textContent = own ? `${story.views ?? 0} ${story.views === 1 ? 'view' : 'views'}` : '';
    stage.setAttribute('aria-label', `Stories from ${group.name}, part ${i + 1} of ${flat.length}`);
    live.textContent = `${group.name}, part ${i + 1} of ${flat.length}${story.text ? `: ${story.text}` : ''}`;
    paintBars(0);
    paused = false;
    pauseBtn.textContent = 'Pause';
    // seen on this phone, and one more view for the poster (once per phone, never their own)
    seen = markSeen(seen, { author: group.author, newest: story.createdAt });
    save(STORIES_SEEN, seen);
    if (!own && !counted.has(story.id)) { counted.add(story.id); save(STORIES_COUNTED, [...counted].slice(-500)); data.countStoryView(story.id).catch(() => {}); }
    if (el) {
      const token = ++playToken;
      const target = el;
      target.ontimeupdate = null;
      target.ready.then(() => {
        if (closed || token !== playToken || target !== el) return;
        const at = Math.max(0, part.start);
        if (Math.abs(target.currentTime - at) > 0.35) { try { target.currentTime = at; } catch { /* not loaded yet */ } }
        target.ontimeupdate = () => {
          if (paused) return;
          const t = target.currentTime;
          if (t >= part.end - 0.05) { advance(); return; }
          paintFraction((t - part.start) / partLength(part));
        };
        target.onended = () => advance();
        if (!paused) target.play().catch(() => { /* the browser wants a tap first: the hold/tap handlers call play again */ });
      });
    } else {
      stillDone = 0;
      stillStart = now();
      tick();
    }
  }

  function tick() {
    cancelAnimationFrame(raf);
    const run = () => {
      if (closed || paused || el) return;
      const length = partLength(current().part) * 1000;
      const elapsed = stillDone + (now() - stillStart);
      if (elapsed >= length) { advance(); return; }
      paintFraction(elapsed / length);
      raf = requestAnimationFrame(run);
    };
    raf = requestAnimationFrame(run);
  }

  const advance = () => step(1);
  function step(d) {
    if (closed) return;
    const next = i + d;
    if (next >= flat.length) { changePerson(1); return; }
    if (next < 0) { if (g > 0) changePerson(-1); else { i = 0; show(); } return; }
    i = next;
    show();
  }
  function changePerson(d) {
    const next = g + d;
    if (next >= groups.length) { end(); return; }
    if (next < 0) { i = 0; show(); return; }
    g = next; flat = flatten(groups[g]); i = 0; mountedId = null;
    show();
  }
  function pause() {
    if (paused) return;
    paused = true; pauseBtn.textContent = 'Play';
    if (el) el.pause(); else { stillDone += now() - stillStart; cancelAnimationFrame(raf); }
  }
  function resume() {
    if (!paused) return;
    paused = false; pauseBtn.textContent = 'Pause';
    if (el) el.play().catch(() => {}); else { stillStart = now(); tick(); }
  }

  // Touch, mouse and pen: tap, hold, swipe and drag.
  stage.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button, a') || (e.pointerType === 'mouse' && e.button !== 0)) return;
    press = { x: e.clientX, y: e.clientY, t: now(), id: e.pointerId, moved: false, held: false, timer: setTimeout(() => { if (press) { press.held = true; pause(); } }, HOLD_MS) };
    try { stage.setPointerCapture(e.pointerId); } catch { /* fine */ }
  });
  stage.addEventListener('pointermove', (e) => {
    if (!press || e.pointerId !== press.id) return;
    if (Math.abs(e.clientX - press.x) > 8 || Math.abs(e.clientY - press.y) > 8) { press.moved = true; clearTimeout(press.timer); }
  });
  const release = (e) => {
    if (!press || e.pointerId !== press.id) return;
    const p = press; press = null;
    clearTimeout(p.timer);
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    if (p.held) { resume(); if (!p.moved) return; }
    if (p.moved) {
      if (dy > SWIPE_DOWN && Math.abs(dy) > Math.abs(dx)) end();
      else if (Math.abs(dx) > SWIPE_X) changePerson(dx < 0 ? 1 : -1);
      return;
    }
    if (e.type === 'pointercancel') return;
    step(p.x < stage.clientWidth / 3 ? -1 : 1);
  };
  stage.addEventListener('pointerup', release);
  stage.addEventListener('pointercancel', release);

  const onKey = (e) => {
    if (closed) return;
    if (e.key === 'Escape' || e.key === 'ArrowDown') { e.preventDefault(); end(); return; }
    if (e.key === 'ArrowRight') { e.preventDefault(); if (e.shiftKey) changePerson(1); else step(1); return; }
    if (e.key === 'ArrowLeft') { e.preventDefault(); if (e.shiftKey) changePerson(-1); else step(-1); return; }
    if (e.key === 'PageDown') { e.preventDefault(); changePerson(1); return; }
    if (e.key === 'PageUp') { e.preventDefault(); changePerson(-1); return; }
    if (e.key === ' ') { e.preventDefault(); if (paused) resume(); else pause(); return; }
    if (e.key === 'Tab') {
      const stops = [...stage.querySelectorAll('button')];
      const at = stops.indexOf(document.activeElement);
      if (e.shiftKey && at <= 0) { e.preventDefault(); stops.at(-1).focus(); }
      else if (!e.shiftKey && at === stops.length - 1) { e.preventDefault(); stops[0].focus(); }
    }
  };
  document.addEventListener('keydown', onKey);

  function end() {
    if (closed) return;
    closed = true;
    stopMedia();
    if (el) { try { el.src = ''; } catch { /* fine */ } }
    document.removeEventListener('keydown', onKey);
    layer.remove();
    onClose?.({ seen });
    if (opener?.isConnected && typeof opener.focus === 'function') opener.focus();
  }

  host.append(layer);
  show();
  closeBtn.focus();
  return end;
}
